import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { decodeIdCursor, encodeIdCursor } from '../helper/cursor';
import { HttpCache } from '../helper/http-cache';

interface ProjectionColumn {
  sql: string;
  join?: 'alliances' | 'players';
  cast?: 'number' | 'date';
}

interface ExportRequest {
  cursor: number;
  limit: number;
  fields: string[];
  ndjson: boolean;
  updatedSince: string | null;
  allianceId: number | null;
  active: number | null;
  onlyPopulated: boolean;
}

interface ExportPage {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Whole collection reads for integrations.
 * The paginated routes return fifteen rows at a time, so reading a server through them costs a
 * request per fifteen players. These return the collection in keyset pages of up to five thousand
 * rows, projected to the columns asked for, with an ETag so an unchanged fill costs a 304
 */
export abstract class ApiExport implements ApiHelper {
  public static readonly MAX_LIMIT = 5000;
  public static readonly DEFAULT_LIMIT = 1000;
  public static readonly CACHE_TTL_SECONDS = 3600;

  private static readonly MAX_CACHED_BYTES = 4 * 1024 * 1024;

  private static readonly PLAYER_COLUMNS: Record<string, ProjectionColumn> = {
    player_id: { sql: 'P.id' },
    player_name: { sql: 'P.name' },
    alliance_id: { sql: 'P.alliance_id' },
    alliance_name: { sql: 'A.name', join: 'alliances' },
    alliance_rank: { sql: 'P.alliance_rank', cast: 'number' },
    might_current: { sql: 'P.might_current', cast: 'number' },
    might_all_time: { sql: 'P.might_all_time', cast: 'number' },
    loot_current: { sql: 'P.loot_current', cast: 'number' },
    loot_all_time: { sql: 'P.loot_all_time', cast: 'number' },
    honor: { sql: 'P.honor', cast: 'number' },
    max_honor: { sql: 'P.max_honor', cast: 'number' },
    level: { sql: 'P.level', cast: 'number' },
    legendary_level: { sql: 'P.legendary_level', cast: 'number' },
    highest_fame: { sql: 'P.highest_fame', cast: 'number' },
    current_fame: { sql: 'P.current_fame', cast: 'number' },
    remaining_relocation_time: { sql: 'P.remaining_relocation_time', cast: 'number' },
    castles: { sql: 'P.castles' },
    castles_realm: { sql: 'P.castles_realm' },
    peace_disabled_at: { sql: 'P.peace_disabled_at', cast: 'date' },
    updated_at: { sql: 'P.updated_at', cast: 'date' },
  };

  private static readonly PLAYER_DEFAULT_FIELDS = ['player_id', 'player_name', 'alliance_id'];

  private static readonly ALLIANCE_COLUMNS: Record<string, ProjectionColumn> = {
    alliance_id: { sql: 'A.id' },
    alliance_name: { sql: 'A.name' },
    language: { sql: 'A.language' },
    description: { sql: 'A.description' },
    is_island_king: { sql: 'A.is_island_king' },
    is_searching_players: { sql: 'A.is_searching_alliance' },
    auto_join_enabled: { sql: 'A.auto_join_enabled' },
    player_count: { sql: 'COUNT(P.id)', join: 'players', cast: 'number' },
    active_player_count: { sql: 'COUNT(P.id) FILTER (WHERE P.loot_current > 0)', join: 'players', cast: 'number' },
    might_current: { sql: 'SUM(P.might_current)', join: 'players', cast: 'number' },
    might_all_time: { sql: 'SUM(P.might_all_time)', join: 'players', cast: 'number' },
    loot_current: { sql: 'SUM(P.loot_current)', join: 'players', cast: 'number' },
    loot_all_time: { sql: 'SUM(P.loot_all_time)', join: 'players', cast: 'number' },
    current_fame: { sql: 'SUM(P.current_fame)', join: 'players', cast: 'number' },
    highest_fame: { sql: 'SUM(P.highest_fame)', join: 'players', cast: 'number' },
  };

  private static readonly ALLIANCE_DEFAULT_FIELDS = ['alliance_id', 'alliance_name'];

  private static readonly CASTLE_FIELDS = [
    'player_id',
    'player_name',
    'alliance_id',
    'kingdom_id',
    'position_x',
    'position_y',
    'castle_type',
    'is_main',
  ];

