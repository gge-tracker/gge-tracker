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
import { formatLootResetTime } from './loot-reset';
import { buildResetQuery, judge, measuredResets } from './loot-reset-measure';
import { ScrapingServer, readScrapingServers } from './servers-file';
import Utils from './utils';

const WINDOW_DAYS = Number(process.env.LOOT_RESET_CHECK_DAYS) || 15;
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';

export type ResetCheckStatus = 'ok' | 'mismatch' | 'not-measured' | 'failed';

export interface ResetCheckRecord {
  event: 'loot_reset_check';
  server: string;
  status: ResetCheckStatus;
  declared: string;
  resets: number;
  mismatches?: string;
  reason?: string;
}

export function serversToCheck(servers: ScrapingServer[]): ScrapingServer[] {
  const seen = new Set<string>();
  return servers.filter((server) => {
    if (!server.lootReset || !server.olap || server.kind === 'internal' || seen.has(server.olap)) return false;
    seen.add(server.olap);
    return true;
  });
}

export function judgeServerReset(server: ScrapingServer, rows: string[][]): ResetCheckRecord {
  const reset = server.lootReset!;
  const resets = measuredResets(rows);
  const verdict = judge(resets, reset);
  const mismatches = verdict.mismatches.map((miss) => `${miss.hour}h UTC instead of ${miss.expected}h`).join(', ');
  return {
    event: 'loot_reset_check',
    server: server.server,
    status: resets.length === 0 ? 'not-measured' : mismatches ? 'mismatch' : 'ok',
    declared: `${reset.timezone} ${formatLootResetTime(reset)}`,
    resets: resets.length,
    ...(mismatches ? { mismatches } : {}),
  };
}

async function readDropHours(database: string): Promise<string[][]> {
  const { data } = await axios.post(
    `${CLICKHOUSE_URL}/?readonly=1`,
    `${buildResetQuery(database, { windowDays: WINDOW_DAYS, minPeak: 1_000_000 })} FORMAT TSV`,
    {
      auth: { username: process.env.CLICKHOUSE_USER ?? '', password: process.env.CLICKHOUSE_PASSWORD ?? '' },
      headers: { 'Content-Type': 'text/plain' },
      responseType: 'text',
      timeout: 120_000,
    },
  );
  return String(data ?? '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

async function checkServer(server: ScrapingServer): Promise<ResetCheckStatus> {
  let record: ResetCheckRecord;
  try {
    record = judgeServerReset(server, await readDropHours(server.olap));
  } catch (error) {
    const declared = `${server.lootReset!.timezone} ${formatLootResetTime(server.lootReset!)}`;
    const reason = Utils.describeError(error).slice(0, 300);
    record = { event: 'loot_reset_check', server: server.server, status: 'failed', declared, resets: 0, reason };
  }
  const message =
    record.status === 'mismatch'
      ? `Loot reset of ${server.server} is not ${record.declared}: ${record.mismatches}`
      : `Loot reset of ${server.server}: ${record.status}`;
  Utils.logRecord(record.status === 'ok' || record.status === 'not-measured' ? 'info' : 'warn', record, message);
  return record.status;
}

async function checkEveryServer(): Promise<void> {
  const servers = serversToCheck(readScrapingServers());
  const statuses: ResetCheckStatus[] = [];
  for (const server of servers) statuses.push(await checkServer(server));
  const count = (status: ResetCheckStatus): number => statuses.filter((each) => each === status).length;
  Utils.logRecord(
    'info',
    {
      event: 'loot_reset_check_summary',
      servers: servers.length,
      ok: count('ok'),
      mismatch: count('mismatch'),
      notMeasured: count('not-measured'),
      failed: count('failed'),
      windowDays: WINDOW_DAYS,
    },
    `Loot reset check: ${count('mismatch')} mismatch(es) over ${servers.length} servers`,
  );
}

if (require.main === module) {
  checkEveryServer().catch((error) => {
    Utils.logRecord(
      'warn',
      { event: 'loot_reset_check_summary', reason: Utils.describeError(error) },
      'Loot reset check crashed',
    );
    process.exitCode = 1;
  });
}
