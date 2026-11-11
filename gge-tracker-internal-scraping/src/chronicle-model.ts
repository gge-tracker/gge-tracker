//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { ScrapingServer } from './servers-file';

export const FULL_SERVER_DAYS = 240;
export const SEASON_SERVER_DAYS = 21;
export const FULL_PLAYER_HOURS = 720;
export const RHYTHM_MIN_ACTIVE_DAYS = 30;
export const PERSONA_SHARE_CAP = 0.2;
export const RIVAL_RANK_REACH = 40;
export const RIVAL_MIN_MONTHS = 6;
export const SUMMIT_MIN_DROP = 1.1;
export const SUMMIT_MIN_MIGHT = 5000;
export const RIVAL_MIN_ACTIVE_DAYS = 7;
export const RIVAL_MIN_EVENTS = 3;
export const REIGN_TIERS = [1, 10, 100];
export const REIGN_MIN_DAYS = 7;
export const REIGN_MERGED_GAP_DAYS = 3;
export const REIGN_STEADY_SHARE = 0.9;
export const RANK_MILESTONES = [100, 500, 1000, 5000, 10_000];
export const CLIMB_MIN_PLACES = 25;
export const CLIMB_MIN_SHARE = 0.1;
// Glory below the first title of the game names no rank worth a page
export const GLORY_FIRST_TITLE_POINTS = 4444;

const DAY_MS = 86_400_000;
const SERVED_KINDS = new Set(['ep', 'e4k', 'partner']);
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5]);
const NOTABLE_DAY_SHARE = 0.05;

export type ServerTier = 'full' | 'season' | 'too-recent';
export type PlayerTier = 'full' | 'short';
export type EventKey = 'nomad' | 'samurai' | 'bloodcrow' | 'berimond' | 'war_realms';
export type SlideId =
  | 'cover'
  | 'climb'
  | 'summit'
  | 'ranking'
  | 'great-day'
  | 'plunder'
  | 'battlefield'
  | 'beyond'
  | 'glory'
  | 'rhythm'
  | 'hours'
  | 'banner'
  | 'rival'
  | 'persona'
  | 'wall';
export type PersonaId =
  | 'conqueror'
  | 'plunderer'
  | 'tournament-knight'
  | 'night-watch'
  | 'iron-banner'
  | 'wanderer'
  | 'risen'
  | 'rising-star'
  | 'veteran'
  | 'hermit-king'
  | 'glorious'
  | 'steadfast';

export interface ChronicleWindow {
  year: number;
  fromMs: number;
  untilMs: number;
}

export interface EventResult {
  runs: number;
  bestRank: number;
  podiums: number;
}

export interface AllianceChange {
  from: string | null;
  to: string | null;
  at: string;
}

export interface BannerSegment {
  name: string | null;
  from: string;
  to: string;
}

export interface WorldEventRow {
  server: string;
  playerId: number;
  events: number;
  bestRank: number;
  bestPoint: number;
  months: number[];
  ranks: number[];
}

export interface WorldEvent extends ServerStanding {
  events: number;
  bestRank: number;
  bestPoint: number;
  months: number[];
  ranks: number[];
}

export interface WorldEvents {
  outerRealms?: WorldEvent;
  horizon?: WorldEvent;
}

export interface PlayerFeatures {
  id: number;
  name: string;
  allianceId: number | null;
  allianceName: string | null;
  allianceChanges: number;
  hours: number;
  mightStart: number;
  mightEnd: number;
  mightPeak: number;
  mightLow: number;
  bestDay: string | null;
  bestDayGain: number;
  peakDay: string | null;
  lootTotal: number;
  bestWeekLoot: number;
  bestWeekStart: string | null;
  weeklyLoot: number[];
  activeDays: number;
  longestStreak: number;
  calendar: string;
  hourly: number[];
  allianceHistory: AllianceChange[];
  monthly: (number | null)[];
  gloryCurrent: number;
  gloryHighest: number;
  world: WorldEvents;
  firstDay: string | null;
  events: Partial<Record<EventKey, EventResult>>;
  topDays: [string, number][];
}

