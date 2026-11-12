import * as crypto from 'node:crypto';
import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { CachedResponse } from '../helper/cache/cached-response';
import { KingdomsLeagueFilter, LeagueFilter, LeagueSubject } from '../helper/kingdoms-league-filter';
import { toQueryText } from '../helper/parse-query';
import { IServerDefinition } from '../interfaces/interfaces';
import { ApiKingdomsLeague } from './api-kingdoms-league';

type LeagueGame = 'all' | 'ep' | 'e4k';

interface GlobalLeagueRow {
  global_rank: string;
  server: string;
  season_id: number;
  server_rank: number | string;
  player_id?: number;
  player_name?: string;
  alliance_id: number;
  alliance_name: string;
  title?: number;
  gold: number;
  silver: number;
  bronze: number;
}

const GAME_KINDS: Record<LeagueGame, string[]> = {
  all: ['ep', 'partner', 'e4k'],
  ep: ['ep', 'partner'],
  e4k: ['e4k'],
};

const GLOBAL_SUBJECTS: Record<LeagueSubject, { table: string; columns: string; order: string }> = {
  players: {
    table: 'ggetracker_global.kingdoms_league_players',
    columns: 'player_id, player_name, alliance_id, alliance_name, title, gold, silver, bronze',
    order: 'title DESC, gold DESC, silver DESC, bronze DESC, rank, server',
  },
  alliances: {
    table: 'ggetracker_global.kingdoms_league_alliances',
    columns: 'alliance_id, alliance_name, gold, silver, bronze',
    order: 'gold DESC, silver DESC, bronze DESC, rank, server',
  },
};

export abstract class ApiKingdomsLeagueGlobal implements ApiHelper {
  private static readonly DAYS_TABLE = 'ggetracker_global.kingdoms_league_days';
  private static readonly CACHE_TTL_SECONDS = 12 * 60 * 60;
  private static readonly MAX_DAYS = 400;

