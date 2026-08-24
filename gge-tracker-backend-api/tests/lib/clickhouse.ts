/**
 * Minimal ClickHouse reader for the harness
 */
import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseEnvFile } from 'dotenv';
import { config } from '../config';
import { record, truncate } from './journal';

export interface ClickHouseTarget {
  name: string;
  url: string;
  username: string;
  password: string;
}

export interface ClickHouseResult {
  ok: boolean;
  rows: string[][];
  error?: string;
  ms: number;
}

function fromDotEnv(name: string): string | undefined {
  for (const candidate of [path.resolve(__dirname, '..', '..', '.env'), path.resolve(__dirname, '..', '..', '..', '.env')]) {
    try {
      const value = parseEnvFile(fs.readFileSync(candidate, 'utf8'))[name];
      if (value !== undefined && value.trim() !== '') return value.trim();
    } catch {}
  }
  return undefined;
}

function setting(testName: string, serverName: string, fallback = ''): string {
  return process.env[testName] ?? process.env[serverName] ?? fromDotEnv(serverName) ?? fallback;
}

function credentials(): { username: string; password: string } {
  return {
    username: setting('TEST_CLICKHOUSE_USER', 'CLICKHOUSE_USER', 'default'),
    password: setting('TEST_CLICKHOUSE_PASSWORD', 'CLICKHOUSE_PASSWORD'),
  };
}

export function localTarget(): ClickHouseTarget {
  return {
    name: 'local',
    url: (process.env.TEST_CLICKHOUSE_URL ?? 'http://localhost:8123').replace(/\/+$/, ''),
    ...credentials(),
  };
}

export function remoteTarget(): ClickHouseTarget | undefined {
  const host = setting('TEST_CLICKHOUSE_REMOTE_URL', 'CLICKHOUSE_HOST');
  if (host === '') return undefined;
  const url = (host.startsWith('http://') || host.startsWith('https://') ? host : `http://${host}:8123`).replace(/\/+$/, '');
  return url === localTarget().url ? undefined : { name: 'production', url, ...credentials() };
}

export async function query(target: ClickHouseTarget, sql: string, label: string, timeoutMs?: number): Promise<ClickHouseResult> {
  const at = new Date().toISOString();
  const started = performance.now();
  const statement = `${sql.trim()}\nFORMAT JSONCompact`;
  let status = 0;
  let raw = '';
  let networkError: string | undefined;
  let rows: string[][] = [];
  let error: string | undefined;

  try {
    const response = await axios.request({
      method: 'POST',
      url: `${target.url}/`,
      data: statement,
      auth: { username: target.username, password: target.password },
      timeout: timeoutMs ?? config.requestTimeoutMs,
      validateStatus: () => true,
      transformResponse: [(d) => d],
      headers: { 'Content-Type': 'text/plain' },
    });
    status = response.status;
    raw = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    if (status === 200) {
      try {
        rows = JSON.parse(raw).data ?? [];
      } catch {
        error = `unparseable response: ${raw.slice(0, 200)}`;
      }
    } else {
      error = raw.split('\n')[0]?.slice(0, 300) || `HTTP ${status}`;
    }
  } catch (thrown: any) {
    networkError = thrown?.code ?? thrown?.message ?? String(thrown);
    error = `unreachable (${networkError})`;
  }

  const ms = performance.now() - started;
  const budget = config.trace.maxBodyChars;
  const request = truncate(statement, budget);
  const responseBody = truncate(raw, budget);
  record({
    at,
    method: 'POST',
    path: `clickhouse:${target.name}/${label}`,
    url: `${target.url}/`,
    requestHeaders: { 'Content-Type': 'text/plain' },
    requestBody: request.text,
    requestBodyTruncated: request.truncated,
    status,
    responseHeaders: {},
    responseBody: responseBody.text,
    responseBodyTruncated: responseBody.truncated,
    responseBytes: raw.length,
    ms,
    networkError,
  });

  return { ok: error === undefined, rows, error, ms };
}

export async function probe(target: ClickHouseTarget, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  const result = await query(target, 'SELECT 1', 'probe', timeoutMs);
  return { ok: result.ok, error: result.error };
}

export async function listDatabases(target: ClickHouseTarget): Promise<{ ok: boolean; databases: Set<string>; error?: string }> {
  const result = await query(target, 'SELECT name FROM system.databases', 'databases');
  return { ok: result.ok, databases: new Set(result.rows.map(([name]) => name)), error: result.error };
}
