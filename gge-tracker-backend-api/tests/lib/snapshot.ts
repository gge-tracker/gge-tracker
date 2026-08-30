import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HttpResult } from './http';

export type SnapshotMode = 'full' | 'shape' | 'fields' | 'none';

const INSTRUMENTATION_FIELDS = new Set(['duration', 'diffs']);

export interface Digest {
  status: number;
  contentType: string;
  kind: 'paginated' | 'array' | 'object' | 'text' | 'binary' | 'empty';
  total?: number;
  count?: number;
  keys?: string[];
  rowKeys?: string[];
  bytes: number;
  hash?: string;
}

export interface Baseline {
  fixture: string;
  server: string;
  recordedAt: string;
  entries: Record<string, Digest>;
}

const TESTS_ROOT = resolve(__dirname, '..');
const FIXTURE_DIR = resolve(TESTS_ROOT, '../../database/fixtures/data');

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (INSTRUMENTATION_FIELDS.has(key)) continue;
      out[key] = normalise(child);
    }
    return out;
  }
  return value;
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function countsAreStable(mode: SnapshotMode): boolean {
  return mode !== 'fields';
}

export function digestOf(res: HttpResult, mode: SnapshotMode): Digest {
  const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim();
  const bytes = (res.raw ?? '').length;
  const base = { status: res.status, contentType, bytes: countsAreStable(mode) ? bytes : 0 };

  if (!contentType.includes('json') || res.body === undefined || res.body === null) {
    return {
      ...base,
      kind: contentType && !contentType.includes('json') && !contentType.startsWith('text') ? 'binary' : 'text',
      hash: mode === 'full' ? sha(res.raw ?? '') : undefined,
    };
  }

  const body = res.body;
  const hash = mode === 'full' ? sha(JSON.stringify(normalise(body))) : undefined;

  if (Array.isArray(body)) {
    return {
      ...base,
      kind: 'array',
      count: countsAreStable(mode) ? body.length : undefined,
      rowKeys: body[0] && typeof body[0] === 'object' ? Object.keys(body[0]).sort() : undefined,
      hash,
    };
  }
  if (typeof body === 'object') {
    const keys = Object.keys(body).sort();
    const collection = keys.find((key) => Array.isArray((body as any)[key]));
    const rows: any[] | undefined = collection ? (body as any)[collection] : undefined;
    const pagination = (body as any).pagination;
    return {
      ...base,
      kind: pagination ? 'paginated' : 'object',
      total:
        countsAreStable(mode) && pagination?.total_items_count !== undefined
          ? Number(pagination.total_items_count)
          : undefined,
      count: countsAreStable(mode) ? rows?.length : undefined,
      keys,
      rowKeys: rows?.[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).sort() : undefined,
      hash,
    };
  }
  return { ...base, kind: 'empty', hash };
}

export function compare(before: Digest, after: Digest): string | undefined {
  if (before.status !== after.status) return `status ${before.status} -> ${after.status}`;
  if (before.contentType !== after.contentType) return `content-type ${before.contentType} -> ${after.contentType}`;
  if (before.kind !== after.kind) return `response kind ${before.kind} -> ${after.kind}`;
  if (before.total !== after.total) return `total_items_count ${before.total} -> ${after.total}`;
  if (before.count !== after.count) return `rows returned ${before.count} -> ${after.count}`;

  const keyDiff = (name: string, a?: string[], b?: string[]): string | undefined => {
    const left = a ?? [];
    const right = b ?? [];
    const gone = left.filter((k) => !right.includes(k));
    const added = right.filter((k) => !left.includes(k));
    if (!gone.length && !added.length) return undefined;
    return `${name}${gone.length ? ` dropped ${gone.join(', ')}` : ''}${added.length ? ` added ${added.join(', ')}` : ''}`;
  };
  const envelope = keyDiff('envelope', before.keys, after.keys);
  if (envelope) return envelope;
  const row = keyDiff('row fields', before.rowKeys, after.rowKeys);
  if (row) return row;

  if (before.hash !== after.hash) {
    return `same shape and counts, but the content changed (${before.bytes} -> ${after.bytes} bytes)`;
  }
  return undefined;
}

export function fixtureFingerprint(): string {
  if (!existsSync(FIXTURE_DIR)) return 'unknown';
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else parts.push(`${full.slice(FIXTURE_DIR.length)}:${info.size}`);
    }
  };
  walk(FIXTURE_DIR);
  return sha(parts.join('\n'));
}

export function baselinePath(server: string): string {
  return resolve(TESTS_ROOT, 'snapshots', `${server}.json`);
}

export function loadBaseline(server: string): Baseline | undefined {
  const path = baselinePath(server);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
  } catch {
    return undefined;
  }
}

export interface BaselineWrite {
  path: string;
  written: boolean;
  changed: string[];
  added: string[];
  removed: string[];
}

export function saveBaseline(baseline: Baseline): BaselineWrite {
  const path = baselinePath(baseline.server);
  const previous = loadBaseline(baseline.server);
  const changed: string[] = [];
  const added: string[] = [];

  const ordered: Record<string, Digest> = {};
  for (const key of Object.keys(baseline.entries).sort()) {
    const fresh = baseline.entries[key];
    const recorded = previous?.entries[key];
    if (!recorded) {
      added.push(key);
      ordered[key] = fresh;
    } else if (compare(recorded, fresh) === undefined) {
      ordered[key] = recorded;
    } else {
      changed.push(key);
      ordered[key] = fresh;
    }
  }

  const removed = Object.keys(previous?.entries ?? {}).filter((key) => !(key in baseline.entries));
  const fixtureMoved = previous !== undefined && previous.fixture !== baseline.fixture;
  const written =
    previous === undefined || fixtureMoved || changed.length > 0 || added.length > 0 || removed.length > 0;

  if (written) {
    mkdirSync(resolve(TESTS_ROOT, 'snapshots'), { recursive: true });
    const recordedAt = baseline.recordedAt;
    writeFileSync(
      path,
      JSON.stringify({ fixture: baseline.fixture, server: baseline.server, recordedAt, entries: ordered }, null, 2) +
        '\n',
      'utf8',
    );
  }

  return { path, written, changed, added, removed };
}
