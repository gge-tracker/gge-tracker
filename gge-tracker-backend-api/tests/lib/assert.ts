import { HttpResult } from './http';

export interface Outcome {
  ok: boolean;
  detail: string;
}

function preview(res: HttpResult, max = 160): string {
  const text = (res.raw || JSON.stringify(res.body) || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function reachable(res: HttpResult): Outcome {
  return {
    ok: res.status !== 0,
    detail: res.status === 0 ? `no response (${res.networkError})` : `status ${res.status}`,
  };
}

export function statusIn(res: HttpResult, allowed: number[]): Outcome {
  return {
    ok: allowed.includes(res.status),
    detail: `expected ${allowed.join('|')}, got ${res.status} ${res.status === 0 ? `(${res.networkError})` : ''}`.trim(),
  };
}

export function noServerError(res: HttpResult): Outcome {
  const ok = res.status !== 0 && res.status < 500;
  return {
    ok,
    detail: ok ? `status ${res.status}` : `5xx/none (${res.status || res.networkError}) body="${preview(res, 120)}"`,
  };
}

export function isJson(res: HttpResult): Outcome {
  const ct = String(res.headers['content-type'] ?? '');
  return { ok: ct.includes('application/json'), detail: `content-type="${ct || 'missing'}"` };
}

export function bodyHasKeys(res: HttpResult, keys: string[]): Outcome {
  if (res.body === null || typeof res.body !== 'object') {
    return { ok: false, detail: `body is not an object (${typeof res.body})` };
  }
  const target = Array.isArray(res.body) ? res.body[0] ?? {} : res.body;
  const missing = keys.filter((k) => !(k in target));
  return { ok: missing.length === 0, detail: missing.length ? `missing keys: ${missing.join(', ')}` : 'all keys present' };
}

export function headerPresent(res: HttpResult, header: string): Outcome {
  const value = res.headers[header.toLowerCase()];
  return { ok: value !== undefined, detail: `${header}="${value ?? 'missing'}"` };
}

const LEAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'SQL syntax error', re: /you have an error in your sql syntax|syntax error at or near|unterminated quoted string/i },
  { name: 'SQL keywords in error', re: /\b(ER_|sqlstate|econnrefused|getaddrinfo)\b/i },
  { name: 'MySQL/MariaDB driver', re: /\b(mysql|mariadb|er_parse_error|er_bad_field_error)\b.*error/i },
  { name: 'Postgres driver', re: /\b(pg_|relation ".*" does not exist|column ".*" does not exist)\b/i },
  { name: 'Node stack trace', re: /\bat\s+[\w$.<>]+\s+\(?[\/\\].*:\d+:\d+\)?/m },
  { name: 'Internal file path', re: /\/home\/|\/usr\/src\/|\/app\/|node_modules\// },
  { name: 'Redis error', re: /\bredis\b.{0,40}(connection|error)|ECONNREFUSED.*6379/i },
];

const BINARY_CONTENT_TYPE = /^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|wasm)/i;

export function noLeak(res: HttpResult): Outcome {
  const contentType = String(res.headers['content-type'] ?? '');
  if (BINARY_CONTENT_TYPE.test(contentType)) {
    return { ok: true, detail: `binary response (${contentType}) - leak scan skipped` };
  }
  const text = res.raw || (typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? ''));
  for (const p of LEAK_PATTERNS) {
    if (p.re.test(text)) {
      return { ok: false, detail: `leaked ${p.name}: "${preview(res, 140)}"` };
    }
  }
  return { ok: true, detail: 'no internal details leaked' };
}
