/**
 * Reset-offset suite : does every weekly loot reset of every server land where its declared timezone puts it
 */
import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { config } from '../config';
import { discard } from '../lib/journal';
import { ClickHouseTarget, listDatabases, localTarget, probe, query, remoteTarget } from '../lib/clickhouse';
import { ServerEntry, activatedServers, serversSourcePath } from '../lib/servers-source';
import { buildResetQuery, defaultOptions, judge, measuredResets, observesDaylightSaving } from '../lib/reset-offset';
import { lootWeekEnd, lootWeekStart, parseLootReset } from '../../src/api/helper/loot-reset';

const MS_PER_HOUR = 3_600_000;

const KNOWN_RESETS: { timezone: string; time: string; instant: string; hours: number }[] = [
  { timezone: 'Europe/Paris', time: 'MON 00:00', instant: '2026-03-22T23:00:00Z', hours: 167 },
  { timezone: 'Europe/Paris', time: 'MON 00:00', instant: '2026-10-18T22:00:00Z', hours: 169 },
  { timezone: 'Europe/Paris', time: 'MON 00:00', instant: '2026-10-25T23:00:00Z', hours: 168 },
  { timezone: 'America/New_York', time: 'MON 00:00', instant: '2025-11-03T05:00:00Z', hours: 168 },
  { timezone: 'America/New_York', time: 'MON 00:00', instant: '2026-03-09T04:00:00Z', hours: 168 },
  { timezone: 'Australia/Sydney', time: 'MON 00:00', instant: '2026-09-27T14:00:00Z', hours: 167 },
  { timezone: 'Australia/Sydney', time: 'MON 00:00', instant: '2026-10-04T13:00:00Z', hours: 168 },
  { timezone: 'UTC', time: 'SUN 19:00', instant: '2026-10-04T19:00:00Z', hours: 168 },
];

function checkArithmetic(section: Section): void {
  const wrong: string[] = [];
  for (const known of KNOWN_RESETS) {
    const reset = parseLootReset(known.timezone, known.time)!;
    const instant = Date.parse(known.instant);
    const start = lootWeekStart(instant + 30 * 60_000, reset);
    const hours = (lootWeekEnd(start, reset) - start) / MS_PER_HOUR;
    if (start !== instant || hours !== known.hours) {
      wrong.push(`${known.timezone} ${known.time}: ${new Date(start).toISOString()} for ${hours}h`);
    }
  }
  section.expect('the reset arithmetic follows daylight saving', {
    ok: wrong.length === 0,
    detail: wrong.join(', ') || `${KNOWN_RESETS.length} known resets, including 167h and 169h weeks`,
    expected: KNOWN_RESETS.map((known) => `${known.timezone} ${known.instant} (${known.hours}h)`).join(', '),
    actual: wrong.length === 0 ? 'every known reset reproduced' : wrong.join(', '),
  });
}

function checkTable(section: Section, servers: ServerEntry[]): void {
  const undeclared = servers.filter((server) => !server.resetTimezone && !server.resetTime);
  section.expect('every activated server declares its loot reset', {
    ok: undeclared.length === 0,
    detail: undeclared.length === 0 ? `${servers.length} servers` : undeclared.map((s) => `${s.key} (line ${s.line})`).join(', '),
    expected: '<reset-timezone> and <reset-time> on each activated server - without them the API falls back to Paris midnight',
    actual:
      undeclared.length === 0
        ? `all ${servers.length} activated servers declare one`
        : `${undeclared.length} without: ${undeclared.map((s) => s.key).join(', ')}`,
  });

  const invalid = servers.filter((server) => (server.resetTimezone || server.resetTime) && !server.lootReset);
  section.expect('declared resets are a known timezone and a weekday time', {
    ok: invalid.length === 0,
    detail: invalid.map((s) => `${s.key}="${s.resetTimezone}" "${s.resetTime}"`).join(', ') || 'all valid',
    expected: 'an IANA timezone (Europe/Paris) and a time like "MON 00:00"',
    actual: invalid.length === 0 ? 'every declaration parses' : invalid.map((s) => `${s.key}="${s.resetTimezone}" "${s.resetTime}"`).join(', '),
  });
}

