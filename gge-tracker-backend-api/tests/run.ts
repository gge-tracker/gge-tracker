/**
 * Orchestrator for the gge-tracker API test harness
 * Please run this via `npm run test:api` from the project root
 */
import { config } from './config';
import { Report } from './lib/report';
import { writeTrace } from './lib/trace';
import { isCircuitOpen } from './lib/http';
import { discard as discardExchanges } from './lib/journal';
import { Seeds, bootstrap, describeSeeds, preflight } from './lib/bootstrap';
import { CATALOG } from './lib/catalog';
import { runCoverage } from './suites/coverage';
import { runOpenApi } from './suites/openapi';
import { runFunctional } from './suites/functional';
import { runSemantic } from './suites/semantic';
import { runOracle } from './suites/oracle';
import { runSnapshot } from './suites/snapshot';
import { runSecurity } from './suites/security';
import { runRobustness } from './suites/robustness';
import { runRateLimit } from './suites/ratelimit';
import { runTiming } from './suites/timing';
import { runLoad } from './suites/load';

const SUITES: Record<string, (r: Report, s: Awaited<ReturnType<typeof bootstrap>>) => Promise<void>> = {
  openapi: runOpenApi,
  coverage: runCoverage,
  functional: runFunctional,
  semantic: runSemantic,
  oracle: runOracle,
  snapshot: runSnapshot,
  security: runSecurity,
  robustness: runRobustness,
  ratelimit: runRateLimit,
  timing: runTiming,
  load: runLoad,
};

const ALL_SUITES = Object.keys(SUITES);
const DEFAULT_SUITES = ['openapi', 'coverage', 'functional', 'semantic', 'oracle', 'snapshot', 'security', 'robustness', 'ratelimit', 'timing'];

function parseSuites(argv: string[]): string[] {
  const names = argv.filter((a) => !a.startsWith('--'));
  if (names.length === 0) return DEFAULT_SUITES;
  if (names.includes('all')) return ALL_SUITES;
  const invalid = names.filter((n) => !(n in SUITES));
  if (invalid.length) {
    console.error(`Unknown suite(s): ${invalid.join(', ')}. Valid: ${Object.keys(SUITES).join(', ')}, all`);
    process.exit(2);
  }
  return names;
}

function finishRun(report: Report, suites: string[], seeds?: Seeds): number {
  const code = report.finish();
  const path = writeTrace(report, { suites, seeds });
  if (path) console.log(`  trace  : ${path}\n`);
  return code;
}

async function main(): Promise<void> {
  const requested = parseSuites(process.argv.slice(2));
  const report = new Report();

  console.log(`\n  GGE Tracker API test harness`);
  console.log(`  target : ${config.baseUrl}`);
  console.log(`  suites : ${requested.join(', ')}`);
  console.log(`  catalog: ${CATALOG.length} endpoints\n`);

  // Fail fast if the API is unreachable, with an actionable message
  const seeds = await bootstrap().catch(() => undefined);
  if (!seeds || !seeds.server) {
    console.log(`  seeds  : ${seeds ? describeSeeds(seeds) : 'bootstrap failed'}`);
    if (!seeds?.server) {
      console.warn(
        `\n  ⚠  Could not discover a valid server from GET /servers.\n` +
          `     Is the dev stack up? (docker-compose up, see root README) Target: ${config.baseUrl}\n` +
          `     Protected-route checks will be skipped; public checks still run.\n`,
      );
    }
  } else {
    console.log(`  seeds  : ${describeSeeds(seeds)}\n`);
  }

  const effectiveSeeds = seeds ?? { server: undefined, serverHeader: () => ({}) };

  discardExchanges();

  if (seeds?.server) {
    const section = report.section('preflight');
    const checks = await preflight(seeds, (check) => {
      section.expect(`${check.pool} is serving`, {
        ok: check.ok,
        detail: `${check.probe} -> ${check.detail}`,
        expected: `${check.probe} answers below 500 - every route backed by ${check.pool} depends on it`,
        actual: check.detail,
      });
    });
    const dead = checks.filter((c) => !c.ok);
    if (dead.length > 0) {
      console.warn(
        `\n  ⚠  ${dead.map((d) => d.pool).join(' and ')} not serving - every route behind ` +
          `${dead.length > 1 ? 'them' : 'it'} would fail for the same reason.\n` +
          `     Aborting instead of reporting the same cause hundreds of times.\n` +
          `     Try: docker restart backend-container\n`,
      );
      process.exit(finishRun(report, requested, seeds));
    }
  }

  for (const name of requested) {
    if (name === 'ratelimit' && config.skipRateLimit) {
      report.section('ratelimit').skip('rate-limit suite', 'TEST_SKIP_RATELIMIT=1');
      continue;
    }
    console.log(`▶ ${name}`);
    try {
      await SUITES[name](report, effectiveSeeds as any);
    } catch (error: any) {
      report.section(name).expect(`${name} suite crashed`, { ok: false, detail: error?.message ?? String(error) });
    }

    // If the API became unreachable mid-run, stop here and report it once instead of cascading failures
    if (isCircuitOpen()) {
      report
        .section('server-health')
        .expect('API stayed up for the whole run', {
          ok: false,
          detail: `API became UNREACHABLE during the "${name}" suite - likely an unhandled exception crashed the process. Check the backend logs (docker logs backend-container).`,
        });
      console.warn(`\n  ⚠  API became unreachable during "${name}" - aborting remaining suites.\n`);
      break;
    }
  }

  process.exit(finishRun(report, requested, seeds));
}

main().catch((error) => {
  console.error('Fatal harness error:', error);
  process.exit(2);
});
