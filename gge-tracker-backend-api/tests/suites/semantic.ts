/**
 * Semantic suite : does the API still MEAN what it says
 *
 * Every other suite stops at the envelope - a status code, a header, a top-level key.
 * This one reads the rows. A filter that returns 200 with the wrong set, a sort that is
 * no longer applied, a page 2 that repeats page 1: all of those are green everywhere else
 * and red here.
 */
import { Report } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG } from '../lib/catalog';
import { callable, headersFor, seedsSatisfied, uncallableReason } from '../lib/endpoints';
import { request } from '../lib/http';
import { Emitter, Probe, checkFilter, checkPagination, checkSort, readPage } from '../lib/invariants';

export async function runSemantic(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('semantic');

  for (const ep of CATALOG) {
    const spec = ep.semantic;
    if (!spec) continue;

    const label = `${ep.method} ${ep.id}`;
    if (!callable(ep, seeds) || !seedsSatisfied(ep, seeds)) {
      section.skip(label, uncallableReason(ep));
      continue;
    }

    const probe: Probe = { path: ep.path(seeds), headers: headersFor(ep, seeds), spec };
    const emit: Emitter = {
      expect: (name, outcome) => section.expect(`${label} ${name}`, outcome),
      skip: (name, why) => section.skip(`${label} ${name}`, why),
    };

    const baseRes = await request({ path: probe.path, headers: probe.headers });
    const baseline = readPage(baseRes, spec);
    if (!baseline) {
      emit.expect('returns a readable collection', {
        ok: false,
        detail: `${baseRes.status} with no "${spec.collection || 'array'}" array - body="${String(baseRes.raw).slice(0, 140)}"`,
        expected: `a 200 whose body carries a "${spec.collection || 'top-level'}" array to read rows from`,
        actual: `HTTP ${baseRes.status}, body="${String(baseRes.raw).slice(0, 140)}"`,
      });
      continue;
    }

    if (spec.nonEmpty) {
      // An empty page here is exactly the failure mode the harness used to miss: a
      // perfectly shaped 200 that happens to contain nothing
      emit.expect('returns rows', {
        ok: baseline.rows.length > 0,
        detail: baseline.rows.length
          ? `${baseline.rows.length} rows, total ${baseline.total}`
          : 'empty collection on a populated server',
        expected: `at least one row in "${spec.collection}" - the fixture has data for this route`,
        actual: baseline.rows.length
          ? `${baseline.rows.length} rows, total ${baseline.total}`
          : 'an empty collection, on a server that has data',
      });
      if (baseline.rows.length === 0) continue;
    }

    if (spec.paginated) await checkPagination(probe, baseline, emit);
    for (const check of spec.filters ?? []) await checkFilter(probe, baseline, check, emit);
    for (const check of spec.sorts ?? []) await checkSort(probe, baseline, check, emit);
  }
}
