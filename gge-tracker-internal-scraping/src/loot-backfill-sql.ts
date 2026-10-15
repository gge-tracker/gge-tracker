//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { LOOT_COUNTER_RANGE } from './loot-counter';
import { CorrectionSegment } from './loot-backfill-replay';

const R = LOOT_COUNTER_RANGE;

function table(database: string): string {
  if (!/^\w+$/.test(database)) throw new Error(`Unexpected ClickHouse database name: ${database}`);
  return `\`${database}\`.player_loot_history`;
}

function seconds(instant: number): number {
  return Math.floor(instant / 1000);
}

function integer(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Unexpected value in a loot mutation: ${value}`);
  return String(value);
}

export function firstReadingQuery(database: string, since: number): string {
  return `SELECT toUnixTimestamp(min(created_at)) FROM ${table(database)} WHERE created_at >= toDateTime(${seconds(since)})`;
}

export interface LootWeek {
  start: number;
  end: number;
}

// One row per drop of the counter between two readings of the same week; week is the 1-based index in weeks
export function midWeekDropsQuery(database: string, weeks: LootWeek[]): string {
  const ends = `[${weeks.map((week) => `toUInt32(${seconds(week.end)})`).join(', ')}]`;
  const from = seconds(weeks[0].start);
  return `
    SELECT player_id, toUnixTimestamp(created_at) AS at, arrayFirstIndex(end -> end > toUnixTimestamp(created_at), ${ends}) AS week
    FROM
    (
        SELECT player_id, created_at, point % ${R} AS counter,
            lagInFrame(point % ${R}) OVER w AS previous,
            lagInFrame(created_at) OVER w AS previous_at
        FROM ${table(database)}
        WHERE created_at >= toDateTime(${from}) AND created_at < toDateTime(${seconds(weeks.at(-1)!.end)})
        WINDOW w AS (PARTITION BY player_id ORDER BY created_at ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
    )
    WHERE previous_at > toDateTime(0)
      AND counter < previous
      AND arrayFirstIndex(end -> end > toUnixTimestamp(created_at), ${ends}) = arrayFirstIndex(end -> end > toUnixTimestamp(previous_at), ${ends})
      AND arrayFirstIndex(end -> end > toUnixTimestamp(created_at), ${ends}) > 0`.trim();
}

export function weekReadingsQuery(database: string, weekStart: number, weekEnd: number, players: number[]): string {
  return `
  SELECT player_id, toUnixTimestamp(created_at), point
  FROM ${table(database)}
  WHERE created_at >= toDateTime(${seconds(weekStart)}) AND created_at < toDateTime(${seconds(weekEnd)})
    AND player_id IN (${players.map(integer).join(', ')})
  ORDER BY created_at, player_id`.trim();
}

function segmentCondition(segment: CorrectionSegment, base: number): string {
  return (
    `(player_id = ${integer(segment.player)}` +
    ` AND created_at BETWEEN toDateTime(${seconds(segment.from)}) AND toDateTime(${seconds(segment.to)})` +
    ` AND intDiv(point, ${R}) = ${integer(base)})`
  );
}

export function segmentsCountQuery(database: string, segments: CorrectionSegment[], side: 'before' | 'after'): string {
  const conditions = segments.map((segment) =>
    segmentCondition(segment, side === 'before' ? segment.beforeBase : segment.afterBase),
  );
  return `SELECT count() FROM ${table(database)} WHERE ${conditions.join(' OR ')}`;
}

export function segmentsMutation(database: string, segments: CorrectionSegment[]): string {
  const branches = segments.map(
    (segment) => `${segmentCondition(segment, segment.beforeBase)}, point % ${R} + ${integer(segment.afterBase * R)}`,
  );
  const conditions = segments.map((segment) => segmentCondition(segment, segment.beforeBase));
  return `ALTER TABLE ${table(database)} UPDATE point = multiIf(${branches.join(', ')}, point) WHERE ${conditions.join(' OR ')}`;
}

export function pendingMutationsQuery(database: string): string {
  if (!/^\w+$/.test(database)) throw new Error(`Unexpected ClickHouse database name: ${database}`);
  return `SELECT count() FROM system.mutations WHERE database = '${database}' AND table = 'player_loot_history' AND is_done = 0`;
}

export function reverseSegments(segments: CorrectionSegment[]): CorrectionSegment[] {
  return segments.map((segment) => ({ ...segment, beforeBase: segment.afterBase, afterBase: segment.beforeBase }));
}
