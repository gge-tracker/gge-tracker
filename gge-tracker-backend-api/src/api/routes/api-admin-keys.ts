import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { ApiKeyRegistry } from '../services/api-key-registry';

interface KeyChanges {
  partner?: string;
  rate_limit_points?: number;
  rate_limit_window_seconds?: number;
  note?: string | null;
}

const UNDEFINED_TABLE = '42P01';
const DEFAULT_POINTS = 300;
const DEFAULT_WINDOW_SECONDS = 5;
const KEY_COLUMNS = `id, partner, key_prefix, rate_limit_points, rate_limit_window_seconds, note, created_at, updated_at, revoked_at`;

class InvalidChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidChangeError';
  }
}

export abstract class ApiAdminKeys implements ApiHelper {
  public static async listKeys(request: express.Request, response: express.Response): Promise<void> {
    await this.run(request, response, 'listKeys', async (pool) => {
      const result = await pool.query(`SELECT ${KEY_COLUMNS} FROM ${ApiKeyRegistry.TABLE} ORDER BY id`);
      response.status(ApiHelper.HTTP_OK).send({ keys: result.rows.map((row) => this.toKey(row)) });
    });
  }

  public static async createKey(request: express.Request, response: express.Response): Promise<void> {
    await this.run(request, response, 'createKey', async (pool) => {
      const changes = this.readChanges(request.body, true);
      const key = ApiKeyRegistry.generate();
      const result = await pool.query(
        `INSERT INTO ${ApiKeyRegistry.TABLE}
            (partner, key_hash, key_prefix, rate_limit_points, rate_limit_window_seconds, note)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING ${KEY_COLUMNS}`,
        [
          changes.partner,
          ApiKeyRegistry.hash(key),
          key.slice(0, 12),
          changes.rate_limit_points ?? DEFAULT_POINTS,
          changes.rate_limit_window_seconds ?? DEFAULT_WINDOW_SECONDS,
          changes.note ?? null,
        ],
      );
      const created = this.toKey(result.rows[0]);
      console.log(`[Admin] API key #${created.id} issued to ${created.partner}`);
      response.status(ApiHelper.HTTP_CREATED).send({ ...created, key });
    });
  }

  public static async updateKey(request: express.Request, response: express.Response): Promise<void> {
    await this.run(request, response, 'updateKey', async (pool) => {
      const id = this.readId(request);
      const changes = this.readChanges(request.body, false);
      const columns = Object.keys(changes) as (keyof KeyChanges)[];
      if (columns.length === 0) throw new InvalidChangeError(RouteErrorMessagesEnum.InvalidApiKeyUpdate);
      const assignments = columns.map((column, index) => `${column} = $${index + 2}`);
      const result = await pool.query(
        `UPDATE ${ApiKeyRegistry.TABLE} SET ${assignments.join(', ')}, updated_at = now()
          WHERE id = $1 RETURNING ${KEY_COLUMNS}, key_hash`,
        [id, ...columns.map((column) => changes[column])],
      );
      if (!this.found(response, result)) return;
      ApiKeyRegistry.forget(result.rows[0].key_hash);
      console.log(`[Admin] API key #${id} updated: ${columns.join(', ')}`);
      response.status(ApiHelper.HTTP_OK).send(this.toKey(result.rows[0]));
    });
  }

  public static async revokeKey(request: express.Request, response: express.Response): Promise<void> {
    await this.run(request, response, 'revokeKey', async (pool) => {
      const id = this.readId(request);
      const result = await pool.query(
        `UPDATE ${ApiKeyRegistry.TABLE} SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
          WHERE id = $1 RETURNING ${KEY_COLUMNS}, key_hash`,
        [id],
      );
      if (!this.found(response, result)) return;
      ApiKeyRegistry.forget(result.rows[0].key_hash);
      console.log(`[Admin] API key #${id} revoked`);
      response.status(ApiHelper.HTTP_OK).send(this.toKey(result.rows[0]));
    });
  }

  private static async run(
    request: express.Request,
    response: express.Response,
    origin: string,
    work: (pool: pg.Pool) => Promise<void>,
  ): Promise<void> {
    try {
      const pool = ApiHelper.ggeTrackerManager.getGlobalPgSqlPool();
      if (!pool) throw new Error('No GLOBAL database pool');
      await work(pool);
    } catch (error) {
      if (error instanceof InvalidChangeError) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: error.message });
        return;
      }
      if ((error as { code?: string }).code === UNDEFINED_TABLE) {
        response.status(ApiHelper.HTTP_SERVICE_UNAVAILABLE).send({ error: RouteErrorMessagesEnum.ApiKeyStoreMissing });
        return;
      }
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, origin, request);
    }
  }

  private static found(response: express.Response, result: pg.QueryResult): boolean {
    if (result.rowCount !== 0) return true;
    response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.ApiKeyNotFound });
    return false;
  }

  private static readId(request: express.Request): number {
    const id = Number(request.params.keyId);
    if (!/^\d+$/.test(request.params.keyId ?? '') || !Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
      throw new InvalidChangeError(RouteErrorMessagesEnum.InvalidApiKeyId);
    }
    return id;
  }

  private static readChanges(body: unknown, creating: boolean): KeyChanges {
    const input = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<
      string,
      unknown
    >;
    const changes: KeyChanges = {};
    if (input.partner !== undefined || creating) {
      const partner = typeof input.partner === 'string' ? input.partner.trim() : '';
      if (partner.length === 0 || partner.length > 64) {
        throw new InvalidChangeError(RouteErrorMessagesEnum.InvalidApiKeyPartner);
      }
      changes.partner = partner;
    }
    for (const [field, maximum] of [
      ['rate_limit_points', 100_000],
      ['rate_limit_window_seconds', 3600],
    ] as const) {
      if (input[field] === undefined) continue;
      const value = input[field];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new InvalidChangeError(RouteErrorMessagesEnum.InvalidApiKeyRateLimit);
      }
      changes[field] = value;
    }
    if (input.note !== undefined) {
      const note = input.note;
      if (note !== null && (typeof note !== 'string' || note.length > 500)) {
        throw new InvalidChangeError(RouteErrorMessagesEnum.InvalidApiKeyNote);
      }
      changes.note = typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
    }
    return changes;
  }

  private static toKey(row: Record<string, any>): Record<string, any> {
    return {
      id: Number(row.id),
      partner: row.partner,
      key_prefix: row.key_prefix,
      rate_limit: { points: Number(row.rate_limit_points), window_seconds: Number(row.rate_limit_window_seconds) },
      note: row.note,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
      revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      active: row.revoked_at === null,
    };
  }
}
