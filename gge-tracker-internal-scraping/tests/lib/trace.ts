//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { config } from '../config';
import { CheckResult, Report } from './report';

export interface RunContext {
  suites: string[];
  fixtures: number;
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
  return join(dir, `scraping-run-${stamp(startedAt)}.md`);
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: TESTS_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function cell(text: string): string {
  return text.replace(/\n/g, ' ').slice(0, 200).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function renderCheck(r: CheckResult, index: number): string[] {
  const out: string[] = [];
  out.push(`### ${index}. ${verdictOf(r)} - ${r.name}`);
  out.push('');
  out.push(`_${r.at}${r.ms === undefined ? '' : ` - ${r.ms.toFixed(1)}ms`}_`);
  out.push('');
  if (r.detail) {
    out.push(`**Detail:** ${r.detail}`);
    out.push('');
  }
  if (r.expected !== undefined || r.actual !== undefined) {
    out.push(`**Expected:** ${r.expected ?? '-'}`);
    out.push('');
    out.push(`**Actual:** ${r.actual ?? '-'}`);
    out.push('');
  }
  if (r.diagnostic) {
    const clipped = r.diagnostic.length > config.trace.maxDetailChars;
    out.push('```text');
    out.push(clipped ? r.diagnostic.slice(0, config.trace.maxDetailChars) + '\n…[truncated]' : r.diagnostic);
    out.push('```');
    out.push('');
  }
  return out;
}

function renderMarkdown(report: Report, context: RunContext, results: CheckResult[], path: string): string {
  const finishedAt = new Date();
  const seconds = ((finishedAt.getTime() - report.startedAt.getTime()) / 1000).toFixed(1);
  const totals = totalsOf(results);
  const out: string[] = [];

  out.push('# Scraping test run');
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Run date | ${report.startedAt.toISOString()} (local ${report.startedAt.toString()}) |`);
  out.push(`| Finished | ${finishedAt.toISOString()} after ${seconds}s |`);
  out.push('| Target | `src/main.ts` (no database, no network) |');
  out.push(`| Suites | ${context.suites.join(', ')} |`);
  out.push(`| Fixtures | ${context.fixtures} captured API responses |`);
  out.push(`| Commit | \`${commit()}\` |`);
  out.push(`| Node | ${process.version} |`);
  out.push(`| Timezone | ${process.env.TZ ?? 'unset'} |`);
  out.push(`| Result | **${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped** |`);
  out.push('');
  out.push(
    'Every check below records the moment it ran and, when it failed, the assertion that judged ' +
      'it. The suites run the real `GenericFetchAndSaveBackend` against recorders standing in for ' +
      'axios, pg, redis and the clock, so nothing here reached a database or the game API.',
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
      out.push(
        `| ${results.indexOf(f) + 1} | ${f.suite} | ${cell(f.name)} | ${cell(f.expected ?? '-')} | ${cell(f.actual ?? f.detail ?? '-')} |`,
      );
    }
    out.push('');
  }

  out.push(
    config.trace.failuresOnly ? '## Every failing check, in the order it ran' : '## Every check, in the order it ran',
  );
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
  results.forEach((r, i) => {
    if (config.trace.failuresOnly && r.ok) return;
    if (r.suite !== current) {
      current = r.suite;
      out.push(`## Suite: ${current}`);
      out.push('');
    }
    out.push(...renderCheck(r, i + 1));
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
            target: 'src/main.ts',
            suites: context.suites,
            fixtures: context.fixtures,
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
