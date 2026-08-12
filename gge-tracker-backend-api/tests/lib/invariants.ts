/**
 * The relational checks behind the semantic suite
 *
 * The point of every assertion here is that it compares responses to each other rather
 * than to a hard-coded value. A filter that quietly stops filtering, a sort that quietly
 * stops sorting or a page that quietly returns the same rows as the previous one all show
 * up as a failure - and none of them show up as a 5xx, which is why the rest of the
 * harness cannot see them.
 */
import { FilterCheck, SemanticSpec, SortCheck } from './catalog';
import { Outcome } from './assert';
import { HttpResult, request } from './http';

const NO_SUCH_TEXT = 'zz-no-such-value-zz';

export interface Page {
  rows: any[];
  total?: number;
  itemsCount?: number;
}

/** Postgres bigints arrive as strings, so every numeric comparison goes through this */
export function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function withParams(path: string, params: Record<string, string | number | undefined>): string {
  const [base, query] = path.split('?');
  const search = new URLSearchParams(query ?? '');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) search.delete(key);
    else search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `${base}?${rendered}` : base;
}

export function readPage(res: HttpResult, spec: SemanticSpec): Page | undefined {
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return undefined;
  const rows = spec.collection ? (res.body as any)[spec.collection] : res.body;
  if (!Array.isArray(rows)) return undefined;
  const pagination = (res.body as any).pagination;
  return {
    rows,
    total: num(pagination?.total_items_count),
    itemsCount: num(pagination?.current_items_count),
  };
}

export function valueFor(check: FilterCheck, row: any): string | number | undefined {
  const raw = check.probeValue ? check.probeValue(row) : row?.[check.field];
  if (raw === null || raw === undefined || raw === '') return undefined;
  return check.kind === 'min' || check.kind === 'max' ? num(raw) : String(raw);
}

/**
 * A value the filter cannot possibly match, or undefined when there is none
 *
 * For text this is trivial. For a numeric bound it has to be declared, because an
 * out-of-range number is dropped by the query parser rather than applied - so
 * `minLevel=800` returns the whole table and would make this check pass by accident.
 */
function impossibleFor(check: FilterCheck): string | number | undefined {
  if (check.noUnmatchableValue) return undefined;
  if (check.impossible !== undefined) return check.impossible;
  return check.kind === 'eq' || check.kind === 'contains' ? NO_SUCH_TEXT : undefined;
}

/** Does one row satisfy the filter that was sent? */
export function satisfies(check: FilterCheck, row: any, sent: string | number): boolean {
  if (check.matches) return check.matches(row, sent);
  const actual = row?.[check.field];
  switch (check.kind) {
    case 'min': {
      const value = num(actual);
      return value !== undefined && value >= Number(sent);
    }
    case 'max': {
      const value = num(actual);
      return value !== undefined && value <= Number(sent);
    }
    case 'eq':
      return actual !== null && actual !== undefined && String(actual) === String(sent);
    case 'contains':
      return typeof actual === 'string' && actual.toLowerCase().includes(String(sent).toLowerCase());
  }
}

export interface Probe {
  path: string;
  headers: Record<string, string>;
  spec: SemanticSpec;
}

export function identify(spec: SemanticSpec, row: any): string {
  return spec.idOf ? spec.idOf(row) : String(row?.[spec.idField]);
}

export interface Emitter {
  expect(name: string, outcome: Outcome): void;
  skip(name: string, why: string): void;
}

async function fetchPage(probe: Probe, params: Record<string, string | number | undefined>): Promise<{ res: HttpResult; page?: Page }> {
  const res = await request({ path: withParams(probe.path, params), headers: probe.headers });
  return { res, page: readPage(res, probe.spec) };
}

/* -------------------------------------------------------------------------
 * Filters
 * ----------------------------------------------------------------------- */
