import { NodeClickHouseClient } from '@clickhouse/client/dist/client';
import { ApiHelper } from '../api-helper';

export interface WoaEvent {
  date: string;
  participants: string;
  total_tickets: string;
  top1_score: number;
  top10_score: number;
  top_floor_players: number;
  id: string;
}

export interface WoaEventsStats {
  prize_floors: number[];
  top10_score_quartiles: [number, number, number] | null;
}

export interface WoaSnapshot {
  collectedAt: string;
  participants: number;
  totalTickets: number;
  top1Score: number;
  top10Score: number;
  topFloorPlayers: number;
}

interface WoaAggregateRow {
  created_at: string;
  participants: string | number;
  total_points: string | number;
  top1_score: string | number;
  top10_score: string | number;
  top_floor_players: string | number;
}

interface ServerCatalog {
  snapshots: WoaSnapshot[];
  checkedAt: number;
  rebuiltAt: number;
  refreshing: Promise<WoaSnapshot[] | null> | null;
}

const WOA_TABLE = 'wheel_unimaginable_affluence';
const SNAPSHOT_TOTALS_KEY_PREFIX = 'woa:events:totals:v2';
const PRIZE_FLOORS = [10, 30, 60, 100, 150, 210, 290, 390];
const TOP_FLOOR_TICKETS = PRIZE_FLOORS.at(-1);
const PRIZE_RANK = 10;
const SNAPSHOT_TOTALS_TTL_SECONDS = 30 * 24 * 60 * 60;

export abstract class WoaEventsCatalogCache {
  private static readonly FRESHNESS_FLOOR_MS = 60 * 1000;
  private static readonly FULL_REBUILD_MS = 6 * 60 * 60 * 1000;

  private static readonly catalogs = new Map<string, ServerCatalog>();

  public static async current(
    code: string,
    database: string,
    clickhouseClient: NodeClickHouseClient,
  ): Promise<WoaSnapshot[] | null> {
    const catalog = WoaEventsCatalogCache.catalogOf(code);
    if (catalog.checkedAt > 0 && Date.now() - catalog.checkedAt < WoaEventsCatalogCache.FRESHNESS_FLOOR_MS) {
      return catalog.snapshots;
    }

    const refresh = WoaEventsCatalogCache.refresh(catalog, code, database, clickhouseClient);
    return catalog.checkedAt > 0 ? catalog.snapshots : refresh;
  }

  public static page(snapshots: WoaSnapshot[], offset: number, limit: number): WoaEvent[] {
    return snapshots.slice(offset, offset + limit).map((snapshot) => {
      const date = new Date(snapshot.collectedAt).toISOString();
      return {
        date,
        participants: String(snapshot.participants),
        total_tickets: String(snapshot.totalTickets),
        top1_score: snapshot.top1Score,
        top10_score: snapshot.top10Score,
        top_floor_players: snapshot.topFloorPlayers,
        id: ApiHelper.encodeDate(date),
      };
    });
  }

  public static stats(snapshots: WoaSnapshot[]): WoaEventsStats {
    const scores = snapshots.map((snapshot) => snapshot.top10Score).sort((left, right) => left - right);
    const quartiles: [number, number, number] | null =
      scores.length === 0
        ? null
        : [
            WoaEventsCatalogCache.quantile(scores, 0.25),
            WoaEventsCatalogCache.quantile(scores, 0.5),
            WoaEventsCatalogCache.quantile(scores, 0.75),
          ];
    return { prize_floors: PRIZE_FLOORS, top10_score_quartiles: quartiles };
  }

  private static quantile(sorted: number[], fraction: number): number {
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
  }

  private static catalogOf(code: string): ServerCatalog {
    const known = WoaEventsCatalogCache.catalogs.get(code);
    if (known) return known;

    const catalog: ServerCatalog = { snapshots: [], checkedAt: 0, rebuiltAt: Date.now(), refreshing: null };
    WoaEventsCatalogCache.catalogs.set(code, catalog);
    return catalog;
  }

  private static refresh(
    catalog: ServerCatalog,
    code: string,
    database: string,
    clickhouseClient: NodeClickHouseClient,
  ): Promise<WoaSnapshot[] | null> {
    catalog.refreshing ??= WoaEventsCatalogCache.build(catalog, code, database, clickhouseClient)
      .catch((error) => {
        ApiHelper.logError(error, 'WoaEventsCatalogCache.refresh', null);
        return catalog.checkedAt > 0 ? catalog.snapshots : null;
      })
      .finally(() => {
        catalog.refreshing = null;
      });
    return catalog.refreshing;
  }

