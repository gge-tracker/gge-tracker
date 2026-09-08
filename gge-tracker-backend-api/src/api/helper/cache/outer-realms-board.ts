import { NodeClickHouseClient } from '@clickhouse/client/dist/client';
import { ApiHelper } from '../api-helper';

const OUTER_REALMS_TABLE = 'ggetracker_global.outer_realms_ranking';

interface OuterRealmsRankingRow {
  player_id: number;
  player_name: string;
  server: string;
  score: number;
  rank: number;
  level: number;
  legendary_level: number;
  might: number;
  castle_position_x: number | null;
  castle_position_y: number | null;
  score_diff: string;
  rank_diff: string;
}

interface OuterRealmsPlayer {
  player_id: number;
  player_name: string;
  server: string;
  score: number;
  rank: number;
  level: number;
  legendary_level: number;
  might: number;
  rank_diff: number;
  score_diff: number;
  castle_position: [number | null, number | null];
}

interface OuterRealmsSnapshotDates {
  lastDate: string | null;
  previousDate: string | null;
}

export interface OuterRealmsPage {
  players: OuterRealmsPlayer[];
  totalItems: number;
}

export class OuterRealmsBoard {
  private readonly players: OuterRealmsPlayer[];
  private readonly namesLower: string[];
  private readonly serverByPlayerId = new Map<number, string>();

  constructor(
    public readonly snapshot: string,
    rows: OuterRealmsRankingRow[],
  ) {
    this.players = rows.map((row) => ({
      player_id: row.player_id,
      player_name: row.player_name,
      server: row.server,
      score: row.score,
      rank: row.rank,
      level: row.level,
      legendary_level: row.legendary_level,
      might: row.might,
      rank_diff: Number(row.rank_diff),
      score_diff: Number(row.score_diff),
      castle_position: [row.castle_position_x, row.castle_position_y],
    }));
    this.namesLower = rows.map((row) => row.player_name.toLowerCase());
    rows.forEach((row) => this.serverByPlayerId.set(row.player_id, row.server));
  }

  public get collectedAt(): Date {
    return new Date(this.snapshot);
  }

  public slice(nameFilter: string | null, offset: number, limit: number): OuterRealmsPage {
    const matches = nameFilter === null ? null : this.matchingIndices(nameFilter);
    const totalItems = matches === null ? this.players.length : matches.length;
    const end = Math.min(offset + limit, totalItems);
    const players: OuterRealmsPlayer[] = [];
    for (let position = offset; position < end; position++) {
      players.push(this.players[matches === null ? position : matches[position]]);
    }
    return { players, totalItems };
  }

  public serverOf(playerId: number): string | null {
    return this.serverByPlayerId.get(playerId) ?? null;
  }

  private matchingIndices(nameFilter: string): number[] {
    const matches: number[] = [];
    this.namesLower.forEach((name, index) => {
      if (name.includes(nameFilter)) matches.push(index);
    });
    return matches;
  }
}

/**
 * Keeps the newest Outer Realms board in the process and replaces it when a new instant lands
 */
export abstract class OuterRealmsBoardCache {
  private static readonly SNAPSHOT_DATES_KEY = 'outer-realms:snapshot-dates';
  private static readonly SNAPSHOT_DATES_TTL_SECONDS = 10;
  private static readonly IDLE_SNAPSHOT_DATES_TTL_SECONDS = 60;
  private static readonly FRESHNESS_FLOOR_MS = 5 * 1000;
  private static readonly DISCOVERY_WINDOW_MINUTES = [10, 2 * 60, 30 * 24 * 60];

  private static board: OuterRealmsBoard | null = null;
  private static checkedAt = 0;
  private static refreshing: Promise<OuterRealmsBoard | null> | null = null;

