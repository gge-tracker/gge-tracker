//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { LootReset, lootWeekEnd, lootWeekStart } from './loot-reset';

// The game sends weekly loot as a signed 32-bit integer that keeps counting past 2^32
export const LOOT_COUNTER_RANGE = 2 ** 32;

const HOUR_MS = 3_600_000;

const MAX_GAIN_PER_HOUR = 3_500_000_000;

const EARLY_RESET_WINDOW_MS = 2 * HOUR_MS;
const EARLY_RESET_GAIN_FACTOR = 4;
const EARLY_RESET_GAIN_FLOOR = 100_000_000;
// Near a reset, production never showed more than 2 wraps in one run, and every partial reset dropped at least 3 players
const RESET_UNDERWAY_DROPS = 3;
export const MAX_WRAPS_PER_RUN = 50;

export interface LootReading {
  at: number;
  point: number;
}

export type LootReadingKind = 'fresh' | 'counted' | 'wrapped' | 'early-reset' | 'decreased' | 'refused';

export interface UnwrappedLoot {
  point: number;
  kind: LootReadingKind;
}

export interface LootRunPlayer {
  raw: number;
  recent: LootReading[];
  nextPace?: number;
}

export interface LootRun {
  at: number;
  finishedAt: number;
  reset: LootReset;
  replay?: boolean;
}

export function lootCounterValue(raw: number): number {
  return ((raw % LOOT_COUNTER_RANGE) + LOOT_COUNTER_RANGE) % LOOT_COUNTER_RANGE;
}

function elapsedHours(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / HOUR_MS));
}

function lastHourlyGain(recent: LootReading[]): number {
  const [last, beforeLast] = recent;
  if (!beforeLast) return 0;
  return (last.point - beforeLast.point) / elapsedHours(beforeLast.at, last.at);
}

function isWrap(gain: number, hours: number, recent: LootReading[], nearReset: boolean, nextPace?: number): boolean {
  const replay = nextPace !== undefined;
  if (gain > MAX_GAIN_PER_HOUR * (replay ? 1 : hours)) return false;
  if (!nearReset && !replay) return true;
  const reference = Math.max(lastHourlyGain(recent), nextPace ?? 0, EARLY_RESET_GAIN_FLOOR);
  return gain <= EARLY_RESET_GAIN_FACTOR * reference * hours;
}

function lastReadingThisWeek(at: number, recent: LootReading[], reset: LootReset): LootReading | undefined {
  const weekStart = lootWeekStart(at, reset);
  return recent.find((reading) => reading.at >= weekStart && reading.at < at);
}

function isNearReset(at: number, reset: LootReset): boolean {
  return lootWeekEnd(lootWeekStart(at, reset), reset) - at <= EARLY_RESET_WINDOW_MS;
}

function hasDropped(player: LootRunPlayer, at: number, reset: LootReset): boolean {
  const last = lastReadingThisWeek(at, player.recent, reset);
  return last !== undefined && lootCounterValue(player.raw) < lootCounterValue(last.point);
}

function isResetUnderway(players: LootRunPlayer[], run: LootRun): boolean {
  if (lootWeekStart(run.finishedAt, run.reset) !== lootWeekStart(run.at, run.reset)) return true;
  if (!isNearReset(run.at, run.reset)) return false;
  return players.filter((player) => hasDropped(player, run.at, run.reset)).length >= RESET_UNDERWAY_DROPS;
}

export function unwrapLoot(
  raw: number,
  at: number,
  recent: LootReading[],
  reset: LootReset,
  resetUnderway = false,
  nextPace?: number,
): UnwrappedLoot {
  const counter = lootCounterValue(raw);
  const weekStart = lootWeekStart(at, reset);
  const sameWeek = recent.filter((reading) => reading.at >= weekStart && reading.at < at);
  const last = sameWeek[0];
  if (!last) return { point: counter, kind: 'fresh' };

  const lastCounter = lootCounterValue(last.point);
  const base = last.point - lastCounter;
  if (counter >= lastCounter) return { point: base + counter, kind: 'counted' };
  if (resetUnderway) return { point: counter, kind: 'early-reset' };

  const gain = counter + LOOT_COUNTER_RANGE - lastCounter;
  const nearReset = isNearReset(at, reset);
  if (isWrap(gain, elapsedHours(last.at, at), sameWeek, nearReset, nextPace)) {
    return { point: base + LOOT_COUNTER_RANGE + counter, kind: 'wrapped' };
  }
  if (nearReset) return { point: counter, kind: 'early-reset' };
  return { point: base + counter, kind: 'decreased' };
}

export function unwrapLootRun(players: LootRunPlayer[], run: LootRun): UnwrappedLoot[] {
  const resetUnderway = isResetUnderway(players, run);
  const results = players.map((player) =>
    unwrapLoot(
      player.raw,
      run.at,
      player.recent,
      run.reset,
      resetUnderway,
      run.replay ? (player.nextPace ?? 0) : undefined,
    ),
  );
  if (results.filter((result) => result.kind === 'wrapped').length <= MAX_WRAPS_PER_RUN) return results;
  return results.map((result) =>
    result.kind === 'wrapped' ? { point: result.point - LOOT_COUNTER_RANGE, kind: 'refused' } : result,
  );
}