  private static async build(
    catalog: ServerCatalog,
    code: string,
    database: string,
    clickhouseClient: NodeClickHouseClient,
  ): Promise<WoaSnapshot[]> {
    const rebuilding = Date.now() - catalog.rebuiltAt >= WoaEventsCatalogCache.FULL_REBUILD_MS;
    const known = rebuilding ? [] : await WoaEventsCatalogCache.knownSnapshots(catalog, code);
    const newest = known[0]?.collectedAt ?? null;

    const aggregated = await WoaEventsCatalogCache.aggregate(database, clickhouseClient, newest);
    const byCollectedAt = new Map(known.map((snapshot) => [snapshot.collectedAt, snapshot]));
    aggregated.forEach((snapshot) => byCollectedAt.set(snapshot.collectedAt, snapshot));

    const snapshots = [...byCollectedAt.values()].sort(WoaEventsCatalogCache.byCollectedAtDesc);
    catalog.snapshots = snapshots;
    catalog.checkedAt = Date.now();
    if (rebuilding) catalog.rebuiltAt = catalog.checkedAt;

    await WoaEventsCatalogCache.storeSnapshots(code, rebuilding ? snapshots : aggregated, rebuilding);
    return snapshots;
  }

  private static async knownSnapshots(catalog: ServerCatalog, code: string): Promise<WoaSnapshot[]> {
    if (catalog.checkedAt > 0) return catalog.snapshots;
    return WoaEventsCatalogCache.readStoredSnapshots(code);
  }

  private static byCollectedAtDesc(left: WoaSnapshot, right: WoaSnapshot): number {
    if (left.collectedAt === right.collectedAt) return 0;
    return left.collectedAt < right.collectedAt ? 1 : -1;
  }

  private static async aggregate(
    database: string,
    clickhouseClient: NodeClickHouseClient,
    since: string | null,
  ): Promise<WoaSnapshot[]> {
    const rawResult = await clickhouseClient.query({
      query: `
        SELECT
          created_at,
          COUNT(DISTINCT player_id) AS participants,
          SUM(point) AS total_points,
          MAX(point) AS top1_score,
          arrayElement(arrayReverseSort(groupArray(point)), least({prizeRank:UInt32}, COUNT())) AS top10_score,
          countIf(point >= {topFloor:UInt32}) AS top_floor_players
        FROM ${database}.${WOA_TABLE}
        ${since === null ? '' : 'WHERE created_at >= {since:DateTime}'}
        GROUP BY created_at
        ORDER BY created_at DESC
      `,
      query_params: {
        prizeRank: PRIZE_RANK,
        topFloor: TOP_FLOOR_TICKETS,
        ...(since === null ? {} : { since }),
      },
    });
    const json = (await rawResult.json()) as { data: WoaAggregateRow[] };
    return json.data.map((row) => ({
      collectedAt: row.created_at,
      participants: Number(row.participants),
      totalTickets: Number(row.total_points),
      top1Score: Number(row.top1_score),
      top10Score: Number(row.top10_score),
      topFloorPlayers: Number(row.top_floor_players),
    }));
  }

  private static async readStoredSnapshots(code: string): Promise<WoaSnapshot[]> {
    const stored = await ApiHelper.redisClient
      .hGetAll(WoaEventsCatalogCache.totalsKey(code))
      .catch(() => ({}) as Record<string, string>);

    return Object.entries(stored)
      .map(([collectedAt, totals]) => {
        const [participants, totalTickets, top1Score, top10Score, topFloorPlayers] = totals.split(':').map(Number);
        return { collectedAt, participants, totalTickets, top1Score, top10Score, topFloorPlayers };
      })
      .filter((snapshot) =>
        [
          snapshot.participants,
          snapshot.totalTickets,
          snapshot.top1Score,
          snapshot.top10Score,
          snapshot.topFloorPlayers,
        ].every(Number.isFinite),
      )
      .sort(WoaEventsCatalogCache.byCollectedAtDesc);
  }

  private static async storeSnapshots(code: string, snapshots: WoaSnapshot[], replaceAll: boolean): Promise<void> {
    const key = WoaEventsCatalogCache.totalsKey(code);
    if (replaceAll) await ApiHelper.redisClient.del(key).catch(() => 0);
    if (snapshots.length === 0) return;

    const fields: Record<string, string> = {};
    snapshots.forEach((snapshot) => {
      fields[snapshot.collectedAt] = [
        snapshot.participants,
        snapshot.totalTickets,
        snapshot.top1Score,
        snapshot.top10Score,
        snapshot.topFloorPlayers,
      ].join(':');
    });
    await ApiHelper.redisClient.hSet(key, fields).catch(() => 0);
    await ApiHelper.redisClient.expire(key, SNAPSHOT_TOTALS_TTL_SECONDS).catch(() => 0);
  }

  private static totalsKey(code: string): string {
    return `${SNAPSHOT_TOTALS_KEY_PREFIX}:${code}`;
  }
}
