import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG } from '../lib/catalog';
import { callable, headersFor } from '../lib/endpoints';
import { request } from '../lib/http';
import { Baseline, Digest, baselinePath, compare, digestOf, fixtureFingerprint, loadBaseline, saveBaseline } from '../lib/snapshot';

const UPDATE = process.env.TEST_SNAPSHOT_UPDATE === '1';

export async function runSnapshot(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('snapshot');
  const server = seeds.server ?? 'unknown';
  const fixture = fixtureFingerprint();
  const baseline = loadBaseline(server);

  if (!baseline && !UPDATE) {
    section.expect('a baseline exists for this server', {
      ok: false,
      detail: `no ${baselinePath(server)}`,
      expected: `a recorded baseline at tests/snapshots/${server}.json to compare this run against`,
      actual: 'none - record one with TEST_SNAPSHOT_UPDATE=1 npm run test:api -- snapshot',
    });
    return;
  }

  if (baseline && !UPDATE && baseline.fixture !== fixture && fixture !== 'unknown' && baseline.fixture !== 'unknown') {
    section.expect('the baseline was recorded against this fixture', {
      ok: false,
      detail: `baseline fixture ${baseline.fixture}, current ${fixture}`,
      expected: `the committed fixture to be the one the baseline was recorded from (${baseline.fixture})`,
      actual: `the fixture on disk is ${fixture} - it has been re-dumped, so every recorded answer is stale. Re-record with TEST_SNAPSHOT_UPDATE=1 and review the diff.`,
    });
    return;
  }

  const entries: Record<string, Digest> = {};
  let compared = 0;
  let unchanged = 0;

  for (const ep of CATALOG) {
    const key = `${ep.method} ${ep.id}`;
    if (ep.snapshot === 'none') {
      section.skip(key, 'declared non-deterministic - its answer is different every call by design');
      continue;
    }
    if (!callable(ep, seeds)) {
      section.skip(key, 'no server for this route - nothing to record');
      continue;
    }

    const res = await request({
      method: ep.method,
      path: ep.path(seeds),
      headers: headersFor(ep, seeds),
      body: ep.body ? ep.body(seeds) : undefined,
    });
    const digest = digestOf(res, ep.snapshot ?? 'full');
    entries[key] = digest;

    if (UPDATE) continue;

    const recorded = baseline!.entries[key];
    if (!recorded) {
      section.expect(`${key} is in the baseline`, {
        ok: false,
        detail: 'no recorded answer',
        expected: 'this route to have a recorded answer to compare against',
        actual: 'it is new since the baseline was recorded - re-record to adopt it',
      });
      continue;
    }

    compared++;
    const difference = compare(recorded, digest);
    if (!difference) unchanged++;
    section.expect(`${key} answers as recorded`, {
      ok: difference === undefined,
      detail: difference ?? `unchanged (${digest.kind}, ${digest.bytes} bytes)`,
      expected: describe(recorded),
      actual: difference ? `${describe(digest)} - ${difference}` : 'exactly that',
    });
  }

  if (UPDATE) {
    const path = saveBaseline({ fixture, server, recordedAt: new Date().toISOString(), entries });
    console.log(`  recorded ${Object.keys(entries).length} routes to ${path}`);
    section.expect('baseline recorded', {
      ok: true,
      detail: `${Object.keys(entries).length} routes -> ${path}`,
      expected: 'a fresh baseline written for review',
      actual: `${Object.keys(entries).length} routes recorded`,
    });
    return;
  }

  const gone = Object.keys(baseline!.entries).filter((key) => !(key in entries));
  section.expect('every recorded route was exercised', {
    ok: gone.length === 0,
    detail: gone.length ? `not called this run: ${gone.join(', ')}` : `${compared} routes compared, ${unchanged} unchanged`,
    expected: `all ${Object.keys(baseline!.entries).length} recorded routes to be reachable in this run`,
    actual: gone.length ? `${gone.length} were not called: ${gone.slice(0, 5).join(', ')}` : `all ${compared} were`,
  });
}

function describe(d: Digest): string {
  const bits = [`HTTP ${d.status}`, d.kind];
  if (d.total !== undefined) bits.push(`total ${d.total}`);
  if (d.count !== undefined) bits.push(`${d.count} rows`);
  bits.push(`${d.bytes} bytes`);
  return bits.join(', ');
}
