/**
 * Central configuration for the API test harness
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export const config = {
  baseUrl: envStr('TEST_API_BASE_URL', 'http://localhost:3002/api/v1'),
  server: envStr('TEST_SERVER', 'FR1'),
  specialServer: envStr('TEST_SPECIAL_SERVER', 'FR1'),
  unsupportedServer: envStr('TEST_UNSUPPORTED_SERVER', 'INT1'),
  requireSeeds: process.env.TEST_REQUIRE_SEEDS === '1',
  requestTimeoutMs: envInt('TEST_REQUEST_TIMEOUT_MS', 15_000),
  rateLimit: {
    points: envInt('RATE_LIMIT_POINTS', 30),
    durationSec: envInt('RATE_LIMIT_DURATION', 5),
  },
  timing: {
    samples: envInt('TEST_TIMING_SAMPLES', 12),
    p95BudgetMs: envInt('TEST_TIMING_P95_MS', 1500),
  },
  load: {
    concurrency: envInt('TEST_LOAD_CONCURRENCY', 25),
    rounds: envInt('TEST_LOAD_ROUNDS', 6),
  },
  resetOffset: {
    windowDays: envInt('TEST_RESET_OFFSET_DAYS', 60),
    minGaps: envInt('TEST_RESET_OFFSET_MIN_GAPS', 20),
    agreement: envFloat('TEST_RESET_OFFSET_AGREEMENT', 0.8),
    probeTimeoutMs: envInt('TEST_CLICKHOUSE_PROBE_MS', 3000),
    servers: envStr('TEST_RESET_OFFSET_SERVERS', ''),
  },
  verbose: process.env.TEST_VERBOSE === '1' || process.argv.includes('--verbose'),
  skipRateLimit: process.env.TEST_SKIP_RATELIMIT === '1',
  trace: {
    enabled: process.env.TEST_TRACE !== '0' && !process.argv.includes('--no-trace'),
    dir: envStr('TEST_TRACE_DIR', '.trace'),
    file: envStr('TEST_TRACE_FILE', ''),
    json: process.env.TEST_TRACE_JSON === '1',
    maxBodyChars: envInt('TEST_TRACE_BODY_CHARS', 1200),
    full: process.env.TEST_TRACE_FULL === '1',
    failuresOnly: process.env.TEST_TRACE_FAILURES === '1',
    maxExchangesPerCheck: envInt('TEST_TRACE_MAX_EXCHANGES', 3),
  },
} as const;

export type Config = typeof config;