  public static async current(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsBoard | null> {
    const board = OuterRealmsBoardCache.board;
    if (board && Date.now() - OuterRealmsBoardCache.checkedAt < OuterRealmsBoardCache.FRESHNESS_FLOOR_MS) return board;

    const refresh = OuterRealmsBoardCache.refresh(clickhouseClient);
    return board ?? refresh;
  }

  private static refresh(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsBoard | null> {
    OuterRealmsBoardCache.refreshing ??= OuterRealmsBoardCache.resolve(clickhouseClient)
      .catch((error) => {
        ApiHelper.logError(error, 'OuterRealmsBoardCache.refresh', null);
        return OuterRealmsBoardCache.board;
      })
      .finally(() => {
        OuterRealmsBoardCache.refreshing = null;
      });
    return OuterRealmsBoardCache.refreshing;
  }

  private static async resolve(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsBoard | null> {
    const { lastDate, previousDate } = await OuterRealmsBoardCache.readSnapshotDates(clickhouseClient);
    OuterRealmsBoardCache.checkedAt = Date.now();
    if (!lastDate) {
      OuterRealmsBoardCache.board = null;
      return null;
    }
    if (OuterRealmsBoardCache.board?.snapshot !== lastDate) {
      OuterRealmsBoardCache.board = await OuterRealmsBoardCache.build(
        clickhouseClient,
        lastDate,
        previousDate ?? lastDate,
      );
    }
    return OuterRealmsBoardCache.board;
  }

  private static async readSnapshotDates(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsSnapshotDates> {
    const cached = await ApiHelper.redisClient.get(OuterRealmsBoardCache.SNAPSHOT_DATES_KEY).catch(() => null);
    if (cached !== null) return JSON.parse(cached) as OuterRealmsSnapshotDates;

    const dates = await OuterRealmsBoardCache.discoverSnapshotDates(clickhouseClient);
    const ttl = dates.lastDate
      ? OuterRealmsBoardCache.SNAPSHOT_DATES_TTL_SECONDS
      : OuterRealmsBoardCache.IDLE_SNAPSHOT_DATES_TTL_SECONDS;
    void ApiHelper.updateCache(OuterRealmsBoardCache.SNAPSHOT_DATES_KEY, JSON.stringify(dates), ttl, true);
    return dates;
  }

  private static async discoverSnapshotDates(
    clickhouseClient: NodeClickHouseClient,
  ): Promise<OuterRealmsSnapshotDates> {
    for (const minutes of OuterRealmsBoardCache.DISCOVERY_WINDOW_MINUTES) {
      const dates = await OuterRealmsBoardCache.readFetchDates(
        clickhouseClient,
        'WHERE fetch_date >= now() - INTERVAL {minutes:UInt32} MINUTE',
        { minutes },
      );
      if (dates.length > 0) return { lastDate: dates[0], previousDate: dates[1] ?? null };
    }
    const anyDates = await OuterRealmsBoardCache.readFetchDates(clickhouseClient, '', {});
    return { lastDate: anyDates[0] ?? null, previousDate: anyDates[1] ?? null };
  }

  private static async readFetchDates(
    clickhouseClient: NodeClickHouseClient,
    whereClause: string,
    queryParameters: Record<string, number>,
  ): Promise<string[]> {
    const rawDates = await clickhouseClient.query({
      query: `
        SELECT DISTINCT fetch_date
        FROM ${OUTER_REALMS_TABLE}
        ${whereClause}
        ORDER BY fetch_date DESC
        LIMIT 2
      `,
      query_params: queryParameters,
    });
    const parsedDates = await rawDates.json();
    return (parsedDates.data as { fetch_date: string }[]).map((row) => row.fetch_date);
  }

  private static async build(
    clickhouseClient: NodeClickHouseClient,
    lastDate: string,
    previousDate: string,
  ): Promise<OuterRealmsBoard> {
    const rawBoard = await clickhouseClient.query({
      query: `
        SELECT
          now.player_id,
          now.player_name,
          now.server,
          now.score,
          now.rank,
          now.level,
          now.legendary_level,
          now.might,
          now.castle_position_x,
          now.castle_position_y,
          (now.score - coalesce(before.score, now.score)) AS score_diff,
          (coalesce(before.rank, now.rank) - now.rank) AS rank_diff
        FROM ${OUTER_REALMS_TABLE} AS now
        LEFT JOIN
        (
          SELECT player_id, score, rank
          FROM ${OUTER_REALMS_TABLE}
          WHERE fetch_date = {previousDate:DateTime}
        ) AS before
        ON before.player_id = now.player_id
        WHERE now.fetch_date = {lastDate:DateTime}
        ORDER BY now.rank ASC
      `,
      query_params: { lastDate, previousDate },
    });
    const parsedBoard = await rawBoard.json();
    return new OuterRealmsBoard(lastDate, parsedBoard.data as OuterRealmsRankingRow[]);
  }
}
