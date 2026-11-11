import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createGzip } from 'node:zlib';
import * as pg from 'pg';
import { decodeIdCursor } from '../helper/cursor';
import { ApiHelper } from '../helper/api-helper';
import { ApiExport, ExportPage } from '../routes/api-export';

export interface DatasetFile {
  name: string;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface DatasetManifest {
  server: string;
  server_code: string;
  date: string;
  generated_at: string;
  files: DatasetFile[];
}

interface DatasetServer {
  name: string;
  code: string;
  olap: string;
  pool: pg.Pool;
}

type HourlyPoints = Record<string, (number | null)[]>;

/**
 * Writes one compressed copy of every server per UTC day
 */
export abstract class DailyDatasets {
  public static readonly FILES = ['players.ndjson.gz', 'alliances.ndjson.gz', 'history.ndjson.gz'] as const;
  public static readonly MANIFEST = 'manifest.json';

  private static readonly HISTORY_TABLES = {
    might: 'player_might_history',
    loot: 'player_loot_history',
    glory: 'player_glory_history',
  } as const;
  private static readonly PAGE_SIZE = 5000;
  private static readonly CHECK_INTERVAL_MS = 3600 * 1000;
  private static readonly FIRST_CHECK_DELAY_MS = 120_000;
  // The hourly fill of 23:05 UTC must have finished before the day is read
  private static readonly DAY_CLOSED_AFTER_MS = 45 * 60 * 1000;

  private static timer: ReturnType<typeof setInterval> | null = null;
  private static running = false;

  public static get root(): string {
    return process.env.DATASETS_DIR || path.join(process.cwd(), 'datasets');
  }

  public static get retentionDays(): number {
    const days = Number(process.env.DATASETS_RETENTION_DAYS);
    return Number.isInteger(days) && days > 0 ? days : 14;
  }

  public static start(): void {
    if (this.timer || process.env.DAILY_DATASETS !== '1') return;
    this.timer = setInterval(() => void this.runOnce(), this.CHECK_INTERVAL_MS);
    setTimeout(() => void this.runOnce(), this.FIRST_CHECK_DELAY_MS);
  }

  public static lastClosedDay(now: Date): string | null {
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (now.getTime() - startOfToday < this.DAY_CLOSED_AFTER_MS) return null;
    return new Date(startOfToday - 24 * 3600 * 1000).toISOString().slice(0, 10);
  }

  public static async readManifest(server: string, date: string): Promise<DatasetManifest | null> {
    try {
      const raw = await fs.promises.readFile(path.join(this.root, server, date, this.MANIFEST));
      return JSON.parse(raw.toString('utf8')) as DatasetManifest;
    } catch {
      return null;
    }
  }

  public static async listManifests(): Promise<DatasetManifest[]> {
    const servers = await fs.promises.readdir(this.root).catch(() => [] as string[]);
    const manifests: DatasetManifest[] = [];
    for (const server of servers.sort()) {
      const dates = await fs.promises.readdir(path.join(this.root, server)).catch(() => [] as string[]);
      for (const date of dates
        .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
        .sort()
        .reverse()) {
        const manifest = await this.readManifest(server, date);
        if (manifest) manifests.push(manifest);
      }
    }
    return manifests;
  }

  public static async runOnce(now = new Date()): Promise<void> {
    const day = this.lastClosedDay(now);
    if (!day || this.running) return;
    this.running = true;
    try {
      let written = 0;
      for (const server of this.servers()) {
        if (await this.readManifest(server.name, day)) continue;
        try {
          await this.build(server, day);
          written++;
        } catch (error) {
          ApiHelper.logError(error, `DailyDatasets.build:${server.name}`);
        }
      }
      await this.prune(now);
      if (written > 0) console.log('[daily-datasets] %s: %d servers written', day, written);
    } finally {
      this.running = false;
    }
  }

  private static servers(): DatasetServer[] {
    const manager = ApiHelper.ggeTrackerManager;
    const servers: DatasetServer[] = [];
    for (const [name, server] of manager.getActivatedServerEntries()) {
      const pool = manager.getPgSqlPool(name);
      if (!pool || !manager.isValidCode(server.code)) continue;
      servers.push({ name, code: server.code, olap: server.databases.olap, pool });
    }
    return servers;
  }

