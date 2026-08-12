import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { CATALOG, Endpoint, FilterCheck, SemanticSpec, SortCheck } from '../lib/catalog';
import { callable, headersFor, seedsSatisfied, uncallableReason } from '../lib/endpoints';
import { identify, num, satisfies, valueFor, withParams } from '../lib/invariants';
import { Collection, diff, enumerate, keysOf, summarise } from '../lib/oracle';

interface Probe {
  path: string;
  headers: Record<string, string>;
  spec: SemanticSpec;
}

function probeValue(check: FilterCheck, rows: any[]): string | number | undefined {
  const values = rows.map((row) => valueFor(check, row)).filter((value) => value !== undefined);
  if (values.length === 0) return undefined;

  if (check.kind === 'min' || check.kind === 'max') {
    const distinct = [...new Set(values.map((v) => num(v)).filter((v): v is number => v !== undefined))].sort(
      (a, b) => a - b,
    );
    if (distinct.length < 2) return undefined;
    return distinct[Math.floor(distinct.length / 2)];
  }

  const counts = new Map<string, number>();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const usable = ranked.find(([, count]) => count < rows.length) ?? ranked[0];
  return usable?.[0];
}

function expectedIds(spec: SemanticSpec, rows: any[], check: FilterCheck, value: string | number): string[] {
  return rows.filter((row) => satisfies(check, row, value)).map((row) => identify(spec, row));
}

function diffDetail(missing: string[], unexpected: string[]): string {
  const parts: string[] = [];
  if (missing.length) parts.push(`${missing.length} row(s) missing (${summarise(missing)})`);
  if (unexpected.length) parts.push(`${unexpected.length} row(s) that do not match (${summarise(unexpected)})`);
  return parts.join(', ');
}

async function checkFilter(
  section: Section,
  label: string,
  probe: Probe,
  truth: Collection,
  check: FilterCheck,
): Promise<void> {
  const name = `${label} filter ${check.param}`;
  const companions = check.with ?? {};
  const universe = Object.keys(companions).length
    ? (await enumerate(withParams(probe.path, companions), probe.headers, probe.spec)).collection
    : truth;
  if (!universe) {
    section.skip(name, `could not read the collection under ${JSON.stringify(companions)}`);
    return;
  }

  const value = probeValue(check, universe.rows);
  if (value === undefined) {
    section.skip(name, `no usable "${check.field}" in the ${universe.rows.length} rows to probe with`);
    return;
  }

  const expected = expectedIds(probe.spec, universe.rows, check, value);
  const { collection: got, failure } = await enumerate(
    withParams(probe.path, { ...companions, [check.param]: value }),
    probe.headers,
    probe.spec,
  );
  if (!got) {
    section.expect(`${name}=${value} returns a collection`, {
      ok: false,
      detail: failure ?? 'unreadable',
      expected: `a readable collection for ${check.param}=${value}, a value taken from the data`,
      actual: failure ?? 'unreadable',
    });
    return;
  }

  const { missing, unexpected, equal } = diff(expected, got.ids);
  section.expect(`${name}=${value} returns exactly the matching rows`, {
    ok: equal,
    detail: equal ? `${expected.length} rows, exactly as computed` : diffDetail(missing, unexpected),
    expected: `the ${expected.length} of ${universe.rows.length} rows that satisfy ${check.field} ${check.kind} ${value}, no more and no fewer`,
    actual: equal ? `exactly those ${got.ids.length} rows` : `${got.ids.length} rows - ${diffDetail(missing, unexpected)}`,
  });

  if (got.total !== undefined) {
    section.expect(`${name}=${value} counts what it returns`, {
      ok: got.total === expected.length,
      detail: `total_items_count=${got.total}, matching rows=${expected.length}`,
      expected: `total_items_count of ${expected.length}, the number of rows that match`,
      actual: `total_items_count=${got.total}, ${got.ids.length} rows served`,
    });
  }

  if (check.kind === 'min' || check.kind === 'max') {
    const onBound = universe.rows
      .filter((row) => num(valueFor(check, row)) === Number(value))
      .map((row) => identify(probe.spec, row));
    if (onBound.length) {
      const served = new Set(got.ids);
      const dropped = onBound.filter((id) => !served.has(id));
      section.expect(`${name}=${value} includes the rows sitting exactly on the bound`, {
        ok: dropped.length === 0,
        detail: dropped.length ? `${dropped.length}/${onBound.length} dropped (${summarise(dropped)})` : `${onBound.length} boundary rows kept`,
        expected: `all ${onBound.length} rows with ${check.field}=${value} are returned - the bound is inclusive`,
        actual: dropped.length
          ? `${dropped.length} of them are missing (${summarise(dropped)}) - the bound looks exclusive`
          : `all ${onBound.length} are there`,
      });
    }
  }
}

