process.env.EMPIRE_RECONNECT_BASE_DELAY_SEC ??= '0';
process.env.EMPIRE_RECONNECT_JITTER_SEC ??= '0';
process.env.EMPIRE_RECONNECT_PRESLEEP_MS ??= '50';

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
  // How long to wait for a single socket to reach the CONNECTED state
  connectTimeoutMs: envInt('TEST_CONNECT_TIMEOUT_MS', 15_000),
  // How long to wait for an automatic reconnection to complete after a forced drop
  reconnectTimeoutMs: envInt('TEST_RECONNECT_TIMEOUT_MS', 10_000),
  // Polling interval
  pollIntervalMs: envInt('TEST_POLL_INTERVAL_MS', 25),
  // Memory / leak suite
  memory: {
    churnIterations: envInt('TEST_MEM_CHURN', 120),
    pingDrainMs: envInt('TEST_MEM_PING_DRAIN_MS', 6_000),
    transmissionMessages: envInt('TEST_MEM_MESSAGES', 800),
    heapGrowthBudgetMb: envInt('TEST_MEM_HEAP_BUDGET_MB', 8),
    timerLeakBudget: envInt('TEST_MEM_TIMER_BUDGET', 5),
  },
  live: process.env.EMPIRE_TEST_LIVE === '1',
  liveConnectTimeoutMs: envInt('TEST_LIVE_CONNECT_TIMEOUT_MS', 90_000),
  serverDescriptionUrls: {
    EP: envStr('TEST_EP_XML_URL', 'https://gge-tracker.github.io/gge-cdn-mirror-files/1.xml'),
    SP: envStr('TEST_SP_XML_URL', 'https://gge-tracker.github.io/gge-cdn-mirror-files/39.xml'),
  },
  verbose: process.env.TEST_VERBOSE === '1' || process.argv.includes('--verbose'),
} as const;

export type Config = typeof config;
