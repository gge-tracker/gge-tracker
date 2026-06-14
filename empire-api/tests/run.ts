/**
 * Orchestrator for the empire-api socket test harness
 */
import { config } from './config.js';
import { Report } from './lib/report.js';
import { runHandshake } from './suites/handshake.js';
import { runRoundtrip } from './suites/roundtrip.js';
import { runReconnect } from './suites/reconnect.js';
import { runLifecycle } from './suites/lifecycle.js';
import { runLogin } from './suites/login.js';
import { runMemory } from './suites/memory.js';
import { runLive } from './suites/live.js';

const SUITES: Record<string, (r: Report) => Promise<void>> = {
  handshake: runHandshake,
  roundtrip: runRoundtrip,
  lifecycle: runLifecycle,
  login: runLogin,
  reconnect: runReconnect,
  memory: runMemory,
  live: runLive,
};

const DEFAULT_SUITES = ['handshake', 'roundtrip', 'lifecycle', 'login', 'reconnect', 'memory', 'live'];

function parseSuites(argv: string[]): string[] {
  const names = argv.filter((a) => !a.startsWith('--'));
  if (names.length === 0) return DEFAULT_SUITES;
  if (names.includes('all')) return DEFAULT_SUITES;
  const invalid = names.filter((n) => !(n in SUITES));
  if (invalid.length > 0) {
    console.error(`Unknown suite(s): ${invalid.join(', ')}. Valid: ${Object.keys(SUITES).join(', ')}, all`);
    process.exit(2);
  }
  return names;
}

async function main(): Promise<void> {
  const requested = parseSuites(process.argv.slice(2));
  const report = new Report();

  console.log('\n  empire-api socket test harness');
  console.log(`  suites : ${requested.join(', ')}`);
  console.log(`  live   : ${config.live ? 'ON (real GGE servers)' : 'off (set EMPIRE_TEST_LIVE=1)'}`);
  console.log(
    `  timing : reconnect base=${process.env.EMPIRE_RECONNECT_BASE_DELAY_SEC}s ` +
      `jitter=${process.env.EMPIRE_RECONNECT_JITTER_SEC}s presleep=${process.env.EMPIRE_RECONNECT_PRESLEEP_MS}ms\n`,
  );

  for (const name of requested) {
    console.log(`▶ ${name}`);
    try {
      await SUITES[name](report);
    } catch (error) {
      report
        .section(name)
        .expect(`${name} suite crashed`, { ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  process.exit(report.finish());
}

main().catch((error) => {
  console.error('Fatal harness error:', error);
  process.exit(2);
});