  private static async build(server: DatasetServer, day: string): Promise<void> {
    const finalDirectory = path.join(this.root, server.name, day);
    const workDirectory = `${finalDirectory}.tmp`;
    await fs.promises.rm(workDirectory, { recursive: true, force: true });
    await fs.promises.mkdir(workDirectory, { recursive: true });
    try {
      await this.writeDataset(workDirectory, server, day);
    } catch (error) {
      await fs.promises.rm(workDirectory, { recursive: true, force: true });
      await fs.promises.rmdir(path.dirname(finalDirectory)).catch(() => null);
      throw error;
    }
    await fs.promises.rm(finalDirectory, { recursive: true, force: true });
    await fs.promises.rename(workDirectory, finalDirectory);
  }

  private static async writeDataset(directory: string, server: DatasetServer, day: string): Promise<void> {
    const files: DatasetFile[] = [
      await this.writeFile(directory, 'players.ndjson.gz', this.collection(server, ApiExport.readEveryPlayer)),
      await this.writeFile(directory, 'alliances.ndjson.gz', this.collection(server, ApiExport.readEveryAlliance)),
      await this.writeFile(directory, 'history.ndjson.gz', await this.history(server, day)),
    ];
    const manifest: DatasetManifest = {
      server: server.name,
      server_code: server.code,
      date: day,
      generated_at: new Date().toISOString(),
      files,
    };
    await fs.promises.writeFile(path.join(directory, this.MANIFEST), JSON.stringify(manifest));
  }

  private static async *collection(
    server: DatasetServer,
    read: (pool: pg.Pool, code: string, cursor: number, limit: number) => Promise<ExportPage>,
  ): AsyncGenerator<Record<string, unknown>> {
    let cursor = 0;
    for (;;) {
      const page = await read.call(ApiExport, server.pool, server.code, cursor, this.PAGE_SIZE);
      yield* page.rows;
      if (!page.hasMore || !page.nextCursor) return;
      cursor = decodeIdCursor(page.nextCursor) ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(cursor)) return;
    }
  }

  private static async history(server: DatasetServer, day: string): Promise<Record<string, unknown>[]> {
    const clickhouse = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    const byPlayer = new Map<string, HourlyPoints>();
    for (const [metric, table] of Object.entries(this.HISTORY_TABLES)) {
      const result = await clickhouse
        .query({
          query: `
            SELECT toString(player_id) AS player_id, toHour(created_at) AS hour, argMax(point, created_at) AS point
            FROM ${server.olap}.${table}
            WHERE created_at >= toDateTime({day:Date}) AND created_at < toDateTime({day:Date} + 1)
            GROUP BY player_id, hour`,
          query_params: { day },
          format: 'JSONEachRow',
        })
        .then((response) => response.json<{ player_id: string; hour: number; point: string | number }>())
        .catch((error: unknown) => {
          if (String(error).includes('UNKNOWN_TABLE')) return [];
          throw error;
        });
      for (const row of result) {
        const points = byPlayer.get(row.player_id) ?? {};
        points[metric] ??= Array.from({ length: 24 }, () => null);
        points[metric][Number(row.hour)] = Number(row.point);
        byPlayer.set(row.player_id, points);
      }
    }
    return [...byPlayer.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([playerId, points]) => ({ player_id: ApiHelper.addCountryCode(playerId, server.code), ...points }));
  }

  private static async writeFile(
    directory: string,
    name: string,
    rows: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>,
  ): Promise<DatasetFile> {
    let count = 0;
    const lines = Readable.from(
      (async function* (): AsyncGenerator<string> {
        for await (const row of rows) {
          count++;
          yield JSON.stringify(row) + '\n';
        }
      })(),
    );
    const hash = createHash('sha256');
    let bytes = 0;
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, done): void {
        hash.update(chunk);
        bytes += chunk.length;
        done(null, chunk);
      },
    });
    await pipeline(lines, createGzip({ level: 9 }), measure, fs.createWriteStream(path.join(directory, name)));
    return { name, rows: count, bytes, sha256: hash.digest('hex') };
  }

  private static async prune(now: Date): Promise<void> {
    const oldestKept = new Date(now.getTime() - this.retentionDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const servers = await fs.promises.readdir(this.root).catch(() => [] as string[]);
    for (const server of servers) {
      const entries = await fs.promises.readdir(path.join(this.root, server)).catch(() => [] as string[]);
      for (const entry of entries) {
        if (entry.slice(0, 10) < oldestKept) {
          await fs.promises.rm(path.join(this.root, server, entry), { recursive: true, force: true });
        }
      }
    }
  }
}