async function checkComposition(
  section: Section,
  label: string,
  probe: Probe,
  truth: Collection,
  checks: FilterCheck[],
): Promise<void> {
  const [a, b] = checks;
  const name = `${label} filters ${a.param}+${b.param}`;
  const valueA = probeValue(a, truth.rows);
  const valueB = probeValue(b, truth.rows);
  if (valueA === undefined || valueB === undefined) {
    section.skip(name, 'no usable probe value for both filters');
    return;
  }

  const expected = truth.rows
    .filter((row) => satisfies(a, row, valueA) && satisfies(b, row, valueB))
    .map((row) => identify(probe.spec, row));

  const params = { ...(a.with ?? {}), ...(b.with ?? {}), [a.param]: valueA, [b.param]: valueB };
  const { collection: got, failure } = await enumerate(withParams(probe.path, params), probe.headers, probe.spec);
  if (!got) {
    section.expect(`${name} compose`, {
      ok: false,
      detail: failure ?? 'unreadable',
      expected: 'a readable collection when both filters are sent together',
      actual: failure ?? 'unreadable',
    });
    return;
  }

  const { missing, unexpected, equal } = diff(expected, got.ids);
  section.expect(`${name} compose as AND`, {
    ok: equal,
    detail: equal ? `${expected.length} rows satisfy both` : diffDetail(missing, unexpected),
    expected: `the ${expected.length} rows satisfying both ${a.param}=${valueA} and ${b.param}=${valueB}`,
    actual: equal ? `exactly those ${got.ids.length} rows` : `${got.ids.length} rows - ${diffDetail(missing, unexpected)}`,
  });
}

async function checkSort(
  section: Section,
  label: string,
  probe: Probe,
  truth: Collection,
  check: SortCheck,
): Promise<void> {
  const name = `${label} sort ${check.param}=${check.value}`;
  const allKeys = keysOf(truth.rows, check.field);
  if (allKeys.length !== truth.rows.length) {
    section.skip(name, `${truth.rows.length - allKeys.length}/${truth.rows.length} rows carry no comparable ${check.field}`);
    return;
  }

  for (const [direction, value] of [
    ['ascending', check.ascending],
    ['descending', check.descending],
  ] as const) {
    const res = await enumerate(
      withParams(probe.path, { [check.param]: check.value, [check.directionParam]: value, page: 1 }),
      probe.headers,
      probe.spec,
    );
    if (!res.collection) {
      section.expect(`${name} ${direction}`, {
        ok: false,
        detail: res.failure ?? 'unreadable',
        expected: `a readable collection ordered by ${check.field}`,
        actual: res.failure ?? 'unreadable',
      });
      continue;
    }

    if (res.collection.duplicates.length > 0) {
      section.expect(`${name} ${direction} pages without repeating rows`, {
        ok: false,
        detail: `${res.collection.duplicates.length} repeated (${summarise(res.collection.duplicates)})`,
        expected: `sorting by ${check.field} ${direction} still pages over every row exactly once`,
        actual: `${res.collection.duplicates.length} rows come back twice (${summarise(res.collection.duplicates)}) - the sort has ties and no unique tiebreak`,
      });
      continue;
    }

    const served = keysOf(res.collection.rows, check.field);
    const wanted = [...allKeys].sort((x, y) => (direction === 'ascending' ? x - y : y - x));
    const at = served.findIndex((key, i) => key !== wanted[i]);
    const ok = served.length === wanted.length && at === -1;
    section.expect(`${name} ${direction} orders the whole collection`, {
      ok,
      detail: ok
        ? `${served.length} keys in the expected order`
        : at >= 0
          ? `position ${at}: got ${served[at]}, the collection's ${direction} order has ${wanted[at]}`
          : `${served.length} rows returned, the collection holds ${wanted.length}`,
      expected: `every row of the collection, ${check.field} ${direction} - ${wanted.slice(0, 3).join(', ')}…`,
      actual: ok
        ? `exactly that`
        : at >= 0
          ? `diverges at position ${at}: ${served[at]} where ${wanted[at]} was expected`
          : `${served.length} rows instead of ${wanted.length}`,
    });
  }
}

