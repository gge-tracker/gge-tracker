//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { readFileSync } from 'node:fs';
import { GenericFetchAndSaveBackend } from './main';

export interface ServerConfig {
  name: string;
  zone: string;
  sql: string;
  limit: number;
}

const CONFIG_PATH = '/app/config/servers.conf';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 120_000);
const BASE_API_HOST = 'http://empire-api-realtime:3000';

export function parseServersConf(): ServerConfig[] {
  const content = readFileSync(CONFIG_PATH, 'utf-8');
  const lines = content.split('\n');

  const servers: ServerConfig[] = [];
  let current: Partial<ServerConfig> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('[')) {
      if (current?.name) servers.push(current as ServerConfig);
      current = { name: trimmed.slice(1, -1) };
      continue;
    }

    const [key, value] = trimmed.split('=').map((v) => v.trim());
    if (!current) continue;

    if (key === 'zone') current.zone = value;
    if (key === 'sql') current.sql = value;
    if (key === 'limit') current.limit = Number(value);
    if (key === 'dungeon' && value.toLowerCase() === 'false') {
      current = null;
    }
  }

  if (current?.name) servers.push(current as ServerConfig);
  return servers;
}

async function runOnce(): Promise<void> {
  const servers = parseServersConf();
  let errorCount = 0;
  for (const server of servers) {
    log(`Updating dungeons for server ${server.name}...`);

    const generic = new GenericFetchAndSaveBackend(
      `${BASE_API_HOST}/${server.zone}/`,
      {
        host: 'mariadb',
        user: process.env.SQL_USER!,
        password: process.env.SQL_PASSWORD!,
        database: server.sql!,
        connectionLimit: 1,
      },
      {},
      {
        host: 'postgres',
        user: process.env.SQL_USER!,
        password: process.env.SQL_PASSWORD!,
        database: server.sql!,
        port: 5432,
        max: 1,
      },
      server.name,
    );

    try {
      await generic.updateDungeonsList();
    } catch (err) {
      errorCount++;
      log(`Error updating dungeons for server ${server.name}: ${(err as Error).message}`);
    } finally {
      try {
        await generic.pgSqlConnection.end();
        await generic.connection.end();
      } catch {}
    }
    log(`Finished updating dungeons for server ${server.name}`);
  }
  if (errorCount > 0) {
    log(`Encountered ${errorCount} errors during dungeon updates.`);
  }
}

async function main(): Promise<void> {
  log('Dungeon Update Worker started');
  while (true) {
    const start = Date.now();
    await runOnce();
    const elapsed = Date.now() - start;
    const sleep = Math.max(0, INTERVAL_MS - elapsed);
    log(`⏳ Sleeping ${sleep}ms`);
    await new Promise((r) => setTimeout(r, sleep));
  }
}

export function log(msg: string): void {
  const date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${date}] ${msg}`);
}

void main();
