/**
 * Central configuration for the API test harness
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export const config = {
  baseUrl: envStr('TEST_API_BASE_URL', 'http://localhost:3000/api/v1'),
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
  verbose: process.env.TEST_VERBOSE === '1' || process.argv.includes('--verbose'),
  skipRateLimit: process.env.TEST_SKIP_RATELIMIT === '1',
} as const;

export type Config = typeof config;
