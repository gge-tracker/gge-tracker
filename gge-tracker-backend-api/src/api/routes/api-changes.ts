import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { decodeCursor, encodeCursor } from '../helper/cursor';

interface ChangeSource {
  table: string;
  subject: 'player' | 'alliance';
  columns: string;
  map: (row: any, code: string) => Record<string, unknown>;
}

interface ChangeRow {
  type: string;
  id: number;
  createdAt: Date;
  cursorTimestamp: string;
  payload: Record<string, unknown>;
}

interface ChangesRequest {
  types: string[];
  positions: Record<string, [string, number]>;
  limit: number;
  playerIds: number[] | null;
  allianceIds: number[] | null;
}

export abstract class ApiChanges implements ApiHelper {
  public static readonly MAX_LIMIT = 1000;
  public static readonly DEFAULT_LIMIT = 200;
  public static readonly MAX_SUBJECT_IDS = 200;
  private static readonly CACHE_TTL_SECONDS = 20;
  private static readonly DEFAULT_LOOKBACK_HOURS = 24;
  private static readonly CURSOR_TIMESTAMP_COLUMN =
    "to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS cursor_timestamp";
  private static readonly SOURCES: Record<string, ChangeSource> = {
    membership: {
      table: 'player_alliance_update',
      subject: 'player',
      columns: 'player_id, old_alliance_id, new_alliance_id, old_alliance_name, new_alliance_name',
      map: (row, code) => ({
        player_id: ApiHelper.addCountryCode(row.player_id, code),
        old_alliance_id: ApiHelper.addCountryCode(row.old_alliance_id, code),
        new_alliance_id: ApiHelper.addCountryCode(row.new_alliance_id, code),
        old_alliance_name: row.old_alliance_name,
        new_alliance_name: row.new_alliance_name,
      }),
    },
    player_rename: {
      table: 'player_name_update_history',
      subject: 'player',
      columns: 'player_id, old_name, new_name',
      map: (row, code) => ({
        player_id: ApiHelper.addCountryCode(row.player_id, code),
        old_name: row.old_name,
        new_name: row.new_name,
      }),
    },
    castle_movement: {
      table: 'player_castle_movements_history',
      subject: 'player',
      columns: 'player_id, castle_type, movement_type, position_x_old, position_y_old, position_x_new, position_y_new',
      map: (row, code) => ({
        player_id: ApiHelper.addCountryCode(row.player_id, code),
        castle_type: row.castle_type,
        movement_type: row.movement_type,
        position_old: row.position_x_old === null ? null : { x: row.position_x_old, y: row.position_y_old },
        position_new: row.position_x_new === null ? null : { x: row.position_x_new, y: row.position_y_new },
      }),
    },
    alliance_rename: {
      table: 'alliance_update_history',
      subject: 'alliance',
      columns: 'alliance_id, old_name, new_name',
      map: (row, code) => ({
        alliance_id: ApiHelper.addCountryCode(row.alliance_id, code),
        old_name: row.old_name,
        new_name: row.new_name,
      }),
    },
    alliance_description: {
      table: 'alliance_description_history',
      subject: 'alliance',
      columns: 'alliance_id, old_description, new_description',
      map: (row, code) => ({
        alliance_id: ApiHelper.addCountryCode(row.alliance_id, code),
        old_description: row.old_description,
        new_description: row.new_description,
      }),
    },
  };

