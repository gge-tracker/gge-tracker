//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
//  Records real empire-api responses and writes them to tests/fixtures as anonymised
//
import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { Anonymiser } from './anonymiser';
import { CaptureJob, CAPTURE_JOBS } from './jobs';
import { AllianceFixture, FixtureMeta, PlayerEventFixture, RankingFixture, RankingRow } from '../harness/fixture-types';

const READ_ONLY_COMMANDS = new Set(['hgh', 'ain', 'gpe']);
const BASE_URL = process.env.CAPTURE_API_URL ?? 'http://10.8.0.1:4444';
const SERVER = process.env.CAPTURE_SERVER ?? 'EmpireEx_3';
const PACING_MS = Number(process.env.CAPTURE_PACING_MS ?? 250);
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(command: string, parameters: Record<string, string | number>): Promise<any> {
  if (!READ_ONLY_COMMANDS.has(command)) {
    throw new Error(`Refusing to capture "${command}": only ${[...READ_ONLY_COMMANDS].join(', ')} are read-only`);
  }
  const serialised = Object.entries(parameters)
    .map(([key, value]) => `"${key}":${typeof value === 'string' ? `"${value}"` : value}`)
    .join(',');
  const url = encodeURI(`${BASE_URL}/${SERVER}/${command}/${serialised}`);
  const response = await axios.get(url, { timeout: 30_000 });
  await sleep(PACING_MS);
  return response.data;
}

async function captureRanking(job: Extract<CaptureJob, { kind: 'ranking' }>): Promise<RankingFixture | null> {
  const probe = await call('hgh', { LT: job.lt, LID: job.lid, SV: '1' });
  if (probe.return_code !== 0 || !probe.content) {
    console.log(`  ${job.name}: return_code=${probe.return_code}, recording the response verbatim`);
    return {
      meta: buildMeta(job, 0, true),
      lt: job.lt,
      lid: job.lid,
      pageSize: 0,
      totalRanked: 0,
      fr: null,
      igh: null,
      rows: [],
      rawResponse: probe,
    };
  }

  const pageSize = probe.content.L.length;
  const totalRanked = Number(probe.content.LR ?? 0);
  if (pageSize === 0 || totalRanked === 0) {
    console.log(`  ${job.name}: empty ranking (LR=${totalRanked}), recording the empty response`);
    return {
      meta: buildMeta(job, 0, true),
      lt: job.lt,
      lid: job.lid,
      pageSize,
      totalRanked,
      fr: probe.content.FR ?? null,
      igh: probe.content.IGH ?? null,
      rows: [],
      rawResponse: probe,
    };
  }

  const wanted = job.maxRows ? Math.min(job.maxRows, totalRanked) : totalRanked;
  const byRank = new Map<number, RankingRow>();
  let sv = Math.ceil(pageSize / 2);
  let guard = 0;
  const maxRequests = Math.ceil(wanted / pageSize) + 4;

  while (byRank.size < wanted && guard < maxRequests) {
    const page = await call('hgh', { LT: job.lt, LID: job.lid, SV: String(sv) });
    guard++;
    const rows: RankingRow[] = page?.content?.L ?? [];
    if (rows.length === 0) break;
    for (const row of rows) byRank.set(row[0], row);
    sv += pageSize;
  }

  const rows = [...byRank.values()].sort((a, b) => a[0] - b[0]).slice(0, wanted);
  console.log(`  ${job.name}: ${rows.length} rows over ${guard} requests (live LR=${totalRanked})`);

  return {
    meta: buildMeta(job, rows.length, rows.length === totalRanked),
    lt: job.lt,
    lid: job.lid,
    pageSize,
    totalRanked: rows.length,
    fr: probe.content.FR ?? null,
    igh: probe.content.IGH ?? null,
    rows,
  };
}

