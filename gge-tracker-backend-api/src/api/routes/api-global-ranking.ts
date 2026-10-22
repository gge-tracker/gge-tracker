import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { CachedResponse } from '../helper/cache/cached-response';
import { PaginationCount } from '../helper/cache/pagination-count';
import { qLevelPair, qNumber, qOrderBy, qString, toQueryText } from '../helper/parse-query';
import { IServerDefinition } from '../interfaces/interfaces';

interface GlobalPlayerRow {
  region: string;
  id: string;
  name: string;
  alliance_id: string | null;
  alliance_name: string | null;
  alliance_rank: number | null;
  level: number | null;
  legendary_level: number | null;
  might_current: string | null;
  might_all_time: string | null;
  loot_current: string | null;
  loot_all_time: string | null;
  current_fame: string | null;
  highest_fame: string | null;
  honor: number | null;
  max_honor: number | null;
  peace_disabled_at: Date | null;
}

interface GlobalAllianceRow {
  region: string;
  alliance_id: string;
  alliance_name: string | null;
  might_current: string | null;
  might_all_time: string | null;
  loot_current: string | null;
  loot_all_time: string | null;
  current_fame: string | null;
  highest_fame: string | null;
  player_count: string;
  active_player_count: string;
}

interface GlobalPlayersFilter {
  where: string;
  values: (string | number | string[])[];
}

type GlobalGame = 'ep' | 'e4k';

export abstract class ApiGlobalRanking implements ApiHelper {
  private static readonly CACHE_VERSION_KEY = 'global-ranking:version';
  private static readonly CACHE_TTL_SECONDS = 3600;
  private static readonly MAX_NAME_LENGTH = 40;
  private static readonly MAX_ALLIANCE_MEMBERS = 65;
  private static readonly ORDER_COLUMNS: Record<string, string> = {
    might_current: 'might_current',
    might_all_time: 'might_all_time',
    loot_current: 'loot_current',
    loot_all_time: 'loot_all_time',
    current_fame: 'current_fame',
    highest_fame: 'highest_fame',
    honor: 'honor',
    level: 'level',
    player_name: 'name',
  };
  private static readonly ALLIANCE_ORDER_COLUMNS: Record<string, string> = {
    might_current: 'might_current',
    might_all_time: 'might_all_time',
    loot_current: 'loot_current',
    loot_all_time: 'loot_all_time',
    current_fame: 'current_fame',
    highest_fame: 'highest_fame',
    player_count: 'player_count',
    active_player_count: 'active_player_count',
    alliance_name: 'alliance_name',
  };
  private static readonly ALLIANCE_AGGREGATES: [string, string, '>=' | '<='][] = [
    ['minMight', 'SUM(might_current)', '>='],
    ['maxMight', 'SUM(might_current)', '<='],
    ['minLoot', 'SUM(loot_current)', '>='],
    ['maxLoot', 'SUM(loot_current)', '<='],
    ['minFame', 'SUM(current_fame)', '>='],
    ['maxFame', 'SUM(current_fame)', '<='],
    ['minPlayerCount', 'COUNT(*)', '>='],
    ['maxPlayerCount', 'COUNT(*)', '<='],
  ];
  private static readonly GAME_KINDS: Record<GlobalGame, string[]> = {
    ep: ['ep', 'partner'],
    e4k: ['e4k'],
  };

  public static async getPlayers(request: express.Request, response: express.Response): Promise<void> {
    try {
      const servers = ApiGlobalRanking.selectServers(request.query.servers, request.query.game);
      if (servers === null) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidServer });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const pageSize = ApiHelper.parsePageSize(request.query.size);
      const orderBy = qOrderBy(Object.keys(ApiGlobalRanking.ORDER_COLUMNS), 'might_current').parse(
        request.query.orderBy,
      )!;
      const orderType = toQueryText(request.query.orderType)?.trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      const bounds = ApiGlobalRanking.parseBounds(request.query);
      const playerName = qString({ max: ApiGlobalRanking.MAX_NAME_LENGTH }).parse(request.query.playerName);

