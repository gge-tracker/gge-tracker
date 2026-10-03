import * as crypto from 'node:crypto';
import * as pg from 'pg';

export interface ApiKey {
  id: number;
  partner: string;
  points: number;
  windowSeconds: number;
}

export type ApiKeyLookup = ApiKey | 'invalid' | 'unverified';

const KEY_FORMAT = /^ggt_[\w-]{43}$/;
const UNDEFINED_TABLE = '42P01';

export abstract class ApiKeyRegistry {
  public static readonly HEADER = 'x-api-key';
  public static readonly TABLE = 'api_keys';

  private static readonly CACHE_TTL_MS = Number(process.env.API_KEY_CACHE_TTL_MS) || 60_000;
  private static readonly CACHE_MAX_ENTRIES = 10_000;
  private static readonly cache = new Map<string, { key: ApiKey | null; expiresAt: number }>();

  public static generate(): string {
    return `ggt_${crypto.randomBytes(32).toString('base64url')}`;
  }

  public static hash(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  public static async resolve(rawKey: string, pool: pg.Pool | null): Promise<ApiKeyLookup> {
    if (!KEY_FORMAT.test(rawKey)) return 'invalid';
    const hash = this.hash(rawKey);
    const cached = this.cache.get(hash);
    if (cached && cached.expiresAt > Date.now()) return cached.key ?? 'invalid';
    if (!pool) return 'unverified';
    try {
      const key = await this.lookup(pool, hash);
      this.remember(hash, key);
      return key ?? 'invalid';
    } catch (error) {
      console.error('[ApiKeyRegistry] key store unreadable:', (error as Error).message);
      return 'unverified';
    }
  }

  public static forget(hash: string): void {
    this.cache.delete(hash);
  }

  private static async lookup(pool: pg.Pool, hash: string): Promise<ApiKey | null> {
    try {
      const result = await pool.query(
        `SELECT id, partner, rate_limit_points, rate_limit_window_seconds
          FROM ${this.TABLE} WHERE key_hash = $1 AND revoked_at IS NULL`,
        [hash],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: Number(row.id),
        partner: String(row.partner),
        points: Number(row.rate_limit_points),
        windowSeconds: Number(row.rate_limit_window_seconds),
      };
    } catch (error) {
      if ((error as { code?: string }).code === UNDEFINED_TABLE) return null;
      throw error;
    }
  }

  private static remember(hash: string, key: ApiKey | null): void {
    if (this.cache.size >= this.CACHE_MAX_ENTRIES) this.cache.clear();
    this.cache.set(hash, { key, expiresAt: Date.now() + this.CACHE_TTL_MS });
  }
}
