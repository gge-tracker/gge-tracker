import { NodeClickHouseClient } from '@clickhouse/client/dist/client';
import { ApiHelper } from '../api-helper';

export interface WoaEvent {
  date: string;
  participants: string;
  total_tickets: string;
  id: string;
}

export interface WoaSnapshot {
  collectedAt: string;
  participants: number;
  totalTickets: number;
}

interface WoaAggregateRow {
  created_at: string;
  participants: string | number;
  total_points: string | number;
}

interface ServerCatalog {
  snapshots: WoaSnapshot[];
  checkedAt: number;
  rebuiltAt: number;
  refreshing: Promise<WoaSnapshot[] | null> | null;
}

const WOA_TABLE = 'wheel_unimaginable_affluence';
const SNAPSHOT_TOTALS_KEY_PREFIX = 'woa:events:totals';
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
        id: ApiHelper.encodeDate(date),
      };
    });
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
          SUM(point) AS total_points
        FROM ${database}.${WOA_TABLE}
        ${since === null ? '' : 'WHERE created_at >= {since:DateTime}'}
        GROUP BY created_at
        ORDER BY created_at DESC
      `,
      query_params: since === null ? {} : { since },
    });
    const json = (await rawResult.json()) as { data: WoaAggregateRow[] };
    return json.data.map((row) => ({
      collectedAt: row.created_at,
      participants: Number(row.participants),
      totalTickets: Number(row.total_points),
    }));
  }

  private static async readStoredSnapshots(code: string): Promise<WoaSnapshot[]> {
    const stored = await ApiHelper.redisClient
      .hGetAll(WoaEventsCatalogCache.totalsKey(code))
      .catch(() => ({}) as Record<string, string>);

    return Object.entries(stored)
      .map(([collectedAt, totals]) => {
        const [participants, totalTickets] = totals.split(':');
        return { collectedAt, participants: Number(participants), totalTickets: Number(totalTickets) };
      })
      .filter((snapshot) => Number.isFinite(snapshot.participants) && Number.isFinite(snapshot.totalTickets))
      .sort(WoaEventsCatalogCache.byCollectedAtDesc);
  }

  private static async storeSnapshots(code: string, snapshots: WoaSnapshot[], replaceAll: boolean): Promise<void> {
    const key = WoaEventsCatalogCache.totalsKey(code);
    if (replaceAll) await ApiHelper.redisClient.del(key).catch(() => 0);
    if (snapshots.length === 0) return;

    const fields: Record<string, string> = {};
    snapshots.forEach((snapshot) => {
      fields[snapshot.collectedAt] = `${snapshot.participants}:${snapshot.totalTickets}`;
    });
    await ApiHelper.redisClient.hSet(key, fields).catch(() => 0);
    await ApiHelper.redisClient.expire(key, SNAPSHOT_TOTALS_TTL_SECONDS).catch(() => 0);
  }

  private static totalsKey(code: string): string {
    return `${SNAPSHOT_TOTALS_KEY_PREFIX}:${code}`;
  }
}