export interface ReignRow {
  tier: number;
  days: number;
  segments: [number, number][];
}

export interface ChronicleReign {
  tier: number;
  days: number;
  longest: number;
  comebacks: number;
  trackedDays: number;
  start: number;
  end: number;
  rows: ReignRow[];
  steady: boolean;
  places: { best: number; usual: number; worst: number };
}

export interface RankMilestone {
  top: number;
  month: number;
}

export interface ChronicleRanking {
  monthly: (number | null)[];
  first: number;
  firstMonth: number;
  last: number;
  lastMonth: number;
  best: number;
  bestMonth: number;
  places: number;
  milestone: RankMilestone | null;
}

export interface ServerStanding {
  rank: number;
  of: number;
  higherThanPct: number;
}

export interface ChronicleRival {
  id: number;
  name: string;
  might: number;
  loot: number;
  events: number;
  activeDays: number;
  allianceName: string | null;
  monthly: (number | null)[];
  monthsAhead: number;
  monthsCompared: number;
  monthsNear: number;
}

export interface ChronicleEntry {
  id: number;
  name: string;
  tier: PlayerTier;
  hours: number;
  firstDay: string | null;
  slides: SlideId[];
  rival: ChronicleRival | null;
  alliance: {
    id: number | null;
    name: string | null;
    changes: number;
    timeline: BannerSegment[];
    daysUnderCurrent: number;
  };
  might: ServerStanding & {
    start: number;
    end: number;
    peak: number;
    peakDay: string | null;
    low: number;
    gain: number;
    bestDay: string | null;
    bestDayGain: number;
    months: number[];
    monthly: (number | null)[];
    rankStart: number | null;
    rankEnd: number | null;
    rankBest: number | null;
    rankBestMonth: number | null;
    rankedPlayers: number;
    reign: ChronicleReign | null;
    ranking: ChronicleRanking | null;
  };
  loot: ServerStanding & {
    total: number;
    bestWeek: number;
    bestWeekStart: string | null;
    weekly: number[];
    weeksLooted: number;
  };
  rhythm: ServerStanding & {
    activeDays: number;
    longestStreak: number;
    calendar: string;
    hourly: number[];
    peakHour: number | null;
    nightShare: number;
  };
  events: ServerStanding & {
    runs: number;
    bestRank: number | null;
    podiums: number;
    favourite: EventKey | null;
    perEvent: Partial<Record<EventKey, EventResult>>;
  };
  glory: ServerStanding & { current: number; highest: number; best: ServerStanding };
  world: { outerRealms: WorldEvent | null; horizon: WorldEvent | null; servers: number };
  profile: { might: number; loot: number; events: number; glory: number; activity: number; loyalty: number };
  persona: PersonaId | null;
}

export interface RivalPick {
  id: number;
  months: number;
}

export interface BuildOptions {
  window: ChronicleWindow;
  months: number[];
  rivals?: Map<number, RivalPick>;
  worldServers?: number;
  trackedDays?: number;
  serverDays?: string[];
}

export function chronicleWindow(year: number, untilMs?: number): ChronicleWindow {
  const fromMs = Date.UTC(year, 0, 1);
  return { year, fromMs, untilMs: untilMs ?? Date.UTC(year, 11, 1) };
}

export function chronicleServers(servers: ScrapingServer[]): ScrapingServer[] {
  const seen = new Set<string>();
  return servers.filter((server) => {
    if (!SERVED_KINDS.has(server.kind) || !server.enabledPublic || !server.olap) return false;
    if (server.server.endsWith('_BETA') || seen.has(server.olap)) return false;
    seen.add(server.olap);
    return true;
  });
}

export function trackedDays(firstReadingMs: number, window: ChronicleWindow): number {
  const start = Math.max(firstReadingMs, window.fromMs);
  return Math.max(0, Math.floor((window.untilMs - start) / DAY_MS));
}

