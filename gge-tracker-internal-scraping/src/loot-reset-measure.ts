//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { LootReset, lootResetOffsetHours, lootWeekStart } from './loot-reset';

const MS_PER_HOUR = 3_600_000;
const CLUSTER_GAP_HOURS = 6;
const MIN_DROPS = 5;
const MEDIAN_SHARE = 0.3;

export interface ResetMeasureOptions {
  windowDays: number;
  minPeak: number;
}

export const defaultOptions: ResetMeasureOptions = {
  windowDays: 400,
  minPeak: 1_000_000,
};

export function buildResetQuery(database: string, options: ResetMeasureOptions = defaultOptions): string {
  return `
    WITH (SELECT max(created_at) FROM \`${database}\`.player_loot_history) AS latest
    SELECT formatDateTime(toStartOfHour(created_at), '%F %H', 'UTC') AS drop_hour, count() AS drops
    FROM
    (
      SELECT created_at, point,
        lagInFrame(point) OVER w AS previous,
        lagInFrame(created_at) OVER w AS previous_at
      FROM \`${database}\`.player_loot_history
      WHERE created_at >= latest - INTERVAL ${options.windowDays} DAY
      WINDOW w AS (PARTITION BY player_id ORDER BY created_at ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
    )
    WHERE previous_at > toDateTime(0)
      AND dateDiff('minute', previous_at, created_at) <= 70
      AND previous >= ${options.minPeak}
      AND point < previous / 10
    GROUP BY drop_hour
    ORDER BY drop_hour`.trim();
}

export interface MeasuredReset {
  hour: string;
  instant: number;
  drops: number;
}

export function measuredResets(rows: string[][]): MeasuredReset[] {
  const hours = rows
    .map(([hour, drops]) => ({ hour, instant: Date.parse(`${hour.replace(' ', 'T')}:00:00Z`), drops: Number(drops) }))
    .filter((row) => !Number.isNaN(row.instant))
    .sort((a, b) => a.instant - b.instant);
  const clusters: MeasuredReset[][] = [];
  for (const hour of hours) {
    const current = clusters.at(-1);
    if (current && hour.instant - current.at(-1)!.instant <= CLUSTER_GAP_HOURS * MS_PER_HOUR) current.push(hour);
    else clusters.push([hour]);
  }
  const peaks = clusters.map((cluster) => cluster.reduce((best, hour) => (hour.drops > best.drops ? hour : best)));
  const sorted = peaks.map((peak) => peak.drops).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return peaks.filter((peak) => peak.drops >= Math.max(MIN_DROPS, median * MEDIAN_SHARE));
}

export interface ResetMismatch {
  hour: string;
  expected: string;
}

export interface ResetJudgement {
  weeks: number;
  mismatches: ResetMismatch[];
  offsetsSeen: number[];
}

function hourLabel(instant: number): string {
  return new Date(instant).toISOString().slice(0, 13).replace('T', ' ');
}

export function judge(resets: MeasuredReset[], reset: LootReset): ResetJudgement {
  const mismatches: ResetMismatch[] = [];
  const offsets = new Set<number>();
  for (const measured of resets) {
    const expected = lootWeekStart(measured.instant + MS_PER_HOUR - 1, reset);
    offsets.add(lootResetOffsetHours(measured.instant, reset));
    if (expected <= measured.instant - MS_PER_HOUR) {
      const next = lootWeekStart(measured.instant + 84 * MS_PER_HOUR, reset);
      const nearest = Math.abs(next - measured.instant) < Math.abs(expected - measured.instant) ? next : expected;
      mismatches.push({ hour: measured.hour, expected: hourLabel(nearest) });
    }
  }
  return { weeks: resets.length, mismatches, offsetsSeen: [...offsets].sort((a, b) => a - b) };
}

export function observesDaylightSaving(reset: LootReset, around: number): boolean {
  const offsets = new Set<number>();
  for (let week = 0; week < 53; week++) offsets.add(lootResetOffsetHours(around - week * 168 * MS_PER_HOUR, reset));
  return offsets.size > 1;
}
