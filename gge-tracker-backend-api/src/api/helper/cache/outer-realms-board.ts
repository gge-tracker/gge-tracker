import { NodeClickHouseClient } from '@clickhouse/client/dist/client';
import { ApiHelper } from '../api-helper';
import { EventGame, EventGames } from '../event-game';

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

export interface OuterRealmsPlayer {
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
  distance?: number;
}

interface OuterRealmsSnapshotDates {
  lastDate: string | null;
  previousDate: string | null;
}

export type OuterRealmsMetric = 'level' | 'might' | 'score' | 'rank';
export type OuterRealmsMovement = 'up' | 'down' | 'steady';
export type OuterRealmsSortField =
  | 'rank'
  | 'score'
  | 'might'
  | 'level'
  | 'score_diff'
  | 'rank_diff'
  | 'player_name'
  | 'distance';

export interface OuterRealmsRange {
  metric: OuterRealmsMetric;
  min: number | null;
  max: number | null;
}

export interface OuterRealmsArea {
  x: number;
  y: number;
  radius: number;
}

export interface OuterRealmsFilter {
  name: string | null;
  servers: string[];
  ranges: OuterRealmsRange[];
  activeOnly: boolean;
  movement: OuterRealmsMovement | null;
  near: OuterRealmsArea | null;
}

export interface OuterRealmsSort {
  field: OuterRealmsSortField;
  descending: boolean;
}

export interface OuterRealmsPage {
  players: OuterRealmsPlayer[];
  totalItems: number;
}

export class OuterRealmsBoard {
  public static readonly DEFAULT_SORT: OuterRealmsSort = { field: 'rank', descending: false };

  public readonly servers: string[];
  private readonly players: OuterRealmsPlayer[];
  private readonly namesLower: string[];
  private readonly serverByPlayerId = new Map<number, string>();
  private readonly ordersBySort = new Map<string, number[]>();

  constructor(
    public readonly snapshot: string,
    public readonly previousSnapshot: string,
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
    this.servers = [...new Set(rows.map((row) => row.server))].sort();
  }

  public static isUnfiltered(filter: OuterRealmsFilter): boolean {
    return (
      filter.name === null &&
      filter.servers.length === 0 &&
      filter.ranges.length === 0 &&
      !filter.activeOnly &&
      filter.movement === null &&
      filter.near === null
    );
  }

  private static metricOf(player: OuterRealmsPlayer, metric: OuterRealmsMetric): number {
    return metric === 'level' ? player.level + player.legendary_level : player[metric];
  }

  private static distanceBetween(player: OuterRealmsPlayer, area: OuterRealmsArea): number | null {
    const [x, y] = player.castle_position;
    if (x === null || y === null) return null;
    return Math.hypot(x - area.x, y - area.y);
  }

  public get collectedAt(): Date {
    return new Date(this.snapshot);
  }

  public get previousCollectedAt(): Date {
    return new Date(this.previousSnapshot);
  }

  public slice(filter: OuterRealmsFilter, sort: OuterRealmsSort, offset: number, limit: number): OuterRealmsPage {
    const selection = this.select(filter, sort);
    const players = selection.slice(offset, offset + limit).map((index) => this.present(index, filter));
    return { players, totalItems: selection.length };
  }

  public list(filter: OuterRealmsFilter, sort: OuterRealmsSort): OuterRealmsPlayer[] {
    return this.select(filter, sort).map((index) => this.present(index, filter));
  }

  public serverOf(playerId: number): string | null {
    return this.serverByPlayerId.get(playerId) ?? null;
  }

  private select(filter: OuterRealmsFilter, sort: OuterRealmsSort): number[] {
    if (sort.field === 'distance' && filter.near) {
      const area = filter.near;
      const matches = this.orderOf(OuterRealmsBoard.DEFAULT_SORT).filter((index) => this.matches(index, filter));
      const distances = new Map(
        matches.map((index) => [index, OuterRealmsBoard.distanceBetween(this.players[index], area)!]),
      );
      const direction = sort.descending ? -1 : 1;
      return matches.sort((a, b) => direction * (distances.get(a)! - distances.get(b)!) || a - b);
    }
    const order = this.orderOf(sort);
    return OuterRealmsBoard.isUnfiltered(filter) ? order : order.filter((index) => this.matches(index, filter));
  }

  private orderOf(sort: OuterRealmsSort): number[] {
    const key = `${sort.field}:${sort.descending ? 'desc' : 'asc'}`;
    let order = this.ordersBySort.get(key);
    if (!order) {
      order = this.players.map((_, index) => index);
      const direction = sort.descending ? -1 : 1;
      const compare = this.comparatorFor(sort.field);
      // Players arrive in rank order, so the index is the tiebreak that keeps paging stable
      order.sort((a, b) => direction * compare(a, b) || a - b);
      this.ordersBySort.set(key, order);
    }
    return order;
  }

  private comparatorFor(field: OuterRealmsSortField): (a: number, b: number) => number {
    if (field === 'player_name') return (a, b) => this.namesLower[a].localeCompare(this.namesLower[b]);
    if (field === 'level') {
      return (a, b) =>
        OuterRealmsBoard.metricOf(this.players[a], 'level') - OuterRealmsBoard.metricOf(this.players[b], 'level');
    }
    if (field === 'distance') return (a, b) => a - b;
    return (a, b) => this.players[a][field] - this.players[b][field];
  }

