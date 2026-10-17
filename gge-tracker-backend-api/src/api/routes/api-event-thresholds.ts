import { NodeClickHouseClient } from '@clickhouse/client/dist/client';
import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';

interface RankingSnapshot {
  occurrence: number;
  startedAt: string;
  readAt: string;
  hour: number;
  participants: number;
  thresholds: number[];
}

interface OccurrenceSummary {
  started_at: string;
  ended_at: string;
  participants: number;
  thresholds: number[];
}

interface PacePoint {
  hour: number;
  thresholds: number[];
}

interface OccurrencePace {
  started_at: string;
  running: boolean;
  points: PacePoint[];
}

interface ThresholdRange {
  median: number[];
  low: number[];
  high: number[];
}

interface ProjectedRange {
  median: (number | null)[];
  low: (number | null)[];
  high: (number | null)[];
}

export interface EventThresholds {
  event: string;
  server: string;
  ranks: number[];
  running: boolean;
  live_events: string[];
  current: (OccurrenceSummary & { hour: number; projected: ProjectedRange }) | null;
  typical: ThresholdRange | null;
  next_expected_start: string | null;
  occurrences: OccurrenceSummary[];
  pace: OccurrencePace[];
}

/**
 * Points needed for each rank of the kingdom events of one server, read from their hourly rankings
 */
export abstract class ApiEventThresholds implements ApiHelper {
  public static readonly RANKS = [1, 3, 10, 25, 50, 100, 250, 500, 1000];
  public static readonly EVENT_TABLES: Readonly<Record<string, string>> = {
    nomad: 'player_event_nomad_history',
    samurai: 'player_event_samurai_history',
    bloodcrow: 'player_event_bloodcrow_history',
    'war-realms': 'player_event_war_realms_history',
    'berimond-kingdom': 'player_event_berimond_kingdom_history',
    'berimond-invasion': 'player_event_berimond_invasion_history',
  };

  // Same gap as the player occurrences of api-statistics, so both pages split events identically
  private static readonly OCCURRENCE_GAP_SECONDS = 86_400;
  // The fill runs hourly: a reading older than this means the event is over
  private static readonly RUNNING_WINDOW_MS = 3 * 3600 * 1000;
  private static readonly HISTORY_SIZE = 12;
  private static readonly PACE_OCCURRENCES = 6;
  private static readonly TYPICAL_OCCURRENCES = 5;

