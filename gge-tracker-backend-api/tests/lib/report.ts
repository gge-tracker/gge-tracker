/**
 * Result collection and terminal reporting
 */
import { config } from '../config';
import { Exchange, drain } from './journal';

export interface CheckResult {
  suite: string;
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
  ms?: number;
  at: string;
  expected?: string;
  actual?: string;
  exchanges?: Exchange[];
  exchangeCount?: number;
  exchangesShared?: boolean;
}

export interface Outcomeish {
  ok: boolean;
  detail?: string;
  expected?: string;
  actual?: string;
}

const c = {
  reset: '[0m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  blue: '[34m',
  gray: '[90m',
  bold: '[1m',
};

export class Section {
  constructor(
    private readonly report: Report,
    public readonly name: string,
  ) {}

  expect(name: string, outcome: boolean | Outcomeish, ms?: number): boolean {
    const ok = typeof outcome === 'boolean' ? outcome : outcome.ok;
    const detail = typeof outcome === 'boolean' ? undefined : outcome.detail;
    const expected = typeof outcome === 'boolean' ? undefined : outcome.expected;
    const actual = typeof outcome === 'boolean' ? undefined : outcome.actual;
    this.report.add({ suite: this.name, name, ok, detail, ms, expected, actual, at: new Date().toISOString() });
    return ok;
  }

  skip(name: string, detail: string): void {
    this.report.add({ suite: this.name, name, ok: true, skipped: true, detail, at: new Date().toISOString() });
  }
}

export class Report {
  private results: CheckResult[] = [];
  private timings: { label: string; p50: number; p95: number; p99: number; budget?: number; ok?: boolean }[] = [];
  readonly startedAt = new Date();
  private lastExchanges: { entries: Exchange[]; total: number; suite: string } | undefined;

  section(name: string): Section {
    return new Section(this, name);
  }

  snapshot(): CheckResult[] {
    return this.results;
  }

  private attach(result: CheckResult): void {
    if (!config.trace.enabled) return;
    const fresh = drain();
    if (fresh.total > 0) {
      this.lastExchanges = { ...fresh, suite: result.suite };
    } else if (!this.lastExchanges || this.lastExchanges.suite !== result.suite) {
      return;
    } else {
      result.exchangesShared = true;
    }
    const group = this.lastExchanges;
    if (!group) return;
    const seen = new Set<string>();
    const distinct = group.entries.filter((x) => {
      const key = `${x.method} ${x.path} ${x.status}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    result.exchanges = distinct.slice(0, config.trace.maxExchangesPerCheck);
    result.exchangeCount = group.total;
  }

  add(result: CheckResult): void {
    this.attach(result);
    this.results.push(result);
    if (config.verbose || (!result.ok && !result.skipped)) {
      this.printLine(result);
    }
  }

  addTiming(row: { label: string; p50: number; p95: number; p99: number; budget?: number; ok?: boolean }): void {
    this.timings.push(row);
  }

  timingRows(): { label: string; p50: number; p95: number; p99: number; budget?: number; ok?: boolean }[] {
    return this.timings;
  }

  private printLine(r: CheckResult): void {
    const tag = r.skipped
      ? `${c.yellow}SKIP${c.reset}`
      : r.ok
        ? `${c.green}PASS${c.reset}`
        : `${c.red}FAIL${c.reset}`;
    const detail = r.detail ? ` ${c.gray}- ${r.detail}${c.reset}` : '';
    console.log(`  ${tag} ${c.gray}[${r.suite}]${c.reset} ${r.name}${detail}`);
  }

  finish(): number {
    const bySuite = new Map<string, CheckResult[]>();
    for (const r of this.results) {
      if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
      bySuite.get(r.suite)!.push(r);
    }

    console.log(`\n${c.bold}══════════════ SUMMARY ══════════════${c.reset}`);
    let totalPass = 0;
    let totalFail = 0;
    let totalSkip = 0;
    for (const [suite, rows] of bySuite) {
      const pass = rows.filter((r) => r.ok && !r.skipped).length;
      const fail = rows.filter((r) => !r.ok).length;
      const skip = rows.filter((r) => r.skipped).length;
      totalPass += pass;
      totalFail += fail;
      totalSkip += skip;
      const color = fail > 0 ? c.red : c.green;
      console.log(
        `  ${color}${suite.padEnd(12)}${c.reset} ${pass} passed` +
          (fail > 0 ? `, ${c.red}${fail} failed${c.reset}` : '') +
          (skip > 0 ? `, ${c.yellow}${skip} skipped${c.reset}` : ''),
      );
    }

    if (this.timings.length > 0) {
      console.log(`\n${c.bold}Response times (ms)${c.reset}  ${c.gray}p50 / p95 / p99 (budget)${c.reset}`);
      for (const t of this.timings) {
        const color = t.ok === false ? c.red : c.gray;
        const budget = t.budget ? ` (${t.budget})` : '';
        console.log(
          `  ${color}${t.label.padEnd(46)}${c.reset} ${t.p50.toFixed(0)} / ${t.p95.toFixed(0)} / ${t.p99.toFixed(0)}${budget}`,
        );
      }
    }

    const failures = this.results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.log(`\n${c.red}${c.bold}FAILURES:${c.reset}`);
      for (const f of failures) {
        console.log(`  ${c.red}✗${c.reset} [${f.suite}] ${f.name}${f.detail ? ` - ${f.detail}` : ''}`);
      }
    }

    const verdict =
      totalFail === 0
        ? `${c.green}${c.bold}✓ API OK - ${totalPass} checks passed${totalSkip ? `, ${totalSkip} skipped` : ''}${c.reset}`
        : `${c.red}${c.bold}✗ ${totalFail} check(s) FAILED${c.reset} ${c.gray}(${totalPass} passed)${c.reset}`;
    console.log(`\n${verdict}\n`);

    return totalFail === 0 ? 0 : 1;
  }
}