  public static async getChanges(request: express.Request, response: express.Response): Promise<void> {
    try {
      const parameters = this.parseRequest(request);
      if ('error' in parameters) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: parameters.error });
        return;
      }
      const pool = request['pg_pool'] as pg.Pool;
      const code = request['code'];

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cacheKey = new CacheKeyBuilder(request['language']).with('changes').withQuery(request.query).build();
      const cached = await ApiHelper.redisClient.get(cacheKey).catch(() => null);
      if (cached) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cached));
        return;
      }

      const batches = await Promise.all(parameters.types.map((type) => this.readSource(pool, type, parameters, code)));
      const fetched = batches.flat();
      fetched.sort(
        (a, b) => a.cursorTimestamp.localeCompare(b.cursorTimestamp) || a.type.localeCompare(b.type) || a.id - b.id,
      );
      const emitted = fetched.slice(0, parameters.limit);
      const positions = { ...parameters.positions };
      for (const row of emitted) {
        positions[row.type] = [row.cursorTimestamp, row.id];
      }
      const hasMore =
        fetched.length > emitted.length ||
        parameters.types.some((type) => batches[parameters.types.indexOf(type)].length >= parameters.limit);

      const responseContent = {
        server: request['language'],
        server_code: code,
        generated_at: new Date().toISOString(),
        types: parameters.types,
        page: {
          count: emitted.length,
          limit: parameters.limit,
          has_more: hasMore,
          next_cursor: encodeCursor({ c: positions }),
        },
        changes: emitted.map((row) => ({
          type: row.type,
          id: row.id,
          occurred_at: row.createdAt.toISOString(),
          ...row.payload,
        })),
      };
      void ApiHelper.updateCache(cacheKey, responseContent, this.CACHE_TTL_SECONDS);
      response.status(ApiHelper.HTTP_OK).send(responseContent);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getChanges', request);
    }
  }

  private static async readSource(
    pool: pg.Pool,
    type: string,
    parameters: ChangesRequest,
    code: string,
  ): Promise<ChangeRow[]> {
    const source = this.SOURCES[type];
    const [since, lastId] = parameters.positions[type];
    const values: unknown[] = [since, lastId];
    const conditions = ['(created_at, id) > ($1::timestamp, $2::bigint)'];
    const subjectIds = source.subject === 'player' ? parameters.playerIds : parameters.allianceIds;
    if (subjectIds !== null) {
      values.push(subjectIds);
      conditions.push(`${source.subject}_id = ANY($${values.length}::bigint[])`);
    }
    values.push(parameters.limit);
    const query = `
      SELECT id, created_at, ${this.CURSOR_TIMESTAMP_COLUMN}, ${source.columns}
      FROM ${source.table}
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at ASC, id ASC
      LIMIT $${values.length}`;
    const results = await pool.query(query, values);
    return results.rows.map((row: any) => ({
      type,
      id: Number(row.id),
      createdAt: new Date(row.created_at),
      cursorTimestamp: row.cursor_timestamp,
      payload: source.map(row, code),
    }));
  }

  private static toTimestampParameter(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '');
  }

  private static parseRequest(request: express.Request): ChangesRequest | { error: string } {
    const rawTypes = ApiHelper.getParsedString(request.query.types);
    let types = Object.keys(this.SOURCES);
    if (rawTypes !== null) {
      const requested = rawTypes.split(',').map((type) => type.trim());
      if (requested.some((type) => !(type in this.SOURCES))) {
        const allowed = Object.keys(this.SOURCES).join(', ');
        return { error: `${RouteErrorMessagesEnum.InvalidChangeType}. Allowed: ${allowed}` };
      }
      types = [...new Set(requested)];
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

    const positions = this.resolvePositions(request, types);
    if ('error' in positions) return { error: positions.error };

    const playerIds = this.parseSubjectIds(request.query.player_ids);
    if (playerIds === false) return { error: RouteErrorMessagesEnum.InvalidPlayerId };
    const allianceIds = this.parseSubjectIds(request.query.alliance_ids);
    if (allianceIds === false) return { error: RouteErrorMessagesEnum.InvalidAllianceId };

    return { types, positions: positions.positions, limit, playerIds, allianceIds };
  }

  private static resolvePositions(
    request: express.Request,
    types: string[],
  ): { positions: Record<string, [string, number]> } | { error: string } {
    const positions: Record<string, [string, number]> = {};
    if (request.query.cursor !== undefined) {
      const decoded = decodeCursor(request.query.cursor);
      const stored = decoded?.c as Record<string, [string, number]> | undefined;
      if (!decoded || typeof stored !== 'object' || stored === null) {
        return { error: RouteErrorMessagesEnum.InvalidCursor };
      }
      for (const type of types) {
        const position = stored[type];
        const valid =
          Array.isArray(position) &&
          typeof position[0] === 'string' &&
          Number.isSafeInteger(Number(position[1])) &&
          !Number.isNaN(new Date(position[0]).getTime());
        positions[type] = valid ? [position[0], Number(position[1])] : [this.earliestPosition(stored), 0];
      }
      return { positions };
    }

    const rawSince = ApiHelper.getParsedString(request.query.since);
    let since: Date;
    if (rawSince === null) {
      since = new Date(Date.now() - this.DEFAULT_LOOKBACK_HOURS * 3_600_000);
    } else {
      since = new Date(rawSince);
      if (Number.isNaN(since.getTime())) return { error: RouteErrorMessagesEnum.InvalidDateParameter };
    }
    const parameter = this.toTimestampParameter(since);
    for (const type of types) positions[type] = [parameter, 0];
    return { positions };
  }

  private static earliestPosition(stored: Record<string, [string, number]>): string {
    const timestamps = Object.values(stored)
      .filter((position) => Array.isArray(position) && typeof position[0] === 'string')
      .map((position) => position[0]);
    return timestamps.length > 0 ? timestamps.sort()[0] : this.toTimestampParameter(new Date(0));
  }

  private static parseSubjectIds(raw: unknown): number[] | null | false {
    const text = ApiHelper.getParsedString(raw);
    if (text === null) return null;
    const parts = text.split(',').map((part) => part.trim());
    if (parts.length > this.MAX_SUBJECT_IDS) return false;
    const ids: number[] = [];
    for (const part of parts) {
      const verified = ApiHelper.verifyIdWithCountryCode(part);
      if (verified === false) return false;
      ids.push(Number(ApiHelper.removeCountryCode(String(verified))));
    }
    return ids.length > 0 ? ids : false;
  }
}
