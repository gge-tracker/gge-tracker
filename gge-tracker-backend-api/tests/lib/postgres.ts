/**
 * Postgres access to the local fixture, for suites that need the ground truth or a scenario the fixture lacks
 */
import * as pg from 'pg';
import { config } from '../config';
import { fromDotEnv } from './dotenv';
import { record, truncate } from './journal';

export interface FixtureDatabase {
  name: string;
  query<T = any>(sql: string, parameters: unknown[], label: string): Promise<T[]>;
  close(): Promise<void>;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function fixtureHost(): string {
  return process.env.TEST_PG_HOST ?? 'localhost';
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

export function openFixtureDatabase(database: string): FixtureDatabase {
  const pool = new pg.Pool({
    host: fixtureHost(),
    port: Number.parseInt(process.env.TEST_PG_PORT ?? '5432', 10),
    user: process.env.TEST_PG_USER ?? fromDotEnv('SQL_USER'),
    password: process.env.TEST_PG_PASSWORD ?? fromDotEnv('SQL_PASSWORD'),
    database,
    max: 2,
    connectionTimeoutMillis: 3000,
  });

  async function query<T>(sql: string, parameters: unknown[], label: string): Promise<T[]> {
    const at = new Date().toISOString();
    const started = performance.now();
    let rows: T[] = [];
    let error: string | undefined;
    try {
      rows = (await pool.query(sql, parameters as any[])).rows;
    } catch (thrown: any) {
      error = thrown?.message ?? String(thrown);
    }
    const statement = truncate(`${sql.trim()}\n-- ${JSON.stringify(parameters)}`, config.trace.maxBodyChars);
    const answer = truncate(error ?? JSON.stringify(rows), config.trace.maxBodyChars);
    record({
      at,
      method: 'SQL',
      path: `postgres:${database}/${label}`,
      url: `postgres://${fixtureHost()}/${database}`,
      requestHeaders: {},
      requestBody: statement.text,
      requestBodyTruncated: statement.truncated,
      status: error ? 500 : 200,
      responseHeaders: {},
      responseBody: answer.text,
      responseBodyTruncated: answer.truncated,
      responseBytes: answer.text.length,
      ms: performance.now() - started,
      networkError: error,
    });
    if (error) throw new Error(`${label}: ${error}`);
    return rows;
  }

  return { name: database, query, close: () => pool.end() };
}
