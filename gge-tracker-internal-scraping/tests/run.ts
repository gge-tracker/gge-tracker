//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { run } from 'node:test';

import { config } from './config';
import { Report } from './lib/report';
import { writeTrace } from './lib/trace';

const SUITES_DIR = resolve(__dirname, 'suites');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

function suiteOf(file: string): string {
  return basename(file).replace(/\.test\.ts$/, '');
}

function allSuiteFiles(): string[] {
  return readdirSync(SUITES_DIR)
    .filter((file) => file.endsWith('.test.ts'))
    .sort()
    .map((file) => join(SUITES_DIR, file));
}

function parseSuites(argv: string[]): string[] {
  const names = argv.filter((a) => !a.startsWith('--'));
  const available = allSuiteFiles();
  if (names.length === 0 || names.includes('all')) return available;

  const bySuite = new Map(available.map((file) => [suiteOf(file), file]));
  const invalid = names.filter((n) => !bySuite.has(n));
  if (invalid.length) {
    console.error(`Unknown suite(s): ${invalid.join(', ')}. Valid: ${[...bySuite.keys()].join(', ')}, all`);
    process.exit(2);
  }
  return names.map((n) => bySuite.get(n)!);
}

function countFixtures(): number {
  try {
    return readdirSync(FIXTURES_DIR).filter((file) => file.endsWith('.json') && file !== 'identity-map.json').length;
  } catch {
    return 0;
  }
}

function summarise(error: any): string {
  if (error?.generatedMessage && error.operator) {
    const expected = inspect(error.expected);
    const actual = inspect(error.actual);
    return clip(`${error.operator}: expected ${clip(expected, 70)}, got ${clip(actual, 70)}`);
  }
  const [first] = String(error?.message ?? error ?? 'failed').split('\n');
  return clip(first.trim()) || 'failed';
}

function clip(text: string, limit = 160): string {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function fullDiagnostic(error: any): string | undefined {
  if (!error) return undefined;
  const message = String(error.message ?? error);
  const stack = error.stack ? String(error.stack) : '';
  return stack.startsWith(message) ? stack : [message, stack].filter(Boolean).join('\n\n');
}

async function runSuite(report: Report, file: string): Promise<void> {
  const section = report.section(suiteOf(file));
  const path: string[] = [];
  let crashed: string | undefined;

  const stream = run({ files: [file], concurrency: 1, timeout: config.timeoutMs });

  for await (const event of stream as AsyncIterable<any>) {
    const data = event.data ?? {};
    switch (event.type) {
      case 'test:start':
        path[data.nesting] = data.name;
        path.length = data.nesting + 1;
        break;

      case 'test:pass':
      case 'test:fail': {
        if (data.details?.type === 'suite') break;
        const ancestors = path.slice(0, data.nesting).filter(Boolean);
        const name = [...ancestors, data.name].join(' > ');
        const ms = data.details?.duration_ms;
        if (data.skip || data.todo) {
          section.skip(name, typeof data.skip === 'string' ? data.skip : 'skipped');
          break;
        }
        const failure = data.details?.error;
        const error = failure?.cause ?? failure;
        section.expect(
          name,
          {
            ok: event.type === 'test:pass',
            detail: error ? summarise(error) : undefined,
            expected: error && 'expected' in error ? inspect(error.expected) : undefined,
            actual: error && 'actual' in error ? inspect(error.actual) : undefined,
            diagnostic: fullDiagnostic(error),
          },
          ms,
        );
        break;
      }

      case 'test:stderr':
        if (typeof data.message === 'string' && data.message.trim()) crashed ??= data.message.trim();
        break;
    }
  }

  if (report.snapshot().every((r) => r.suite !== suiteOf(file))) {
    section.expect(`${suiteOf(file)} suite ran`, {
      ok: false,
      detail: crashed ? summarise({ message: crashed }) : 'the suite reported no checks',
      diagnostic: crashed,
    });
  }
}

function inspect(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function finishRun(report: Report, suites: string[], fixtures: number): number {
  const code = report.finish();
  const path = writeTrace(report, { suites, fixtures });
  if (path) console.log(`  trace  : ${path}\n`);
  return code;
}

async function main(): Promise<void> {
  const files = parseSuites(process.argv.slice(2));
  const suites = files.map(suiteOf);
  const fixtures = countFixtures();
  const report = new Report();

  console.log(`\n  GGE Tracker scraping test harness`);
  console.log(`  target : src/main.ts`);
  console.log(`  suites : ${suites.join(', ')}`);
  console.log(`  records: ${fixtures} captured API responses\n`);

  for (const file of files) {
    console.log(`▶ ${suiteOf(file)}`);
    try {
      await runSuite(report, file);
    } catch (error: any) {
      report.section(suiteOf(file)).expect(`${suiteOf(file)} suite crashed`, {
        ok: false,
        detail: summarise(error),
        diagnostic: fullDiagnostic(error),
      });
    }
  }

  process.exit(finishRun(report, suites, fixtures));
}

main().catch((error) => {
  console.error('Fatal harness error:', error);
  process.exit(2);
});
