import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { CachedResponse } from '../helper/cache/cached-response';

interface LeagueSeasonRow {
  season_id: number;
  days: string[];
  ranked_players: number;
  ranked_alliances: number;
}

interface LeagueNight {
  day: string;
  season_id: number;
  previous_day: string | null;
}

interface LeaguePlayerRow {
  rank: number;
  player_id: number;
  player_name: string;
  alliance_id: number;
  alliance_name: string;
  title: number;
  gold: number;
  silver: number;
  bronze: number;
}

interface LeagueAllianceRow {
  rank: number;
  alliance_id: number;
  alliance_name: string;
  gold: number;
  silver: number;
  bronze: number;
}

interface LeagueHistoryRow {
  night: string;
  rank: number;
  player_name: string;
  title: number;
  gold: number;
  silver: number;
  bronze: number;
}

interface RankingQuery {
  table: string;
  idColumn: string;
  columns: string;
  filters: string[];
  parameters: QueryParameters;
}

type QueryParameters = Record<string, string | number | number[]>;

interface Pagination {
  current_page: number;
  total_pages: number;
  current_items_count: number;
  total_items_count: number;
}

export abstract class ApiKingdomsLeague implements ApiHelper {
  private static readonly DAYS_TABLE = 'ggetracker_global.kingdoms_league_days';
  private static readonly PLAYERS_TABLE = 'ggetracker_global.kingdoms_league_players';
  private static readonly ALLIANCES_TABLE = 'ggetracker_global.kingdoms_league_alliances';
  private static readonly CACHE_VERSION_PREFIX = 'kingdoms-league-version:';
  private static readonly CACHE_TTL_SECONDS = 12 * 60 * 60;
  private static readonly ROWS_PER_PAGE = 15;
  private static readonly MAX_SEASON_ID = 65_535;
  private static readonly MISSING_SCHEMA_ERRORS = new Set(['UNKNOWN_TABLE', 'UNKNOWN_DATABASE']);
  private static readonly EMPTY_PAGINATION: Pagination = {
    current_page: 1,
    total_pages: 0,
    current_items_count: 0,
    total_items_count: 0,
  };