export function serverTier(days: number): ServerTier {
  if (days >= FULL_SERVER_DAYS) return 'full';
  return days >= SEASON_SERVER_DAYS ? 'season' : 'too-recent';
}

export function totalEventRuns(events: PlayerFeatures['events']): number {
  return Object.values(events).reduce((total, event) => total + (event?.runs ?? 0), 0);
}

// A server tracked for five weeks cannot ask for thirty days of a player who joined after its first week
export function fullStoryHours(serverDays = Number.POSITIVE_INFINITY): number {
  return Math.min(FULL_PLAYER_HOURS, Math.floor(serverDays * 24 * 0.6));
}

export function playerTier(player: PlayerFeatures, minHours = FULL_PLAYER_HOURS): PlayerTier {
  const hasActivity = player.activeDays > 0 || totalEventRuns(player.events) > 0;
  return player.hours >= minHours && hasActivity ? 'full' : 'short';
}

export function sortedPositive(values: number[]): number[] {
  return values.filter((value) => value > 0).sort((a, b) => a - b);
}

export function higherThanPct(sorted: number[], value: number): number {
  if (value <= 0 || sorted.length === 0) return 0;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return Math.floor((100 * low) / sorted.length);
}

export function standing(sorted: number[], value: number): ServerStanding {
  if (value <= 0 || sorted.length === 0) return { rank: 0, of: sorted.length, higherThanPct: 0 };
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return { rank: sorted.length - low + 1, of: sorted.length, higherThanPct: higherThanPct(sorted, value) };
}

// Everyone is ranked on the best finish of their year, so one great run counts whatever the others were
export function rankWorldEvent(rows: WorldEventRow[]): Map<string, Map<number, WorldEvent>> {
  const merged = new Map<string, WorldEventRow>();
  for (const row of rows) {
    const key = `${row.server}:${row.playerId}`;
    const known = merged.get(key);
    if (known) {
      const months = new Map(known.months.map((month, index) => [month, known.ranks[index]]));
      row.months.forEach((month, index) =>
        months.set(month, Math.min(months.get(month) ?? Infinity, row.ranks[index])),
      );
      const ordered = [...months].sort((a, b) => a[0] - b[0]);
      known.events += row.events;
      known.bestRank = Math.min(known.bestRank, row.bestRank);
      known.bestPoint = Math.max(known.bestPoint, row.bestPoint);
      known.months = ordered.map(([month]) => month);
      known.ranks = ordered.map(([, rank]) => rank);
    } else {
      merged.set(key, { ...row });
    }
  }
  const sorted = sortedPositive([...merged.values()].map((row) => 1 / row.bestRank));
  const byServer = new Map<string, Map<number, WorldEvent>>();
  for (const { server, playerId, ...row } of merged.values()) {
    const players = byServer.get(server) ?? new Map<number, WorldEvent>();
    byServer.set(server, players);
    players.set(playerId, { ...row, ...standing(sorted, 1 / row.bestRank) });
  }
  return byServer;
}

function dayIndex(day: string, year: number): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.UTC(year, 0, 1)) / DAY_MS);
}

export function activityCalendar(days: string[], window: ChronicleWindow): string {
  const length = Math.ceil((window.untilMs - window.fromMs) / DAY_MS);
  const marks = new Array<string>(length).fill('0');
  for (const day of days) {
    const index = dayIndex(day, window.year);
    if (index >= 0 && index < length) marks[index] = '1';
  }
  return marks.join('');
}

export function longestRun(calendar: string): number {
  return Math.max(0, ...calendar.split('0').map((run) => run.length));
}

function consecutiveRuns(ordinals: number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const ordinal of ordinals) {
    const last = runs.at(-1);
    if (last && ordinal === last[1] + 1) last[1] = ordinal;
    else runs.push([ordinal, ordinal]);
  }
  return runs;
}

function mergeShortGaps(runs: [number, number][]): [number, number][] {
  return runs.reduce<[number, number][]>((merged, run) => {
    const last = merged.at(-1);
    if (last && run[0] - last[1] - 1 <= REIGN_MERGED_GAP_DAYS) last[1] = run[1];
    else merged.push([run[0], run[1]]);
    return merged;
  }, []);
}