      const regions = servers.map((server) => server.globalName).sort();
      const version = (await ApiHelper.redisClient.get(ApiGlobalRanking.CACHE_VERSION_KEY).catch(() => null)) ?? '-1';
      const filterKey = new CacheKeyBuilder('global-ranking:players')
        .with(`v${version}`)
        .with(regions.join(','))
        .withParams({ ...bounds, playerName: playerName?.toLowerCase() })
        .build();
      const cacheKey = new CacheKeyBuilder(filterKey).withParams({ orderBy, orderType, page, size: pageSize }).build();
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const filter = ApiGlobalRanking.buildFilter(regions, bounds, playerName);
      const limitIndex = filter.values.length + 1;
      const [total, rows] = await Promise.all([
        PaginationCount.resolve(`${filterKey}:count`, () => ApiGlobalRanking.count(filter)),
        ApiGlobalRanking.select<GlobalPlayerRow>(
          `SELECT region, id, name, alliance_id, alliance_name, alliance_rank, level, legendary_level,
              might_current, might_all_time, loot_current, loot_all_time, current_fame, highest_fame,
              honor, max_honor, peace_disabled_at
            FROM global_players
            ${filter.where}
            ORDER BY ${ApiGlobalRanking.ordering(orderBy, orderType)}
            LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
          [...filter.values, pageSize, (page - 1) * pageSize],
        ),
      ]);

      const serverByRegion = new Map(servers.map((server) => [server.globalName, server]));
      const body = {
        pagination: {
          current_page: page,
          total_pages: Math.ceil(total / pageSize),
          current_items_count: rows.length,
          total_items_count: total,
        },
        players: rows.map((row) => ApiGlobalRanking.toPlayer(row, serverByRegion.get(row.region)!)),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiGlobalRanking.CACHE_TTL_SECONDS);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getGlobalRankingPlayers', request);
    }
  }

  public static async getAlliances(request: express.Request, response: express.Response): Promise<void> {
    try {
      const servers = ApiGlobalRanking.selectServers(request.query.servers, request.query.game);
      if (servers === null) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidServer });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const pageSize = ApiHelper.parsePageSize(request.query.size);
      const orderBy = qOrderBy(Object.keys(ApiGlobalRanking.ALLIANCE_ORDER_COLUMNS), 'might_current').parse(
        request.query.orderBy,
      )!;
      const orderType = toQueryText(request.query.orderType)?.trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      const bounds = ApiGlobalRanking.parseAllianceBounds(request.query);
      const allianceName = qString({ max: ApiGlobalRanking.MAX_NAME_LENGTH }).parse(request.query.allianceName);

      const regions = servers.map((server) => server.globalName).sort();
      const version = (await ApiHelper.redisClient.get(ApiGlobalRanking.CACHE_VERSION_KEY).catch(() => null)) ?? '-1';
      const filterKey = new CacheKeyBuilder('global-ranking:alliances')
        .with(`v${version}`)
        .with(regions.join(','))
        .withParams({ ...bounds, allianceName: allianceName?.toLowerCase() })
        .build();
      const cacheKey = new CacheKeyBuilder(filterKey).withParams({ orderBy, orderType, page, size: pageSize }).build();
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const grouped = ApiGlobalRanking.buildAllianceGrouping(regions, bounds, allianceName);
      const limitIndex = grouped.values.length + 1;
      const [total, rows] = await Promise.all([
        PaginationCount.resolve(`${filterKey}:count`, () => ApiGlobalRanking.countAlliances(grouped)),
        ApiGlobalRanking.select<GlobalAllianceRow>(
          `SELECT region, alliance_id, MAX(alliance_name) AS alliance_name,
              SUM(might_current) AS might_current, SUM(might_all_time) AS might_all_time,
              SUM(loot_current) AS loot_current, SUM(loot_all_time) AS loot_all_time,
              SUM(current_fame) AS current_fame, SUM(highest_fame) AS highest_fame,
              COUNT(*) AS player_count, COUNT(*) FILTER (WHERE loot_current > 0) AS active_player_count
            FROM global_players
            ${grouped.where}
            ORDER BY ${ApiGlobalRanking.allianceOrdering(orderBy, orderType)}
            LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
          [...grouped.values, pageSize, (page - 1) * pageSize],
        ),
      ]);

