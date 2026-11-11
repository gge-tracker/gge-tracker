//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { formatInTimeZone } from 'date-fns-tz';

export const KINGDOMS_LEAGUE_PLAYER_LT = 63;
export const KINGDOMS_LEAGUE_ALLIANCE_LT = 67;
export const KINGDOMS_LEAGUE_VERSION_KEY = 'kingdoms-league-version:';

const LEAGUE_TIMEZONE = 'Europe/Paris';
const WINDOW_FIRST_HOUR = 2;
const WINDOW_END_HOUR = 8;

const MEDAL_GOLD = 1;
const MEDAL_SILVER = 2;
const MEDAL_BRONZE = 3;
const SCORE_BASE = 401;

export interface LeagueClock {
  day: string;
  hour: number;
}

export interface Medals {
  gold: number;
  silver: number;
  bronze: number;
}

export interface LeaguePlayer extends Medals {
  rank: number;
  score: number;
  playerId: number;
  playerName: string;
  allianceId: number;
  allianceName: string;
  title: number;
}

export interface LeagueAlliance extends Medals {
  rank: number;
  score: number;
  allianceId: number;
  allianceName: string;
}

export interface LeagueHead {
  rankedPlayers: number;
  topGold: number;
  signature: string;
}

export interface StoredLeagueDay {
  season_id: number;
  day: string;
  ranked_players: number;
  top_gold: number;
  top_signature: string;
}

export type LeagueDecision =
  | { kind: 'empty' }
  | { kind: 'unchanged' }
  | { kind: 'collect'; seasonId: number; newSeason: boolean };

export function leagueClock(now: Date): LeagueClock {
  return {
    day: formatInTimeZone(now, LEAGUE_TIMEZONE, 'yyyy-MM-dd'),
    hour: Number(formatInTimeZone(now, LEAGUE_TIMEZONE, 'H')),
  };
}

export function isInCollectionWindow(clock: LeagueClock): boolean {
  return clock.hour >= WINDOW_FIRST_HOUR && clock.hour < WINDOW_END_HOUR;
}

export function isLastCollectionHour(clock: LeagueClock): boolean {
  return clock.hour === WINDOW_END_HOUR - 1;
}

export function readMedals(klmo: unknown): Medals {
  const medals: Medals = { gold: 0, silver: 0, bronze: 0 };
  if (!Array.isArray(klmo)) return medals;
  for (const pair of klmo) {
    if (!Array.isArray(pair)) continue;
    const amount = Number(pair[1]) || 0;
    if (Number(pair[0]) === MEDAL_GOLD) medals.gold = amount;
    if (Number(pair[0]) === MEDAL_SILVER) medals.silver = amount;
    if (Number(pair[0]) === MEDAL_BRONZE) medals.bronze = amount;
  }
  return medals;
}

export function packedAllianceScore(medals: Medals): number {
  return (medals.gold * SCORE_BASE + medals.silver) * SCORE_BASE + medals.bronze;
}

export function packedPlayerScore(title: number, medals: Medals): number {
  return title * SCORE_BASE ** 3 + packedAllianceScore(medals);
}

export function parsePlayerEntry(entry: unknown): LeaguePlayer | null {
  if (!Array.isArray(entry) || typeof entry[2] !== 'object' || entry[2] === null) return null;
  const owner = entry[2] as Record<string, unknown>;
  const playerId = Number(owner.OID);
  if (!Number.isInteger(playerId) || playerId <= 0) return null;
  return {
    rank: Number(entry[0]),
    score: Number(entry[1]),
    playerId,
    playerName: String(owner.N ?? ''),
    allianceId: Number(owner.AID ?? -1),
    allianceName: Number(owner.AID ?? -1) > 0 ? String(owner.AN ?? '') : '',
    title: Number(owner.KLRID ?? 0),
    ...readMedals(owner.KLMO),
  };
}

export function parseAllianceEntry(entry: unknown): LeagueAlliance | null {
  if (!Array.isArray(entry) || !Array.isArray(entry[2])) return null;
  const allianceId = Number(entry[2][0]);
  if (!Number.isInteger(allianceId) || allianceId <= 0) return null;
  const extra = (entry[3] ?? {}) as Record<string, unknown>;
  return {
    rank: Number(entry[0]),
    score: Number(entry[1]),
    allianceId,
    allianceName: String(entry[2][1] ?? ''),
    ...readMedals(extra.KLMO),
  };
}

export function hasPackedScore(player: LeaguePlayer): boolean {
  return player.score === packedPlayerScore(player.title, player);
}

export function headOf(rankedPlayers: number, firstPage: LeaguePlayer[]): LeagueHead {
  const leader = firstPage.find((player) => player.rank === 1);
  return {
    rankedPlayers,
    topGold: leader?.gold ?? 0,
    signature: firstPage.map((player) => `${player.rank}:${player.playerId}:${player.score}`).join(','),
  };
}

/**
 * Medals never go down within a season -> any drop from the last stored day is a reset
 */
export function decideLeagueDay(previous: StoredLeagueDay | null, head: LeagueHead): LeagueDecision {
  if (head.rankedPlayers <= 0) return { kind: 'empty' };
  if (!previous) return { kind: 'collect', seasonId: 1, newSeason: false };
  const unchanged = head.signature === previous.top_signature && head.rankedPlayers === Number(previous.ranked_players);
  if (unchanged) return { kind: 'unchanged' };
  const newSeason =
    head.topGold < Number(previous.top_gold) || head.rankedPlayers < Number(previous.ranked_players) / 2;
  const seasonId = Number(previous.season_id) + (newSeason ? 1 : 0);
  return { kind: 'collect', seasonId, newSeason };
}

export function pageValues(total: number, pageSize: number): number[] {
  const values: number[] = [];
  for (let first = 1; first <= total; first += pageSize) values.push(first - 1 + Math.ceil(pageSize / 2));
  return values;
}
