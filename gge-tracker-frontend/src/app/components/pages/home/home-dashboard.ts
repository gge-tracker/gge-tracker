import {
  ApiAllianceMemberChange,
  ApiGenericData,
  ApiPlayerStatsSummaryEvent,
  ApiPlayerStatsType,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { HOURS_PER_WEEK, MS_PER_HOUR, weekStartOf } from '../compare/compare-loot/compare-loot-weeks';

export type Trend = 'up' | 'down' | 'flat';

export interface Delta {
  value: number;
  trend: Trend;
}

export interface Reading {
  at: number;
  value: number;
}

export interface Sparkline {
  line: string;
  area: string;
  trend: Trend;
}

export interface EventDefinition {
  table: ApiPlayerStatsType;
  label: string;
  icon: string;
}

export interface WeekEvent extends EventDefinition {
  score: number;
  record: number;
  isRecord: boolean;
  isLive: boolean;
  lastAt: number;
}

export interface LootWeek {
  value: number;
  sameTimeLastWeek: number | null;
  lastWeekTotal: number | null;
  current: Sparkline | null;
  previous: Sparkline | null;
}

export interface MembershipMoves {
  joined: number;
  left: number;
}

export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MS_PER_WEEK = HOURS_PER_WEEK * MS_PER_HOUR;
const MINUS = '\u2212';
const compactNumber = new FormatNumberPipe();
const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 32;
const SPARKLINE_PADDING = 2;
const COLLECTION_JITTER_MS = MS_PER_HOUR / 2;
const LIVE_EVENT_TOLERANCE_MS = 2 * MS_PER_HOUR;

export function trendOf(value: number): Trend {
  if (value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

export function deltaOf(
  current: number | null | undefined,
  previous: number | null | undefined,
  lowerIsBetter = false,
): Delta | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const value = current - previous;
  if (value === 0) return { value, trend: 'flat' };
  const improved = lowerIsBetter ? value < 0 : value > 0;
  return { value, trend: improved ? 'up' : 'down' };
}

export function readingsOf(points: ApiGenericData[] | undefined): Reading[] {
  return (points ?? [])
    .map((point) => ({ at: Date.parse(point.utcDate ?? point.date), value: Number(point.point) }))
    .filter((reading) => Number.isFinite(reading.at) && Number.isFinite(reading.value))
    .sort((a, b) => a.at - b.at);
}

export function valueAt(readings: Reading[], instant: number): number | null {
  return readingUpTo(readings, instant + COLLECTION_JITTER_MS)?.value ?? null;
}

export function lootAt(readings: Reading[], instant: number, resetOffset: number | null): number | null {
  const weekStart = weekStartOf(instant, resetOffset);
  const last = readingUpTo(readings, Math.min(instant + COLLECTION_JITTER_MS, weekStart + MS_PER_WEEK - 1));
  if (!last) return null;
  return last.at >= weekStart ? last.value : 0;
}

function readingUpTo(readings: Reading[], limit: number): Reading | null {
  let last: Reading | null = null;
  for (const reading of readings) {
    if (reading.at > limit) break;
    last = reading;
  }
  return last;
}

export function sparklineOf(
  readings: Reading[],
  from: number,
  to: number,
  scale: { low?: number; high?: number } = {},
): Sparkline | null {
  const visible = readings.filter((reading) => reading.at >= from && reading.at <= to);
  if (visible.length < 2) return null;
  const values = visible.map((reading) => reading.value);
  const low = scale.low ?? Math.min(...values);
  const high = scale.high ?? Math.max(...values);
  const range = high - low || 1;
  const drawable = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;
  const coordinates = visible.map((reading) => {
    const x = ((reading.at - from) / (to - from)) * SPARKLINE_WIDTH;
    const y = SPARKLINE_PADDING + drawable - ((reading.value - low) / range) * drawable;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const firstX = coordinates[0].split(',')[0];
  const lastX = coordinates.at(-1)!.split(',')[0];
  return {
    line: `M${coordinates.join(' L')}`,
    area: `M${firstX},${SPARKLINE_HEIGHT} L${coordinates.join(' L')} L${lastX},${SPARKLINE_HEIGHT} Z`,
    trend: trendOf(values.at(-1)! - values[0]),
  };
}

// Both sides are read at the same collection hour, so the comparison never depends on the clock
export function lootWeekOf(readings: Reading[], resetOffset: number | null, now: number): LootWeek {
  const weekStart = weekStartOf(now, resetOffset);
  const previousStart = weekStart - MS_PER_WEEK;
  const thisWeek = readings.filter((reading) => reading.at >= weekStart);
  const lastWeek = readings.filter((reading) => reading.at >= previousStart && reading.at < weekStart);
  const latest = thisWeek.at(-1) ?? null;
  const at = latest?.at ?? now;
  const hasLastWeek = readings.some((reading) => reading.at < weekStart);
  const current = [{ at: weekStart, value: 0 }, ...thisWeek];
  const previous = [
    { at: weekStart, value: 0 },
    ...lastWeek.map((reading) => ({ ...reading, at: reading.at + MS_PER_WEEK })),
  ];
  const scale = { low: 0, high: Math.max(...current.map((r) => r.value), ...previous.map((r) => r.value)) };
  const weekEnd = weekStart + MS_PER_WEEK;
  return {
    value: latest?.value ?? 0,
    sameTimeLastWeek: hasLastWeek ? (lootAt(readings, at - MS_PER_WEEK, resetOffset) ?? 0) : null,
    lastWeekTotal: hasLastWeek ? (lastWeek.at(-1)?.value ?? 0) : null,
    current: sparklineOf(current, weekStart, weekEnd, scale),
    previous: hasLastWeek ? sparklineOf(previous, weekStart, weekEnd, scale) : null,
  };
}

export function eventsOfTheWeek(
  summaries: Partial<Record<ApiPlayerStatsType, ApiPlayerStatsSummaryEvent>>,
  definitions: EventDefinition[],
  now: number,
): WeekEvent[] {
  const events: WeekEvent[] = [];
  for (const definition of definitions) {
    const summary = summaries[definition.table];
    if (!summary?.last_date || summary.last_point === null || summary.max_point === null) continue;
    const lastAt = Date.parse(summary.last_date);
    if (now - lastAt > MS_PER_WEEK) continue;
    events.push({
      ...definition,
      score: summary.last_point,
      record: summary.max_point,
      isRecord: summary.last_point >= summary.max_point,
      isLive: now - lastAt <= LIVE_EVENT_TOLERANCE_MS,
      lastAt,
    });
  }
  return events.sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.lastAt - a.lastAt);
}

export function membershipMovesSince(changes: ApiAllianceMemberChange[], since: number): MembershipMoves {
  const firstAndLast = new Map<string, [string, string]>();
  const recent = changes
    .filter((change) => Date.parse(change.occurred_at) >= since)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  for (const change of recent) {
    const known = firstAndLast.get(change.player_id);
    firstAndLast.set(change.player_id, [known?.[0] ?? change.direction, change.direction]);
  }
  const moves = { joined: 0, left: 0 };
  for (const [first, last] of firstAndLast.values()) {
    if (first !== last) continue;
    if (last === 'joined') moves.joined++;
    else moves.left++;
  }
  return moves;
}

export function nextWeeklyReset(now: number, resetOffsetHours: number | null): number {
  return weekStartOf(now, resetOffsetHours) + MS_PER_WEEK;
}

export function formatCountdown(milliseconds: number, language: string): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: 'day' | 'hour' | 'minute'): string =>
    new Intl.NumberFormat(language, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value);
  const parts = days > 0 ? [unit(days, 'day'), unit(hours, 'hour')] : [unit(hours, 'hour'), unit(minutes, 'minute')];
  return parts.join(' ');
}

export function formatCompact(value: number): string {
  return compactNumber.transform(value);
}

export function formatSigned(value: number): string {
  const formatted = formatCompact(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  return value < 0 ? `${MINUS}${formatted}` : formatted;
}

export function formatSignedPercent(ratio: number, language: string): string {
  const formatted = new Intl.NumberFormat(language, {
    style: 'percent',
    maximumFractionDigits: Math.abs(ratio) < 0.1 ? 1 : 0,
  }).format(Math.abs(ratio));
  if (ratio > 0) return `+${formatted}`;
  return ratio < 0 ? `${MINUS}${formatted}` : formatted;
}

export function formatTopPercent(rank: number, total: number, language: string): string {
  const share = Math.max(rank / total, 0.0001);
  return new Intl.NumberFormat(language, {
    style: 'percent',
    maximumSignificantDigits: share < 0.1 ? 2 : 3,
  }).format(share);
}