export async function checkFilter(probe: Probe, baseline: Page, check: FilterCheck, emit: Emitter): Promise<void> {
  const label = `filter ${check.param}`;
  const companions = check.with ?? {};

  let sample = baseline.rows.map((row) => valueFor(check, row)).find((value) => value !== undefined);
  let source = baseline;
  if (sample === undefined) {
    const { page: wide } = await fetchPage(probe, { ...companions, size: 200 });
    if (wide) {
      sample = wide.rows.map((row) => valueFor(check, row)).find((value) => value !== undefined);
      source = wide;
    }
  }
  if (sample === undefined) {
    emit.skip(`${label}`, `no row carries a usable "${check.field}" to probe with`);
    return;
  }

  const { res, page } = await fetchPage(probe, { ...companions, [check.param]: sample });
  if (!page) {
    emit.expect(`${label} accepts a value taken from its own data`, {
      ok: false,
      detail: `${check.param}=${sample} came back ${res.status}, body="${String(res.raw).slice(0, 120)}"`,
      expected: `a 200 carrying a "${probe.spec.collection}" array, since ${check.param}=${sample} was read from this very route`,
      actual: `HTTP ${res.status}, body="${String(res.raw).slice(0, 120)}"`,
    });
    return;
  }

  // Every row that came back has to actually satisfy what was asked for
  const violations = page.rows.filter((row) => !satisfies(check, row, sample));
  emit.expect(`${label} narrows to matching rows`, {
    ok: violations.length === 0,
    detail: violations.length
      ? `${violations.length}/${page.rows.length} rows violate ${check.field} ${check.kind} ${sample}, e.g. ${JSON.stringify(violations[0]?.[check.field])}`
      : `${page.rows.length} rows all satisfy ${check.field} ${check.kind} ${sample}`,
    expected: `every returned row satisfies ${check.field} ${check.kind} ${sample}`,
    actual: violations.length
      ? `${violations.length} of ${page.rows.length} rows do not, e.g. ${check.field}=${JSON.stringify(violations[0]?.[check.field])}`
      : `all ${page.rows.length} returned rows do`,
  });

  // For an exact/substring match the probe row itself must survive its own value.
  // This is the one that catches "filter still runs, but now matches nothing".
  if (check.kind === 'eq' || check.kind === 'contains') {
    const probeRow = source.rows.find((row) => valueFor(check, row) === sample);
    const probeId = probeRow ? identify(probe.spec, probeRow) : undefined;
    const found = page.rows.some((row) => identify(probe.spec, row) === probeId);
    emit.expect(`${label} round-trip`, {
      ok: found,
      detail: found
        ? `the row ${check.param}=${sample} was taken from is still in the result`
        : `${check.param}=${sample} came from row ${probeId}, which is not in the result (${page.rows.length} rows, total ${page.total})`,
      expected: `row ${probeId}, the one ${check.param}=${sample} was read from, comes back when that value is filtered on`,
      actual: found ? `row ${probeId} is in the result` : `row ${probeId} is absent from the ${page.rows.length} rows returned (total ${page.total})`,
    });
  }

  // Tightening a bound can never widen the result set
  if (baseline.total !== undefined && page.total !== undefined) {
    emit.expect(`${label} never widens the result`, {
      ok: page.total <= baseline.total,
      detail: `total ${page.total} vs unfiltered ${baseline.total}`,
      expected: `a filtered total no larger than the unfiltered ${baseline.total}`,
      actual: `total ${page.total} with ${check.param}=${sample}`,
    });
  }

  // And the one that catches a silently-dropped parameter: a value nothing can
  // match must empty the result set, or be rejected outright
  const impossible = impossibleFor(check);
  if (impossible === undefined) {
    emit.skip(
      `${label} is applied at all`,
      check.noUnmatchableValue
        ? 'the route ignores unrecognised values rather than rejecting them'
        : 'no unmatchable value declared for this numeric bound',
    );
    return;
  }
  const applied = `${check.param}=${impossible} matches nothing, so an empty result or a 4xx rejection`;
  const { res: deadRes, page: deadPage } = await fetchPage(probe, { ...companions, [check.param]: impossible });
  if (deadPage) {
    const empty = deadPage.rows.length === 0 && (deadPage.total === undefined || deadPage.total === 0);
    emit.expect(`${label} is applied at all`, {
      ok: empty,
      detail: empty
        ? `${check.param}=${impossible} matches nothing, as it must`
        : `${check.param}=${impossible} still returned ${deadPage.rows.length} rows (total ${deadPage.total}) - the parameter looks ignored`,
      expected: applied,
      actual: empty
        ? 'an empty result'
        : `${deadPage.rows.length} rows (total ${deadPage.total}) - the parameter looks ignored`,
    });
  } else {
    // Rejecting an unmatchable value is a legitimate alternative to returning nothing
    emit.expect(`${label} is applied at all`, {
      ok: deadRes.status >= 400 && deadRes.status < 500,
      detail: `${check.param}=${impossible} -> ${deadRes.status} (rejected rather than matched)`,
      expected: applied,
      actual: `HTTP ${deadRes.status} with no readable collection`,
    });
  }
}

