import {
  ApiHonorActivity,
  ApiVicinity,
  ApiVicinityEvent,
  ApiVicinityNeighbour,
} from '@ggetracker-interfaces/empire-ranking';

export type VicinityWindow = '24h' | '7d';
export type FeedCategory = 'castles' | 'alliances' | 'activity';
export type FeedTone = 'threat' | 'opportunity' | 'info';

export interface FeedEntry {
  key: string;
  message: string;
  params: Record<string, string | number>;
  category: FeedCategory;
  tone: FeedTone;
  icon: string;
  at: number;
  playerId: string | null;
  playerName: string | null;
  allianceName: string | null;
  isAlly: boolean;
  distance: number | null;
  origin: number | null;
  castleType: number | null;
}

export interface FeedOptions {
  window: VicinityWindow;
  now: number;
  hideAllies: boolean;
  origin: number | null;
}

export const WINDOW_MS: Record<VicinityWindow, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000 };

// Consecutive hourly readings, w a little slack for a late fill
const SPIKE_JOIN_MS = 70 * 60_000;

export function buildFeed(vicinity: ApiVicinity, options: FeedOptions): FeedEntry[] {
  const since = options.now - WINDOW_MS[options.window];
  const entries = [
    ...vicinity.events
      .filter((event) => event.type !== 'might_spike')
      .map((event) => entryOf(event, vicinity.radius))
      .filter((entry): entry is FeedEntry => entry !== null),
    ...mightEntries(
      vicinity.events.filter((event) => event.type === 'might_spike' && Date.parse(event.occurred_at) >= since),
    ),
    ...honorEntries(vicinity.neighbours, options.window),
  ];
  return entries
    .filter((entry) => entry.at >= since)
    .filter((entry) => options.origin === null || entry.origin === options.origin)
    .filter((entry) => !options.hideAllies || !entry.isAlly || concernsMe(entry))
    .sort((a, b) => b.at - a.at);
}

export function honorOf(neighbour: ApiVicinityNeighbour, window: VicinityWindow): ApiHonorActivity {
  return window === '24h' ? neighbour.honor_24h : neighbour.honor_7d;
}

export function mightChangeOf(neighbour: ApiVicinityNeighbour, window: VicinityWindow): number | null {
  return window === '24h' ? neighbour.might_change_24h : neighbour.might_change_7d;
}

function concernsMe(entry: FeedEntry): boolean {
  return ['left-my-alliance', 'joined-my-alliance', 'captured-from-me'].some((message) =>
    entry.message.includes(message),
  );
}

function base(event: ApiVicinityEvent): Omit<FeedEntry, 'key' | 'message' | 'params' | 'category' | 'tone' | 'icon'> {
  return {
    at: Date.parse(event.occurred_at),
    playerId: event.player_id,
    playerName: event.player_name,
    allianceName: event.alliance_name,
    isAlly: event.is_ally,
    distance: event.distance,
    origin: event.origin,
    castleType: event.castle_type ?? null,
  };
}

function entryOf(event: ApiVicinityEvent, radius: number): FeedEntry | null {
  const shared = base(event);
  const make = (message: string, category: FeedCategory, tone: FeedTone, icon: string, parameters = {}): FeedEntry => ({
    ...shared,
    key: `${event.type}:${event.player_id}:${event.occurred_at}`,
    message: `vicinity.event.${message}`,
    params: parameters,
    category,
    tone,
    icon,
  });
  const hostile = (tone: FeedTone): FeedTone => (event.is_ally ? 'info' : tone);
  switch (event.type) {
    case 'castle_captured': {
      const owner = event.previous_owner;
      if (owner?.is_me) return make('captured-from-me', 'castles', 'threat', 'fa-solid fa-flag');
      return make(
        owner?.is_ally ? 'captured-from-ally' : 'captured',
        'castles',
        owner?.is_ally ? 'threat' : hostile('threat'),
        'fa-solid fa-flag',
        {
          previous: owner?.player_name ?? '?',
        },
      );
    }
    case 'castle_founded': {
      return make('founded', 'castles', hostile('threat'), 'fa-solid fa-chess-rook');
    }
    case 'castle_relocated': {
      return relocationEntry(event, radius, make, hostile);
    }
    case 'castle_vanished': {
      return { ...make('vanished', 'castles', 'opportunity', 'fa-solid fa-ghost'), distance: event.distance };
    }
    case 'player_appeared': {
      return make(event.new_account ? 'new-player' : 'returned', 'castles', 'info', 'fa-solid fa-user-plus');
    }
    case 'alliance_changed': {
      return allianceEntry(event, make);
    }
    case 'player_renamed': {
      return make('renamed', 'alliances', 'info', 'fa-solid fa-signature', { previous: event.old_name ?? '' });
    }
    case 'protection_started': {
      return make('protection-started', 'activity', 'info', 'fa-solid fa-shield-halved');
    }
    case 'protection_ended': {
      return event.ended_early
        ? make('protection-broken', 'activity', hostile('threat'), 'fa-solid fa-shield-virus')
        : make('protection-expired', 'activity', 'opportunity', 'fa-solid fa-shield');
    }
    case 'ruin_started': {
      return make('ruin-started', 'activity', 'opportunity', 'fa-solid fa-house-crack');
    }
    case 'ruin_ended': {
      return make('ruin-ended', 'activity', 'info', 'fa-solid fa-house-chimney');
    }
    default: {
      return null;
    }
  }
}

