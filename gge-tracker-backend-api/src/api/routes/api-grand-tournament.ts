import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { CachedResponse } from '../helper/cache/cached-response';
import { CachedValue } from '../helper/cache/cached-value';
import { RankingGame, RankingOrigin, RankingStanding, RankingUniverse } from '../helper/ranking-universe';

interface GrandTournamentAllianceRow {
  server_id: number;
  division_id: number;
  subdivision_id: number;
  alliance_id: number;
  alliance_name: string;
  rank: number;
  score: string;
}

interface GrandTournamentAnalysisRow {
  division_id: number;
  subdivision_id: number;
  rank: number;
  score: string;
  date: string;
  alliance_name: string;
}

interface GrandTournamentStandingRow extends GrandTournamentAnalysisRow {
  event_id: number;
}

interface GrandTournamentAlliance {
  alliance_id: number | null;
  alliance_name: string;
  server: string | null;
  rank: number;
  score: number;
  division: number;
  subdivision: number;
}

export abstract class ApiGrandTournament implements ApiHelper {
  private static readonly RANKING_TABLE = 'grand_tournament';
  private static readonly HOURS_VIEW = 'grand_tournament_hours_mv';
  private static readonly CACHE_VERSION_KEY = 'grand-tournament:event-dates:version';
  private static readonly CACHE_TTL_SECONDS = 6 * 60 * 60;
  private static readonly ALLIANCES_PER_PAGE = 10;
  private static readonly MIN_DIVISION = 1;
  private static readonly MAX_DIVISION = 5;
  private static readonly MAX_EVENT_ID = 65_535;
  private static readonly UNKNOWN_SERVER_CODE = '999';
  private static readonly ISO_HOUR = `'YYYY-MM-DD"T"HH24:00:00.000"Z"'`;
  private static readonly HOUR_WINDOW = `
    game = $1
    AND created_at >= $2::timestamp AND created_at < $2::timestamp + interval '1 hour'`;

