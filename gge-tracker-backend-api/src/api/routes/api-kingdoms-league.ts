import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { CachedResponse } from '../helper/cache/cached-response';
import { HttpCache } from '../helper/http-cache';
import { KingdomsLeagueFilter, LeagueFilter, LeagueSubject } from '../helper/kingdoms-league-filter';
import { OuterRealmsExport, OuterRealmsExportFormat } from '../helper/outer-realms-export';

interface LeagueSeasonRow {
  season_id: number;
  days: string[];
  ranked_players: number;
  ranked_alliances: number;
}

interface LeagueDay {
  day: string;
  season_id: number;
  previous_day: string | null;
}

interface LeagueRow {
  rank: number;
  player_id?: number;
  player_name?: string;
  alliance_id: number;
  alliance_name: string;
  title?: number;
  gold: number;
  silver: number;
  bronze: number;
}

type LeagueEntry = Record<string, string | number | null>;

type ExportFormat = OuterRealmsExportFormat;

interface LeagueHistoryRow {
  day_text: string;
  rank: number;
  player_name: string;
  title: number;
  gold: number;
  silver: number;
  bronze: number;
}

type QueryParameters = Record<string, string | number | number[] | string[]>;

interface Pagination {
  current_page: number;
  total_pages: number;
  current_items_count: number;
  total_items_count: number;
}

const SUBJECTS: Record<LeagueSubject, { table: string; idColumn: 'player_id' | 'alliance_id'; columns: string }> = {
  players: {
    table: 'ggetracker_global.kingdoms_league_players',
    idColumn: 'player_id',
    columns: 'rank, player_id, player_name, alliance_id, alliance_name, title, gold, silver, bronze',
  },
  alliances: {
    table: 'ggetracker_global.kingdoms_league_alliances',
    idColumn: 'alliance_id',
    columns: 'rank, alliance_id, alliance_name, gold, silver, bronze',
  },
};