function relocationEntry(
  event: ApiVicinityEvent,
  radius: number,
  make: (message: string, category: FeedCategory, tone: FeedTone, icon: string, parameters?: object) => FeedEntry,
  hostile: (tone: FeedTone) => FeedTone,
): FeedEntry | null {
  const now = event.distance ?? Number.POSITIVE_INFINITY;
  const before = event.previous_distance ?? Number.POSITIVE_INFINITY;
  if (now <= radius && before > radius)
    return make('relocated-in', 'castles', hostile('threat'), 'fa-solid fa-truck-moving');
  if (before <= radius && now > radius) {
    return {
      ...make('relocated-out', 'castles', 'info', 'fa-solid fa-person-walking-arrow-right'),
      distance: before,
      origin: event.previous_origin ?? null,
    };
  }
  if (now <= radius) {
    return make('relocated-within', 'castles', hostile(now < before ? 'threat' : 'info'), 'fa-solid fa-truck-moving', {
      before: before,
    });
  }
  return null;
}

function allianceEntry(
  event: ApiVicinityEvent,
  make: (message: string, category: FeedCategory, tone: FeedTone, icon: string, parameters?: object) => FeedEntry,
): FeedEntry {
  const from = event.old_alliance_name ?? '';
  const to = event.new_alliance_name ?? '';
  if (event.left_my_alliance) {
    return make(
      to ? 'left-my-alliance-for' : 'left-my-alliance',
      'alliances',
      'threat',
      'fa-solid fa-person-walking-arrow-right',
      { to },
    );
  }
  if (event.joined_my_alliance)
    return make('joined-my-alliance', 'alliances', 'info', 'fa-solid fa-handshake', { from });
  if (event.new_alliance_id === null)
    return make('left-alliance', 'alliances', 'opportunity', 'fa-solid fa-user-minus', { from });
  if (event.old_alliance_id === null)
    return make('joined-alliance', 'alliances', 'info', 'fa-solid fa-user-group', { to });
  return make('switched-alliance', 'alliances', 'info', 'fa-solid fa-right-left', { from, to });
}

function mightEntries(spikes: ApiVicinityEvent[]): FeedEntry[] {
  const byPlayer = new Map<string, ApiVicinityEvent[]>();
  for (const spike of spikes) {
    const key = String(spike.player_id);
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), spike]);
  }
  // One story per player: a single run of same-signed hours reads as "+18M in 3 h", anything else as swings
  return [...byPlayer.values()].map((group): FeedEntry => {
    const ordered = [...group].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    const latest = ordered.at(-1)!;
    const change = ordered.reduce((sum, spike) => sum + (spike.change ?? 0), 0);
    const peak = ordered.reduce(
      (largest, spike) => (Math.abs(spike.change ?? 0) > Math.abs(largest) ? (spike.change ?? 0) : largest),
      0,
    );
    const rising = change > 0;
    const shared = {
      ...base(latest),
      key: `might:${latest.player_id}:${ordered[0].occurred_at}`,
      category: 'activity' as const,
      tone: (rising && !latest.is_ally ? 'threat' : 'info') as FeedTone,
    };
    if (isSingleRun(ordered)) {
      return {
        ...shared,
        message: latest.typical_hourly_change
          ? `vicinity.event.${rising ? 'might-up' : 'might-down'}`
          : 'vicinity.event.might-change-plain',
        params: { change, hours: ordered.length, typical: latest.typical_hourly_change ?? 0 },
        icon: rising ? 'fa-solid fa-arrow-trend-up' : 'fa-solid fa-arrow-trend-down',
      };
    }
    return {
      ...shared,
      message: 'vicinity.event.might-swings',
      params: { count: ordered.length, change, peak },
      icon: 'fa-solid fa-chart-line',
    };
  });
}

function isSingleRun(ordered: ApiVicinityEvent[]): boolean {
  return ordered.every((spike, index) => {
    if (index === 0) return true;
    const previous = ordered[index - 1];
    return (
      Math.sign(previous.change ?? 0) === Math.sign(spike.change ?? 0) &&
      Date.parse(spike.occurred_at) - Date.parse(previous.occurred_at) <= SPIKE_JOIN_MS
    );
  });
}

function honorEntries(neighbours: ApiVicinityNeighbour[], window: VicinityWindow): FeedEntry[] {
  return neighbours
    .filter((neighbour) => honorOf(neighbour, window).changes > 0 && neighbour.last_honor_change_at)
    .map((neighbour) => {
      const honor = honorOf(neighbour, window);
      const net = honor.gained - honor.lost;
      const castle = neighbour.castles[0];
      return {
        key: `honor:${neighbour.player_id}`,
        message: 'vicinity.event.honor',
        params: { net, changes: honor.changes },
        category: 'activity',
        tone: !neighbour.is_ally && net > 0 ? 'threat' : 'info',
        icon: 'fa-solid fa-medal',
        at: Date.parse(neighbour.last_honor_change_at!),
        playerId: neighbour.player_id,
        playerName: neighbour.player_name,
        allianceName: neighbour.alliance_name,
        isAlly: neighbour.is_ally,
        distance: neighbour.distance,
        origin: neighbour.origin,
        castleType: castle?.castle_type ?? null,
      } satisfies FeedEntry;
    });
}