  public static async getEventDates(request: express.Request, response: express.Response): Promise<void> {
    try {
      const game = ApiGrandTournament.gameOf(request);
      const cacheKey = await ApiGrandTournament.cacheKey('event-dates', { game });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const rows = await ApiGrandTournament.select<{ event_id: number; dates: string[] }>(
        `SELECT event_id, ARRAY_AGG(to_char(hour, ${ApiGrandTournament.ISO_HOUR}) ORDER BY hour) AS dates
          FROM ${ApiGrandTournament.HOURS_VIEW}
          WHERE game = $1
          GROUP BY event_id
          ORDER BY event_id`,
        [game],
      );
      await CachedResponse.serve(response, cacheKey, { events: rows }, ApiGrandTournament.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiGrandTournament.fail(request, response, error, 'getGrandTournamentEventDates');
    }
  }

  public static async getAlliances(request: express.Request, response: express.Response): Promise<void> {
    try {
      const game = ApiGrandTournament.gameOf(request);
      const hour = ApiGrandTournament.parseHour(request.query.date);
      const division = ApiGrandTournament.parseDivision(request.query.division_id);
      const subdivision = ApiGrandTournament.parseOptionalPositiveInteger(request.query.subdivision_id);
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
      const cacheKey = await ApiGrandTournament.cacheKey('division', { game, hour, division, subdivision, page });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const parameters = [game, hour, division, subdivision ?? 0];
      const subdivisionFilter = '($4 = 0 OR subdivision_id = $4)';
      const order = subdivision ? 'subdivision_id, rank' : 'score DESC, rank';
      const [rows, stats] = await Promise.all([
        ApiGrandTournament.select<GrandTournamentAllianceRow>(
          `SELECT server_id, division_id, subdivision_id, alliance_id, alliance_name, rank, score
            FROM ${ApiGrandTournament.RANKING_TABLE}
            WHERE ${ApiGrandTournament.HOUR_WINDOW} AND division_id = $3 AND ${subdivisionFilter}
            ORDER BY ${order}, server_id, alliance_id
            LIMIT $5 OFFSET $6`,
          [...parameters, ApiGrandTournament.ALLIANCES_PER_PAGE, (page - 1) * ApiGrandTournament.ALLIANCES_PER_PAGE],
        ),
        ApiGrandTournament.select<{ total_items: string; max_subdivision_id: number }>(
          `SELECT COUNT(*) FILTER (WHERE ${subdivisionFilter}) AS total_items, MAX(subdivision_id) AS max_subdivision_id
            FROM ${ApiGrandTournament.RANKING_TABLE}
            WHERE ${ApiGrandTournament.HOUR_WINDOW} AND division_id = $3`,
          parameters,
        ),
      ]);

      const alliances = ApiGrandTournament.toAlliances(game, rows);
      const totalItems = Number(stats[0]?.total_items ?? 0);
      const body = {
        event: {
          division: {
            current_division: division,
            min_division: ApiGrandTournament.MIN_DIVISION,
            max_division: ApiGrandTournament.MAX_DIVISION,
          },
          subdivision: {
            current_subdivision: subdivision ?? null,
            min_subdivision: 1,
            max_subdivision: Math.max(Number(stats[0]?.max_subdivision_id ?? 0), 1),
          },
          alliances,
        },
        pagination: ApiGrandTournament.pagination(page, alliances.length, totalItems),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiGrandTournament.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiGrandTournament.fail(request, response, error, 'getGrandTournamentAlliances');
    }
  }

  public static async searchAlliances(request: express.Request, response: express.Response): Promise<void> {
    try {
      const game = ApiGrandTournament.gameOf(request);
      const hour = ApiGrandTournament.parseHour(request.query.date);
      const allianceName = ApiHelper.validateSearchAndSanitize(request.query.alliance_name);
      if (!hour) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidFlatDateFormat });
        return;
      } else if (ApiHelper.isInvalidInput(allianceName) || allianceName === '') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceName });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const cacheKey = await ApiGrandTournament.cacheKey('search', { game, hour, name: allianceName, page });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      // A % or _ the caller sends must match itself rather than act as a wildcard
      const parameters = [game, hour, `%${ApiGrandTournament.escapeLike(String(allianceName))}%`];
      const nameFilter = `alliance_name ILIKE $3 ESCAPE '\\'`;
      const [rows, stats] = await Promise.all([
        ApiGrandTournament.select<GrandTournamentAllianceRow>(
          `SELECT server_id, division_id, subdivision_id, alliance_id, alliance_name, rank, score
            FROM ${ApiGrandTournament.RANKING_TABLE}
            WHERE ${ApiGrandTournament.HOUR_WINDOW} AND ${nameFilter}
            ORDER BY division_id DESC, score DESC, rank, server_id, alliance_id
            LIMIT $4 OFFSET $5`,
          [...parameters, ApiGrandTournament.ALLIANCES_PER_PAGE, (page - 1) * ApiGrandTournament.ALLIANCES_PER_PAGE],
        ),
        ApiGrandTournament.select<{ total_items: string }>(
          `SELECT COUNT(*) AS total_items
            FROM ${ApiGrandTournament.RANKING_TABLE}
            WHERE ${ApiGrandTournament.HOUR_WINDOW} AND ${nameFilter}`,
          parameters,
        ),
      ]);

      const alliances = ApiGrandTournament.toAlliances(game, rows);
      const body = {
        alliances,
        pagination: ApiGrandTournament.pagination(page, alliances.length, Number(stats[0]?.total_items ?? 0)),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiGrandTournament.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiGrandTournament.fail(request, response, error, 'searchGrandTournamentAlliances');
    }
  }

  public static async getAllianceAnalysis(request: express.Request, response: express.Response): Promise<void> {
    try {
      const allianceId = ApiHelper.verifyIdWithCountryCode(String(request.params.allianceId));
      const eventId = ApiGrandTournament.parseOptionalPositiveInteger(request.params.eventId);
      const origin = allianceId ? RankingUniverse.originOf(ApiHelper.getCountryCode(String(allianceId))) : null;
      if (!allianceId || !origin) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      } else if (!eventId || eventId > ApiGrandTournament.MAX_EVENT_ID) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventId });
        return;
      }
      const cacheKey = await ApiGrandTournament.cacheKey('alliance-analysis', { allianceId, eventId });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const rows = await ApiGrandTournament.select<GrandTournamentAnalysisRow>(
        `SELECT division_id, subdivision_id, rank, score, alliance_name,
          to_char(created_at, 'YYYY-MM-DD HH24:00:00') AS date
          FROM ${ApiGrandTournament.RANKING_TABLE}
          WHERE game = $1 AND alliance_id = $2 AND server_id = $3 AND event_id = $4
          ORDER BY created_at DESC`,
        [origin.game, Number(ApiHelper.removeCountryCode(allianceId)), origin.serverId, eventId],
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
      await CachedResponse.serve(response, cacheKey, body, ApiGrandTournament.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiGrandTournament.fail(request, response, error, 'getGrandTournamentAllianceAnalysis');
    }
  }

  public static async latestStandingOf(origin: RankingOrigin, allianceId: number): Promise<RankingStanding | null> {
    const cacheKey = await ApiGrandTournament.cacheKey('alliance-latest', {
      game: origin.game,
      server: origin.serverId,
      alliance: allianceId,
    });
    return CachedValue.remember(cacheKey, ApiGrandTournament.CACHE_TTL_SECONDS, async () => {
      const [latest] = await ApiGrandTournament.select<{ hour: string | null }>(
        `SELECT to_char(MAX(hour), 'YYYY-MM-DD HH24:MI:SS') AS hour
          FROM ${ApiGrandTournament.HOURS_VIEW}
          WHERE game = $1`,
        [origin.game],
      );
      if (!latest?.hour) return null;
      const rows = await ApiGrandTournament.select<GrandTournamentStandingRow>(
        `SELECT event_id, division_id, subdivision_id, rank, score, alliance_name,
          to_char(created_at, 'YYYY-MM-DD HH24:00:00') AS date
          FROM ${ApiGrandTournament.RANKING_TABLE}
          WHERE game = $1 AND created_at >= $2::timestamp AND server_id = $3 AND alliance_id = $4
          ORDER BY created_at DESC
          LIMIT 1`,
        [origin.game, latest.hour, origin.serverId, allianceId],
      );
      return rows.length === 0 ? null : ApiGrandTournament.toStanding(rows[0]);
    });
  }

  private static toStanding(row: GrandTournamentStandingRow): RankingStanding {
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
    if (value === undefined) return ApiGrandTournament.MAX_DIVISION;
    const division = ApiGrandTournament.parseOptionalPositiveInteger(value);
    if (!division || division < ApiGrandTournament.MIN_DIVISION || division > ApiGrandTournament.MAX_DIVISION) {
      return null;
    }
    return division;
  }

  // undefined when absent, false when present but not a positive integer
  private static parseOptionalPositiveInteger(value: unknown): number | undefined | false {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return false;
    const parsed = Number(value);
    return parsed > 0 ? parsed : false;
  }

  private static escapeLike(value: string): string {
    return value
      .replaceAll('\\', '\\\\')
      .replaceAll('%', String.raw`\%`)
      .replaceAll('_', String.raw`\_`);
  }

  private static toAlliances(game: RankingGame, rows: GrandTournamentAllianceRow[]): GrandTournamentAlliance[] {
    const servers = RankingUniverse.serversOf(game);
    return rows.map((row) => {
      const server = servers.get(row.server_id);
      const code = server?.code || ApiGrandTournament.UNKNOWN_SERVER_CODE;
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
      total_pages: Math.ceil(totalItems / ApiGrandTournament.ALLIANCES_PER_PAGE),
      current_items_count: currentItems,
      total_items_count: totalItems,
    };
  }

  private static async cacheKey(
    scope: string,
    parameters: Record<string, string | number | false | undefined>,
  ): Promise<string> {
    const version = (await ApiHelper.redisClient.get(ApiGrandTournament.CACHE_VERSION_KEY).catch(() => null)) ?? '-1';
    return new CacheKeyBuilder('grand-tournament')
      .with(scope)
      .withParams(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, value || undefined])))
      .with(`v${version}`)
      .build();
  }

  private static async select<T>(query: string, parameters: (string | number)[]): Promise<T[]> {
    const pgPool: pg.Pool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
    const { rows } = await pgPool.query(query, parameters);
    return rows as T[];
  }

  private static fail(request: express.Request, response: express.Response, error: unknown, origin: string): void {
    const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
    response.status(code).send({ error: message });
    ApiHelper.logError(error, origin, request);
  }
}
