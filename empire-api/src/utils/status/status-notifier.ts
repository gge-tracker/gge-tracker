import { buildStatusEmbed, DiscordEmbed, ServerSnapshot, StatusFamily, StatusReport } from './status-message.js';
import { ServerDirectory } from './server-directory.js';
import { ServerObservation, StatusTracker, StatusTransition } from './status-tracker.js';

export interface StatusSocket {
  connected: { isSet: boolean };
  metricsLabels: { server: string; type: string };
  downReason: string | null;
  nextAttemptAtMs: number | null;
}

export interface StatusNotifierOptions {
  bridge: string;
  pollMs: number;
  settleMs: number;
  batchMs: number;
  startupGraceMs: number;
  reminderMs: number;
  retryMs: number;
  serversFile: string;
  send: (embed: DiscordEmbed) => Promise<void>;
  now?: () => number;
}

function readEnvironmentInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isNaN(parsed) ? fallback : parsed;
}

const SEND_TIMEOUT_MS = 10_000;

/**
 * Posts every lasting change of the bridge's sockets
 */
export class StatusNotifier {
  private readonly tracker: StatusTracker;
  private readonly directory: ServerDirectory;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private started = false;
  private lastSentAtMs = 0;
  private lastFailureAtMs = Number.NEGATIVE_INFINITY;
  private sending = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sockets: Record<string, StatusSocket>,
    private readonly options: StatusNotifierOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.startedAtMs = this.now();
    this.directory = new ServerDirectory(options.serversFile);
    this.tracker = new StatusTracker({
      settleMs: options.settleMs,
      batchMs: options.batchMs,
      graceMs: options.startupGraceMs,
    });
  }

  public static fromEnvironment(sockets: Record<string, StatusSocket>): StatusNotifier | null {
    const send = StatusNotifier.discordSender();
    if (!send) {
      console.log('[status] No STATUS_DISCORD_API_URL or STATUS_DISCORD_WEBHOOK_URL: status notifications are off.');
      return null;
    }
    return new StatusNotifier(sockets, {
      bridge: process.env.API_TYPE?.toLowerCase() === 'realtime' ? 'realtime' : 'standard',
      pollMs: readEnvironmentInteger('STATUS_POLL_MS', 10_000),
      settleMs: readEnvironmentInteger('STATUS_SETTLE_MS', 60_000),
      batchMs: readEnvironmentInteger('STATUS_BATCH_MS', 60_000),
      startupGraceMs: readEnvironmentInteger('STATUS_STARTUP_GRACE_MS', 180_000),
      reminderMs: readEnvironmentInteger('STATUS_REMINDER_MS', 6 * 60 * 60 * 1000),
      retryMs: 60_000,
      serversFile: process.env.SERVERS_FILE ?? '/app/servers/servers.xml',
      send,
    });
  }

  public start(): void {
    this.timer = setInterval(() => void this.tick(), this.options.pollMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(): Promise<void> {
    if (this.sending) return;
    const nowMs = this.now();
    if (nowMs - this.lastFailureAtMs < this.options.retryMs) return;
    const observations = this.observe();
    if (!this.started) {
      if (nowMs - this.startedAtMs < this.options.startupGraceMs) return;
      this.tracker.adopt(observations, nowMs);
      this.started = true;
      if (observations.length > 0) await this.publish(this.report('startup', nowMs, [], []), []);
      return;
    }
    const transitions = this.tracker.observe(observations, nowMs);
    if (transitions.length > 0) {
      const wentDown = transitions.filter((transition) => !transition.up);
      const cameUp = transitions.filter((transition) => transition.up);
      await this.publish(this.report('change', nowMs, wentDown, cameUp), transitions);
      return;
    }
    const reminderDue = this.options.reminderMs > 0 && nowMs - this.lastSentAtMs >= this.options.reminderMs;
    if (reminderDue && this.tracker.reportedDown().length > 0)
      await this.publish(this.report('reminder', nowMs, [], []), []);
  }

  private observe(): ServerObservation[] {
    return Object.entries(this.sockets).map(([server, socket]) => ({ server, up: socket.connected.isSet }));
  }

  private async publish(report: StatusReport, transitions: StatusTransition[]): Promise<void> {
    this.sending = true;
    try {
      await this.options.send(buildStatusEmbed(report));
      this.tracker.commit(transitions);
      this.lastSentAtMs = report.nowMs;
    } catch (error) {
      this.lastFailureAtMs = report.nowMs;
      console.warn('[status] Discord notification failed:', error instanceof Error ? error.message : error);
    } finally {
      this.sending = false;
    }
  }

  private report(
    kind: StatusReport['kind'],
    nowMs: number,
    wentDown: StatusTransition[],
    cameUp: StatusTransition[],
  ): StatusReport {
    const changes = new Map([...wentDown, ...cameUp].map((transition) => [transition.server, transition]));
    const reportedDown = new Set(this.tracker.reportedDown());
    const servers = Object.entries(this.sockets).map(([zone, socket]): ServerSnapshot => {
      const change = changes.get(zone);
      const up = change ? change.up : !reportedDown.has(zone);
      const downSinceMs = up ? null : change ? change.atMs : (this.tracker.downSinceMs(zone) ?? this.startedAtMs);
      const identity = this.directory.identify(zone);
      return {
        zone,
        name: identity?.name ?? null,
        family: StatusNotifier.familyOf(identity?.kind, socket.metricsLabels.type),
        up,
        reason: up ? null : socket.downReason,
        nextAttemptAtMs: up ? null : socket.nextAttemptAtMs,
        downSinceMs,
      };
    });
    return { kind, bridge: this.options.bridge, nowMs, servers, wentDown, cameUp };
  }

  private static familyOf(kind: string | undefined, socketType: string): StatusFamily {
    if (kind === 'ep' || kind === 'partner' || kind === 'e4k') return kind;
    if (socketType === 'E4K') return 'e4k';
    return socketType === 'LIVE' ? 'live' : 'ep';
  }

  private static discordSender(): ((embed: DiscordEmbed) => Promise<void>) | null {
    const apiUrl = process.env.STATUS_DISCORD_API_URL;
    const channelId = process.env.STATUS_DISCORD_CHANNEL_ID;
    const webhookUrl = process.env.STATUS_DISCORD_WEBHOOK_URL;
    if (apiUrl && channelId) return (embed) => StatusNotifier.post(apiUrl, { channelId, embeds: [embed] });
    if (webhookUrl) return (embed) => StatusNotifier.post(webhookUrl, { embeds: [embed] });
    return null;
  }

  private static async post(url: string, body: unknown): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
}
