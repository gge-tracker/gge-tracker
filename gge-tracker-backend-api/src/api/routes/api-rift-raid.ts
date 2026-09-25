import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { CachedResponse } from '../helper/cache/cached-response';
import { CachedValue } from '../helper/cache/cached-value';
import { RankingGame, RankingOrigin, RankingStanding, RankingUniverse } from '../helper/ranking-universe';

interface RiftRaidAllianceRow {
  server_id: number;
  division_id: number;
  subdivision_id: number;
  alliance_id: number;
  alliance_name: string;
  rank: number;
  score: string;
}

interface RiftRaidAnalysisRow {
  division_id: number;
  subdivision_id: number;
  rank: number;
  score: string;
  date: string;
  alliance_name: string;
}

interface RiftRaidStandingRow extends RiftRaidAnalysisRow {
  event_id: number;
}

interface RiftRaidAlliance {
  alliance_id: number | null;
  alliance_name: string;
  server: string | null;
  rank: number;
  score: number;
  division: number;
  subdivision: number;
}

export abstract class ApiRiftRaid implements ApiHelper {
  private static readonly RANKING_TABLE = 'ggetracker_global.rift_raid_ranking';
  private static readonly HOURS_TABLE = 'ggetracker_global.rift_raid_hours';
  private static readonly CACHE_VERSION_KEY = 'rift-raid:event-dates:version';
  private static readonly CACHE_TTL_SECONDS = 6 * 60 * 60;
  private static readonly ALLIANCES_PER_PAGE = 10;
  private static readonly MIN_DIVISION = 1;
  private static readonly MAX_DIVISION = 6;
  private static readonly MAX_EVENT_ID = 65_535;
  private static readonly UNKNOWN_SERVER_CODE = '999';
  private static readonly HOUR_WINDOW = `
    game = {game:String}
    AND created_at >= {hour:DateTime} AND created_at < {hour:DateTime} + INTERVAL 1 HOUR`;

