//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
//  Result collection and terminal reporting
//
import { config } from '../config';

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
  diagnostic?: string;
}

export interface Outcomeish {
  ok: boolean;
  detail?: string;
  expected?: string;
  actual?: string;
  diagnostic?: string;
}

const c = {
  reset: '[0m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  gray: '[90m',
  bold: '[1m',
};

export class Section {
  constructor(
    private readonly report: Report,
    public readonly name: string,
  ) {}

  public expect(name: string, outcome: boolean | Outcomeish, ms?: number): boolean {
    const ok = typeof outcome === 'boolean' ? outcome : outcome.ok;
    const detail = typeof outcome === 'boolean' ? undefined : outcome.detail;
    const expected = typeof outcome === 'boolean' ? undefined : outcome.expected;
    const actual = typeof outcome === 'boolean' ? undefined : outcome.actual;
    const diagnostic = typeof outcome === 'boolean' ? undefined : outcome.diagnostic;
    this.report.add({
      suite: this.name,
      name,
      ok,
      detail,
      ms,
      expected,
      actual,
      diagnostic,
      at: new Date().toISOString(),
    });
    return ok;
  }

  public skip(name: string, detail: string): void {
    this.report.add({ suite: this.name, name, ok: true, skipped: true, detail, at: new Date().toISOString() });
  }
}

export class Report {
  public readonly startedAt = new Date();

  private results: CheckResult[] = [];

  public section(name: string): Section {
    return new Section(this, name);
  }

  public snapshot(): CheckResult[] {
    return this.results;
  }

  public add(result: CheckResult): void {
    this.results.push(result);
    if (config.verbose || (!result.ok && !result.skipped)) {
      this.printLine(result);
    }
  }

  public finish(): number {
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
        `  ${color}${suite.padEnd(22)}${c.reset} ${pass} passed` +
          (fail > 0 ? `, ${c.red}${fail} failed${c.reset}` : '') +
          (skip > 0 ? `, ${c.yellow}${skip} skipped${c.reset}` : ''),
      );
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
        ? `${c.green}${c.bold}✓ Scraping OK - ${totalPass} checks passed${totalSkip ? `, ${totalSkip} skipped` : ''}${c.reset}`
        : `${c.red}${c.bold}✗ ${totalFail} check(s) FAILED${c.reset} ${c.gray}(${totalPass} passed)${c.reset}`;
    console.log(`\n${verdict}\n`);

    return totalFail === 0 ? 0 : 1;
  }

  private printLine(r: CheckResult): void {
    const tag = r.skipped ? `${c.yellow}SKIP${c.reset}` : r.ok ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
    const detail = r.detail ? ` ${c.gray}- ${r.detail}${c.reset}` : '';
    console.log(`  ${tag} ${c.gray}[${r.suite}]${c.reset} ${r.name}${detail}`);
  }
}