  private matches(index: number, filter: OuterRealmsFilter): boolean {
    const player = this.players[index];
    if (filter.name !== null && !this.namesLower[index].includes(filter.name)) return false;
    if (filter.servers.length > 0 && !filter.servers.includes(player.server)) return false;
    if (filter.activeOnly && player.score_diff <= 0) return false;
    if (filter.movement === 'up' && player.rank_diff <= 0) return false;
    if (filter.movement === 'down' && player.rank_diff >= 0) return false;
    if (filter.movement === 'steady' && player.rank_diff !== 0) return false;
    for (const range of filter.ranges) {
      const value = OuterRealmsBoard.metricOf(player, range.metric);
      if (range.min !== null && value < range.min) return false;
      if (range.max !== null && value > range.max) return false;
    }
    if (filter.near) {
      const distance = OuterRealmsBoard.distanceBetween(player, filter.near);
      if (distance === null || distance > filter.near.radius) return false;
    }
    return true;
  }

  private present(index: number, filter: OuterRealmsFilter): OuterRealmsPlayer {
    const player = this.players[index];
    if (!filter.near) return player;
    const distance = OuterRealmsBoard.distanceBetween(player, filter.near)!;
    return { ...player, distance: Math.round(distance * 10) / 10 };
  }
}

/**
 * Keeps the newest Outer Realms board of each game in the process and replaces it when a new instant lands
 */
export class OuterRealmsBoardCache {
  private static readonly SNAPSHOT_DATES_TTL_SECONDS = 10;
  private static readonly IDLE_SNAPSHOT_DATES_TTL_SECONDS = 60;
  private static readonly FRESHNESS_FLOOR_MS = 5 * 1000;
  private static readonly DISCOVERY_WINDOW_MINUTES = [10, 2 * 60, 30 * 24 * 60];
  private static readonly caches = new Map<EventGame, OuterRealmsBoardCache>();

  private board: OuterRealmsBoard | null = null;
  private checkedAt = 0;
  private refreshing: Promise<OuterRealmsBoard | null> | null = null;
  private readonly snapshotDatesKey: string;
  private readonly table: string;

  private constructor(game: EventGame) {
    this.snapshotDatesKey = `outer-realms:snapshot-dates${EventGames.keySuffix(game)}`;
    this.table = EventGames.liveRankingTable(game);
  }

  public static of(game: EventGame): OuterRealmsBoardCache {
    let cache = OuterRealmsBoardCache.caches.get(game);
    if (!cache) {
      cache = new OuterRealmsBoardCache(game);
      OuterRealmsBoardCache.caches.set(game, cache);
    }
    return cache;
  }

  public async current(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsBoard | null> {
    const board = this.board;
    if (board && Date.now() - this.checkedAt < OuterRealmsBoardCache.FRESHNESS_FLOOR_MS) return board;

    const refresh = this.refresh(clickhouseClient);
    return board ?? refresh;
  }

  private refresh(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsBoard | null> {
    this.refreshing ??= this.resolve(clickhouseClient)
      .catch((error) => {
        ApiHelper.logError(error, 'OuterRealmsBoardCache.refresh', null);
        return this.board;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private async resolve(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsBoard | null> {
    const { lastDate, previousDate } = await this.readSnapshotDates(clickhouseClient);
    this.checkedAt = Date.now();
    if (!lastDate) {
      this.board = null;
      return null;
    }
    if (this.board?.snapshot !== lastDate) {
      this.board = await this.build(clickhouseClient, lastDate, previousDate ?? lastDate);
    }
    return this.board;
  }

  private async readSnapshotDates(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsSnapshotDates> {
    const cached = await ApiHelper.redisClient.get(this.snapshotDatesKey).catch(() => null);
    if (cached !== null) return JSON.parse(cached) as OuterRealmsSnapshotDates;

    const dates = await this.discoverSnapshotDates(clickhouseClient);
    const ttl = dates.lastDate
      ? OuterRealmsBoardCache.SNAPSHOT_DATES_TTL_SECONDS
      : OuterRealmsBoardCache.IDLE_SNAPSHOT_DATES_TTL_SECONDS;
    void ApiHelper.updateCache(this.snapshotDatesKey, JSON.stringify(dates), ttl, true);
    return dates;
  }

  private async discoverSnapshotDates(clickhouseClient: NodeClickHouseClient): Promise<OuterRealmsSnapshotDates> {
    for (const minutes of OuterRealmsBoardCache.DISCOVERY_WINDOW_MINUTES) {
      const dates = await this.readFetchDates(
        clickhouseClient,
        'WHERE fetch_date >= now() - INTERVAL {minutes:UInt32} MINUTE',
        { minutes },
      );
      if (dates.length > 0) return { lastDate: dates[0], previousDate: dates[1] ?? null };
    }
    const anyDates = await this.readFetchDates(clickhouseClient, '', {});
    return { lastDate: anyDates[0] ?? null, previousDate: anyDates[1] ?? null };
  }

  private async readFetchDates(
    clickhouseClient: NodeClickHouseClient,
    whereClause: string,
    queryParameters: Record<string, number>,
  ): Promise<string[]> {
    const rawDates = await clickhouseClient.query({
      query: `
        SELECT DISTINCT fetch_date
        FROM ${this.table}
        ${whereClause}
        ORDER BY fetch_date DESC
        LIMIT 2
      `,
      query_params: queryParameters,
    });
    const parsedDates = await rawDates.json();
    return (parsedDates.data as { fetch_date: string }[]).map((row) => row.fetch_date);
  }

  private async build(
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
        FROM ${this.table} AS now
        LEFT JOIN
        (
          SELECT player_id, score, rank
          FROM ${this.table}
          WHERE fetch_date = {previousDate:DateTime}
        ) AS before
        ON before.player_id = now.player_id
        WHERE now.fetch_date = {lastDate:DateTime}
        ORDER BY now.rank ASC
      `,
      query_params: { lastDate, previousDate },
    });
    const parsedBoard = await rawBoard.json();
    return new OuterRealmsBoard(lastDate, previousDate, parsedBoard.data as OuterRealmsRankingRow[]);
  }
}