  private static readonly ID_FIELDS = new Set(['player_id', 'alliance_id']);

  public static async getPlayersExport(request: express.Request, response: express.Response): Promise<void> {
    await this.serve(request, response, 'players', async (parameters, pool) => {
      const columns = this.project(parameters.fields, this.PLAYER_COLUMNS);
      const values: unknown[] = [parameters.cursor];
      const conditions = ['P.id > $1'];
      if (parameters.updatedSince) {
        values.push(parameters.updatedSince);
        conditions.push(`P.updated_at >= $${values.length}`);
      }
      if (parameters.allianceId !== null) {
        values.push(parameters.allianceId);
        conditions.push(`P.alliance_id = $${values.length}`);
      }
      if (parameters.active === 1) {
        conditions.push('(P.castles IS NOT NULL AND jsonb_array_length(P.castles) > 0)');
      } else if (parameters.active === 0) {
        conditions.push('(P.castles IS NULL OR jsonb_array_length(P.castles) = 0)');
      }
      const join = columns.some((column) => this.PLAYER_COLUMNS[column].join === 'alliances')
        ? 'LEFT JOIN alliances A ON P.alliance_id = A.id'
        : '';
      values.push(parameters.limit + 1);
      const query = `
        SELECT ${columns.map((column) => `${this.PLAYER_COLUMNS[column].sql} AS ${column}`).join(', ')}, P.id AS _cursor
        FROM players P
        ${join}
        WHERE ${conditions.join(' AND ')}
        ORDER BY P.id ASC
        LIMIT $${values.length}`;
      return this.readPage(pool, query, values, parameters, columns, this.PLAYER_COLUMNS, request['code']);
    });
  }

  public static async getAlliancesExport(request: express.Request, response: express.Response): Promise<void> {
    await this.serve(request, response, 'alliances', async (parameters, pool) => {
      const columns = this.project(parameters.fields, this.ALLIANCE_COLUMNS);
      const aggregated = columns.some((column) => this.ALLIANCE_COLUMNS[column].join === 'players');
      const values: unknown[] = [parameters.cursor, parameters.limit + 1];
      const join = aggregated || parameters.onlyPopulated ? 'LEFT JOIN players P ON A.id = P.alliance_id' : '';
      const selected = columns.map((column) => `${this.ALLIANCE_COLUMNS[column].sql} AS ${column}`).join(', ');
      const query = `
        SELECT ${selected}, A.id AS _cursor
        FROM alliances A
        ${join}
        WHERE A.id > $1
        ${join ? 'GROUP BY A.id' : ''}
        ${parameters.onlyPopulated ? 'HAVING COUNT(P.id) > 0' : ''}
        ORDER BY A.id ASC
        LIMIT $2`;
      return this.readPage(pool, query, values, parameters, columns, this.ALLIANCE_COLUMNS, request['code']);
    });
  }

  /**
   * One row per castle, so the caller does not have to know how the two castle arrays are shaped.
   * The page is cut on the player id and a player's castles are never split, so count exceeds limit
   */
  public static async getCastlesExport(request: express.Request, response: express.Response): Promise<void> {
    await this.serve(request, response, 'castles', async (parameters, pool) => {
      const values: unknown[] = [parameters.cursor, parameters.limit];
      const query = `
        WITH page AS (
          SELECT P.id, P.name, P.alliance_id, P.castles, P.castles_realm
          FROM players P
          WHERE P.id > $1 AND P.castles IS NOT NULL AND jsonb_array_length(P.castles) > 0
          ORDER BY P.id ASC
          LIMIT $2
        )
        SELECT page.id AS player_id, page.name AS player_name, page.alliance_id,
          0 AS kingdom_id,
          (castle->>0)::int AS position_x, (castle->>1)::int AS position_y,
          (castle->>2)::int AS castle_type
        FROM page, LATERAL jsonb_array_elements(page.castles) AS castle
        UNION ALL
        SELECT page.id, page.name, page.alliance_id,
          (castle->>0)::int,
          (castle->>1)::int, (castle->>2)::int,
          (castle->>3)::int
        FROM page, LATERAL jsonb_array_elements(COALESCE(page.castles_realm, '[]'::jsonb)) AS castle
        ORDER BY player_id ASC, kingdom_id ASC, position_x ASC, position_y ASC`;
      const results = await pool.query(query, values);
      const code = request['code'];
      const playerIds = new Set(results.rows.map((row: any) => row.player_id));
      const hasMore = playerIds.size >= parameters.limit;
      const lastPlayerId = results.rows.at(-1)?.player_id ?? null;
      return {
        rows: results.rows.map((row: any) => ({
          player_id: ApiHelper.addCountryCode(row.player_id, code),
          player_name: row.player_name,
          alliance_id: ApiHelper.addCountryCode(row.alliance_id, code),
          kingdom_id: row.kingdom_id,
          position_x: row.position_x,
          position_y: row.position_y,
          castle_type: row.castle_type,
          is_main: row.kingdom_id === 0 && row.castle_type === 1,
        })),
        hasMore,
        nextCursor: hasMore && lastPlayerId !== null ? encodeIdCursor(Number(lastPlayerId)) : null,
      };
    });
  }