async function captureRankingTail(job: Extract<CaptureJob, { kind: 'ranking-tail' }>): Promise<RankingFixture | null> {
  const probe = await call('hgh', { LT: job.lt, LID: job.lid, SV: '1' });
  if (probe.return_code !== 0 || !probe.content?.L?.length) {
    console.log(`  ${job.name}: ranking unavailable, skipped`);
    return null;
  }
  const pageSize = probe.content.L.length;
  const totalRanked = Number(probe.content.LR ?? 0);
  const byRank = new Map<number, RankingRow>();
  let sv = totalRanked;
  let guard = 0;
  const maxRequests = Math.ceil(job.maxRows / pageSize) + 4;

  while (byRank.size < job.maxRows && guard < maxRequests && sv > 0) {
    const page = await call('hgh', { LT: job.lt, LID: job.lid, SV: String(sv) });
    guard++;
    const rows: RankingRow[] = page?.content?.L ?? [];
    if (rows.length === 0) break;
    for (const row of rows) byRank.set(row[0], row);
    sv -= pageSize;
  }

  const tail = [...byRank.values()].sort((a, b) => a[0] - b[0]).slice(-job.maxRows);
  const negatives = tail.filter((row) => Number(row[1]) < 0).length;
  console.log(`  ${job.name}: ${tail.length} tail rows over ${guard} requests, ${negatives} with negative points`);

  // The tail is renumbered from rank 1 so it can be replayed as a small self-contained ranking
  const renumbered: RankingRow[] = tail.map((row, index) => [index + 1, row[1], row[2]]);
  return {
    meta: { ...buildMeta(job, renumbered.length, false), renumberedFromRank: tail[0]?.[0] ?? null },
    lt: job.lt,
    lid: job.lid,
    pageSize,
    totalRanked: renumbered.length,
    fr: probe.content.FR ?? null,
    igh: probe.content.IGH ?? null,
    rows: renumbered,
  };
}

async function captureAlliances(job: Extract<CaptureJob, { kind: 'alliances' }>): Promise<AllianceFixture | null> {
  const ranking = await call('hgh', { LT: job.sourceLt, LID: 1, SV: '1' });
  const rows: RankingRow[] = ranking?.content?.L ?? [];
  const allianceIds = [...new Set(rows.map((row) => Number(row[2].AID)).filter((id) => id > 0))].slice(0, job.count);
  const alliances: Record<string, any>[] = [];
  for (const allianceId of allianceIds) {
    const response = await call('ain', { AID: allianceId });
    if (response?.content?.A) alliances.push(response.content.A);
  }
  console.log(`  ${job.name}: ${alliances.length} alliances`);
  return { meta: buildMeta(job, alliances.length, false), alliances };
}

async function capturePlayerEvents(
  job: Extract<CaptureJob, { kind: 'player-events' }>,
): Promise<PlayerEventFixture | null> {
  const ranking = await call('hgh', { LT: job.sourceLt, LID: 1, SV: '1' });
  const rows: RankingRow[] = ranking?.content?.L ?? [];
  const events: Record<string, any>[] = [];
  let entered = 0;
  for (const row of rows.slice(0, job.count)) {
    const playerId = Number(row[2].OID);
    const response = await call('gpe', { PID: playerId, EID: job.eid });
    if (!response?.content) continue;
    events.push(response.content);
    if (response.content.PE === 1) entered++;
  }
  console.log(`  ${job.name}: ${events.length} players, ${entered} of them entered the event`);
  return { meta: { ...buildMeta(job, events.length, false), eid: job.eid }, events };
}

function buildMeta(job: CaptureJob, rowCount: number, complete: boolean): FixtureMeta {
  return {
    name: job.name,
    describes: job.describes,
    capturedAt: new Date().toISOString(),
    capturedFrom: SERVER,
    rowCount,
    complete,
    anonymised: true,
  };
}

async function main(): Promise<void> {
  const filters = process.argv.slice(2);
  const jobs =
    filters.length === 0 ? CAPTURE_JOBS : CAPTURE_JOBS.filter((j) => filters.some((f) => j.name.includes(f)));
  if (jobs.length === 0) {
    console.error(`No capture job matches ${filters.join(', ')}`);
    process.exit(1);
  }

  const identityMap = path.join(FIXTURE_DIR, 'identity-map.json');
  if (filters.length > 0 && !fs.existsSync(identityMap)) {
    console.error('No identity map on this machine: run a full capture (no filter) before a partial one.');
    process.exit(1);
  }
  const anonymiser = Anonymiser.load(identityMap);
  console.log(`Capturing ${jobs.length} job(s) from ${BASE_URL}/${SERVER}`);

  for (const job of jobs) {
    console.log(`- ${job.name}`);
    let fixture: unknown = null;
    switch (job.kind) {
      case 'ranking':
        fixture = await captureRanking(job);
        break;
      case 'ranking-tail':
        fixture = await captureRankingTail(job);
        break;
      case 'alliances':
        fixture = await captureAlliances(job);
        break;
      case 'player-events':
        fixture = await capturePlayerEvents(job);
        break;
    }
    if (!fixture) continue;
    const anonymised = anonymiser.scrub(fixture);
    fs.writeFileSync(path.join(FIXTURE_DIR, `${job.name}.json`), JSON.stringify(anonymised, null, 2) + '\n');
  }

  anonymiser.save();
  console.log('Done. Review the diff before committing.');
}

void main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