  public static async getDays(request: express.Request, response: express.Response): Promise<void> {
    try {
      const servers = ApiKingdomsLeagueGlobal.selectServers(request.query.game);
      if (!servers) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidServer });
        return;
      }
      const cacheKey = await ApiKingdomsLeagueGlobal.cacheKey(servers, 'days', {});
      if (await CachedResponse.serveCached(response, cacheKey)) return;
      const days = await ApiKingdomsLeagueGlobal.readDays(servers);
      await CachedResponse.serve(response, cacheKey, { days }, ApiKingdomsLeagueGlobal.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiKingdomsLeagueGlobal.fail(request, response, error, 'getKingdomsLeagueGlobalDays');
    }
  }

  public static async getPlayers(request: express.Request, response: express.Response): Promise<void> {
    await ApiKingdomsLeagueGlobal.serveRanking(request, response, 'players');
  }

  public static async getAlliances(request: express.Request, response: express.Response): Promise<void> {
    await ApiKingdomsLeagueGlobal.serveRanking(request, response, 'alliances');
  }

  private static async serveRanking(
    request: express.Request,
    response: express.Response,
    subject: LeagueSubject,
  ): Promise<void> {
    try {
      const servers = ApiKingdomsLeagueGlobal.selectServers(request.query.game);
      if (!servers) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidServer });
        return;
      }
      const filter = KingdomsLeagueFilter.parse({ ...request.query, alliance_id: undefined }, subject, '');
      if (typeof filter === 'string') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: filter });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const size = ApiHelper.parsePageSize(request.query.size);
      const cacheKey = await ApiKingdomsLeagueGlobal.cacheKey(servers, subject, {
        day: filter.day,
        ...KingdomsLeagueFilter.describe(filter),
        page,
        size,
      });
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const day = filter.day ?? (await ApiKingdomsLeagueGlobal.latestDay(servers));
      const { rows, totalItems } = day
        ? await ApiKingdomsLeagueGlobal.readPage(servers, day, subject, filter, page, size)
        : { rows: [], totalItems: 0 };
      const codes = new Map(servers.map((server) => [server.name, server.code]));
      const body = {
        day,
        [subject]: rows.map((row) => ApiKingdomsLeagueGlobal.present(row, subject, codes.get(row.server) ?? '')),
        pagination: {
          current_page: page,
          total_pages: Math.ceil(totalItems / size),
          current_items_count: rows.length,
          total_items_count: totalItems,
        },
      };
      await CachedResponse.serve(response, cacheKey, body, ApiKingdomsLeagueGlobal.CACHE_TTL_SECONDS);
    } catch (error) {
      ApiKingdomsLeagueGlobal.fail(request, response, error, `getKingdomsLeagueGlobal:${subject}`);
    }
  }

  private static async readPage(
    servers: IServerDefinition[],
    day: string,
    subject: LeagueSubject,
    filter: LeagueFilter,
    page: number,
    size: number,
  ): Promise<{ rows: GlobalLeagueRow[]; totalItems: number }> {
    const { table, columns, order } = GLOBAL_SUBJECTS[subject];
    const { conditions, parameters } = KingdomsLeagueFilter.toSql(filter, subject);
    const outerWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const nightWhere = 'day = {day:Date} AND server IN {servers:Array(String)}';
    const queryParameters = { ...parameters, day, servers: servers.map((server) => server.name) };
    const [rows, stats] = await Promise.all([
      ApiKingdomsLeague.select<GlobalLeagueRow>(
        `SELECT * FROM (
            SELECT server, season_id, rank AS server_rank, ${columns}, row_number() OVER (ORDER BY ${order}) AS global_rank
            FROM ${table} FINAL WHERE ${nightWhere}
          ) ${outerWhere}
          ORDER BY global_rank LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...queryParameters, limit: size, offset: (page - 1) * size },
      ),
      ApiKingdomsLeague.select<{ total_items: string }>(
        `SELECT count() AS total_items FROM ${table} FINAL
          WHERE ${[nightWhere, ...conditions].join(' AND ')}`,
        queryParameters,
      ),
    ]);
    return { rows, totalItems: Number(stats[0]?.total_items ?? 0) };
  }

  private static async readDays(servers: IServerDefinition[]): Promise<string[]> {
    const rows = await ApiKingdomsLeague.select<{ night: string }>(
      `SELECT DISTINCT toString(day) AS night FROM ${ApiKingdomsLeagueGlobal.DAYS_TABLE} FINAL
        WHERE server IN {servers:Array(String)} ORDER BY night DESC LIMIT {limit:UInt32}`,
      { servers: servers.map((server) => server.name), limit: ApiKingdomsLeagueGlobal.MAX_DAYS },
    );
    return rows.map((row) => row.night);
  }

  private static async latestDay(servers: IServerDefinition[]): Promise<string | null> {
    const days = await ApiKingdomsLeagueGlobal.readDays(servers);
    return days.at(0) ?? null;
  }

  private static present(row: GlobalLeagueRow, subject: LeagueSubject, code: string): Record<string, unknown> {
    const common = {
      rank: Number(row.global_rank),
      server: row.server,
      server_rank: Number(row.server_rank),
      season_id: row.season_id,
    };
    const medals = { gold: row.gold, silver: row.silver, bronze: row.bronze };
    if (subject === 'alliances') {
      return {
        ...common,
        alliance_id: Number(`${row.alliance_id}${code}`),
        alliance_name: row.alliance_name,
        ...medals,
      };
    }
    return {
      ...common,
      player_id: Number(`${row.player_id}${code}`),
      player_name: row.player_name,
      alliance_id: row.alliance_id > 0 ? Number(`${row.alliance_id}${code}`) : null,
      alliance_name: row.alliance_id > 0 ? row.alliance_name : null,
      title: row.title,
      ...medals,
    };
  }

  private static selectServers(gameParameter: unknown): IServerDefinition[] | null {
    const game = (toQueryText(gameParameter)?.trim().toLowerCase() || 'all') as LeagueGame;
    if (!(game in GAME_KINDS)) return null;
    return ApiHelper.ggeTrackerManager
      .getPublicServerDefinitions()
      .filter((definition) => definition.api.enabled && GAME_KINDS[game].includes(definition.kind));
  }

  // Keyed on every server's league version, so a night stored on any server refreshes the global answers
  private static async cacheKey(
    servers: IServerDefinition[],
    scope: string,
    parameters: Record<string, string | number | undefined>,
  ): Promise<string> {
    const names = servers.map((server) => server.name).sort();
    const versions = await ApiHelper.redisClient
      .mGet(names.map((name) => `kingdoms-league-version:${name}`))
      .catch(() => [] as (string | null)[]);
    const fingerprint = crypto
      .createHash('sha1')
      .update(names.map((name, index) => `${name}=${versions[index] ?? '-1'}`).join(','))
      .digest('hex')
      .slice(0, 16);
    return new CacheKeyBuilder('kingdoms-league:global').with(scope).withParams(parameters).with(fingerprint).build();
  }

  private static fail(request: express.Request, response: express.Response, error: unknown, origin: string): void {
    const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
    response.status(code).send({ error: message });
    ApiHelper.logError(error, origin, request);
  }
}
