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
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as pg from 'pg';
import {
  CorrectionSegment,
  LootCorrection,
  SkippedPlayerWeek,
  StoredLoot,
  replayLootWeek,
} from './loot-backfill-replay';
import {
  LootWeek,
  firstReadingQuery,
  midWeekDropsQuery,
  pendingMutationsQuery,
  reverseSegments,
  segmentsCountQuery,
  segmentsMutation,
  weekReadingsQuery,
} from './loot-backfill-sql';
import { judgeServerReset, serversToCheck } from './loot-reset-check';
import { lootWeekEnd, lootWeekStart } from './loot-reset';
import { buildResetQuery } from './loot-reset-measure';
import { ScrapingServer, readScrapingServers } from './servers-file';
import Utils from './utils';

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
const POSTGRES_HOST = process.env.LOOT_BACKFILL_PG_HOST || 'postgres';
const BACKUP_DIR = process.env.LOOT_BACKFILL_DIR || '/app/backups';
const SEGMENTS_PER_MUTATION = 50;
const EXAMPLES_SHOWN = 5;
const DAY_MS = 86_400_000;

interface Options {
  apply: boolean;
  servers: string[] | null;
  since: number;
  rollback: string | null;
}

interface PlayerPeak {
  id: number;
  before: number | null;
  after: number;
}

interface ServerPlan {
  server: ScrapingServer;
  weeks: number;
  corrections: LootCorrection[];
  segments: CorrectionSegment[];
  skipped: SkippedPlayerWeek[];
  refusedByStrictRules: number;
  peaks: PlayerPeak[];
  missingPlayers: number;
}

interface Backup {
  server: string;
  olap: string;
  sql: string;
  createdAt: string;
  segments: CorrectionSegment[];
  peaks: PlayerPeak[];
  corrections: LootCorrection[];
}

class Refusal extends Error {}

function parseOptions(argv: string[]): Options {
  const options: Options = { apply: false, servers: null, since: 0, rollback: null };
  for (const argument of argv) {
    const [name, value] = argument.split('=', 2);
    if (name === '--apply') options.apply = true;
    else if (name === '--servers' && value) options.servers = value.split(',').map((each) => each.trim().toUpperCase());
    else if (name === '--since' && value && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      options.since = Date.parse(`${value}T00:00:00Z`);
    } else if (name === '--rollback' && value) options.rollback = value;
    else throw new Refusal(`Unknown argument: ${argument}`);
  }
  return options;
}

