//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import Utils from './utils';

export const DEFAULT_ALERT_AFTER_FAILURES = Number(process.env.ALERT_AFTER_FAILED_RUNS) || 5;

export interface WatchedServer {
  name: string;
  alertAfterFailures: number | null;
}

export class FailureStreaks {
  private readonly streaks = new Map<string, number>();

  constructor(
    private readonly job: string,
    private readonly identifier: string,
    private readonly defaultThreshold = DEFAULT_ALERT_AFTER_FAILURES,
  ) {}

  public recordSuccess(server: WatchedServer): void {
    const streak = this.streaks.get(server.name) ?? 0;
    this.streaks.delete(server.name);
    if (streak >= this.thresholdOf(server)) {
      Utils.logMessage(`${this.job} on ${server.name} recovered after ${streak} failed runs in a row`);
    }
  }

  public recordFailure(server: WatchedServer, reason: string): void {
    const streak = (this.streaks.get(server.name) ?? 0) + 1;
    this.streaks.set(server.name, streak);
    const threshold = this.thresholdOf(server);
    if (streak < threshold) return;
    Utils.logPersistentFailure(
      server.name,
      this.identifier,
      `${this.job} on ${server.name} failed ${threshold} runs in a row`,
      `${reason} (${streak} failed runs so far)`,
    );
  }

  public streakOf(server: WatchedServer): number {
    return this.streaks.get(server.name) ?? 0;
  }

  private thresholdOf(server: WatchedServer): number {
    return server.alertAfterFailures ?? this.defaultThreshold;
  }
}
