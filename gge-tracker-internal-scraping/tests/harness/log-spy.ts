//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import Utils from '../../src/utils';

type UtilsLogger =
  | 'logCritical'
  | 'logTolerated'
  | 'logWarning'
  | 'logPersistentFailure'
  | 'flushRunSummary'
  | 'logMessage';

export interface LogSpy {
  calls: Record<UtilsLogger, unknown[][]>;
  restore: () => void;
}

export function spyOnLogs(): LogSpy {
  const names: UtilsLogger[] = [
    'logCritical',
    'logTolerated',
    'logWarning',
    'logPersistentFailure',
    'flushRunSummary',
    'logMessage',
  ];
  const calls = Object.fromEntries(names.map((name) => [name, []])) as unknown as Record<UtilsLogger, unknown[][]>;
  const originals = names.map((name) => [name, (Utils as any)[name]] as const);
  for (const [name, original] of originals) {
    (Utils as any)[name] = (...args: unknown[]): void => {
      calls[name].push(args);
      original(...args);
    };
  }
  return {
    calls,
    restore: (): void => {
      for (const [name, original] of originals) (Utils as any)[name] = original;
    },
  };
}

export async function withLogSpy(body: (spy: LogSpy) => Promise<void> | void): Promise<void> {
  const spy = spyOnLogs();
  try {
    await body(spy);
  } finally {
    spy.restore();
  }
}
