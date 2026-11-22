import { ApiVicinityEvent, ApiVicinityEventType } from '@ggetracker-interfaces/empire-ranking';

export interface OutdatedNote {
  message: string;
  params: Record<string, string>;
}

type StateFamily = 'alliance' | 'protection' | 'ruin' | 'presence';

const FAMILY: Partial<Record<ApiVicinityEventType, StateFamily>> = {
  alliance_changed: 'alliance',
  protection_started: 'protection',
  protection_ended: 'protection',
  ruin_started: 'ruin',
  ruin_ended: 'ruin',
  castle_vanished: 'presence',
  player_appeared: 'presence',
  castle_relocated: 'presence',
};

const PRESENCE_NOTE: Partial<Record<ApiVicinityEventType, string>> = {
  castle_vanished: 'vicinity.since.vanished',
  player_appeared: 'vicinity.since.back',
  castle_relocated: 'vicinity.since.moved',
};

export class OutdatedEvents {
  private readonly latest = new Map<string, ApiVicinityEvent>();

  constructor(events: ApiVicinityEvent[]) {
    for (const event of events) {
      const family = FAMILY[event.type];
      if (!family || !event.player_id) continue;
      const key = `${event.player_id}:${family}`;
      const current = this.latest.get(key);
      if (!current || event.occurred_at > current.occurred_at) this.latest.set(key, event);
    }
  }

  public noteFor(event: ApiVicinityEvent): OutdatedNote | null {
    const family = FAMILY[event.type];
    if (!family || !event.player_id) return null;
    const latest = this.latest.get(`${event.player_id}:${family}`)!;
    if (family === 'alliance') return this.allianceNote(event, latest);
    if (latest === event || latest.occurred_at === event.occurred_at) return null;
    if (family === 'protection')
      return this.note(latest.type === 'protection_started' ? 'protection-on' : 'protection-off');
    if (family === 'ruin') return this.note(latest.type === 'ruin_started' ? 'ruin-on' : 'ruin-off');
    const presence = PRESENCE_NOTE[latest.type];
    return presence ? { message: presence, params: {} } : null;
  }

  private allianceNote(event: ApiVicinityEvent, latest: ApiVicinityEvent): OutdatedNote | null {
    const stated = event.new_alliance_id ?? null;
    const current = latest === event ? (event.alliance_id ?? null) : (latest.new_alliance_id ?? null);
    if (stated === current) return null;
    const name = latest === event ? event.alliance_name : latest.new_alliance_name;
    return current === null ? this.note('alliance-none') : this.note('alliance-now', { alliance: name ?? '?' });
  }

  private note(key: string, parameters: Record<string, string> = {}): OutdatedNote {
    return { message: `vicinity.since.${key}`, params: parameters };
  }
}