      const serverByRegion = new Map(servers.map((server) => [server.globalName, server]));
      const body = {
        pagination: {
          current_page: page,
          total_pages: Math.ceil(total / pageSize),
          current_items_count: rows.length,
          total_items_count: total,
        },
        alliances: rows.map((row) => ApiGlobalRanking.toAlliance(row, serverByRegion.get(row.region)!)),
      };
      await CachedResponse.serve(response, cacheKey, body, ApiGlobalRanking.CACHE_TTL_SECONDS);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getGlobalRankingAlliances', request);
    }
  }

  private static selectServers(serversParameter: unknown, gameParameter: unknown): IServerDefinition[] | null {
    const enabled = ApiHelper.ggeTrackerManager
      .getPublicServerDefinitions()
      .filter((definition) => definition.api.enabled && definition.globalName);
    const game = toQueryText(gameParameter)?.trim().toLowerCase();
    if (game !== undefined && !(game in ApiGlobalRanking.GAME_KINDS)) return null;
    const kinds = game ? ApiGlobalRanking.GAME_KINDS[game as GlobalGame] : null;
    const inGame = kinds ? enabled.filter((definition) => kinds.includes(definition.kind)) : enabled;

    const serversText = toQueryText(serversParameter)?.trim();
    if (!serversText) return inGame;
    const requested = new Set(serversText.toUpperCase().split(','));
    const selected = inGame.filter((definition) => requested.has(definition.name));
    return selected.length === requested.size ? selected : null;
  }

  private static parseBounds(query: express.Request['query']): Record<string, number | undefined> {
    const amount = qNumber({ min: 0, max: ApiHelper.MAX_BIG_VALUE });
    const level = qLevelPair({ maxLevel: 70, maxLegendaryLevel: 999 });
    const [minLevel, minLegendaryLevel] = level.parse(query.minLevel);
    const [maxLevel, maxLegendaryLevel] = level.parse(query.maxLevel);
    return {
      minMight: amount.parse(query.minMight),
      maxMight: amount.parse(query.maxMight),
      minLoot: amount.parse(query.minLoot),
      maxLoot: amount.parse(query.maxLoot),
      minFame: amount.parse(query.minFame),
      maxFame: amount.parse(query.maxFame),
      minLevel,
      maxLevel,
      minLegendaryLevel,
      maxLegendaryLevel,
    };
  }

  private static buildFilter(
    regions: string[],
    bounds: Record<string, number | undefined>,
    playerName: string | undefined,
  ): GlobalPlayersFilter {
    const values: (string | number | string[])[] = [regions];
    const conditions = ['active', 'region = ANY($1::text[])'];
    const columns: [string, string, '>=' | '<='][] = [
      ['minMight', 'might_current', '>='],
      ['maxMight', 'might_current', '<='],
      ['minLoot', 'loot_current', '>='],
      ['maxLoot', 'loot_current', '<='],
      ['minFame', 'current_fame', '>='],
      ['maxFame', 'current_fame', '<='],
      ['minLevel', 'level', '>='],
      ['maxLevel', 'level', '<='],
      ['minLegendaryLevel', 'legendary_level', '>='],
      ['maxLegendaryLevel', 'legendary_level', '<='],
    ];
    for (const [key, column, operator] of columns) {
      if (bounds[key] === undefined) continue;
      values.push(bounds[key]);
      conditions.push(`${column} ${operator} $${values.length}`);
    }
    if (playerName) {
      values.push(`%${ApiHelper.escapeLike(playerName)}%`);
      conditions.push(`name ILIKE $${values.length} ESCAPE '\\'`);
    }
    return { where: `WHERE ${conditions.join(' AND ')}`, values };
  }

  private static ordering(orderBy: string, orderType: 'ASC' | 'DESC'): string {
    const direction = `${orderType} NULLS LAST`;
    const column = ApiGlobalRanking.ORDER_COLUMNS[orderBy];
    const levelTiebreak = orderBy === 'level' ? `, legendary_level ${direction}` : '';
    return `${column} ${direction}${levelTiebreak}, region, id`;
  }

  private static async count(filter: GlobalPlayersFilter): Promise<number> {
    const [row] = await ApiGlobalRanking.select<{ total: string }>(
      `SELECT COUNT(*) AS total FROM global_players ${filter.where}`,
      filter.values,
    );
    return Number(row?.total ?? 0);
  }

  private static toPlayer(row: GlobalPlayerRow, server: IServerDefinition): Record<string, unknown> {
    return {
      player_id: ApiHelper.addCountryCode(row.id, server.code),
      player_name: row.name,
      server: server.name,
      alliance_id: row.alliance_id ? ApiHelper.addCountryCode(row.alliance_id, server.code) : null,
      alliance_name: row.alliance_name,
      alliance_rank: row.alliance_rank,
      level: row.level,
      legendary_level: row.legendary_level,
      might_current: Number(row.might_current ?? 0),
      might_all_time: Number(row.might_all_time ?? 0),
      loot_current: Number(row.loot_current ?? 0),
      loot_all_time: Number(row.loot_all_time ?? 0),
      current_fame: Number(row.current_fame ?? 0),
      highest_fame: Number(row.highest_fame ?? 0),
      honor: row.honor,
      max_honor: row.max_honor,
      peace_disabled_at: row.peace_disabled_at ? new Date(row.peace_disabled_at).toISOString() : null,
    };
  }

  private static parseAllianceBounds(query: express.Request['query']): Record<string, number | undefined> {
    const amount = qNumber({ min: 0, max: ApiHelper.MAX_BIG_VALUE });
    const playerCount = qNumber({ min: 0, max: ApiGlobalRanking.MAX_ALLIANCE_MEMBERS });
    return {
      minMight: amount.parse(query.minMight),
      maxMight: amount.parse(query.maxMight),
      minLoot: amount.parse(query.minLoot),
      maxLoot: amount.parse(query.maxLoot),
      minFame: amount.parse(query.minFame),
      maxFame: amount.parse(query.maxFame),
      minPlayerCount: playerCount.parse(query.minPlayerCount),
      maxPlayerCount: playerCount.parse(query.maxPlayerCount),
    };
  }

  private static buildAllianceGrouping(
    regions: string[],
    bounds: Record<string, number | undefined>,
    allianceName: string | undefined,
  ): GlobalPlayersFilter {
    const values: (string | number | string[])[] = [regions];
    const conditions = ['active', 'alliance_id IS NOT NULL', 'region = ANY($1::text[])'];
    if (allianceName) {
      values.push(`%${ApiHelper.escapeLike(allianceName)}%`);
      conditions.push(`alliance_name ILIKE $${values.length} ESCAPE '\\'`);
    }
    const having: string[] = [];
    for (const [key, aggregate, operator] of ApiGlobalRanking.ALLIANCE_AGGREGATES) {
      if (bounds[key] === undefined) continue;
      values.push(bounds[key]);
      having.push(`${aggregate} ${operator} $${values.length}`);
    }
    const havingClause = having.length > 0 ? `HAVING ${having.join(' AND ')}` : '';
    return {
      where: `WHERE ${conditions.join(' AND ')} GROUP BY region, alliance_id ${havingClause}`,
      values,
    };
  }

  private static allianceOrdering(orderBy: string, orderType: 'ASC' | 'DESC'): string {
    return `${ApiGlobalRanking.ALLIANCE_ORDER_COLUMNS[orderBy]} ${orderType} NULLS LAST, region, alliance_id`;
  }

  private static async countAlliances(grouped: GlobalPlayersFilter): Promise<number> {
    const [row] = await ApiGlobalRanking.select<{ total: string }>(
      `SELECT COUNT(*) AS total FROM (SELECT 1 FROM global_players ${grouped.where}) AS alliances`,
      grouped.values,
    );
    return Number(row?.total ?? 0);
  }

  private static toAlliance(row: GlobalAllianceRow, server: IServerDefinition): Record<string, unknown> {
    return {
      alliance_id: ApiHelper.addCountryCode(row.alliance_id, server.code),
      alliance_name: row.alliance_name,
      server: server.name,
      might_current: Number(row.might_current ?? 0),
      might_all_time: Number(row.might_all_time ?? 0),
      loot_current: Number(row.loot_current ?? 0),
      loot_all_time: Number(row.loot_all_time ?? 0),
      current_fame: Number(row.current_fame ?? 0),
      highest_fame: Number(row.highest_fame ?? 0),
      player_count: Number(row.player_count),
      active_player_count: Number(row.active_player_count),
    };
  }

  private static async select<T>(query: string, parameters: (string | number | string[])[]): Promise<T[]> {
    const pgPool: pg.Pool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
    const { rows } = await pgPool.query(query, parameters);
    return rows as T[];
  }
}