function enumerable(ep: Endpoint): boolean {
  return Boolean(ep.semantic?.paginated && ep.semantic.collection && (ep.semantic.idField || ep.semantic.idOf));
}

export async function runOracle(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('oracle');

  for (const ep of CATALOG.filter(enumerable)) {
    const spec = ep.semantic!;
    const label = `${ep.method} ${ep.id}`;
    if (!callable(ep, seeds) || !seedsSatisfied(ep, seeds)) {
      section.skip(label, uncallableReason(ep));
      continue;
    }

    const requested = ep.path(seeds);
    const probe: Probe = {
      path: spec.stableOrder ? withParams(requested, spec.stableOrder) : requested,
      headers: headersFor(ep, seeds),
      spec,
    };
    const { collection: served, failure: servedFailure } = await enumerate(requested, headersFor(ep, seeds), spec);
    const { collection: truth, failure } = spec.stableOrder
      ? await enumerate(probe.path, probe.headers, spec)
      : { collection: served, failure: servedFailure };
    if (!truth) {
      section.expect(`${label} collection can be read end to end`, {
        ok: false,
        detail: failure ?? 'unreadable',
        expected: 'every page of the collection is readable, so the expected results can be computed from it',
        actual: failure ?? 'unreadable',
      });
      continue;
    }
    if (truth.rows.length === 0) {
      section.skip(label, 'the collection is empty on this server - nothing to compute against');
      continue;
    }

    if (served) {
      const distinct = new Set(served.ids).size;
      section.expect(`${label} pages add up to total_items_count`, {
        ok: served.total === undefined || served.total === distinct,
        detail: `${distinct} distinct rows over ${served.pages} pages, total_items_count=${served.total}`,
        expected: `paging through the whole collection reaches the ${served.total} distinct rows it reports`,
        actual: `${distinct} distinct rows over ${served.pages} pages (${served.requests} requests)`,
      });
      section.expect(`${label} serves every row once`, {
        ok: served.duplicates.length === 0,
        detail: served.duplicates.length
          ? `${served.duplicates.length} repeated (${summarise(served.duplicates)})`
          : 'no row repeats',
        expected: 'no row appears on two pages, and none is unreachable - the paging order is total',
        actual: served.duplicates.length
          ? `${served.duplicates.length} rows served twice (${summarise(served.duplicates)}), so ${served.duplicates.length} others are unreachable`
          : `${served.ids.length} distinct rows`,
      });
    }

    if (truth.duplicates.length > 0) {
      const why =
        `paging this collection repeats ${truth.duplicates.length} rows, so the full set cannot be read; ` +
        (spec.stableOrder
          ? 'even the declared stable order is not total'
          : 'declare a stableOrder in the catalog once the route offers a total sort');
      for (const check of spec.filters ?? []) section.skip(`${label} filter ${check.param}`, why);
      for (const check of spec.sorts ?? []) section.skip(`${label} sort ${check.param}=${check.value}`, why);
      continue;
    }

    for (const check of spec.filters ?? []) await checkFilter(section, label, probe, truth, check);
    if ((spec.filters ?? []).length >= 2) {
      const [a, b] = spec.filters!;
      if (spec.filtersCompose === false) {
        section.skip(`${label} filters ${a.param}+${b.param}`, 'this route applies one filter or the other by design, not both');
      } else {
        await checkComposition(section, label, probe, truth, [a, b]);
      }
    }
    for (const check of spec.sorts ?? []) await checkSort(section, label, probe, truth, check);
  }
}