function firstOrdinal(serverDays: string[], firstDay: string | null): number {
  if (!firstDay) return 0;
  const index = serverDays.findIndex((day) => day >= firstDay);
  return index < 0 ? serverDays.length : index;
}

export function buildReign(
  topDays: [string, number][],
  serverDays: string[],
  firstDay: string | null,
  year: number,
): ChronicleReign | null {
  if (topDays.length === 0 || serverDays.length === 0) return null;
  const ordinals = new Map(serverDays.map((day, index) => [day, index]));
  const held = (tier: number): number[] =>
    topDays
      .flatMap(([day, position]) => (position <= tier && ordinals.has(day) ? [ordinals.get(day)!] : []))
      .sort((a, b) => a - b);
  const headline = REIGN_TIERS.findIndex((tier) => held(tier).length >= REIGN_MIN_DAYS);
  if (headline < 0) return null;
  const toCalendar = ([start, end]: [number, number]): [number, number] => [
    dayIndex(serverDays[start], year),
    dayIndex(serverDays[end], year),
  ];
  const rows = REIGN_TIERS.flatMap((tier, index) => {
    const days = held(tier);
    if (index < headline && days.length === 0) return [];
    return [{ tier, days: days.length, segments: mergeShortGaps(consecutiveRuns(days)).map(toCalendar) }];
  });
  const headlineRow = rows.find((row) => row.tier === REIGN_TIERS[headline])!;
  const from = Math.min(firstOrdinal(serverDays, firstDay), serverDays.length - 1);
  const trackedDays = serverDays.length - from;
  const positions = topDays
    .filter(([day]) => ordinals.has(day))
    .map(([, position]) => position)
    .sort((a, b) => a - b);
  return {
    tier: REIGN_TIERS[headline],
    days: headlineRow.days,
    longest: Math.max(...consecutiveRuns(held(REIGN_TIERS[headline])).map(([start, end]) => end - start + 1)),
    comebacks: headlineRow.segments.length - 1,
    trackedDays,
    start: dayIndex(serverDays[from], year),
    end: dayIndex(serverDays.at(-1)!, year) + 1,
    rows,
    steady: rows.every((row) => row.segments.length <= 1 && row.days >= trackedDays * REIGN_STEADY_SHARE),
    places: {
      best: positions[0],
      usual: positions[Math.floor(positions.length / 2)],
      worst: positions.at(-1)!,
    },
  };
}

export function buildRanking(monthlyRanks: (number | null)[], months: number[]): ChronicleRanking | null {
  const known = monthlyRanks.flatMap((rank, index) => (rank === null ? [] : [{ rank, month: months[index] }]));
  if (known.length < 2) return null;
  const first = known[0];
  const last = known.at(-1)!;
  const best = known.reduce((top, entry) => (entry.rank < top.rank ? entry : top));
  const top = RANK_MILESTONES.find((milestone) => best.rank <= milestone && first.rank > milestone);
  return {
    monthly: monthlyRanks,
    first: first.rank,
    firstMonth: first.month,
    last: last.rank,
    lastMonth: last.month,
    best: best.rank,
    bestMonth: best.month,
    places: first.rank - last.rank,
    milestone: top === undefined ? null : { top, month: known.find((entry) => entry.rank <= top)!.month },
  };
}