async function measureServer(section: Section, target: ClickHouseTarget, server: ServerEntry): Promise<boolean> {
  const label = `${server.key} (${server.olapDatabase})`;
  if (!server.lootReset) return false;
  const options = { ...defaultOptions, windowDays: config.resetOffset.windowDays };
  const result = await query(target, buildResetQuery(server.olapDatabase, options), `reset-offset/${server.key}`, 120_000);
  if (!result.ok) {
    section.expect(`${label}: loot stream is readable`, {
      ok: false,
      detail: result.error ?? 'query failed',
      expected: `player_loot_history in ${server.olapDatabase} answers the reset query`,
      actual: result.error ?? 'query failed',
    });
    return false;
  }

  const resets = measuredResets(result.rows);
  if (resets.length < config.resetOffset.minWeeks) {
    const detail = `only ${resets.length} weekly resets seen in the last ${options.windowDays} days, need ${config.resetOffset.minWeeks}`;
    if (config.requireSeeds) {
      section.expect(`${label}: weekly resets`, { ok: false, detail, expected: 'enough loot history (TEST_REQUIRE_SEEDS=1)', actual: detail });
    } else {
      section.skip(`${label}: weekly resets`, detail);
    }
    return false;
  }

  const declared = `${server.resetTimezone} ${server.resetTime}`;
  const verdict = judge(resets, server.lootReset);
  const misses = verdict.mismatches.map((miss) => `${miss.hour}h (expected ${miss.expected}h)`);
  section.expect(
    `${label}: every weekly reset lands on ${declared}`,
    {
      ok: verdict.mismatches.length === 0,
      detail:
        verdict.mismatches.length === 0
          ? `${verdict.weeks} resets, UTC offsets ${verdict.offsetsSeen.join('/')}`
          : `${verdict.mismatches.length} of ${verdict.weeks} resets elsewhere: ${misses.slice(0, 6).join(', ')}`,
      expected: `${declared} - ${serversSourcePath()} line ${server.line}`,
      actual: verdict.mismatches.length === 0 ? `all ${verdict.weeks} measured resets` : misses.join(', '),
    },
    result.ms,
  );

  const latest = resets.at(-1)!.instant;
  if (observesDaylightSaving(server.lootReset, latest) && verdict.offsetsSeen.length < 2) {
    section.skip(
      `${label}: daylight saving confirmed`,
      `${server.resetTimezone} moves the reset twice a year, but the window only holds one season`,
    );
  }
  return true;
}

async function measurePass(
  section: Section,
  target: ClickHouseTarget,
  servers: ServerEntry[],
  reportMissing: boolean,
): Promise<void> {
  const catalogue = await listDatabases(target);
  if (!catalogue.ok) {
    section.skip('measure resets against the loot stream', `${target.name} ClickHouse not readable: ${catalogue.error}`);
    return;
  }

  const present = servers.filter((server) => catalogue.databases.has(server.olapDatabase));
  const absent = servers.filter((server) => !catalogue.databases.has(server.olapDatabase));
  let measured = 0;
  for (const server of present) {
    if (await measureServer(section, target, server)) measured++;
  }

  if (reportMissing) {
    for (const server of absent) {
      section.skip(`${server.key} (${server.olapDatabase}): weekly resets`, `no such database on ${target.url}`);
    }
  } else if (absent.length > 0) {
    section.skip(
      'servers not held by this ClickHouse',
      `${absent.length} of ${servers.length} are only on production - bring the VPN up to measure them`,
    );
  }

  if (measured === 0) {
    section.skip('weekly resets measured', `no server on ${target.url} carried enough loot history`);
  }
}

export async function runResetOffset(report: Report, _seeds: Seeds): Promise<void> {
  const only = config.resetOffset.servers
    .split(',')
    .map((name) => name.trim().toUpperCase())
    .filter(Boolean);
  const all = activatedServers();
  const servers = only.length > 0 ? all.filter((server) => only.includes(server.key)) : all;
  const section = report.section('reset-offset');
  checkArithmetic(section);
  checkTable(section, servers);

  await measurePass(section, localTarget(), servers, false);

  const remote = remoteTarget();
  if (!remote) return;
  const reachable = await probe(remote, config.resetOffset.probeTimeoutMs);
  if (!reachable.ok) {
    discard();
    return;
  }
  await measurePass(report.section('reset-offset:production'), remote, servers, true);
}