  private static async serve(
    request: express.Request,
    response: express.Response,
    collection: 'players' | 'alliances' | 'castles',
    read: (parameters: ExportRequest, pool: pg.Pool) => Promise<ExportPage>,
  ): Promise<void> {
    try {
      const parameters = this.parseRequest(request, collection);
      if ('error' in parameters) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: parameters.error });
        return;
      }
      // The body depends on Accept when format is absent, so a shared cache must not mix the two
      response.vary('Accept');
      const language = request['language'];
      const dataVersion = await ApiHelper.getCacheVersion(ApiHelper.redisClient, language);
      const cacheKey = new CacheKeyBuilder(language)
        .with(dataVersion)
        .with(`export:${collection}`)
        .withParams({
          cursor: parameters.cursor,
          limit: parameters.limit,
          fields: parameters.fields.join('.'),
          updatedSince: parameters.updatedSince,
          allianceId: parameters.allianceId,
          active: parameters.active,
          onlyPopulated: parameters.onlyPopulated ? 1 : 0,
        })
        .build();

      if (
        HttpCache.handleConditional(request, response, {
          etag: HttpCache.etagFromCacheKey(cacheKey + (parameters.ndjson ? ':ndjson' : '')),
          dataVersion,
          maxAgeSeconds: this.CACHE_TTL_SECONDS,
        })
      ) {
        return;
      }

