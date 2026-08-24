import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../config';
import { CheckResult, Report } from './report';
import { Exchange } from './journal';
import { Seeds, describeSeeds } from './bootstrap';

export interface RunContext {
  suites: string[];
  seeds?: Seeds;
}

interface Totals {
  passed: number;
  failed: number;
  skipped: number;
}

const TESTS_ROOT = resolve(__dirname, '..');

function totalsOf(results: CheckResult[]): Totals {
  return {
    passed: results.filter((r) => r.ok && !r.skipped).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}

function verdictOf(r: CheckResult): 'PASS' | 'FAIL' | 'SKIP' {
  return r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function destination(startedAt: Date): string {
  if (config.trace.file) {
    return isAbsolute(config.trace.file) ? config.trace.file : resolve(TESTS_ROOT, config.trace.file);
  }
  const dir = isAbsolute(config.trace.dir) ? config.trace.dir : resolve(TESTS_ROOT, config.trace.dir);
  return join(dir, `api-run-${stamp(startedAt)}.md`);
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: TESTS_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function renderBody(body: string, contentType: string | undefined, limit: number): { text: string; lang: string; clipped: boolean } {
  const clipped = body.length > limit;
  let text = clipped ? body.slice(0, limit) : body;
  let lang = 'text';
  if ((contentType ?? '').includes('json')) {
    lang = 'json';
    if (!clipped) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch { }
    }
  }
  return { text, lang, clipped };
}

const NOISE_HEADERS = new Set(['user-agent', 'x-forwarded-for']);

function renderRequest(x: Exchange): string[] {
  const lines = [`${x.method} ${x.url}`];
  for (const [name, value] of Object.entries(x.requestHeaders)) {
    if (!NOISE_HEADERS.has(name.toLowerCase())) lines.push(`${name}: ${value}`);
  }
  lines.push(`X-Forwarded-For: ${x.requestHeaders['X-Forwarded-For'] ?? '-'}   (per-call rate-limit bucket)`);
  if (x.requestBody !== undefined) {
    lines.push('');
    lines.push(x.requestBody + (x.requestBodyTruncated ? ' …[truncated]' : ''));
  }
  return lines;
}

function renderExchange(x: Exchange, bodyLimit: number): string[] {
  const out: string[] = [];
  out.push('**Action** — the request the harness sent');
  out.push('');
  out.push('```http');
  out.push(...renderRequest(x));
  out.push('```');
  out.push('');

  const headerLines = Object.entries(x.responseHeaders).map(([n, v]) => `${n}: ${v}`);
  const status = x.status === 0 ? `no response (${x.networkError})` : `HTTP ${x.status}`;
  out.push(`**Received** — ${status} in ${Math.round(x.ms)} ms, ${x.responseBytes} bytes`);
  out.push('');
  if (headerLines.length) {
    out.push('```http');
    out.push(...headerLines);
    out.push('```');
    out.push('');
  }
  if (x.responseBody) {
    const { text, lang, clipped } = renderBody(x.responseBody, x.responseHeaders['content-type'], bodyLimit);
    out.push(`<details><summary>Response body (${x.responseBytes} bytes${clipped || x.responseBodyTruncated ? ', shown truncated' : ''})</summary>`);
    out.push('');
    out.push('```' + lang);
    out.push(text);
    out.push('```');
    out.push('');
    out.push('</details>');
    out.push('');
  } else if (x.status !== 0) {
    out.push('_Empty response body._');
    out.push('');
  }
  return out;
}

type ShownAt = Map<number, number>;

function renderReference(x: Exchange, at: number | undefined): string[] {
  const status = x.status === 0 ? `no response (${x.networkError})` : `HTTP ${x.status}`;
  return [
    `**Action** — \`${x.method} ${x.path}\` (call #${x.seq}${at ? `, sent and shown in full under check ${at}` : ''})`,
    '',
    `**Received** — ${status} in ${Math.round(x.ms)} ms, ${x.responseBytes} bytes — the same response the check above judged`,
    '',
  ];
}

function renderCheck(r: CheckResult, index: number, shownAt: ShownAt): string[] {
  const out: string[] = [];
  const verdict = verdictOf(r);
  const mark = verdict === 'PASS' ? 'OK' : verdict === 'FAIL' ? 'KO' : 'SKIP';
  out.push(`### ${index}. ${mark} ${verdict} — ${r.name}`);
  out.push('');
  out.push(`- **Suite** : \`${r.suite}\``);
  out.push(`- **Run at** : ${r.at}${r.ms !== undefined ? ` (${Math.round(r.ms)} ms)` : ''}`);
  if (r.skipped) {
    out.push(`- **Skipped because** : ${r.detail ?? 'no reason given'}`);
    out.push('');
    return out;
  }
  out.push(`- **Expected** : ${r.expected ?? r.name}`);
  out.push(`- **Actual** : ${r.actual ?? r.detail ?? '(not reported)'}`);
  if (r.detail && r.actual !== undefined && r.detail !== r.actual) out.push(`- **Detail** : ${r.detail}`);
  out.push('');

  const bodyLimit = r.ok && !config.trace.full ? Math.min(config.trace.maxBodyChars, 400) : config.trace.maxBodyChars;
  if (!r.exchanges?.length) {
    out.push('_No HTTP call: this check reads the source or the published specification._');
    out.push('');
    return out;
  }
  const hidden = (r.exchangeCount ?? r.exchanges.length) - r.exchanges.length;
  for (const exchange of r.exchanges) {
    if (r.exchangesShared && shownAt.has(exchange.seq)) out.push(...renderReference(exchange, shownAt.get(exchange.seq)));
    else {
      shownAt.set(exchange.seq, index);
      out.push(...renderExchange(exchange, bodyLimit));
    }
  }
  if (hidden > 0) {
    out.push(`_${hidden} further call(s) went into this check - repeats of the above, not shown._`);
    out.push('');
  }
  return out;
}

function renderMarkdown(report: Report, context: RunContext, results: CheckResult[], path: string): string {
  const totals = totalsOf(results);
  const finishedAt = new Date();
  const seconds = ((finishedAt.getTime() - report.startedAt.getTime()) / 1000).toFixed(1);
  const out: string[] = [];

  out.push('# GGE Tracker API — test run trace');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Run date | ${report.startedAt.toISOString()} (local ${report.startedAt.toString()}) |`);
  out.push(`| Finished | ${finishedAt.toISOString()} after ${seconds}s |`);
  out.push(`| Target | \`${config.baseUrl}\` |`);
  out.push(`| Suites | ${context.suites.join(', ')} |`);
  out.push(`| Seeds | ${context.seeds ? describeSeeds(context.seeds) : 'none discovered'} |`);
  out.push(`| Commit | \`${commit()}\` |`);
  out.push(`| Node | ${process.version} |`);
  out.push(`| Result | **${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped** |`);
  out.push('');
  out.push(
    'Every check below records the moment it ran, the exact request that was sent, the response ' +
      'that came back and the expectation it was judged against. Bodies are truncated; ' +
      'set `TEST_TRACE_FULL=1` for the full budget on passing checks too.',
  );
  out.push('');

  out.push('## Per-suite result');
  out.push('');
  out.push('| Suite | Passed | Failed | Skipped |');
  out.push('|---|---:|---:|---:|');
  const suites = [...new Set(results.map((r) => r.suite))];
  for (const suite of suites) {
    const t = totalsOf(results.filter((r) => r.suite === suite));
    out.push(`| ${suite} | ${t.passed} | ${t.failed} | ${t.skipped} |`);
  }
  out.push('');

  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    out.push('## Failures at a glance');
    out.push('');
    out.push('| # | Suite | Check | Expected | Actual |');
    out.push('|---|---|---|---|---|');
    for (const f of failures) {
      const cell = (text: string): string =>
        text.replace(/\n/g, ' ').slice(0, 200).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
      out.push(
        `| ${results.indexOf(f) + 1} | ${f.suite} | ${cell(f.name)} | ${cell(f.expected ?? '-')} | ${cell(f.actual ?? f.detail ?? '-')} |`,
      );
    }
    out.push('');
  }

  const timings = report.timingRows();
  if (timings.length) {
    out.push('## Response times (ms)');
    out.push('');
    out.push('| Endpoint | p50 | p95 | p99 | Budget |');
    out.push('|---|---:|---:|---:|---:|');
    for (const t of timings) {
      out.push(
        `| ${t.label} | ${t.p50.toFixed(0)} | ${t.p95.toFixed(0)} | ${t.p99.toFixed(0)} | ${t.budget ? t.budget : '-'} |`,
      );
    }
    out.push('');
  }

  out.push(config.trace.failuresOnly ? '## Every failing check, in the order it ran' : '## Every check, in the order it ran');
  out.push('');
  if (config.trace.failuresOnly) {
    out.push('_TEST_TRACE_FAILURES=1: passing and skipped checks are counted above but not detailed._');
    out.push('');
    if (!failures.length) {
      out.push('Nothing failed.');
      out.push('');
    }
  }
  let current = '';
  const shownAt: ShownAt = new Map();
  results.forEach((r, i) => {
    if (config.trace.failuresOnly && r.ok) return;
    if (r.suite !== current) {
      current = r.suite;
      out.push(`## Suite: ${current}`);
      out.push('');
    }
    out.push(...renderCheck(r, i + 1, shownAt));
  });

  out.push('---');
  out.push('');
  out.push(`_Written by tests/lib/trace.ts to ${path}. Temporary artifact - safe to delete._`);
  out.push('');
  return out.join('\n');
}

export function writeTrace(report: Report, context: RunContext): string | undefined {
  if (!config.trace.enabled) return undefined;
  const results = report.snapshot();
  if (results.length === 0) return undefined;

  const path = destination(report.startedAt);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderMarkdown(report, context, results, path), 'utf8');
    if (config.trace.json) {
      writeFileSync(
        path.replace(/\.md$/, '') + '.json',
        JSON.stringify(
          {
            startedAt: report.startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            baseUrl: config.baseUrl,
            suites: context.suites,
            seeds: context.seeds ? describeSeeds(context.seeds) : undefined,
            totals: totalsOf(results),
            checks: results,
          },
          null,
          2,
        ),
        'utf8',
      );
    }
    return path;
  } catch (error: any) {
    console.warn(`  ⚠  could not write the run trace to ${path}: ${error?.message ?? error}`);
    return undefined;
  }
}