function sortKey(value: unknown): number | undefined {
  const asNumber = num(value);
  if (asNumber !== undefined) return asNumber;
  if (typeof value === 'string') {
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate)) return asDate;
  }
  return undefined;
}

function orderedField(rows: any[], field: string): boolean {
  const present = rows.map((row) => row?.[field]).filter((value) => value !== null && value !== undefined);
  return present.length > 0 && present.every((value) => sortKey(value) !== undefined);
}

function monotonic(rows: any[], field: string, ascending: boolean): { ok: boolean; at?: number } {
  for (let i = 1; i < rows.length; i++) {
    const a = sortKey(rows[i - 1]?.[field]);
    const b = sortKey(rows[i]?.[field]);
    if (a === undefined || b === undefined) continue;
    if (!(ascending ? a <= b : a >= b)) return { ok: false, at: i };
  }
  return { ok: true };
}

export async function checkSort(probe: Probe, baseline: Page, check: SortCheck, emit: Emitter): Promise<void> {
  const label = `sort ${check.param}=${check.value}`;

  const ordered: Record<string, Page | undefined> = {};
  for (const [name, direction] of [['ascending', check.ascending], ['descending', check.descending]] as const) {
    const { res, page } = await fetchPage(probe, { [check.param]: check.value, [check.directionParam]: direction });
    ordered[name] = page;
    if (!page) {
      emit.expect(`${label} ${name}`, {
        ok: false,
        detail: `came back ${res.status}`,
        expected: `a 200 collection sorted on ${check.field}, ${name}`,
        actual: `HTTP ${res.status} with no readable collection`,
      });
      continue;
    }
    if (!orderedField(page.rows, check.field)) {
      emit.skip(`${label} ${name}`, `${check.field} is free text - its order is the database collation, not reproducible here`);
      continue;
    }
    const result = monotonic(page.rows, check.field, name === 'ascending');
    emit.expect(`${label} ${name}`, {
      ok: result.ok,
      detail: result.ok
        ? `${page.rows.length} rows ordered on ${check.field}`
        : `${check.field} breaks ${name} order at row ${result.at}: ${JSON.stringify(page.rows[result.at! - 1]?.[check.field])} then ${JSON.stringify(page.rows[result.at!]?.[check.field])}`,
      expected: `${check.field} ${name === 'ascending' ? 'never decreases' : 'never increases'} down the page`,
      actual: result.ok
        ? `${page.rows.length} rows in order, ${check.field} from ${JSON.stringify(page.rows[0]?.[check.field])} to ${JSON.stringify(page.rows[page.rows.length - 1]?.[check.field])}`
        : `order breaks at row ${result.at}: ${JSON.stringify(page.rows[result.at! - 1]?.[check.field])} then ${JSON.stringify(page.rows[result.at!]?.[check.field])}`,
    });
  }

  // Both directions returning the same first row means the direction is ignored -
  // only meaningful when there is more than one page of distinct values
  const first = ordered.ascending?.rows?.[0];
  const last = ordered.descending?.rows?.[0];

  // Meaningless when the column is nearly all ties - both ends of the sort legitimately
  // start on the same value, and which row wins is then down to the storage order
  const distinct = new Set((ordered.ascending?.rows ?? []).map((row) => String(row?.[check.field])));
  if (first && last && distinct.size <= 1) {
    emit.skip(`${label} direction changes the result`, `every row on page 1 has the same ${check.field}`);
  } else if (first && last && (baseline.total ?? 0) > baseline.rows.length) {
    const differs =
      identify(probe.spec, first) !== identify(probe.spec, last) ||
      String(first?.[check.field]) !== String(last?.[check.field]);
    emit.expect(`${label} direction changes the result`, {
      ok: differs,
      detail: differs
        ? `${check.ascending} and ${check.descending} start on different rows`
        : `both directions start on the same row - the direction looks ignored`,
      expected: `${check.directionParam}=${check.ascending} and ${check.directionParam}=${check.descending} open on different rows`,
      actual: differs
        ? `${identify(probe.spec, first)} (${JSON.stringify(first?.[check.field])}) vs ${identify(probe.spec, last)} (${JSON.stringify(last?.[check.field])})`
        : `both open on ${identify(probe.spec, first)} - the direction looks ignored`,
    });
  }
}

