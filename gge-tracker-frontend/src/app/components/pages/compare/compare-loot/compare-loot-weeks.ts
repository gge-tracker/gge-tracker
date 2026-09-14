import { ApiGenericData, ApiPlayerEventOccurrence } from '@ggetracker-interfaces/empire-ranking';

export const MS_PER_HOUR = 3_600_000;
export const HOURS_PER_WEEK = 168;

const MS_PER_WEEK = HOURS_PER_WEEK * MS_PER_HOUR;
const DEFAULT_RESET_OFFSET = -1;
const RESET_DRIFT_HOURS = 3;

export interface WeeklyScoreRow {
  mondayKey: number;
  scores: [number | null, number | null];
}

export function weekStartOf(instant: number, resetOffset: number | null): number {
  const anchor = utcMondayOf(instant) + ((resetOffset ?? DEFAULT_RESET_OFFSET) - 1) * MS_PER_HOUR;
  return anchor + Math.floor((instant - anchor) / MS_PER_WEEK) * MS_PER_WEEK;
}

export function buildWeekRace(points: ApiGenericData[], weekStart: number, cutoff: number): (number | null)[] {
  const valueBySlot = new Map(weekReadings(points, weekStart).map((reading) => [reading.slot, reading.value]));
  let current = 0;
  return Array.from({ length: HOURS_PER_WEEK }, (_, slot) => {
    if (weekStart + slot * MS_PER_HOUR > cutoff) return null;
    current = valueBySlot.get(slot) ?? current;
    return current;
  });
}

export function alignWeeklyScores(
  occurrences: [ApiPlayerEventOccurrence[], ApiPlayerEventOccurrence[]],
  weekCount: number,
): WeeklyScoreRow[] {
  const rows = new Map<number, WeeklyScoreRow>();
  const firstWeek: [number, number] = [Infinity, Infinity];
  for (const side of [0, 1] as const) {
    for (const occurrence of occurrences[side]) {
      const mondayKey = mondayKeyOf(Date.parse(occurrence.started_at));
      const row = rows.get(mondayKey) ?? { mondayKey, scores: [null, null] };
      row.scores[side] = Number(occurrence.point);
      rows.set(mondayKey, row);
      firstWeek[side] = Math.min(firstWeek[side], mondayKey);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => a.mondayKey - b.mondayKey).slice(-weekCount);
  for (const row of sorted) {
    for (const side of [0, 1] as const) {
      // A week without a row after the player's first one means they did not loot, before it they were not tracked
      if (row.scores[side] === null && row.mondayKey > firstWeek[side]) row.scores[side] = 0;
    }
  }
  return sorted;
}

export function mondayKeyOf(weekStart: number): number {
  return utcMondayOf(weekStart + 84 * MS_PER_HOUR);
}

function utcMondayOf(instant: number): number {
  const date = new Date(instant);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
}

function weekReadings(points: ApiGenericData[], weekStart: number): { slot: number; value: number }[] {
  const readings = points
    .map((point) => ({
      slot: Math.floor((new Date(point.date).getTime() - weekStart) / MS_PER_HOUR),
      value: Number(point.point),
    }))
    .filter((reading) => reading.slot >= 0 && reading.slot < HOURS_PER_WEEK)
    .sort((a, b) => a.slot - b.slot);
  let first = 0;
  let end = readings.length;
  for (let index = 1; index < readings.length; index++) {
    if (readings[index].value >= readings[index - 1].value) continue;
    if (readings[index].slot < RESET_DRIFT_HOURS) {
      first = index;
    } else if (readings[index].slot >= HOURS_PER_WEEK - RESET_DRIFT_HOURS) {
      end = index;
      break;
    }
  }
  return readings.slice(first, end);
}