  public static async getThresholds(request: express.Request, response: express.Response): Promise<void> {
    try {
      const slug = String(request.params.eventName ?? '');
      const table = Object.hasOwn(this.EVENT_TABLES, slug) ? this.EVENT_TABLES[slug] : null;
      if (!table) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventName });
        return;
      }
      const server = String(request['language']);
      const olapDatabase = ApiHelper.ggeTrackerManager.getOlapDatabase(server);
      if (!olapDatabase) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidServer });
        return;
      }

      const fillVersion = (await ApiHelper.redisClient.get(`fill-version:${server}`)) || '1';
      const cacheKey = `event-thresholds:${server}:${fillVersion}:${slug}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      const clickhouse = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const [finals, readings, lastReadings] = await Promise.all([
        this.readFinalSnapshots(clickhouse, olapDatabase, table),
        this.readRecentSnapshots(clickhouse, olapDatabase, table),
        this.readLastReadings(clickhouse, olapDatabase),
      ]);
      const data = this.build(slug, server, finals, readings, lastReadings, Date.now());
      void ApiHelper.updateCache(cacheKey, data);
      response.status(ApiHelper.HTTP_OK).send(data);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getEventThresholds', request);
    }
  }

  public static build(
    event: string,
    server: string,
    finals: RankingSnapshot[],
    readings: RankingSnapshot[],
    lastReadings: Record<string, string>,
    now: number,
  ): EventThresholds {
    const last = finals.at(-1);
    const running = last !== undefined && now - Date.parse(last.readAt) < this.RUNNING_WINDOW_MS;
    const completed = running ? finals.slice(0, -1) : finals;
    const pace = this.groupPace(readings, running ? last.occurrence : null);
    const completedPace = pace.filter((occurrence) => !occurrence.running);
    return {
      event,
      server,
      ranks: this.RANKS,
      running,
      live_events: this.liveEvents(lastReadings, now),
      current: running
        ? { ...this.summarise(last), hour: last.hour, projected: this.project(last, completedPace) }
        : null,
      typical: this.typicalRange(completed.slice(-this.TYPICAL_OCCURRENCES)),
      next_expected_start: running ? null : this.nextExpectedStart(finals, now),
      occurrences: completed
        .slice(-this.HISTORY_SIZE)
        .reverse()
        .map((snapshot) => this.summarise(snapshot)),
      pace,
    };
  }

  private static liveEvents(lastReadings: Record<string, string>, now: number): string[] {
    return Object.keys(this.EVENT_TABLES).filter((slug) => {
      const readAt = lastReadings[this.EVENT_TABLES[slug]];
      return readAt !== undefined && now - Date.parse(readAt) < this.RUNNING_WINDOW_MS;
    });
  }

  private static summarise(snapshot: RankingSnapshot): OccurrenceSummary {
    return {
      started_at: snapshot.startedAt,
      ended_at: snapshot.readAt,
      participants: snapshot.participants,
      thresholds: snapshot.thresholds,
    };
  }

  private static groupPace(readings: RankingSnapshot[], runningOccurrence: number | null): OccurrencePace[] {
    const byOccurrence = new Map<number, OccurrencePace>();
    for (const reading of readings) {
      let occurrence = byOccurrence.get(reading.occurrence);
      if (!occurrence) {
        occurrence = { started_at: reading.startedAt, running: reading.occurrence === runningOccurrence, points: [] };
        byOccurrence.set(reading.occurrence, occurrence);
      }
      occurrence.points.push({ hour: reading.hour, thresholds: reading.thresholds });
    }
    return [...byOccurrence.values()];
  }

  // Each past run says how much a rank still grew after this hour; those ratios are applied to now
  private static project(current: RankingSnapshot, completedPace: OccurrencePace[]): ProjectedRange {
    const ratiosByRank = this.RANKS.map((_, rankIndex) => this.growthRatios(current.hour, rankIndex, completedPace));
    const apply = (rankIndex: number, ratio: number | null): number | null => {
      const value = current.thresholds[rankIndex];
      return value && ratio !== null ? Math.round(value * Math.max(1, ratio)) : null;
    };
    return {
      median: ratiosByRank.map((ratios, index) => apply(index, this.median(ratios))),
      low: ratiosByRank.map((ratios, index) => apply(index, ratios.length > 0 ? Math.min(...ratios) : null)),
      high: ratiosByRank.map((ratios, index) => apply(index, ratios.length > 0 ? Math.max(...ratios) : null)),
    };
  }

  private static growthRatios(hour: number, rankIndex: number, completedPace: OccurrencePace[]): number[] {
    const ratios: number[] = [];
    for (const occurrence of completedPace) {
      const atHour = occurrence.points.findLast((point) => point.hour <= hour);
      const final = occurrence.points.at(-1);
      const before = atHour?.thresholds[rankIndex] ?? 0;
      if (before > 0 && final) ratios.push(final.thresholds[rankIndex] / before);
    }
    return ratios;
  }

  private static typicalRange(snapshots: RankingSnapshot[]): ThresholdRange | null {
    if (snapshots.length === 0) return null;
    const column = (rankIndex: number): number[] => snapshots.map((snapshot) => snapshot.thresholds[rankIndex]);
    return {
      median: this.RANKS.map((_, index) => this.median(column(index)) ?? 0),
      low: this.RANKS.map((_, index) => Math.min(...column(index))),
      high: this.RANKS.map((_, index) => Math.max(...column(index))),
    };
  }

  private static nextExpectedStart(finals: RankingSnapshot[], now: number): string | null {
    const starts = finals.slice(-this.HISTORY_SIZE).map((snapshot) => Date.parse(snapshot.startedAt));
    const gaps = starts.slice(1).map((start, index) => start - starts[index]);
    const gap = this.median(gaps);
    if (gap === null || starts.length < 3) return null;
    const next = starts.at(-1)! + gap;
    return next > now ? new Date(next).toISOString() : null;
  }

  private static median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  }

  private static async readLastReadings(
    clickhouse: NodeClickHouseClient,
    olapDatabase: string,
  ): Promise<Record<string, string>> {
    const result = await clickhouse.query({
      query: `
        SELECT table_name, max(created_at) AS read_at
        FROM ${olapDatabase}.event_dates
        WHERE table_name IN {tables:Array(String)}
        GROUP BY table_name
      `,
      query_params: { tables: Object.values(this.EVENT_TABLES) },
    });
    const json = await result.json();
    return Object.fromEntries(json.data.map((row: any) => [row.table_name, this.toIso(row.read_at)]));
  }

  private static async readFinalSnapshots(
    clickhouse: NodeClickHouseClient,
    olapDatabase: string,
    table: string,
  ): Promise<RankingSnapshot[]> {
    return this.querySnapshots(clickhouse, olapDatabase, table, 'last_reading = created_at', '1');
  }

  private static async readRecentSnapshots(
    clickhouse: NodeClickHouseClient,
    olapDatabase: string,
    table: string,
  ): Promise<RankingSnapshot[]> {
    return this.querySnapshots(
      clickhouse,
      olapDatabase,
      table,
      '1',
      `occurrence > (SELECT max(occurrence) FROM readings) - ${this.PACE_OCCURRENCES + 1}`,
    );
  }

  private static async querySnapshots(
    clickhouse: NodeClickHouseClient,
    olapDatabase: string,
    table: string,
    readingFilter: string,
    occurrenceFilter: string,
  ): Promise<RankingSnapshot[]> {
    const query = `
      WITH readings AS (
        SELECT
          created_at,
          sum(is_new_occurrence) OVER (ORDER BY created_at ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
            AS occurrence
        FROM (
          SELECT
            created_at,
            if(
              dateDiff('second', lagInFrame(created_at, 1, created_at) OVER (ORDER BY created_at ASC), created_at)
                > {gap:UInt32},
              1,
              0
            ) AS is_new_occurrence
          FROM ${olapDatabase}.event_dates
          WHERE table_name = {table:String}
        )
      ),
      selected AS (
        SELECT occurrence, created_at, started_at
        FROM (
          SELECT
            occurrence,
            created_at,
            min(created_at) OVER (PARTITION BY occurrence) AS started_at,
            max(created_at) OVER (PARTITION BY occurrence) AS last_reading
          FROM readings
        )
        WHERE ${readingFilter} AND ${occurrenceFilter}
      )
      SELECT
        s.occurrence AS occurrence,
        s.started_at AS started_at,
        s.created_at AS read_at,
        dateDiff('hour', s.started_at, s.created_at) AS hour,
        r.participants AS participants,
        arrayMap(rank -> if(rank <= length(r.points), r.points[rank], 0), {ranks:Array(UInt32)}) AS thresholds
      FROM (
        SELECT created_at, arrayReverseSort(groupArray(point)) AS points, count() AS participants
        FROM ${olapDatabase}.${table}
        WHERE created_at IN (SELECT created_at FROM selected) AND point > 0
        GROUP BY created_at
      ) AS r
      INNER JOIN selected AS s ON s.created_at = r.created_at
      ORDER BY s.created_at ASC
    `;
    const result = await clickhouse.query({
      query,
      query_params: { gap: this.OCCURRENCE_GAP_SECONDS, table, ranks: this.RANKS },
    });
    const json = await result.json();
    return json.data.map((row: any) => ({
      occurrence: Number(row.occurrence),
      startedAt: this.toIso(row.started_at),
      readAt: this.toIso(row.read_at),
      hour: Number(row.hour),
      participants: Number(row.participants),
      thresholds: (row.thresholds as (string | number)[]).map(Number),
    }));
  }

  private static toIso(clickhouseDate: string): string {
    const date = new Date(clickhouseDate.replace(' ', 'T') + 'Z');
    date.setUTCMinutes(0, 0, 0);
    return date.toISOString();
  }
}
