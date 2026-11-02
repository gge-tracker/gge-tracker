export interface ServerObservation {
  server: string;
  up: boolean;
}

export interface StatusTransition {
  server: string;
  up: boolean;
  atMs: number;
  previousSinceMs: number;
}

interface TrackedState {
  up: boolean;
  sinceMs: number;
}

export interface StatusTrackerOptions {
  settleMs: number;
  batchMs: number;
  graceMs: number;
}

export class StatusTracker {
  private readonly reported = new Map<string, TrackedState>();
  private readonly pending = new Map<string, TrackedState>();
  private readonly firstSeenMs = new Map<string, number>();
  private batchOpenedAtMs: number | null = null;

  constructor(private readonly options: StatusTrackerOptions) {}

  public adopt(observations: ServerObservation[], nowMs: number): void {
    this.reported.clear();
    this.pending.clear();
    this.batchOpenedAtMs = null;
    for (const { server, up } of observations) {
      this.reported.set(server, { up, sinceMs: nowMs });
      this.firstSeenMs.set(server, nowMs - this.options.graceMs);
    }
  }

  public observe(observations: ServerObservation[], nowMs: number): StatusTransition[] {
    this.forgetRemoved(observations);
    for (const observation of observations) this.track(observation, nowMs);
    return this.ready(nowMs);
  }

  public commit(transitions: StatusTransition[]): void {
    for (const transition of transitions) {
      this.reported.set(transition.server, { up: transition.up, sinceMs: transition.atMs });
      this.pending.delete(transition.server);
    }
    this.batchOpenedAtMs = null;
  }

  public downSinceMs(server: string): number | null {
    const state = this.reported.get(server);
    return state && !state.up ? state.sinceMs : null;
  }

  public reportedDown(): string[] {
    return [...this.reported].filter(([, state]) => !state.up).map(([server]) => server);
  }

  private track({ server, up }: ServerObservation, nowMs: number): void {
    if (!this.firstSeenMs.has(server)) this.firstSeenMs.set(server, nowMs);
    if (!this.reported.has(server)) this.reported.set(server, { up: true, sinceMs: nowMs });
    if (nowMs - this.firstSeenMs.get(server) < this.options.graceMs) return;
    if (this.reported.get(server).up === up) {
      this.pending.delete(server);
      return;
    }
    if (this.pending.get(server)?.up !== up) this.pending.set(server, { up, sinceMs: nowMs });
  }

  private ready(nowMs: number): StatusTransition[] {
    const settled = [...this.pending].filter(([, state]) => nowMs - state.sinceMs >= this.options.settleMs);
    if (settled.length === 0) {
      this.batchOpenedAtMs = null;
      return [];
    }
    this.batchOpenedAtMs ??= nowMs;
    const stillSettling = settled.length < this.pending.size;
    if (stillSettling && nowMs - this.batchOpenedAtMs < this.options.batchMs) return [];
    return settled.map(([server, state]) => ({
      server,
      up: state.up,
      atMs: state.sinceMs,
      previousSinceMs: this.reported.get(server).sinceMs,
    }));
  }

  private forgetRemoved(observations: ServerObservation[]): void {
    const present = new Set(observations.map((observation) => observation.server));
    for (const server of [...this.reported.keys()]) {
      if (present.has(server)) continue;
      this.reported.delete(server);
      this.pending.delete(server);
      this.firstSeenMs.delete(server);
    }
  }
}
