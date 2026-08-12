import { config } from '../config';

export interface Exchange {
  seq: number;
  at: string;
  method: string;
  path: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseBodyTruncated?: boolean;
  responseBytes: number;
  ms: number;
  networkError?: string;
}

const KEPT_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'retry-after',
  'location',
  'access-control-allow-origin',
]);

const MAX_BUFFERED = 40;

let sequence = 0;
let buffered: Exchange[] = [];
let bufferedTotal = 0;

export function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max ? { text, truncated: false } : { text: text.slice(0, max), truncated: true };
}

export function pickResponseHeaders(headers: Record<string, any>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (KEPT_RESPONSE_HEADERS.has(key) || key.startsWith('x-')) kept[key] = String(value);
  }
  return kept;
}

export function record(entry: Omit<Exchange, 'seq'>): void {
  if (!config.trace.enabled) return;
  bufferedTotal++;
  if (buffered.length < MAX_BUFFERED) buffered.push({ seq: ++sequence, ...entry });
}

export interface Drained {
  entries: Exchange[];
  total: number;
}

export function drain(): Drained {
  const drained: Drained = { entries: buffered, total: bufferedTotal };
  buffered = [];
  bufferedTotal = 0;
  return drained;
}

export function discard(): void {
  buffered = [];
  bufferedTotal = 0;
}

export function reset(): void {
  discard();
  sequence = 0;
}
