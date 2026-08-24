import { SemanticSpec } from './catalog';
import { HttpResult, request } from './http';
import { Page, identify, num, readPage, withParams } from './invariants';

export interface Collection {
  rows: any[];
  ids: string[];
  total?: number;
  pages: number;
  requests: number;
  duplicates: string[];
}

export interface Enumeration {
  collection?: Collection;
  failure?: string;
}

const MAX_PAGES = 400;
const WIDE_PAGE = 200;

const cache = new Map<string, Enumeration>();

function keyOf(path: string, headers: Record<string, string>): string {
  return `${path}|${JSON.stringify(headers)}`;
}

function describe(res: HttpResult): string {
  return res.status === 0
    ? `no response (${res.networkError})`
    : `HTTP ${res.status}, body="${String(res.raw).slice(0, 120)}"`;
}

export async function enumerate(
  path: string,
  headers: Record<string, string>,
  spec: SemanticSpec,
): Promise<Enumeration> {
  const key = keyOf(path, headers);
  const cached = cache.get(key);
  if (cached) return cached;

  const result = await read(path, headers, spec);
  cache.set(key, result);
  return result;
}

async function read(path: string, headers: Record<string, string>, spec: SemanticSpec): Promise<Enumeration> {
  const firstRes = await request({ path: withParams(path, { page: 1, size: WIDE_PAGE }), headers });
  const first = readPage(firstRes, spec);
  if (!first) return { failure: `page 1 is not a readable collection: ${describe(firstRes)}` };

  const pageSize = first.rows.length;
  if (pageSize === 0) {
    return { collection: { rows: [], ids: [], total: first.total, pages: 1, requests: 1, duplicates: [] } };
  }

  const rows = [...first.rows];
  let requests = 1;
  let page = 1;
  const expectedPages = first.total !== undefined ? Math.ceil(first.total / pageSize) : MAX_PAGES;
  while (page < Math.min(expectedPages + 1, MAX_PAGES)) {
    page++;
    const res = await request({ path: withParams(path, { page, size: WIDE_PAGE }), headers });
    requests++;
    const next = readPage(res, spec);
    if (!next) return { failure: `page ${page} is not a readable collection: ${describe(res)}` };
    if (next.rows.length === 0) break;
    rows.push(...next.rows);
    if (next.rows.length < pageSize) break; // a short page is the last one
  }

  if (page >= MAX_PAGES) {
    return { failure: `collection needs more than ${MAX_PAGES} pages of ${pageSize} - too large to enumerate` };
  }

  const ids = rows.map((row) => identify(spec, row));
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) duplicates.push(id);
    else seen.add(id);
  }

  return { collection: { rows, ids, total: first.total, pages: page, requests, duplicates } };
}

export interface SetDiff {
  missing: string[];
  unexpected: string[];
  equal: boolean;
}

export function diff(expected: string[], actual: string[]): SetDiff {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = actual.filter((id) => !expectedSet.has(id));
  return { missing, unexpected, equal: missing.length === 0 && unexpected.length === 0 };
}

export function summarise(ids: string[], limit = 3): string {
  return ids.length <= limit ? ids.join(', ') : `${ids.slice(0, limit).join(', ')} and ${ids.length - limit} more`;
}

export function keysOf(rows: any[], field: string): number[] {
  return rows
    .map((row) => num(row?.[field]))
    .filter((value): value is number => value !== undefined);
}

export type { Page };