export function isNotableClimb(ranking: ChronicleRanking | null): boolean {
  return !!ranking && ranking.places >= Math.max(CLIMB_MIN_PLACES, ranking.first * CLIMB_MIN_SHARE);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function bannerTimeline(
  history: AllianceChange[],
  currentName: string | null,
  window: ChronicleWindow,
): BannerSegment[] {
  const end = isoDay(window.untilMs - 1);
  if (history.length === 0) return [{ name: currentName, from: isoDay(window.fromMs), to: end }];
  const segments: BannerSegment[] = [{ name: history[0].from, from: isoDay(window.fromMs), to: history[0].at }];
  history.forEach((change, index) => {
    const next = history[index + 1];
    segments.push({ name: change.to, from: change.at, to: next ? next.at : end });
  });
  const lasting = segments.filter((segment) => segment.from !== segment.to);
  return lasting.reduce<BannerSegment[]>((merged, segment) => {
    const last = merged.at(-1);
    if (last && last.name === segment.name) last.to = segment.to;
    else merged.push({ ...segment });
    return merged;
  }, []);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function daysUnderBanner(timeline: BannerSegment[], name: string | null): number {
  const last = timeline.at(-1);
  if (!last) return 0;
  return timeline.reduce(
    (days, segment) =>
      days + (segment.name === name ? daysBetween(segment.from, segment.to) + (segment === last ? 1 : 0) : 0),
    0,
  );
}

export function nightShare(hourly: number[]): number {
  const total = hourly.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  return hourly.reduce((sum, count, hour) => sum + (NIGHT_HOURS.has(hour) ? count : 0), 0) / total;
}

function peakHour(hourly: number[]): number | null {
  const peak = Math.max(...hourly);
  return peak > 0 ? hourly.indexOf(peak) : null;
}

function bestEventRank(events: PlayerFeatures['events']): number | null {
  const ranks = Object.values(events)
    .map((event) => event?.bestRank ?? 0)
    .filter((rank) => rank > 0);
  return ranks.length > 0 ? Math.min(...ranks) : null;
}

function favouriteEvent(events: PlayerFeatures['events']): EventKey | null {
  let favourite: EventKey | null = null;
  let runs = 0;
  for (const [key, event] of Object.entries(events) as [EventKey, EventResult][]) {
    if (event.runs > runs) {
      favourite = key;
      runs = event.runs;
    }
  }
  return favourite;
}

interface PersonaRule {
  id: PersonaId;
  isEligible: (player: PlayerFeatures) => boolean;
  metric: (player: PlayerFeatures) => number;
}

function hasFallenAndRecovered(player: PlayerFeatures): boolean {
  return player.mightLow < player.mightStart * 0.7 && player.mightEnd > player.mightLow * 1.3;
}

const PERSONA_RULES: PersonaRule[] = [
  { id: 'conqueror', isEligible: (p) => p.mightEnd > p.mightStart, metric: (p) => p.mightEnd - p.mightStart },
  { id: 'plunderer', isEligible: (p) => p.lootTotal > 0, metric: (p) => p.lootTotal },
  { id: 'tournament-knight', isEligible: (p) => totalEventRuns(p.events) > 0, metric: (p) => totalEventRuns(p.events) },
  {
    id: 'night-watch',
    isEligible: (p) => p.activeDays >= RHYTHM_MIN_ACTIVE_DAYS && nightShare(p.hourly) >= 0.4,
    metric: (p) => nightShare(p.hourly),
  },
  {
    id: 'iron-banner',
    isEligible: (p) => p.allianceId !== null && p.allianceChanges === 0 && p.activeDays > 0,
    metric: (p) => p.activeDays,
  },
  { id: 'wanderer', isEligible: (p) => p.allianceChanges >= 3, metric: (p) => p.allianceChanges },
  { id: 'risen', isEligible: hasFallenAndRecovered, metric: (p) => p.mightEnd / Math.max(p.mightLow, 1) },
  {
    id: 'rising-star',
    isEligible: (p) => p.mightStart > 0 && p.mightEnd > p.mightStart * 2,
    metric: (p) => p.mightEnd / p.mightStart,
  },
  { id: 'veteran', isEligible: (p) => p.longestStreak >= 30, metric: (p) => p.longestStreak },
  { id: 'hermit-king', isEligible: (p) => p.allianceId === null && p.lootTotal > 0, metric: (p) => p.lootTotal },
  { id: 'glorious', isEligible: (p) => p.gloryHighest >= GLORY_FIRST_TITLE_POINTS, metric: (p) => p.gloryHighest },
];

export function assignPersonas(players: PlayerFeatures[]): Map<number, PersonaId> {
  const candidates: { playerId: number; persona: PersonaId; score: number }[] = [];
  for (const rule of PERSONA_RULES) {
    const eligible = players.filter(rule.isEligible);
    const sorted = sortedPositive(eligible.map(rule.metric));
    for (const player of eligible) {
      candidates.push({ playerId: player.id, persona: rule.id, score: higherThanPct(sorted, rule.metric(player)) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.playerId - b.playerId);

  const cap = Math.max(1, Math.ceil(players.length * PERSONA_SHARE_CAP));
  const assigned = new Map<number, PersonaId>();
  const taken = new Map<PersonaId, number>();
  for (const { playerId, persona } of candidates) {
    if (assigned.has(playerId) || (taken.get(persona) ?? 0) >= cap) continue;
    assigned.set(playerId, persona);
    taken.set(persona, (taken.get(persona) ?? 0) + 1);
  }
  for (const player of players) {
    if (!assigned.has(player.id)) assigned.set(player.id, 'steadfast');
  }
  return assigned;
}

function contentSlides(player: PlayerFeatures, rhythmMinDays: number, hasRanking: boolean): SlideId[] {
  const gain = player.mightEnd - player.mightStart;
  const slides: SlideId[] = [];
  if (gain > 0) slides.push('climb');
  else if (player.mightPeak >= player.mightEnd * SUMMIT_MIN_DROP && player.mightPeak >= SUMMIT_MIN_MIGHT)
    slides.push('summit');
  if (hasRanking) slides.push('ranking');
  if (gain > 0 && player.bestDay !== null && player.bestDayGain >= gain * NOTABLE_DAY_SHARE) slides.push('great-day');
  if (player.lootTotal > 0) slides.push('plunder');
  if (totalEventRuns(player.events) > 0) slides.push('battlefield');
  if (player.world.outerRealms || player.world.horizon) slides.push('beyond');
  if (player.gloryHighest >= GLORY_FIRST_TITLE_POINTS) slides.push('glory');
  if (player.activeDays >= rhythmMinDays) slides.push('rhythm', 'hours');
  if (player.allianceId !== null) slides.push('banner');
  return slides;
}

export function selectSlides(
  player: PlayerFeatures,
  tier: PlayerTier,
  hasRival = false,
  rhythmMinDays = RHYTHM_MIN_ACTIVE_DAYS,
  hasRanking = false,
): SlideId[] {
  const content = contentSlides(player, rhythmMinDays, hasRanking);
  if (tier === 'short') return ['cover', ...content.slice(0, 1), 'wall'];
  return ['cover', ...content, ...(hasRival ? (['rival'] as const) : []), 'persona', 'wall'];
}

interface RivalTally {
  months: number;
  distance: number;
}

function tallyNeighbours(snapshots: Map<number, number>[], players: Set<number>): Map<number, Map<number, RivalTally>> {
  const tallies = new Map<number, Map<number, RivalTally>>();
  const add = (from: number, to: number, distance: number): void => {
    const row = tallies.get(from) ?? new Map<number, RivalTally>();
    tallies.set(from, row);
    const tally = row.get(to) ?? { months: 0, distance: 0 };
    tally.months += 1;
    tally.distance += distance;
    row.set(to, tally);
  };
  for (const snapshot of snapshots) {
    const ranked = [...snapshot].filter(([id]) => players.has(id)).sort((a, b) => b[1] - a[1]);
    ranked.forEach(([id, might], position) => {
      for (const [otherId, otherMight] of ranked.slice(position + 1, position + 1 + RIVAL_RANK_REACH)) {
        const distance = (might - otherMight) / Math.max(might, 1);
        add(id, otherId, distance);
        add(otherId, id, distance);
      }
    });
  }
  return tallies;
}

function isActiveRival(player: PlayerFeatures | undefined): boolean {
  return !!player && (player.activeDays >= RIVAL_MIN_ACTIVE_DAYS || totalEventRuns(player.events) >= RIVAL_MIN_EVENTS);
}

// A rival is whoever kept sitting next to you in the ranking month after month, never an ally or an abandoned account
export function pickRivals(players: PlayerFeatures[], snapshots: Map<number, number>[]): Map<number, RivalPick> {
  const byId = new Map(players.map((player) => [player.id, player]));
  const allianceOf = new Map(players.map((player) => [player.id, player.allianceId]));
  const tallies = tallyNeighbours(snapshots, new Set(allianceOf.keys()));
  const rivals = new Map<number, RivalPick>();
  for (const [playerId, row] of tallies) {
    const alliance = allianceOf.get(playerId) ?? null;
    let best: { id: number; tally: RivalTally } | null = null;
    for (const [otherId, tally] of row) {
      if (tally.months < RIVAL_MIN_MONTHS || (alliance !== null && allianceOf.get(otherId) === alliance)) continue;
      if (!isActiveRival(byId.get(otherId))) continue;
      const isBetter =
        !best ||
        tally.months > best.tally.months ||
        (tally.months === best.tally.months && tally.distance < best.tally.distance);
      if (isBetter) best = { id: otherId, tally };
    }
    if (best) rivals.set(playerId, { id: best.id, months: best.tally.months });
  }
  return rivals;
}

function rankPositions(players: PlayerFeatures[], column: number): Map<number, number> {
  const ranked = players
    .map((player) => [player.id, player.monthly[column] ?? 0] as const)
    .filter(([, might]) => might > 0)
    .sort((a, b) => b[1] - a[1]);
  return new Map(ranked.map(([id], position) => [id, position + 1]));
}

function buildRival(player: PlayerFeatures, rival: PlayerFeatures, monthsNear: number): ChronicleRival {
  const compared = player.monthly
    .map((might, month) => [might, rival.monthly[month]] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);
  return {
    id: rival.id,
    name: rival.name,
    might: rival.mightEnd,
    loot: rival.lootTotal,
    events: totalEventRuns(rival.events),
    activeDays: rival.activeDays,
    allianceName: rival.allianceName,
    monthly: rival.monthly,
    monthsAhead: compared.filter(([mine, theirs]) => mine > theirs).length,
    monthsCompared: compared.length,
    monthsNear,
  };
}

export function buildEntries(players: PlayerFeatures[], options: BuildOptions): ChronicleEntry[] {
  const { window, rivals = new Map<number, RivalPick>() } = options;
  const minHours = fullStoryHours(options.trackedDays);
  const rhythmMinDays = Math.min(RHYTHM_MIN_ACTIVE_DAYS, Math.floor((options.trackedDays ?? Infinity) * 0.4));
  const full = players.filter((player) => playerTier(player, minHours) === 'full');
  const byId = new Map(players.map((player) => [player.id, player]));
  const personas = assignPersonas(full);
  const gains = sortedPositive(players.map((player) => player.mightEnd - player.mightStart));
  const loots = sortedPositive(players.map((player) => player.lootTotal));
  const runs = sortedPositive(players.map((player) => totalEventRuns(player.events)));
  const days = sortedPositive(players.map((player) => player.activeDays));
  const glories = sortedPositive(players.map((player) => player.gloryCurrent));
  const bestGlories = sortedPositive(players.map((player) => player.gloryHighest));
  const monthlyRanks = options.months.map((_, column) => rankPositions(players, column));
  const startRanks = monthlyRanks[0] ?? new Map<number, number>();
  const endRanks = monthlyRanks.at(-1) ?? new Map<number, number>();
  const bestRanks = new Map<number, { rank: number; month: number }>();
  options.months.forEach((month, column) => {
    for (const [id, rank] of monthlyRanks[column]) {
      const known = bestRanks.get(id);
      if (!known || rank < known.rank) bestRanks.set(id, { rank, month });
    }
  });
  const windowDays = Math.ceil((window.untilMs - window.fromMs) / DAY_MS);
  const serverDays = options.serverDays ?? [];

  return players.map((player) => {
    const tier = playerTier(player, minHours);
    const reign = buildReign(player.topDays, serverDays, player.firstDay, window.year);
    const ranking = buildRanking(
      monthlyRanks.map((ranks) => ranks.get(player.id) ?? null),
      options.months,
    );
    const gain = player.mightEnd - player.mightStart;
    const eventRuns = totalEventRuns(player.events);
    const rivalPick = tier === 'full' ? rivals.get(player.id) : undefined;
    const rivalFeatures = rivalPick === undefined ? undefined : byId.get(rivalPick.id);
    const timeline = bannerTimeline(player.allianceHistory, player.allianceName, window);
    const daysUnderCurrent = player.allianceId === null ? 0 : daysUnderBanner(timeline, timeline.at(-1)!.name);
    const mightStanding = standing(gains, gain);
    const lootStanding = standing(loots, player.lootTotal);
    const eventStanding = standing(runs, eventRuns);
    const dayStanding = standing(days, player.activeDays);
    const gloryStanding = standing(glories, player.gloryCurrent);
    const bestGloryStanding = standing(bestGlories, player.gloryHighest);
    return {
      id: player.id,
      name: player.name,
      tier,
      hours: player.hours,
      firstDay: player.firstDay,
      slides: selectSlides(
        player,
        tier,
        rivalFeatures !== undefined,
        rhythmMinDays,
        reign !== null || isNotableClimb(ranking),
      ),
      rival: rivalFeatures ? buildRival(player, rivalFeatures, rivalPick!.months) : null,
      alliance: {
        id: player.allianceId,
        name: player.allianceName,
        changes: player.allianceChanges,
        timeline,
        daysUnderCurrent,
      },
      might: {
        ...mightStanding,
        start: player.mightStart,
        end: player.mightEnd,
        peak: player.mightPeak,
        peakDay: player.peakDay,
        low: player.mightLow,
        gain,
        bestDay: player.bestDay,
        bestDayGain: player.bestDayGain,
        months: options.months,
        monthly: player.monthly,
        rankStart: startRanks.get(player.id) ?? null,
        rankEnd: endRanks.get(player.id) ?? null,
        rankBest: bestRanks.get(player.id)?.rank ?? null,
        rankBestMonth: bestRanks.get(player.id)?.month ?? null,
        rankedPlayers: endRanks.size,
        reign,
        ranking,
      },
      loot: {
        ...lootStanding,
        total: player.lootTotal,
        bestWeek: player.bestWeekLoot,
        bestWeekStart: player.bestWeekStart,
        weekly: player.weeklyLoot,
        weeksLooted: player.weeklyLoot.filter((value) => value > 0).length,
      },
      rhythm: {
        ...dayStanding,
        activeDays: player.activeDays,
        longestStreak: player.longestStreak,
        calendar: player.calendar,
        hourly: player.hourly,
        peakHour: peakHour(player.hourly),
        nightShare: Math.round(nightShare(player.hourly) * 100) / 100,
      },
      events: {
        ...eventStanding,
        runs: eventRuns,
        bestRank: bestEventRank(player.events),
        podiums: Object.values(player.events).reduce((total, event) => total + (event?.podiums ?? 0), 0),
        favourite: favouriteEvent(player.events),
        perEvent: player.events,
      },
      glory: {
        ...gloryStanding,
        current: player.gloryCurrent,
        highest: player.gloryHighest,
        best: bestGloryStanding,
      },
      world: {
        outerRealms: player.world.outerRealms ?? null,
        horizon: player.world.horizon ?? null,
        servers: options.worldServers ?? 0,
      },
      profile: {
        might: mightStanding.higherThanPct,
        loot: lootStanding.higherThanPct,
        events: eventStanding.higherThanPct,
        glory: bestGloryStanding.higherThanPct,
        activity: dayStanding.higherThanPct,
        loyalty: Math.min(100, Math.round((100 * daysUnderCurrent) / windowDays)),
      },
      persona: personas.get(player.id) ?? null,
    };
  });
}
