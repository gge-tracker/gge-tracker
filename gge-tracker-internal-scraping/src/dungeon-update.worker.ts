//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { BridgeStatus, isSocketDown, readBridgeStatus } from './bridge-status';
import { FailureStreaks } from './failure-streaks';
import { GenericFetchAndSaveBackend } from './main';
import { ScrapingServer, readScrapingServers } from './servers-file';

export type ServerConfig = ScrapingServer;

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 120_000);
const BASE_API_HOST = 'http://empire-api-realtime:3000';
const failedSweeps = new FailureStreaks('Dungeon cooldown sweep', '432');

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

function timestampTag(): string {
  return colors.gray(`[${getTimestamp()}]`);
}

function logInfo(msg: string): void {
  console.log(`${timestampTag()} ${colors.green('[INFO]')} ${msg}`);
}

function logWarn(msg: string): void {
  console.log(`${timestampTag()} ${colors.yellow('[WARN]')} ${msg}`);
}

function logError(msg: string): void {
  console.log(`${timestampTag()} ${colors.red('[ERROR]')} ${msg}`);
}

function logStep(msg: string): void {
  console.log(`${timestampTag()} ${colors.cyan('[STEP]')} ${msg}`);
}

export function parseServersConf(): ServerConfig[] {
  const servers = readScrapingServers().filter((server) => server.dungeon);
  logInfo(`Loaded ${servers.length} servers from config`);
  return servers;
}

export interface ServerRunResult {
  failure: string | null;
  discoveryAttempted: boolean;
  discoveryCompleted: boolean;
}

async function processServer(
  server: ServerConfig,
  index: string,
  total: number,
  discoveryAllowed: boolean,
): Promise<ServerRunResult> {
  logStep(`[${index}/${total}] Updating ${server.name}`);

  const backend = new GenericFetchAndSaveBackend(
    `${BASE_API_HOST}/${server.zone}/`,
    {},
    {
      host: 'postgres',
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: server.sql,
      port: 5432,
      max: 1,
    },
    server.name,
  );
  backend.deferFailureAlerts = true;

  let discoveryAttempted = false;
  let discoveryCompleted = false;
  try {
    if (discoveryAllowed && (await backend.isDungeonDiscoveryDue())) {
      logStep(`${server.name} is due for the weekly dungeon discovery`);
      discoveryAttempted = true;
      discoveryCompleted = await backend.discoverNewDungeons();
      if (!discoveryCompleted) logWarn(`${server.name} discovery incomplete, it stays due`);
    }
    await backend.updateDungeonsList();
    const failure = backend.lastJobFailure?.failureReason ?? null;
    if (failure === null) logInfo(`${server.name} updated`);
    else logWarn(`${server.name} failed: ${failure}`);
    return { failure, discoveryAttempted, discoveryCompleted };
  } catch (err) {
    logError(`${server.name} failed: ${(err as Error).message}`);
    return {
      failure: (err as Error).message,
      discoveryAttempted,
      discoveryCompleted,
    };
  } finally {
    await safeCloseConnections(backend);
  }
}

async function safeCloseConnections(backend: GenericFetchAndSaveBackend): Promise<void> {
  try {
    await backend.closePool();
    await backend.connection.end();
  } catch {
    // Ignore errors during connection close
  }
}

const DISCOVERY_ATTEMPTS_PER_CYCLE = 3;

async function runOnce(): Promise<void> {
  const servers = parseServersConf();
  const bridge: BridgeStatus | null = await readBridgeStatus(BASE_API_HOST);
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let attemptsLeft = DISCOVERY_ATTEMPTS_PER_CYCLE;
  for (const [index, server] of servers.entries()) {
    const cleanIndex: string = `${index + 1}`.padStart(servers.length.toString().length, ' ');
    if (isSocketDown(bridge, server.zone)) {
      logWarn(`[${cleanIndex}/${servers.length}] ${server.name} skipped: its bridge socket is down`);
      skipped++;
      continue;
    }
    const result = await processServer(server, cleanIndex, servers.length, attemptsLeft > 0);
    if (result.discoveryAttempted) attemptsLeft--;
    if (result.discoveryCompleted) attemptsLeft = 0;
    if (result.failure === null) {
      failedSweeps.recordSuccess(server);
      success++;
    } else {
      failedSweeps.recordFailure(server, result.failure);
      failed++;
    }
  }
  logInfo(`Run completed : ${success} success / ${failed} failed / ${skipped} skipped`);
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