export abstract class ApiKingdomsLeague implements ApiHelper {
  private static readonly DAYS_TABLE = 'ggetracker_global.kingdoms_league_days';
  private static readonly CACHE_VERSION_PREFIX = 'kingdoms-league-version:';
  private static readonly CACHE_TTL_SECONDS = 24 * 60 * 60;
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
    await ApiKingdomsLeague.serveRanking(request, response, 'players');
  }

  public static async getAlliances(request: express.Request, response: express.Response): Promise<void> {
    await ApiKingdomsLeague.serveRanking(request, response, 'alliances');
  }

  public static async getPlayersExport(request: express.Request, response: express.Response): Promise<void> {
    await ApiKingdomsLeague.serveExport(request, response, 'players');
  }

  public static async getAlliancesExport(request: express.Request, response: express.Response): Promise<void> {
    await ApiKingdomsLeague.serveExport(request, response, 'alliances');
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
              `SELECT toString(day) AS day_text, rank, player_name, title, gold, silver, bronze
                FROM ${SUBJECTS.players.table} FINAL
                WHERE server = {server:String} AND season_id = {season:UInt16} AND player_id = {player:UInt32}
                ORDER BY day`,
              { server, season, player: Number(ApiHelper.removeCountryCode(playerId)) },
            );
      const body = {
        season_id: season,
        player_id: playerId,
        player_name: rows.at(-1)?.player_name ?? null,
        history: rows.map((row) => ({
          day: row.day_text,
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

  // Answers no rows until the migration has run, so the API can ship before it
  public static async select<T>(query: string, parameters: QueryParameters): Promise<T[]> {
    const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    try {
      const result = await clickhouseClient.query({ query, query_params: parameters, format: 'JSONEachRow' });
      return await result.json<T>();
    } catch (error) {
      if (ApiKingdomsLeague.MISSING_SCHEMA_ERRORS.has((error as { type?: string }).type ?? '')) return [];
      throw error;
    }
  }

  private static async serveRanking(
    request: express.Request,
    response: express.Response,
    subject: LeagueSubject,
  ): Promise<void> {
    try {
      const server = String(request['language']);
      const code = String(request['code']);
      const filter = KingdomsLeagueFilter.parse(request.query, subject, code);
      if (typeof filter === 'string') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: filter });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const size = ApiHelper.parsePageSize(request.query.size);
      const cacheKey = await ApiKingdomsLeague.cacheKey(server, subject, {
        day: filter.day,
        ...KingdomsLeagueFilter.describe(filter),
        page,
        size,
      });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const leagueDay = await ApiKingdomsLeague.resolveDay(server, filter.day);
      if (!leagueDay) {
        const body = {
          day: filter.day ?? null,
          season_id: null,
          previous_day: null,
          [subject]: [],
          pagination: { ...ApiKingdomsLeague.EMPTY_PAGINATION },
        };
        await CachedResponse.serve(response, cacheKey, body, ApiKingdomsLeague.CACHE_TTL_SECONDS);
        return;
      }
      const { rows, totalItems } = await ApiKingdomsLeague.readPage(server, leagueDay, subject, filter, page, size);
      const previousRanks = await ApiKingdomsLeague.readPreviousRanks(server, leagueDay, subject, rows);
      const idColumn = SUBJECTS[subject].idColumn;
      const items = rows.map((row) =>
        ApiKingdomsLeague.present(row, subject, code, previousRanks.get(Number(row[idColumn])) ?? null),
      );
      const body = {
        ...leagueDay,
        [subject]: items,
        pagination: ApiKingdomsLeague.pagination(page, size, items.length, totalItems),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiKingdomsLeague.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiKingdomsLeague.fail(request, response, error, `getKingdomsLeague:${subject}`);
    }
  }

  private static async serveExport(
    request: express.Request,
    response: express.Response,
    subject: LeagueSubject,
  ): Promise<void> {
    try {
      const server = String(request['language']);
      const code = String(request['code']);
      const format = ApiKingdomsLeague.parseFormat(request.query.format);
      if (!format) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidLiveExportFormat });
        return;
      }
      const filter = KingdomsLeagueFilter.parse(request.query, subject, code);
      if (typeof filter === 'string') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: filter });
        return;
      }
      const leagueDay = await ApiKingdomsLeague.resolveDay(server, filter.day);
      const cacheKey = await ApiKingdomsLeague.cacheKey(server, `${subject}-export`, {
        day: leagueDay?.day ?? 'none',
        ...KingdomsLeagueFilter.describe(filter),
        format,
      });
      const etag = HttpCache.etagFromCacheKey(cacheKey);
      if (HttpCache.handleConditional(request, response, { etag, maxAgeSeconds: 0 })) return;

      const rows = leagueDay ? await ApiKingdomsLeague.readAll(server, leagueDay, subject, filter) : [];
      const items = rows.map((row) => ApiKingdomsLeague.present(row, subject, code, row.previous_rank));
      response.setHeader('Content-Type', OuterRealmsExport.CONTENT_TYPES[format]);
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="kingdoms-league-${subject}-${server}-${leagueDay?.day ?? 'empty'}.${format}"`,
      );
      response.setHeader('X-Item-Count', String(items.length));
      if (format === 'ndjson') {
        response.status(ApiHelper.HTTP_OK).send(items.map((item) => JSON.stringify(item) + '\n').join(''));
      } else if (format === 'csv') {
        response.status(ApiHelper.HTTP_OK).send(ApiKingdomsLeague.toCsv(items));
      } else {
        const header = leagueDay ?? { day: filter.day ?? null, season_id: null, previous_day: null };
        response.status(ApiHelper.HTTP_OK).send({ ...header, count: items.length, [subject]: items });
      }
    } catch (error) {
      ApiKingdomsLeague.fail(request, response, error, `getKingdomsLeagueExport:${subject}`);
    }
  }

  private static async readPage(
    server: string,
    leagueDay: LeagueDay,
    subject: LeagueSubject,
    filter: LeagueFilter,
    page: number,
    size: number,
  ): Promise<{ rows: LeagueRow[]; totalItems: number }> {
    const { where, parameters } = ApiKingdomsLeague.dayWhere(server, leagueDay, subject, filter);
    const table = SUBJECTS[subject].table;
    const [rows, stats] = await Promise.all([
      ApiKingdomsLeague.select<LeagueRow>(
        `SELECT ${SUBJECTS[subject].columns} FROM ${table} FINAL WHERE ${where}
          ORDER BY rank LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...parameters, limit: size, offset: (page - 1) * size },
      ),
      ApiKingdomsLeague.select<{ total_items: string }>(
        `SELECT count() AS total_items FROM ${table} FINAL WHERE ${where}`,
        parameters,
      ),
    ]);
    return { rows, totalItems: Number(stats[0]?.total_items ?? 0) };
  }

  // A rank starts at 1, so the 0 a missed LEFT JOIN fills in means "not ranked the previous day"
  private static async readAll(
    server: string,
    leagueDay: LeagueDay,
    subject: LeagueSubject,
    filter: LeagueFilter,
  ): Promise<(LeagueRow & { previous_rank: number | null })[]> {
    const { where, parameters } = ApiKingdomsLeague.dayWhere(server, leagueDay, subject, filter);
    const { table, idColumn, columns } = SUBJECTS[subject];
    if (!leagueDay.previous_day) {
      const rows = await ApiKingdomsLeague.select<LeagueRow>(
        `SELECT ${columns} FROM ${table} FINAL WHERE ${where} ORDER BY rank`,
        parameters,
      );
      return rows.map((row) => ({ ...row, previous_rank: null }));
    }
    const rows = await ApiKingdomsLeague.select<LeagueRow & { previous_rank: number }>(
      `SELECT current.*, previous.previous_rank AS previous_rank
        FROM (SELECT ${columns} FROM ${table} FINAL WHERE ${where}) AS current
        LEFT JOIN (
          SELECT ${idColumn}, rank AS previous_rank FROM ${table} FINAL
          WHERE server = {server:String} AND season_id = {season:UInt16} AND day = {previous_day:Date}
        ) AS previous USING ${idColumn}
        ORDER BY rank`,
      { ...parameters, previous_day: leagueDay.previous_day },
    );
    return rows.map((row) => ({ ...row, previous_rank: row.previous_rank > 0 ? row.previous_rank : null }));
  }

  private static dayWhere(
    server: string,
    leagueDay: LeagueDay,
    subject: LeagueSubject,
    filter: LeagueFilter,
  ): { where: string; parameters: QueryParameters } {
    const { conditions, parameters } = KingdomsLeagueFilter.toSql(filter, subject);
    const where = ['server = {server:String}', 'season_id = {season:UInt16}', 'day = {day:Date}', ...conditions];
    return {
      where: where.join(' AND '),
      parameters: { ...parameters, server, season: leagueDay.season_id, day: leagueDay.day },
    };
  }

  private static async readPreviousRanks(
    server: string,
    leagueDay: LeagueDay,
    subject: LeagueSubject,
    rows: LeagueRow[],
  ): Promise<Map<number, number>> {
    const { table, idColumn } = SUBJECTS[subject];
    const ids = rows.map((row) => Number(row[idColumn]));
    if (!leagueDay.previous_day || ids.length === 0) return new Map();
    const previous = await ApiKingdomsLeague.select<{ id: number; rank: number }>(
      `SELECT ${idColumn} AS id, rank FROM ${table} FINAL
        WHERE server = {server:String} AND season_id = {season:UInt16} AND day = {day:Date}
          AND ${idColumn} IN {ids:Array(Int64)}`,
      { server, season: leagueDay.season_id, day: leagueDay.previous_day, ids },
    );
    return new Map(previous.map((row) => [Number(row.id), row.rank]));
  }

  private static present(
    row: LeagueRow,
    subject: LeagueSubject,
    code: string,
    previousRank: number | null,
  ): LeagueEntry {
    const medals = { gold: row.gold, silver: row.silver, bronze: row.bronze };
    if (subject === 'alliances') {
      return {
        rank: row.rank,
        previous_rank: previousRank,
        alliance_id: ApiKingdomsLeague.withCode(row.alliance_id, code),
        alliance_name: row.alliance_name,
        ...medals,
      };
    }
    return {
      rank: row.rank,
      previous_rank: previousRank,
      player_id: ApiKingdomsLeague.withCode(Number(row.player_id), code),
      player_name: row.player_name ?? '',
      alliance_id: row.alliance_id > 0 ? ApiKingdomsLeague.withCode(row.alliance_id, code) : null,
      alliance_name: row.alliance_id > 0 ? row.alliance_name : null,
      title: row.title ?? 0,
      ...medals,
    };
  }

  private static toCsv(items: LeagueEntry[]): string {
    const columns = Object.keys(items[0] ?? {});
    const lines = [columns.join(',')];
    for (const item of items) {
      lines.push(columns.map((column) => OuterRealmsExport.csvCell(item[column] as string | number | null)).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  private static parseFormat(value: unknown): ExportFormat | null {
    if (value === undefined || value === '') return 'json';
    return OuterRealmsExport.FORMATS.includes(value as ExportFormat) ? (value as ExportFormat) : null;
  }

  private static async resolveDay(server: string, day: string | undefined): Promise<LeagueDay | null> {
    const dayFilter = day ? 'AND day = {day:Date}' : '';
    const days = await ApiKingdomsLeague.select<{ day_text: string; season_id: number }>(
      `SELECT toString(day) AS day_text, season_id FROM ${ApiKingdomsLeague.DAYS_TABLE} FINAL
        WHERE server = {server:String} ${dayFilter}
        ORDER BY day DESC LIMIT 1`,
      day ? { server, day } : { server },
    );
    const found = days.at(0);
    if (!found) return null;
    const previous = await ApiKingdomsLeague.select<{ day_text: string }>(
      `SELECT toString(day) AS day_text FROM ${ApiKingdomsLeague.DAYS_TABLE} FINAL
        WHERE server = {server:String} AND season_id = {season:UInt16} AND day < {day:Date}
        ORDER BY day DESC LIMIT 1`,
      { server, season: found.season_id, day: found.day_text },
    );
    return { day: found.day_text, season_id: found.season_id, previous_day: previous.at(0)?.day_text ?? null };
  }

  private static async latestSeason(server: string): Promise<number | null> {
    const rows = await ApiKingdomsLeague.select<{ season_id: number }>(
      `SELECT season_id FROM ${ApiKingdomsLeague.DAYS_TABLE} FINAL
        WHERE server = {server:String} ORDER BY day DESC LIMIT 1`,
      { server },
    );
    return rows.at(0)?.season_id ?? null;
  }

  private static parseSeason(value: unknown): number | undefined | false {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return false;
    const season = Number(value);
    return season > 0 && season <= ApiKingdomsLeague.MAX_SEASON_ID ? season : false;
  }

  private static withCode(id: number, code: string): number {
    return Number(`${id}${code}`);
  }

  private static pagination(page: number, size: number, currentItems: number, totalItems: number): Pagination {
    return {
      current_page: page,
      total_pages: Math.ceil(totalItems / size),
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

  private static fail(request: express.Request, response: express.Response, error: unknown, origin: string): void {
    const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
    response.status(code).send({ error: message });
    ApiHelper.logError(error, origin, request);
  }
}
