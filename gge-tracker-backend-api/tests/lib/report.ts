/**
 * Result collection and terminal reporting
 */
import { config } from '../config';

export interface CheckResult {
  suite: string;
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
  ms?: number;
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

  expect(name: string, outcome: boolean | { ok: boolean; detail?: string }, ms?: number): boolean {
    const ok = typeof outcome === 'boolean' ? outcome : outcome.ok;
    const detail = typeof outcome === 'boolean' ? undefined : outcome.detail;
    this.report.add({ suite: this.name, name, ok, detail, ms });
    return ok;
  }

  skip(name: string, detail: string): void {
    this.report.add({ suite: this.name, name, ok: true, skipped: true, detail });
  }
}

export class Report {
  private results: CheckResult[] = [];
  private timings: { label: string; p50: number; p95: number; p99: number; budget?: number; ok?: boolean }[] = [];

  section(name: string): Section {
    return new Section(this, name);
  }

  add(result: CheckResult): void {
    this.results.push(result);
    if (config.verbose || (!result.ok && !result.skipped)) {
      this.printLine(result);
    }
  }

  addTiming(row: { label: string; p50: number; p95: number; p99: number; budget?: number; ok?: boolean }): void {
    this.timings.push(row);
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
