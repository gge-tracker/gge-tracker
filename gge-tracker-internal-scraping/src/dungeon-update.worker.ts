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

const colors = {
  gray: (type: string): string => `\x1b[90m${type}\x1b[0m`,
  red: (type: string): string => `\x1b[31m${type}\x1b[0m`,
  yellow: (type: string): string => `\x1b[33m${type}\x1b[0m`,
  green: (type: string): string => `\x1b[32m${type}\x1b[0m`,
  cyan: (type: string): string => `\x1b[36m${type}\x1b[0m`,
  bold: (type: string): string => `\x1b[1m${type}\x1b[0m`,
};

function getTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function logInfo(msg: string): void {
  console.log(`${colors.gray(`[${getTimestamp()}]`)} ${colors.green('[INFO]')} ${msg}`);
}

function logWarn(msg: string): void {
  console.log(`${colors.gray(`[${getTimestamp()}]`)} ${colors.yellow('[WARN]')} ${msg}`);
}

function logError(msg: string): void {
  console.log(`${colors.gray(`[${getTimestamp()}]`)} ${colors.red('[ERROR]')} ${msg}`);
}

function logStep(msg: string): void {
  console.log(`${colors.gray(`[${getTimestamp()}]`)} ${colors.cyan('[STEP]')} ${msg}`);
}

export function parseServersConf(): ServerConfig[] {
  const content = readFileSync(CONFIG_PATH, 'utf-8');
  const lines = content.split('\n');
  const servers: ServerConfig[] = [];
  let current: Partial<ServerConfig> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[')) {
      if (isValidServer(current)) {
        servers.push(current as ServerConfig);
      }
      current = { name: line.slice(1, -1) };
      continue;
    }
    if (!current) continue;
    const [key, value] = parseKeyValue(line);
    applyConfig(current, key, value);
  }
  if (isValidServer(current)) {
    servers.push(current as ServerConfig);
  }

  logInfo(`Loaded ${servers.length} servers from config`);

  return servers;
}

function parseKeyValue(line: string): [string, string] {
  const [key, value] = line.split('=');
  return [key.trim(), value.trim()];
}

function applyConfig(target: Partial<ServerConfig>, key: string, value: string): void {
  switch (key) {
    case 'zone':
      target.zone = value;
      break;
    case 'sql':
      target.sql = value;
      break;
    case 'limit':
      target.limit = Number(value);
      break;
    case 'dungeon':
      if (value.toLowerCase() === 'false') {
        Object.assign(target, { name: undefined });
      }
      break;
  }
}

function isValidServer(server: Partial<ServerConfig> | null): server is ServerConfig {
  return !!(server && server.name);
}

async function processServer(server: ServerConfig, index: string, total: number): Promise<boolean> {
  // logStep(`Updating ${colors.bold(server.name)}`);
  logStep(`[${index}/${total}] Updating ${server.name}`);

  const backend = new GenericFetchAndSaveBackend(
    `${BASE_API_HOST}/${server.zone}/`,
    {
      host: 'mariadb',
      user: process.env.SQL_USER!,
      password: process.env.SQL_PASSWORD!,
      database: server.sql,
      connectionLimit: 1,
    },
    {},
    {
      host: 'postgres',
      user: process.env.SQL_USER!,
      password: process.env.SQL_PASSWORD!,
      database: server.sql,
      port: 5432,
      max: 1,
    },
    server.name,
  );

  try {
    await backend.updateDungeonsList();
    logInfo(`${server.name} updated`);
    return true;
  } catch (err) {
    logError(`${server.name} failed: ${(err as Error).message}`);
    return false;
  } finally {
    await safeCloseConnections(backend);
  }
}

async function safeCloseConnections(backend: GenericFetchAndSaveBackend): Promise<void> {
  try {
    await backend.pgSqlConnection.end();
    await backend.connection.end();
  } catch {
    // Ignore errors during connection close
  }
}

async function runOnce(): Promise<void> {
  const servers = parseServersConf();
  let success = 0;
  let failed = 0;
  for (const [index, server] of servers.entries()) {
    const cleanIndex: string = `${index + 1}`.padStart(servers.length.toString().length, ' ');
    const ok = await processServer(server, cleanIndex, servers.length);
    ok ? success++ : failed++;
  }
  logInfo(`Run completed : ${success} success / ${failed} failed`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  logInfo(colors.bold('Dungeon Update Worker started'));

  while (true) {
    const start = Date.now();
    await runOnce();
    const elapsed = Date.now() - start;
    const waitTime = Math.max(0, INTERVAL_MS - elapsed);
    logWarn(`Sleeping ${waitTime}ms`);
    await sleep(waitTime);
  }
}

void main();