  public static async getEventDates(request: express.Request, response: express.Response): Promise<void> {
    try {
      const game = ApiRiftRaid.gameOf(request);
      const cacheKey = await ApiRiftRaid.cacheKey('event-dates', { game });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const rows = await ApiRiftRaid.select<{ event_id: number; dates: string[] }>(
        `SELECT event_id, groupArray(hour_iso) AS dates
          FROM (
            SELECT DISTINCT event_id, formatDateTime(hour, '%Y-%m-%dT%H:00:00.000Z', 'UTC') AS hour_iso
            FROM ${ApiRiftRaid.HOURS_TABLE}
            WHERE game = {game:String}
            ORDER BY hour_iso
          )
          GROUP BY event_id
          ORDER BY event_id`,
        { game },
      );
      await CachedResponse.serve(response, cacheKey, { events: rows }, ApiRiftRaid.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiRiftRaid.fail(request, response, error, 'getRiftRaidEventDates');
    }
  }

  public static async getAlliances(request: express.Request, response: express.Response): Promise<void> {
    try {
      const game = ApiRiftRaid.gameOf(request);
      const hour = ApiRiftRaid.parseHour(request.query.date);
      const division = ApiRiftRaid.parseDivision(request.query.division_id);
      const subdivision = ApiRiftRaid.parseOptionalPositiveInteger(request.query.subdivision_id);
      if (!hour) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidFlatDateFormat });
        return;
      } else if (division === null) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidDivisionId });
        return;
      } else if (subdivision === false) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidSubdivisionId });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const cacheKey = await ApiRiftRaid.cacheKey('division', { game, hour, division, subdivision, page });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const parameters = {
        game,
        hour,
        division,
        subdivision: subdivision ?? 0,
        limit: ApiRiftRaid.ALLIANCES_PER_PAGE,
        offset: (page - 1) * ApiRiftRaid.ALLIANCES_PER_PAGE,
      };
      const subdivisionFilter = '({subdivision:UInt16} = 0 OR subdivision_id = {subdivision:UInt16})';
      const order = subdivision ? 'subdivision_id, rank' : 'score DESC, rank';
      const [rows, stats] = await Promise.all([
        ApiRiftRaid.select<RiftRaidAllianceRow>(
          `SELECT server_id, division_id, subdivision_id, alliance_id, alliance_name, rank, score
            FROM ${ApiRiftRaid.RANKING_TABLE}
            WHERE ${ApiRiftRaid.HOUR_WINDOW} AND division_id = {division:UInt8} AND ${subdivisionFilter}
            ORDER BY ${order}, server_id, alliance_id
            LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
          parameters,
        ),
        ApiRiftRaid.select<{ total_items: string; max_subdivision_id: number }>(
          `SELECT countIf(${subdivisionFilter}) AS total_items, max(subdivision_id) AS max_subdivision_id
            FROM ${ApiRiftRaid.RANKING_TABLE}
            WHERE ${ApiRiftRaid.HOUR_WINDOW} AND division_id = {division:UInt8}`,
          parameters,
        ),
      ]);

      const alliances = ApiRiftRaid.toAlliances(game, rows);
      const totalItems = Number(stats[0]?.total_items ?? 0);
      const body = {
        event: {
          division: {
            current_division: division,
            min_division: ApiRiftRaid.MIN_DIVISION,
            max_division: ApiRiftRaid.MAX_DIVISION,
          },
          subdivision: {
            current_subdivision: subdivision ?? null,
            min_subdivision: 1,
            max_subdivision: Math.max(Number(stats[0]?.max_subdivision_id ?? 0), 1),
          },
          alliances,
        },
        pagination: ApiRiftRaid.pagination(page, alliances.length, totalItems),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiRiftRaid.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiRiftRaid.fail(request, response, error, 'getRiftRaidAlliances');
    }
  }

  public static async searchAlliances(request: express.Request, response: express.Response): Promise<void> {
    try {
      const game = ApiRiftRaid.gameOf(request);
      const hour = ApiRiftRaid.parseHour(request.query.date);
      const allianceName = ApiHelper.validateSearchAndSanitize(request.query.alliance_name);
      if (!hour) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidFlatDateFormat });
        return;
      } else if (ApiHelper.isInvalidInput(allianceName) || allianceName === '') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceName });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const cacheKey = await ApiRiftRaid.cacheKey('search', { game, hour, name: allianceName, page });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const parameters = {
        game,
        hour,
        name: allianceName,
        limit: ApiRiftRaid.ALLIANCES_PER_PAGE,
        offset: (page - 1) * ApiRiftRaid.ALLIANCES_PER_PAGE,
      };
      const nameFilter = 'positionCaseInsensitiveUTF8(alliance_name, {name:String}) > 0';
      const [rows, stats] = await Promise.all([
        ApiRiftRaid.select<RiftRaidAllianceRow>(
          `SELECT server_id, division_id, subdivision_id, alliance_id, alliance_name, rank, score
            FROM ${ApiRiftRaid.RANKING_TABLE}
            WHERE ${ApiRiftRaid.HOUR_WINDOW} AND ${nameFilter}
            ORDER BY division_id DESC, score DESC, rank, server_id, alliance_id
            LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
          parameters,
        ),
        ApiRiftRaid.select<{ total_items: string }>(
          `SELECT count() AS total_items
            FROM ${ApiRiftRaid.RANKING_TABLE}
            WHERE ${ApiRiftRaid.HOUR_WINDOW} AND ${nameFilter}`,
          parameters,
        ),
      ]);

      const alliances = ApiRiftRaid.toAlliances(game, rows);
      const body = {
        alliances,
        pagination: ApiRiftRaid.pagination(page, alliances.length, Number(stats[0]?.total_items ?? 0)),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiRiftRaid.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiRiftRaid.fail(request, response, error, 'searchRiftRaidAlliances');
    }
  }

  public static async getAllianceAnalysis(request: express.Request, response: express.Response): Promise<void> {
    try {
      const allianceId = ApiHelper.verifyIdWithCountryCode(String(request.params.allianceId));
      const eventId = ApiRiftRaid.parseOptionalPositiveInteger(request.params.eventId);
      const origin = allianceId ? RankingUniverse.originOf(ApiHelper.getCountryCode(String(allianceId))) : null;
      if (!allianceId || !origin) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      } else if (!eventId || eventId > ApiRiftRaid.MAX_EVENT_ID) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventId });
        return;
      }
      const cacheKey = await ApiRiftRaid.cacheKey('alliance-analysis', { allianceId, eventId });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const rows = await ApiRiftRaid.select<RiftRaidAnalysisRow>(
        `SELECT division_id, subdivision_id, rank, score, alliance_name,
          formatDateTime(created_at, '%Y-%m-%d %H:00:00', 'UTC') AS date
          FROM ${ApiRiftRaid.RANKING_TABLE}
          WHERE game = {game:String} AND alliance_id = {alliance:UInt32}
            AND server_id = {server:UInt16} AND event_id = {event:UInt16}
          ORDER BY created_at DESC
          SETTINGS optimize_read_in_order = 0`,
        {
          game: origin.game,
          alliance: Number(ApiHelper.removeCountryCode(allianceId)),
          server: origin.serverId,
          event: eventId,
        },
      );

      const body = {
        analysis: rows.map((row) => ({
          division: row.division_id,
          subdivision: row.subdivision_id,
          rank: row.rank,
          score: Number(row.score),
          date: row.date,
        })),
        meta: {
          alliance_id: allianceId,
          alliance_name: rows.at(0)?.alliance_name ?? null,
          server: origin.server.outerName,
          game: origin.game,
        },
      };
      await CachedResponse.serve(response, cacheKey, body, ApiRiftRaid.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiRiftRaid.fail(request, response, error, 'getRiftRaidAllianceAnalysis');
    }
  }

  public static async latestStandingOf(origin: RankingOrigin, allianceId: number): Promise<RankingStanding | null> {
    const cacheKey = await ApiRiftRaid.cacheKey('alliance-latest', {
      game: origin.game,
      server: origin.serverId,
      alliance: allianceId,
    });
    return CachedValue.remember(cacheKey, ApiRiftRaid.CACHE_TTL_SECONDS, async () => {
      const rows = await ApiRiftRaid.select<RiftRaidStandingRow>(
        `SELECT event_id, division_id, subdivision_id, rank, score, alliance_name,
          formatDateTime(created_at, '%Y-%m-%d %H:00:00', 'UTC') AS date
          FROM ${ApiRiftRaid.RANKING_TABLE}
          WHERE game = {game:String} AND server_id = {server:UInt16} AND alliance_id = {alliance:UInt32}
            AND created_at >= (SELECT max(hour) FROM ${ApiRiftRaid.HOURS_TABLE} WHERE game = {game:String})
          ORDER BY created_at DESC
          LIMIT 1`,
        { game: origin.game, server: origin.serverId, alliance: allianceId },
      );
      return rows.length === 0 ? null : ApiRiftRaid.toStanding(rows[0]);
    });
  }

  private static toStanding(row: RiftRaidStandingRow): RankingStanding {
    return {
      event_id: row.event_id,
      division: row.division_id,
      subdivision: row.subdivision_id,
      rank: row.rank,
      score: Number(row.score),
      date: row.date,
    };
  }

  private static gameOf(request: express.Request): RankingGame {
    return RankingUniverse.gameOfServerName(String(request['language']));
  }

  private static parseHour(value: unknown): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(value)) return null;
    if (Number.isNaN(Date.parse(value))) return null;
    return value.slice(0, 19).replace('T', ' ');
  }

  private static parseDivision(value: unknown): number | null {
    if (value === undefined) return ApiRiftRaid.MAX_DIVISION;
    const division = ApiRiftRaid.parseOptionalPositiveInteger(value);
    if (!division || division < ApiRiftRaid.MIN_DIVISION || division > ApiRiftRaid.MAX_DIVISION) return null;
    return division;
  }

  // undefined when absent, false when present but not a positive integer
  private static parseOptionalPositiveInteger(value: unknown): number | undefined | false {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return false;
    const parsed = Number(value);
    return parsed > 0 ? parsed : false;
  }

  private static toAlliances(game: RankingGame, rows: RiftRaidAllianceRow[]): RiftRaidAlliance[] {
    const servers = RankingUniverse.serversOf(game);
    return rows.map((row) => {
      const server = servers.get(row.server_id);
      const code = server?.code || ApiRiftRaid.UNKNOWN_SERVER_CODE;
      return {
        alliance_id: Number.parseInt(`${row.alliance_id}${code}`) || null,
        alliance_name: row.alliance_name,
        server: server?.outerName ?? null,
        rank: row.rank,
        score: Number(row.score),
        division: row.division_id,
        subdivision: row.subdivision_id,
      };
    });
  }

  private static pagination(
    page: number,
    currentItems: number,
    totalItems: number,
  ): { current_page: number; total_pages: number; current_items_count: number; total_items_count: number } {
    return {
      current_page: page,
      total_pages: Math.ceil(totalItems / ApiRiftRaid.ALLIANCES_PER_PAGE),
      current_items_count: currentItems,
      total_items_count: totalItems,
    };
  }

  private static async cacheKey(
    scope: string,
    parameters: Record<string, string | number | false | undefined>,
  ): Promise<string> {
    const version = (await ApiHelper.redisClient.get(ApiRiftRaid.CACHE_VERSION_KEY).catch(() => null)) ?? '-1';
    return new CacheKeyBuilder('rift-raid')
      .with(scope)
      .withParams(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, value || undefined])))
      .with(`v${version}`)
      .build();
  }

  private static async select<T>(query: string, parameters: Record<string, string | number>): Promise<T[]> {
    const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    const result = await clickhouseClient.query({
      query,
      query_params: parameters,
      format: 'JSONEachRow',
      // Note: clickHouse fails any ORDER BY ... LIMIT 10 on a table with a projection while this is on
      clickhouse_settings: { query_plan_optimize_lazy_materialization: 0 },
    });
    return result.json<T>();
  }

  private static fail(request: express.Request, response: express.Response, error: unknown, origin: string): void {
    const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
    response.status(code).send({ error: message });
    ApiHelper.logError(error, origin, request);
  }
}