async function clickhouse(query: string, write = false): Promise<string[][]> {
  const settings = write ? 'mutations_sync=2&wait_end_of_query=1' : 'readonly=1';
  const { data } = await axios.post(`${CLICKHOUSE_URL}/?${settings}`, write ? query : `${query} FORMAT TSV`, {
    auth: { username: process.env.CLICKHOUSE_USER ?? '', password: process.env.CLICKHOUSE_PASSWORD ?? '' },
    headers: { 'Content-Type': 'text/plain' },
    responseType: 'text',
    timeout: 30 * 60_000,
  });
  return String(data ?? '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

async function count(query: string): Promise<number> {
  return Number((await clickhouse(query))[0]?.[0] ?? Number.NaN);
}

function postgres(database: string, readOnly: boolean): pg.Pool {
  return new pg.Pool({
    ...(readOnly ? { options: '-c default_transaction_read_only=on' } : {}),
    host: POSTGRES_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database,
    port: 5432,
    max: 1,
  });
}

function day(instant: number, timeZone = 'UTC'): string {
  return new Date(instant).toLocaleDateString('sv-SE', { timeZone });
}

function hour(instant: number): string {
  return new Date(instant).toISOString().slice(0, 16).replace('T', ' ');
}

function billions(point: number): string {
  return `${(point / 1e9).toFixed(3)}B`;
}

function completedWeeks(server: ScrapingServer, first: number): LootWeek[] {
  const reset = server.lootReset!;
  const currentWeek = lootWeekStart(Date.now(), reset);
  const weeks: LootWeek[] = [];
  for (let start = lootWeekStart(first, reset); start < currentWeek; start = lootWeekEnd(start, reset)) {
    weeks.push({ start, end: lootWeekEnd(start, reset) });
  }
  return weeks;
}

async function checkDeclaredReset(server: ScrapingServer, first: number): Promise<void> {
  const windowDays = Math.ceil((Date.now() - first) / DAY_MS) + 1;
  const rows = await clickhouse(buildResetQuery(server.olap, { windowDays, minPeak: 1_000_000 }));
  const verdict = judgeServerReset(server, rows);
  if (verdict.status !== 'ok') {
    throw new Refusal(`declared reset ${verdict.declared} is ${verdict.status} ${verdict.mismatches ?? ''}`.trim());
  }
}

async function playersWithMidWeekDrops(server: ScrapingServer, weeks: LootWeek[]): Promise<Map<number, number[]>> {
  const byWeek = new Map<number, Set<number>>();
  for (const [player, , week] of await clickhouse(midWeekDropsQuery(server.olap, weeks))) {
    const players = byWeek.get(Number(week) - 1) ?? new Set<number>();
    players.add(Number(player));
    byWeek.set(Number(week) - 1, players);
  }
  return new Map([...byWeek].map(([week, players]) => [week, [...players]]));
}

async function readWeek(server: ScrapingServer, week: LootWeek, players: number[]): Promise<StoredLoot[]> {
  const rows = await clickhouse(weekReadingsQuery(server.olap, week.start, week.end, players));
  return rows.map(([player, at, point]) => ({ player: Number(player), at: Number(at) * 1000, point: Number(point) }));
}

async function readPeaks(server: ScrapingServer, peaks: Map<number, number>): Promise<[PlayerPeak[], number]> {
  if (peaks.size === 0) return [[], 0];
  const pool = postgres(server.sql, true);
  try {
    const { rows } = await pool.query<{ id: number; loot_all_time: string | null }>(
      'SELECT id, loot_all_time FROM players WHERE id = ANY($1::int[])',
      [[...peaks.keys()]],
    );
    const raised = rows
      .map((row) => ({
        id: Number(row.id),
        before: row.loot_all_time === null ? null : Number(row.loot_all_time),
        after: peaks.get(Number(row.id))!,
      }))
      .filter((peak) => peak.after > (peak.before ?? 0));
    return [raised, peaks.size - rows.length];
  } finally {
    await pool.end();
  }
}

async function planServer(server: ScrapingServer, options: Options): Promise<ServerPlan> {
  const first = (await count(firstReadingQuery(server.olap, options.since))) * 1000;
  const weeks = first > 0 ? completedWeeks(server, first) : [];
  if (weeks.length > 0) await checkDeclaredReset(server, first);
  const plan: ServerPlan = {
    server,
    weeks: weeks.length,
    corrections: [],
    segments: [],
    skipped: [],
    refusedByStrictRules: 0,
    peaks: [],
    missingPlayers: 0,
  };
  if (weeks.length === 0) return plan;
  const peaks = new Map<number, number>();
  for (const [index, players] of await playersWithMidWeekDrops(server, weeks)) {
    const week = weeks[index];
    const replay = replayLootWeek(await readWeek(server, week, players), week.start, server.lootReset!);
    plan.corrections.push(...replay.corrections);
    plan.segments.push(...replay.segments);
    plan.skipped.push(...replay.skipped);
    plan.refusedByStrictRules += replay.refusedByStrictRules;
    for (const [player, peak] of replay.peaks) peaks.set(player, Math.max(peaks.get(player) ?? 0, peak));
  }
  [plan.peaks, plan.missingPlayers] = await readPeaks(server, peaks);
  return plan;
}

function skippedCulprit(skipped: SkippedPlayerWeek): number {
  if (skipped.reason === 'conflict') return skipped.readings.findIndex((reading) => reading.after < reading.before);
  const firstWrap = skipped.readings.findIndex((reading) => reading.kind === 'wrapped');
  return skipped.readings.findIndex(
    (reading, index) => index > firstWrap && (reading.kind === 'decreased' || reading.kind === 'refused'),
  );
}

function printPlan(plan: ServerPlan): void {
  const playerWeeks = new Set(
    plan.corrections.map((each) => `${each.player}:${lootWeekStart(each.at, plan.server.lootReset!)}`),
  );
  console.log(
    `${plan.server.server}: ${plan.weeks} weeks, ${playerWeeks.size} player-weeks to correct (${plan.corrections.length} rows, ` +
      `${plan.segments.length} segments), ${plan.peaks.length} loot_all_time to raise, ` +
      `${plan.skipped.length} player-weeks left alone, ${plan.refusedByStrictRules} wraps the live rules would accept but the replay refuses`,
  );
  const lastByPlayerWeek = new Map<string, LootCorrection>();
  for (const correction of plan.corrections) {
    lastByPlayerWeek.set(`${correction.player}:${lootWeekStart(correction.at, plan.server.lootReset!)}`, correction);
  }
  const biggest = [...lastByPlayerWeek.values()].sort((a, b) => b.after - a.after).slice(0, EXAMPLES_SHOWN);
  for (const each of biggest) {
    console.log(
      `  player ${each.player}, week of ${day(lootWeekStart(each.at, plan.server.lootReset!), plan.server.lootReset!.timezone)}: ends at ${billions(each.after)} instead of ${billions(each.before)}`,
    );
  }
  for (const skipped of plan.skipped.slice(0, EXAMPLES_SHOWN)) {
    const culprit = skippedCulprit(skipped);
    const around = skipped.readings
      .slice(Math.max(0, culprit - 1), culprit + 1)
      .map((reading) => `${hour(reading.at)} ${billions(reading.before)} ${reading.kind}`);
    console.log(
      `  left alone (${skipped.reason}): player ${skipped.player}, week of ${day(skipped.weekStart, plan.server.lootReset!.timezone)}: ${around.join(' -> ')}`,
    );
  }
  if (plan.missingPlayers > 0)
    console.log(`  ${plan.missingPlayers} corrected players are no longer in the players table`);
}

function writeBackup(plan: ServerPlan): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(
    BACKUP_DIR,
    `loot-backfill-${plan.server.server}-${new Date().toISOString().replace(/:/g, '-')}.json`,
  );
  const backup: Backup = {
    server: plan.server.server,
    olap: plan.server.olap,
    sql: plan.server.sql,
    createdAt: new Date().toISOString(),
    segments: plan.segments,
    peaks: plan.peaks,
    corrections: plan.corrections,
  };
  const descriptor = fs.openSync(file, 'wx');
  fs.writeSync(descriptor, JSON.stringify(backup));
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  return file;
}

async function rewriteSegments(database: string, segments: CorrectionSegment[]): Promise<void> {
  if (await count(pendingMutationsQuery(database)))
    throw new Refusal('a mutation is already running on player_loot_history');
  for (let index = 0; index < segments.length; index += SEGMENTS_PER_MUTATION) {
    const chunk = segments.slice(index, index + SEGMENTS_PER_MUTATION);
    const expected = chunk.reduce((sum, segment) => sum + segment.rows, 0);
    const found = await count(segmentsCountQuery(database, chunk, 'before'));
    if (found !== expected) {
      throw new Refusal(
        `segments ${index}-${index + chunk.length - 1}: expected ${expected} rows to rewrite, found ${found}`,
      );
    }
    await clickhouse(segmentsMutation(database, chunk), true);
    const rewritten = await count(segmentsCountQuery(database, chunk, 'after'));
    if (rewritten !== expected) {
      throw new Refusal(`segments ${index}-${index + chunk.length - 1}: rewrote ${rewritten} rows out of ${expected}`);
    }
  }
}

async function raisePeaks(database: string, peaks: PlayerPeak[]): Promise<number> {
  if (peaks.length === 0) return 0;
  const pool = postgres(database, false);
  try {
    const result = await pool.query(
      `UPDATE players p SET loot_all_time = v.after
        FROM unnest($1::int[], $2::bigint[]) AS v(id, after)
        WHERE p.id = v.id AND COALESCE(p.loot_all_time, 0) < v.after`,
      [peaks.map((peak) => peak.id), peaks.map((peak) => peak.after)],
    );
    return result.rowCount ?? 0;
  } finally {
    await pool.end();
  }
}

async function restorePeaks(database: string, peaks: PlayerPeak[]): Promise<number> {
  if (peaks.length === 0) return 0;
  const pool = postgres(database, false);
  try {
    const result = await pool.query(
      `UPDATE players p SET loot_all_time = v.before
        FROM unnest($1::int[], $2::bigint[], $3::bigint[]) AS v(id, after, before)
        WHERE p.id = v.id AND p.loot_all_time = v.after`,
      [peaks.map((peak) => peak.id), peaks.map((peak) => peak.after), peaks.map((peak) => peak.before)],
    );
    return result.rowCount ?? 0;
  } finally {
    await pool.end();
  }
}

async function applyPlan(plan: ServerPlan): Promise<void> {
  if (plan.segments.length === 0 && plan.peaks.length === 0) return;
  const backup = writeBackup(plan);
  console.log(`  backup written to ${backup}`);
  await rewriteSegments(plan.server.olap, plan.segments);
  console.log(`  ${plan.corrections.length} loot rows rewritten`);
  console.log(`  ${await raisePeaks(plan.server.sql, plan.peaks)} loot_all_time raised`);
}

async function rollback(file: string, apply: boolean): Promise<void> {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8')) as Backup;
  const segments = reverseSegments(backup.segments);
  const rows = segments.reduce((sum, segment) => sum + segment.rows, 0);
  const restorable = segments.length > 0 ? await count(segmentsCountQuery(backup.olap, segments, 'before')) : 0;
  console.log(
    `${backup.server} (backup of ${backup.createdAt}): ${restorable} of ${rows} rows still hold the corrected value`,
  );
  if (!apply) return;
  for (let index = 0; index < segments.length; index += SEGMENTS_PER_MUTATION) {
    const chunk = segments.slice(index, index + SEGMENTS_PER_MUTATION);
    await clickhouse(segmentsMutation(backup.olap, chunk), true);
  }
  console.log(
    `  ${segments.length > 0 ? await count(segmentsCountQuery(backup.olap, segments, 'after')) : 0} rows restored`,
  );
  console.log(`  ${await restorePeaks(backup.sql, backup.peaks)} loot_all_time restored`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.rollback) return rollback(options.rollback, options.apply);
  const wanted = (server: ScrapingServer): boolean =>
    options.servers!.includes(server.server.toUpperCase()) || options.servers!.includes(server.name.toUpperCase());
  const servers = serversToCheck(readScrapingServers()).filter((server) => !options.servers || wanted(server));
  if (options.servers && servers.length !== options.servers.length) {
    throw new Refusal(`Unknown server, or one without a declared loot reset, in ${options.servers.join(',')}`);
  }
  console.log(
    `${options.apply ? 'APPLY' : 'DRY RUN'} over ${servers.length} servers, weeks completed before now${options.since ? `, since ${day(options.since)}` : ''}`,
  );
  let failures = 0;
  for (const server of servers) {
    try {
      const plan = await planServer(server, options);
      printPlan(plan);
      if (options.apply) await applyPlan(plan);
    } catch (error) {
      failures++;
      console.log(`${server.server}: SKIPPED, ${Utils.describeError(error)}`);
    }
  }
  console.log(
    `${failures === 0 ? 'Done' : `Done, ${failures} server(s) skipped`}${options.apply ? '' : ' (dry run, nothing written)'}`,
  );
  if (failures > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(Utils.describeError(error));
    process.exitCode = 1;
  });
}