      const cached = await ApiHelper.redisClient.get(cacheKey);
      const page: ExportPage = cached ? JSON.parse(cached) : await read(parameters, request['pg_pool'] as pg.Pool);
      if (!cached) {
        const serialized = JSON.stringify(page);
        if (serialized.length <= this.MAX_CACHED_BYTES) {
          void ApiHelper.updateCache(cacheKey, serialized, this.CACHE_TTL_SECONDS, true);
        }
      }
      this.send(request, response, collection, parameters, page, dataVersion);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, `getExport:${collection}`, request);
    }
  }

  private static send(
    request: express.Request,
    response: express.Response,
    collection: string,
    parameters: ExportRequest,
    page: ExportPage,
    dataVersion: string,
  ): void {
    if (parameters.ndjson) {
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      response.setHeader('X-Item-Count', String(page.rows.length));
      response.setHeader('X-Has-More', page.hasMore ? 'true' : 'false');
      if (page.nextCursor) response.setHeader('X-Next-Cursor', page.nextCursor);
      response.status(ApiHelper.HTTP_OK).send(page.rows.map((row) => JSON.stringify(row) + '\n').join(''));
      return;
    }
    response.status(ApiHelper.HTTP_OK).send({
      server: request['language'],
      server_code: request['code'],
      data_version: Number(dataVersion),
      generated_at: new Date().toISOString(),
      fields: parameters.fields,
      page: {
        count: page.rows.length,
        limit: parameters.limit,
        has_more: page.hasMore,
        next_cursor: page.nextCursor,
      },
      [collection]: page.rows,
    });
  }

  private static async readPage(
    pool: pg.Pool,
    query: string,
    values: unknown[],
    parameters: ExportRequest,
    columns: string[],
    definitions: Record<string, ProjectionColumn>,
    code: string,
  ): Promise<ExportPage> {
    const results = await pool.query(query, values);
    const hasMore = results.rows.length > parameters.limit;
    const rows = hasMore ? results.rows.slice(0, parameters.limit) : results.rows;
    const lastCursor = rows.at(-1)?._cursor;
    return {
      rows: rows.map((row: any) => {
        const projected: Record<string, unknown> = {};
        for (const column of columns) {
          projected[column] = this.castValue(row[column], definitions[column], column, code);
        }
        return projected;
      }),
      hasMore,
      nextCursor: hasMore && lastCursor !== undefined ? encodeIdCursor(Number(lastCursor)) : null,
    };
  }

  private static castValue(value: unknown, definition: ProjectionColumn, column: string, code: string): unknown {
    if (value === null || value === undefined) return null;
    if (this.ID_FIELDS.has(column)) return ApiHelper.addCountryCode(String(value), code);
    if (definition.cast === 'number') return Number(value);
    if (definition.cast === 'date') return new Date(value as string).toISOString();
    return value;
  }

  private static project(requested: string[], definitions: Record<string, ProjectionColumn>): string[] {
    return requested.filter((field) => field in definitions);
  }

  private static parseRequest(
    request: express.Request,
    collection: 'players' | 'alliances' | 'castles',
  ): ExportRequest | { error: string } {
    const rawCursor = request.query.cursor;
    let cursor = 0;
    if (rawCursor !== undefined) {
      const decoded = decodeIdCursor(rawCursor);
      if (decoded === null) return { error: RouteErrorMessagesEnum.InvalidCursor };
      cursor = decoded;
    }

    const rawLimit = request.query.limit;
    let limit = this.DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > this.MAX_LIMIT) {
        return { error: RouteErrorMessagesEnum.InvalidExportLimit };
      }
      limit = parsed;
    }

    const definitions = collection === 'alliances' ? this.ALLIANCE_COLUMNS : this.PLAYER_COLUMNS;
    const defaults = collection === 'alliances' ? this.ALLIANCE_DEFAULT_FIELDS : this.PLAYER_DEFAULT_FIELDS;
    let fields = collection === 'castles' ? this.CASTLE_FIELDS : defaults;
    const rawFields = ApiHelper.getParsedString(request.query.fields);
    if (rawFields !== null && collection !== 'castles') {
      if (rawFields === 'all') {
        fields = Object.keys(definitions);
      } else {
        const requested = rawFields.split(',').map((field) => field.trim());
        // The allowed columns, not the rejected ones, which would reflect caller input
        if (requested.some((field) => !(field in definitions))) {
          const allowed = Object.keys(definitions).join(', ');
          return { error: `${RouteErrorMessagesEnum.InvalidExportFields}. Allowed: ${allowed}` };
        }
        fields = [...new Set([defaults[0], ...requested])];
      }
    }

    let updatedSince: string | null = null;
    const rawUpdatedSince = ApiHelper.getParsedString(request.query.updated_since);
    if (rawUpdatedSince !== null) {
      const parsed = new Date(rawUpdatedSince);
      if (Number.isNaN(parsed.getTime())) return { error: RouteErrorMessagesEnum.InvalidDateParameter };
      updatedSince = parsed.toISOString();
    }

    let allianceId: number | null = null;
    if (request.query.alliance_id !== undefined) {
      const verified = ApiHelper.verifyIdWithCountryCode(request.query.alliance_id);
      if (verified === false) return { error: RouteErrorMessagesEnum.InvalidAllianceId };
      allianceId = Number(ApiHelper.removeCountryCode(String(verified)));
    }

    let active: number | null = null;
    if (request.query.active !== undefined) {
      if (request.query.active !== '0' && request.query.active !== '1') {
        return { error: RouteErrorMessagesEnum.InvalidInput };
      }
      active = Number(request.query.active);
    }

    const accept = String(request.headers.accept || '');
    const format = ApiHelper.getParsedString(request.query.format);
    if (format !== null && format !== 'json' && format !== 'ndjson') {
      return { error: RouteErrorMessagesEnum.InvalidExportFormat };
    }

    return {
      cursor,
      limit,
      fields,
      ndjson: format === 'ndjson' || (format === null && accept.includes('application/x-ndjson')),
      updatedSince,
      allianceId,
      active,
      onlyPopulated: request.query.only_populated === '1',
    };
  }
}
