import {
  ApiHonorActivity,
  ApiVicinity,
  ApiVicinityEvent,
  ApiVicinityNeighbour,
} from '@ggetracker-interfaces/empire-ranking';
import { OutdatedEvents, OutdatedNote } from './vicinity-outdated';

export type VicinityWindow = '24h' | '7d';
export type FeedCategory = 'castles' | 'alliances' | 'activity';
export type FeedTone = 'threat' | 'opportunity' | 'info';
export type FeedTrend = 'up' | 'down' | null;

export interface PlayerStanding {
  level: number;
  legendaryLevel: number;
  might: number | null;
}

export interface FeedEntry {
  key: string;
  message: string;
  params: Record<string, string | number>;
  category: FeedCategory;
  tone: FeedTone;
  icon: string;
  trend: FeedTrend;
  minor: boolean;
  outdated: OutdatedNote | null;
  standing: PlayerStanding | null;
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

const ICONS = {
  captured: '/assets/troop.png',
  capturedFromMe: '/assets/fire2.png',
  founded: '/assets/new-castle.png',
  relocated: '/assets/moving.png',
  vanished: '/assets/tools/movements.webp',
  appeared: '/assets/tools/players.webp',
  joined: '/assets/icon_alliance.png',
  switched: '/assets/tools/alliances.webp',
  left: '/assets/alliance.png',
  renamed: '/assets/tools/renames.webp',
  protectionStarted: '/assets/peace.png',
  protectionEnded: '/assets/icon_peace.png',
  ruin: '/assets/ruins.png',
  rebuilt: '/assets/construction.webp',
  might: '/assets/might.png',
  honor: '/assets/honor2.png',
} as const;

// Consecutive hourly readings, w a little slack for a late fill
const SPIKE_JOIN_MS = 70 * 60_000;

export function buildFeed(vicinity: ApiVicinity, options: FeedOptions): FeedEntry[] {
  const since = options.now - WINDOW_MS[options.window];
  const me = myStanding(vicinity);
  const outdated = new OutdatedEvents(vicinity.events);
  const entries = [
    ...vicinity.events
      .filter((event) => event.type !== 'might_spike')
      .map((event) => withOutdated(entryOf(event, vicinity.radius, me), outdated.noteFor(event)))
      .filter((entry): entry is FeedEntry => entry !== null),
    ...mightEntries(
      vicinity.events.filter((event) => event.type === 'might_spike' && Date.parse(event.occurred_at) >= since),
      me,
    ),
    ...honorEntries(vicinity.neighbours, options.window, me),
  ];
  return entries
    .filter((entry) => entry.at >= since)
    .filter((entry) => options.origin === null || entry.origin === options.origin)
    .filter((entry) => !options.hideAllies || !entry.isAlly || concernsMe(entry))
    .sort((a, b) => b.at - a.at);
}

export function isMinor(standing: PlayerStanding | null, me: PlayerStanding | null): boolean {
  if (standing === null || me === null) return false;
  return standing.level + standing.legendaryLevel < me.level + me.legendaryLevel;
}

export function myStanding(vicinity: ApiVicinity): PlayerStanding | null {
  return standingOf(vicinity.player.level, vicinity.player.legendary_level, null);
}

export function standingOf(
  level: number | null | undefined,
  legendaryLevel: number | null | undefined,
  might: number | null | undefined,
): PlayerStanding | null {
  if (level === null || level === undefined) return null;
  return { level, legendaryLevel: legendaryLevel ?? 0, might: might ?? null };
}

export function honorOf(neighbour: ApiVicinityNeighbour, window: VicinityWindow): ApiHonorActivity {
  return window === '24h' ? neighbour.honor_24h : neighbour.honor_7d;
}

export function mightChangeOf(neighbour: ApiVicinityNeighbour, window: VicinityWindow): number | null {
  return window === '24h' ? neighbour.might_change_24h : neighbour.might_change_7d;
}

const ABOUT_ME = ['left-my-alliance', 'joined-my-alliance', 'captured-from-me'];
const LEVEL_BLIND = [...ABOUT_ME, 'vanished'];

function withOutdated(entry: FeedEntry | null, note: OutdatedNote | null): FeedEntry | null {
  if (!entry || !note) return entry;
  return { ...entry, outdated: note, tone: 'info' };
}

function weaknessTone(rising: boolean, ignored: boolean): FeedTone {
  if (ignored) return 'info';
  return rising ? 'threat' : 'opportunity';
}

function concernsMessage(message: string): boolean {
  return ABOUT_ME.some((about) => message.startsWith(about));
}

function concernsMe(entry: FeedEntry): boolean {
  return concernsMessage(entry.message.replace('vicinity.event.', ''));
}

function base(
  event: ApiVicinityEvent,
): Omit<FeedEntry, 'key' | 'message' | 'params' | 'category' | 'tone' | 'icon' | 'trend' | 'minor' | 'outdated'> {
  return {
    standing: standingOf(event.level, event.legendary_level, event.might),
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

function entryOf(event: ApiVicinityEvent, radius: number, me: PlayerStanding | null): FeedEntry | null {
  const shared = base(event);
  const minor = isMinor(shared.standing, me);
  const make = (message: string, category: FeedCategory, tone: FeedTone, icon: string, parameters = {}): FeedEntry => {
    const dimmed = minor && !LEVEL_BLIND.some((kind) => message.startsWith(kind));
    return {
      ...shared,
      key: `${event.type}:${event.player_id}:${event.occurred_at}`,
      message: `vicinity.event.${message}`,
      params: parameters,
      category,
      tone: dimmed ? 'info' : tone,
      icon,
      trend: null,
      minor: dimmed,
      outdated: null,
    };
  };
  const hostile = (tone: FeedTone): FeedTone => (event.is_ally ? 'info' : tone);
  switch (event.type) {
    case 'castle_captured': {
      const owner = event.previous_owner;
      if (owner?.is_me) return make('captured-from-me', 'castles', 'threat', ICONS.capturedFromMe);
      return make(
        owner?.is_ally ? 'captured-from-ally' : 'captured',
        'castles',
        owner?.is_ally ? 'threat' : hostile('threat'),
        ICONS.captured,
        {
          previous: owner?.player_name ?? '?',
        },
      );
    }
    case 'castle_founded': {
      return make('founded', 'castles', hostile('threat'), ICONS.founded);
    }
    case 'castle_relocated': {
      return relocationEntry(event, radius, make, hostile);
    }
    case 'castle_vanished': {
      const spot = event.position;
      const vanished = spot
        ? make('vanished-at', 'castles', 'opportunity', ICONS.vanished, { x: spot.x, y: spot.y })
        : make('vanished', 'castles', 'opportunity', ICONS.vanished);
      return { ...vanished, distance: event.distance };
    }
    case 'player_appeared': {
      return make(event.new_account ? 'new-player' : 'returned', 'castles', 'info', ICONS.appeared);
    }
    case 'alliance_changed': {
      return allianceEntry(event, make);
    }
    case 'player_renamed': {
      return make('renamed', 'alliances', 'info', ICONS.renamed, { previous: event.old_name ?? '' });
    }
    case 'protection_started': {
      return make('protection-started', 'activity', 'info', ICONS.protectionStarted);
    }
    case 'protection_ended': {
      return event.ended_early
        ? make('protection-broken', 'activity', hostile('threat'), ICONS.protectionEnded)
        : make('protection-expired', 'activity', 'opportunity', ICONS.protectionEnded);
    }
    case 'ruin_started': {
      return make('ruin-started', 'activity', 'info', ICONS.ruin);
    }
    case 'ruin_ended': {
      return make('ruin-ended', 'activity', 'info', ICONS.rebuilt);
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
  if (now <= radius && before > radius) return make('relocated-in', 'castles', hostile('threat'), ICONS.relocated);
  if (before <= radius && now > radius) {
    return {
      ...make('relocated-out', 'castles', 'info', ICONS.relocated),
      distance: before,
      origin: event.previous_origin ?? null,
    };
  }
  if (now <= radius) {
    return make('relocated-within', 'castles', hostile(now < before ? 'threat' : 'info'), ICONS.relocated, {
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
    return make(to ? 'left-my-alliance-for' : 'left-my-alliance', 'alliances', 'threat', ICONS.left, { to });
  }
  if (event.joined_my_alliance) return make('joined-my-alliance', 'alliances', 'info', ICONS.joined, { from });
  if (event.new_alliance_id === null) return make('left-alliance', 'alliances', 'opportunity', ICONS.left, { from });
  if (event.old_alliance_id === null) return make('joined-alliance', 'alliances', 'info', ICONS.joined, { to });
  return make('switched-alliance', 'alliances', 'info', ICONS.switched, { from, to });
}

function mightEntries(spikes: ApiVicinityEvent[], me: PlayerStanding | null): FeedEntry[] {
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
    const common = base(latest);
    const minor = isMinor(common.standing, me);
    const shared = {
      ...common,
      key: `might:${latest.player_id}:${ordered[0].occurred_at}`,
      category: 'activity' as const,
      tone: weaknessTone(rising, latest.is_ally || minor),
      icon: ICONS.might,
      trend: (rising ? 'up' : 'down') as FeedTrend,
      minor,
      outdated: null,
    };
    if (isSingleRun(ordered)) {
      return {
        ...shared,
        message: latest.typical_hourly_change
          ? `vicinity.event.${rising ? 'might-up' : 'might-down'}`
          : 'vicinity.event.might-change-plain',
        params: { change, hours: ordered.length, typical: latest.typical_hourly_change ?? 0 },
      };
    }
    return {
      ...shared,
      message: 'vicinity.event.might-swings',
      params: { count: ordered.length, change, peak },
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

function honorEntries(
  neighbours: ApiVicinityNeighbour[],
  window: VicinityWindow,
  me: PlayerStanding | null,
): FeedEntry[] {
  return neighbours
    .filter((neighbour) => honorOf(neighbour, window).changes > 0 && neighbour.last_honor_change_at)
    .map((neighbour) => {
      const honor = honorOf(neighbour, window);
      const net = honor.gained - honor.lost;
      const castle = neighbour.castles[0];
      const standing = standingOf(neighbour.level, neighbour.legendary_level, neighbour.might_current);
      const minor = isMinor(standing, me);
      return {
        key: `honor:${neighbour.player_id}`,
        message: honor.changes === 1 ? 'vicinity.event.honor-once' : 'vicinity.event.honor',
        params: { net, changes: honor.changes },
        category: 'activity',
        tone: net === 0 ? 'info' : weaknessTone(net > 0, neighbour.is_ally || minor),
        icon: ICONS.honor,
        trend: net > 0 ? 'up' : net < 0 ? 'down' : null,
        minor,
        outdated: null,
        standing,
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
