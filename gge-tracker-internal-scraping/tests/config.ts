//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
//  Central configuration for the scraping test harness. The switches mirror the ones the API
//  harness reads, so the two behave the same way from a terminal.
//
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
  verbose: process.env.TEST_VERBOSE === '1' || process.argv.includes('--verbose'),
  timeoutMs: envInt('TEST_TIMEOUT_MS', 60_000),
  trace: {
    enabled: process.env.TEST_TRACE !== '0' && !process.argv.includes('--no-trace'),
    dir: envStr('TEST_TRACE_DIR', '.trace'),
    file: envStr('TEST_TRACE_FILE', ''),
    json: process.env.TEST_TRACE_JSON === '1',
    failuresOnly: process.env.TEST_TRACE_FAILURES === '1',
    maxDetailChars: envInt('TEST_TRACE_DETAIL_CHARS', 4000),
  },
} as const;

export type Config = typeof config;