/* -------------------------------------------------------------------------
 * Pagination
 * ----------------------------------------------------------------------- */
export async function checkPagination(probe: Probe, baseline: Page, emit: Emitter): Promise<void> {
  if (baseline.itemsCount !== undefined) {
    emit.expect('pagination reports the rows it returned', {
      ok: baseline.itemsCount === baseline.rows.length,
      detail: `current_items_count=${baseline.itemsCount}, rows=${baseline.rows.length}`,
      expected: `pagination.current_items_count equals the ${baseline.rows.length} rows in the body`,
      actual: `current_items_count=${baseline.itemsCount}, rows=${baseline.rows.length}`,
    });
  }

  if ((baseline.total ?? 0) <= baseline.rows.length) return; // single page, nothing to compare

  const { res, page } = await fetchPage(probe, { page: 2 });
  if (!page) {
    emit.expect('pagination serves a second page', {
      ok: false,
      detail: `page 2 came back ${res.status}`,
      expected: `a 200 second page, since page 1 reports ${baseline.total} items for ${baseline.rows.length} rows`,
      actual: `HTTP ${res.status} with no readable collection`,
    });
    return;
  }

  const firstIds = new Set(baseline.rows.map((row) => identify(probe.spec, row)));
  const overlap = page.rows.filter((row) => firstIds.has(identify(probe.spec, row)));
  emit.expect('pagination pages do not overlap', {
    ok: overlap.length === 0,
    detail: overlap.length
      ? `${overlap.length}/${page.rows.length} rows of page 2 are already on page 1, e.g. ${identify(probe.spec, overlap[0])}`
      : `page 2 is disjoint from page 1`,
    expected: `none of the ${page.rows.length} rows on page 2 appear among the ${baseline.rows.length} on page 1`,
    actual: overlap.length
      ? `${overlap.length} rows repeat, e.g. ${identify(probe.spec, overlap[0])}`
      : 'page 2 is disjoint from page 1',
  });

  emit.expect('pagination total is stable across pages', {
    ok: page.total === baseline.total,
    detail: `page 1 says ${baseline.total}, page 2 says ${page.total}`,
    expected: `both pages report the same total_items_count (${baseline.total})`,
    actual: `page 1 says ${baseline.total}, page 2 says ${page.total}`,
  });
}
