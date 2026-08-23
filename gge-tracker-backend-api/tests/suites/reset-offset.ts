/**
 * Reset-offset suite : does every server's declared weekly loot reset match its own point stream
 */
import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { config } from '../config';
import { discard } from '../lib/journal';
import { ClickHouseTarget, listDatabases, localTarget, probe, query, remoteTarget } from '../lib/clickhouse';
import { ServerEntry, activatedServers } from '../lib/servers-source';
import { HOURS_PER_WEEK, buildResetQuery, defaultOptions, describeOffset, measure } from '../lib/reset-offset';

function checkTable(section: Section, servers: ServerEntry[]): void {
  const undeclared = servers.filter((server) => server.resetOffset === undefined);
  section.expect('every activated server declares a reset offset', {
    ok: undeclared.length === 0,
    detail: undeclared.length === 0 ? `${servers.length} servers` : undeclared.map((s) => `${s.key} (line ${s.line})`).join(', '),
    expected: 'a serverResetOffset on each of the activated servers - without one the frontend falls back to a default week',
    actual:
      undeclared.length === 0
        ? `all ${servers.length} activated servers declare one`
        : `${undeclared.length} without: ${undeclared.map((s) => s.key).join(', ')}`,
  });

  const half = HOURS_PER_WEEK / 2;
  const implausible = servers.filter(
    (server) => server.resetOffset !== undefined && (!Number.isInteger(server.resetOffset) || Math.abs(server.resetOffset) > half),
  );
  section.expect('declared offsets are whole hours within a week of Monday', {
    ok: implausible.length === 0,
    detail: implausible.map((s) => `${s.key}=${s.resetOffset}`).join(', ') || 'all within range',
    expected: `an integer in [-${half}, ${half}] - the offset counts hours around Monday 00:00 UTC`,
    actual: implausible.length === 0 ? 'every value is a whole number of hours' : implausible.map((s) => `${s.key}=${s.resetOffset}`).join(', '),
  });
}

async function measureServer(section: Section, target: ClickHouseTarget, server: ServerEntry): Promise<boolean> {
  const label = `${server.key} (${server.olapDatabase})`;
  const options = { ...defaultOptions, windowDays: config.resetOffset.windowDays };
  const result = await query(target, buildResetQuery(server.olapDatabase, options), `reset-offset/${server.key}`);
  if (!result.ok) {
    section.expect(`${label}: loot stream is readable`, {
      ok: false,
      detail: result.error ?? 'query failed',
      expected: `player_loot_history in ${server.olapDatabase} answers the reset query`,
      actual: result.error ?? 'query failed',
    });
    return false;
  }

  const reading = measure(result.rows);
  if (!reading || reading.totalGaps < config.resetOffset.minGaps) {
    const detail = reading
      ? `only ${reading.totalGaps} loot gaps in the last ${options.windowDays} days, need ${config.resetOffset.minGaps}`
      : `no player left the loot ranking in the last ${options.windowDays} days`;
    if (config.requireSeeds) {
      section.expect(`${label}: reset offset`, {
        ok: false,
        detail,
        expected: 'enough loot history to re-measure the reset (TEST_REQUIRE_SEEDS=1)',
        actual: detail,
      });
    } else {
      section.skip(`${label}: reset offset`, detail);
    }
    return false;
  }

  const agreement = `${(reading.agreement * 100).toFixed(1)}% of ${reading.totalGaps} gaps`;
  const runnerUp = reading.runnerUp ? `, next best ${reading.runnerUp.offset} with ${reading.runnerUp.gaps}` : '';
  const blurred = reading.blurred > 0 ? `, ${reading.blurred} of them read early by a short scrape` : '';
  const weeks = `${reading.weeks} reset${reading.weeks === 1 ? '' : 's'}`;
  section.expect(
    `${label}: the loot stream agrees on one reset instant`,
    {
      ok: reading.agreement >= config.resetOffset.agreement,
      detail: `${weeks}, ${agreement}${blurred}${runnerUp}`,
      expected: `at least ${(config.resetOffset.agreement * 100).toFixed(0)}% of the gaps opening on the same hour of the week - the reset is one instant, every player sees it`,
      actual: `${weeks} seen, ${agreement} land on ${describeOffset(reading.offset)}${blurred}${runnerUp}`,
    },
    result.ms,
  );

  const declared = server.resetOffset === undefined ? 'none declared' : `${server.resetOffset} (${describeOffset(server.resetOffset)})`;
  section.expect(`${label}: declared offset matches the measured reset`, {
    ok: reading.offset === server.resetOffset,
    detail:
      reading.offset === server.resetOffset
        ? `${declared}, ${reading.gaps} gaps over ${weeks}, ${reading.playerWeeks} player-weeks${blurred}`
        : `declared ${declared}, measured ${reading.offset} (${describeOffset(reading.offset)})`,
    expected: `serverResetOffset ${declared} - api.manager.ts line ${server.line}`,
    actual: `${reading.offset} at ${describeOffset(reading.offset)}, from ${reading.gaps} gaps over ${weeks} (${reading.instants.join(', ')})`,
  });
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
    section.skip('measure offsets against the loot stream', `${target.name} ClickHouse not readable: ${catalogue.error}`);
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
      section.skip(`${server.key} (${server.olapDatabase}): reset offset`, `no such database on ${target.url}`);
    }
  } else if (absent.length > 0) {
    section.skip(
      'servers not held by this ClickHouse',
      `${absent.length} of ${servers.length} are only on production - bring the VPN up to measure them`,
    );
  }

  if (measured === 0) {
    section.skip('reset offsets measured', `no server on ${target.url} carried enough loot history`);
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
