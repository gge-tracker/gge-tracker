//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import axios from 'axios';
import * as pg from 'pg';
import * as redis from 'redis';

import { GenericFetchAndSaveBackend } from '../../src/main';
import { FakeClickHouse } from './fake-clickhouse';
import { FakeGameApi } from './fake-api';
import { FakePostgres } from './fake-postgres';

export const API_BASE_URL = 'http://empire-api.test:3000/EmpireEx_TEST/';
export const CLICKHOUSE_URL = 'http://clickhouse.test';
export const CLICKHOUSE_PORT = 8123;
export const DEFAULT_RUN_INSTANT = '2026-08-29T12:00:00.000Z';

export interface OutboundCall {
  url: string;
  body: unknown;
  config: unknown;
}

export interface SandboxOptions {
  server?: string;
  clickhouse?: boolean;
  postgres?: boolean;
  connectionLimit?: number;
  now?: Date;
  env?: Record<string, string | undefined>;
}

export interface Sandbox {
  backend: GenericFetchAndSaveBackend;
  api: FakeGameApi;
  db: FakePostgres;
  clickhouse: FakeClickHouse;
  redis: FakeRedis;
  outbound: OutboundCall[];
  now: Date;
  state: <T = any>(field: string) => T;
  setState: (field: string, value: unknown) => void;
  call: <T = any>(method: string, ...args: any[]) => Promise<T>;
  restore: () => void;
}

export class FakeRedis {
  public readonly store = new Map<string, string>();
  public readonly connects: number[] = [];
  public quits = 0;

  public async connect(): Promise<void> {
    this.connects.push(Date.now());
  }
  public async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  public async set(key: string, value: string): Promise<void> {
    this.store.set(key, String(value));
  }
  public async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
  public async incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(next));
    return next;
  }
  public async quit(): Promise<void> {
    this.quits++;
  }
  public on(): this {
    return this;
  }
}

export function createSandbox(options: SandboxOptions = {}): Sandbox {
  assertUtc();
  const api = new FakeGameApi(API_BASE_URL);
  const db = new FakePostgres();
  const clickhouse = new FakeClickHouse(`${CLICKHOUSE_URL}:${CLICKHOUSE_PORT}`);
  const fakeRedis = new FakeRedis();
  const outbound: OutboundCall[] = [];
  const restorers: (() => void)[] = [];

  const env = {
    ENVIRONMENT: 'production',
    LOG_LEVEL: 'silent',
    WEBHOOK_URL: 'http://discord.test/webhook',
    DISCORD_OR_CHANNEL_ID: '1234567890',
    DISCORD_OR_API_URL: 'http://discord.test/api',
    ...options.env,
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    restorers.push(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }

  const now = options.now ?? new Date(DEFAULT_RUN_INSTANT);
  restorers.push(freezeClock(now));
  restorers.push(collapseTimers());
  restorers.push(patch(axios, 'get', async (url: string) => respondGet(url)));
  restorers.push(
    patch(axios, 'post', async (url: string, body: unknown, config: unknown) => respondPost(url, body, config)),
  );
  restorers.push(patch(axios, 'delete', async () => ({ status: 200, data: {} })));
  restorers.push(
    patch(pg, 'Pool', function FakePool(config: Record<string, any>) {
      return db.createPool(config ?? {});
    }),
  );
  restorers.push(patch(redis, 'createClient', () => fakeRedis));

  async function respondGet(url: string): Promise<{ status: number; data: unknown }> {
    if (api.handles(url)) return api.get(url);
    throw new Error(`Unexpected GET outside the sandbox: ${url}`);
  }

  function respondPost(url: string, body: unknown, config: unknown): { status: number; data: unknown } {
    if (clickhouse.handles(url)) return clickhouse.post(url, body as string, config);
    outbound.push({ url, body, config });
    return { status: 200, data: {} };
  }

  const backend = new GenericFetchAndSaveBackend(
    API_BASE_URL,
    options.clickhouse === false
      ? null
      : {
          url: CLICKHOUSE_URL,
          port: CLICKHOUSE_PORT,
          protocol: 'http',
          user: 'test-user',
          password: 'test-password',
          database: 'empire_ranking_test',
        },
    options.postgres === false
      ? null
      : {
          host: 'postgres.test',
          user: 'test',
          password: 'test',
          database: 'empire-ranking-test',
          port: 5432,
          max: options.connectionLimit ?? 10,
        },
    options.server ?? 'TEST1',
  );

  return {
    backend,
    api,
    db,
    clickhouse,
    redis: fakeRedis,
    outbound,
    now,
    state: <T>(field: string): T => (backend as any)[field] as T,
    setState: (field: string, value: unknown): void => {
      (backend as any)[field] = value;
    },
    call: <T>(method: string, ...args: any[]): Promise<T> => (backend as any)[method](...args),
    restore: (): void => {
      for (const undo of restorers.reverse()) undo();
    },
  };
}

export async function withSandbox(
  options: SandboxOptions,
  body: (sandbox: Sandbox) => Promise<void> | void,
): Promise<void> {
  const sandbox = createSandbox(options);
  try {
    await body(sandbox);
  } finally {
    sandbox.restore();
  }
}

function assertUtc(): void {
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error('The suites must run with TZ=UTC (npm test sets it); this process is not on UTC.');
  }
}

function patch(target: object, key: string, replacement: unknown): () => void {
  const original = (target as Record<string, unknown>)[key];
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value: replacement, configurable: true, writable: true });
  return () => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else (target as Record<string, unknown>)[key] = original;
  };
}

function freezeClock(now: Date): () => void {
  const RealDate = Date;
  const fixed = now.getTime();
  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      // @ts-expect-error - forwarding the real Date overloads
      super(...(args.length === 0 ? [fixed] : args));
    }
    public static now(): number {
      return fixed;
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}

function collapseTimers(): () => void {
  const realSetTimeout = globalThis.setTimeout;
  const collapsed = ((callback: (...args: any[]) => void, _delay?: number, ...args: any[]) =>
    realSetTimeout(callback, 0, ...args)) as typeof globalThis.setTimeout;
  collapsed.__promisify__ = (realSetTimeout as any).__promisify__;
  globalThis.setTimeout = collapsed;
  return () => {
    globalThis.setTimeout = realSetTimeout;
  };
}