  public static async getSeasons(request: express.Request, response: express.Response): Promise<void> {
    try {
      const server = String(request['language']);
      const cacheKey = await ApiKingdomsLeague.cacheKey(server, 'seasons', {});
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const rows = await ApiKingdomsLeague.select<LeagueSeasonRow>(
        `SELECT season_id, groupArray(day_text) AS days,
            argMax(ranked_players, day) AS ranked_players, argMax(ranked_alliances, day) AS ranked_alliances
          FROM (
            SELECT season_id, day, toString(day) AS day_text, ranked_players, ranked_alliances
            FROM ${ApiKingdomsLeague.DAYS_TABLE} FINAL
            WHERE server = {server:String}
            ORDER BY day
          )
          GROUP BY season_id
          ORDER BY season_id`,
        { server },
      );
      const seasons = rows.map((row) => ({
        season_id: row.season_id,
        first_day: row.days.at(0) ?? null,
        last_day: row.days.at(-1) ?? null,
        days: row.days,
        ranked_players: row.ranked_players,
        ranked_alliances: row.ranked_alliances,
      }));
      await CachedResponse.serve(response, cacheKey, { seasons }, ApiKingdomsLeague.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiKingdomsLeague.fail(request, response, error, 'getKingdomsLeagueSeasons');
    }
  }

  public static async getPlayers(request: express.Request, response: express.Response): Promise<void> {
    try {
      const server = String(request['language']);
      const code = String(request['code']);
      const query = ApiKingdomsLeague.parsePlayersQuery(request.query, code);
      if (typeof query === 'string') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: query });
        return;
      }
      const { day, playerName, allianceId } = query;
      const page = ApiHelper.validatePageNumber(request.query.page);
      const cacheKey = await ApiKingdomsLeague.cacheKey(server, 'players', {
        day,
        name: playerName,
        alliance: allianceId,
        page,
      });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const night = await ApiKingdomsLeague.resolveNight(server, day);
      if (!night) {
        await CachedResponse.serve(
          response,
          cacheKey,
          {
            day: day ?? null,
            season_id: null,
            previous_day: null,
            players: [],
            pagination: { ...ApiKingdomsLeague.EMPTY_PAGINATION },
          },
          ApiKingdomsLeague.CACHE_TTL_SECONDS,
        );
        return;
      }
      const filters: string[] = [];
      if (playerName) filters.push('positionCaseInsensitiveUTF8(player_name, {name:String}) > 0');
      if (allianceId !== undefined) filters.push('alliance_id = {alliance:Int32}');
      const { rows, previousRanks, totalItems } = await ApiKingdomsLeague.readRanking<LeaguePlayerRow>(night, page, {
        table: ApiKingdomsLeague.PLAYERS_TABLE,
        idColumn: 'player_id',
        columns: 'rank, player_id, player_name, alliance_id, alliance_name, title, gold, silver, bronze',
        filters,
        parameters: { server, name: playerName ?? '', alliance: allianceId ?? 0 },
      });
      const players = rows.map((row) => ({
        rank: row.rank,
        previous_rank: previousRanks.get(row.player_id) ?? null,
        player_id: ApiKingdomsLeague.withCode(row.player_id, code),
        player_name: row.player_name,
        alliance_id: row.alliance_id > 0 ? ApiKingdomsLeague.withCode(row.alliance_id, code) : null,
        alliance_name: row.alliance_id > 0 ? row.alliance_name : null,
        title: row.title,
        gold: row.gold,
        silver: row.silver,
        bronze: row.bronze,
      }));
      const body = { ...night, players, pagination: ApiKingdomsLeague.pagination(page, players.length, totalItems) };
      await CachedResponse.serve(response, cacheKey, body, ApiKingdomsLeague.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiKingdomsLeague.fail(request, response, error, 'getKingdomsLeaguePlayers');
    }
  }

  public static async getAlliances(request: express.Request, response: express.Response): Promise<void> {
    try {
      const server = String(request['language']);
      const code = String(request['code']);
      const day = ApiKingdomsLeague.parseDay(request.query.day);
      const allianceName = ApiKingdomsLeague.parseSearch(request.query.alliance_name);
      if (day === false) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidDay });
        return;
      } else if (allianceName === false) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceName });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const cacheKey = await ApiKingdomsLeague.cacheKey(server, 'alliances', { day, name: allianceName, page });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const night = await ApiKingdomsLeague.resolveNight(server, day);
      if (!night) {
        await CachedResponse.serve(
          response,
          cacheKey,
          {
            day: day ?? null,
            season_id: null,
            previous_day: null,
            alliances: [],
            pagination: { ...ApiKingdomsLeague.EMPTY_PAGINATION },
          },
          ApiKingdomsLeague.CACHE_TTL_SECONDS,
        );
        return;
      }
      const { rows, previousRanks, totalItems } = await ApiKingdomsLeague.readRanking<LeagueAllianceRow>(night, page, {
        table: ApiKingdomsLeague.ALLIANCES_TABLE,
        idColumn: 'alliance_id',
        columns: 'rank, alliance_id, alliance_name, gold, silver, bronze',
        filters: allianceName ? ['positionCaseInsensitiveUTF8(alliance_name, {name:String}) > 0'] : [],
        parameters: { server, name: allianceName ?? '' },
      });
      const alliances = rows.map((row) => ({
        rank: row.rank,
        previous_rank: previousRanks.get(row.alliance_id) ?? null,
        alliance_id: ApiKingdomsLeague.withCode(row.alliance_id, code),
        alliance_name: row.alliance_name,
        gold: row.gold,
        silver: row.silver,
        bronze: row.bronze,
      }));
      const body = {
        ...night,
        alliances,
        pagination: ApiKingdomsLeague.pagination(page, alliances.length, totalItems),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiKingdomsLeague.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiKingdomsLeague.fail(request, response, error, 'getKingdomsLeagueAlliances');
    }
  }

  public static async getPlayerHistory(request: express.Request, response: express.Response): Promise<void> {
    try {
      const server = String(request['language']);
      const code = String(request['code']);
      const playerId = ApiHelper.verifyIdWithCountryCode(String(request.params.playerId));
      const seasonId = ApiKingdomsLeague.parseSeason(request.query.season_id);
      if (!playerId || ApiHelper.getCountryCode(String(playerId)) !== code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      } else if (seasonId === false) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidSeasonId });
        return;
      }
      const cacheKey = await ApiKingdomsLeague.cacheKey(server, 'player', { player: playerId, season: seasonId });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const season = seasonId ?? (await ApiKingdomsLeague.latestSeason(server));
      const rows =
        season === null
          ? []
          : await ApiKingdomsLeague.select<LeagueHistoryRow>(
              `SELECT toString(day) AS night, rank, player_name, title, gold, silver, bronze
                FROM ${ApiKingdomsLeague.PLAYERS_TABLE} FINAL
                WHERE server = {server:String} AND season_id = {season:UInt16} AND player_id = {player:UInt32}
                ORDER BY day`,
              { server, season, player: Number(ApiHelper.removeCountryCode(playerId)) },
            );
      const body = {
        season_id: season,
        player_id: playerId,
        player_name: rows.at(-1)?.player_name ?? null,
        history: rows.map((row) => ({
          day: row.night,
          rank: row.rank,
          title: row.title,
          gold: row.gold,
          silver: row.silver,
          bronze: row.bronze,
        })),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiKingdomsLeague.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiKingdomsLeague.fail(request, response, error, 'getKingdomsLeaguePlayerHistory');
    }
  }

  private static async readRanking<T extends { rank: number }>(
    night: LeagueNight,
    page: number,
    query: RankingQuery,
  ): Promise<{ rows: T[]; previousRanks: Map<number, number>; totalItems: number }> {
    const where = [
      'server = {server:String}',
      'season_id = {season:UInt16}',
      'day = {day:Date}',
      ...query.filters,
    ].join(' AND ');
    const parameters = {
      ...query.parameters,
      season: night.season_id,
      day: night.day,
      limit: ApiKingdomsLeague.ROWS_PER_PAGE,
      offset: (page - 1) * ApiKingdomsLeague.ROWS_PER_PAGE,
    };
    const [rows, stats] = await Promise.all([
      ApiKingdomsLeague.select<T>(
        `SELECT ${query.columns} FROM ${query.table} FINAL WHERE ${where}
          ORDER BY rank LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        parameters,
      ),
      ApiKingdomsLeague.select<{ total_items: string }>(
        `SELECT count() AS total_items FROM ${query.table} FINAL WHERE ${where}`,
        parameters,
      ),
    ]);
    const ids = rows.map((row) => Number(row[query.idColumn]));
    const previousRanks = await ApiKingdomsLeague.readPreviousRanks(night, query, ids);
    return { rows, previousRanks, totalItems: Number(stats[0]?.total_items ?? 0) };
  }

  private static async readPreviousRanks(
    night: LeagueNight,
    query: RankingQuery,
    ids: number[],
  ): Promise<Map<number, number>> {
    if (!night.previous_day || ids.length === 0) return new Map();
    const rows = await ApiKingdomsLeague.select<{ id: number; rank: number }>(
      `SELECT ${query.idColumn} AS id, rank FROM ${query.table} FINAL
        WHERE server = {server:String} AND season_id = {season:UInt16} AND day = {day:Date}
          AND ${query.idColumn} IN {ids:Array(Int64)}`,
      { server: String(query.parameters.server), season: night.season_id, day: night.previous_day, ids },
    );
    return new Map(rows.map((row) => [Number(row.id), row.rank]));
  }

  private static async resolveNight(server: string, day: string | undefined): Promise<LeagueNight | null> {
    const dayFilter = day ? 'AND day = {day:Date}' : '';
    const nights = await ApiKingdomsLeague.select<{ night: string; season_id: number }>(
      `SELECT toString(day) AS night, season_id FROM ${ApiKingdomsLeague.DAYS_TABLE} FINAL
        WHERE server = {server:String} ${dayFilter}
        ORDER BY day DESC LIMIT 1`,
      day ? { server, day } : { server },
    );
    const found = nights.at(0);
    if (!found) return null;
    const previous = await ApiKingdomsLeague.select<{ night: string }>(
      `SELECT toString(day) AS night FROM ${ApiKingdomsLeague.DAYS_TABLE} FINAL
        WHERE server = {server:String} AND season_id = {season:UInt16} AND day < {day:Date}
        ORDER BY day DESC LIMIT 1`,
      { server, season: found.season_id, day: found.night },
    );
    return { day: found.night, season_id: found.season_id, previous_day: previous.at(0)?.night ?? null };
  }

  private static async latestSeason(server: string): Promise<number | null> {
    const rows = await ApiKingdomsLeague.select<{ season_id: number }>(
      `SELECT season_id FROM ${ApiKingdomsLeague.DAYS_TABLE} FINAL
        WHERE server = {server:String} ORDER BY day DESC LIMIT 1`,
      { server },
    );
    return rows.at(0)?.season_id ?? null;
  }

  private static parsePlayersQuery(
    query: express.Request['query'],
    code: string,
  ): { day?: string; playerName?: string; allianceId?: number } | RouteErrorMessagesEnum {
    const day = ApiKingdomsLeague.parseDay(query.day);
    if (day === false) return RouteErrorMessagesEnum.InvalidDay;
    const playerName = ApiKingdomsLeague.parseSearch(query.player_name);
    if (playerName === false) return RouteErrorMessagesEnum.InvalidPlayerName;
    const allianceId = ApiKingdomsLeague.parseAllianceFilter(query.alliance_id, code);
    if (allianceId === false) return RouteErrorMessagesEnum.InvalidAllianceId;
    return { day, playerName, allianceId };
  }

  // undefined when absent, false when present but not a calendar day
  private static parseDay(value: unknown): string | undefined | false {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : false;
  }

  private static parseSeason(value: unknown): number | undefined | false {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return false;
    const season = Number(value);
    return season > 0 && season <= ApiKingdomsLeague.MAX_SEASON_ID ? season : false;
  }

  private static parseSearch(value: unknown): string | undefined | false {
    if (value === undefined || value === '') return undefined;
    const search = ApiHelper.validateSearchAndSanitize(value, { toLowerCase: false });
    return ApiHelper.isInvalidInput(search) || search === '' ? false : search;
  }

  private static parseAllianceFilter(value: unknown, code: string): number | undefined | false {
    if (value === undefined || value === '') return undefined;
    const allianceId = ApiHelper.verifyIdWithCountryCode(value);
    if (!allianceId || ApiHelper.getCountryCode(String(allianceId)) !== code) return false;
    return Number(ApiHelper.removeCountryCode(allianceId));
  }

  private static withCode(id: number, code: string): number {
    return Number(`${id}${code}`);
  }

  private static pagination(page: number, currentItems: number, totalItems: number): Pagination {
    return {
      current_page: page,
      total_pages: Math.ceil(totalItems / ApiKingdomsLeague.ROWS_PER_PAGE),
      current_items_count: currentItems,
      total_items_count: totalItems,
    };
  }

  private static async cacheKey(
    server: string,
    scope: string,
    parameters: Record<string, string | number | undefined>,
  ): Promise<string> {
    const versionKey = ApiKingdomsLeague.CACHE_VERSION_PREFIX + server;
    const version = (await ApiHelper.redisClient.get(versionKey).catch(() => null)) ?? '-1';
    return new CacheKeyBuilder('kingdoms-league')
      .with(server)
      .with(scope)
      .withParams(parameters)
      .with(`v${version}`)
      .build();
  }

  // Answers no rows until the migration has run, so the API can ship before it
  private static async select<T>(query: string, parameters: QueryParameters): Promise<T[]> {
    const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    try {
      const result = await clickhouseClient.query({ query, query_params: parameters, format: 'JSONEachRow' });
      return await result.json<T>();
    } catch (error) {
      if (ApiKingdomsLeague.MISSING_SCHEMA_ERRORS.has((error as { type?: string }).type ?? '')) return [];
      throw error;
    }
  }

  private static fail(request: express.Request, response: express.Response, error: unknown, origin: string): void {
    const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
    response.status(code).send({ error: message });
    ApiHelper.logError(error, origin, request);
  }
}
