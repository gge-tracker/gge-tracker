//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { LOOT_COUNTER_RANGE, LootReading, LootReadingKind, lootCounterValue, unwrapLootRun } from './loot-counter';
import { LootReset } from './loot-reset';

// A past run's finish is not stored; production unwraps loot 30-90s after the run starts (2026-10-15)
export const ASSUMED_RUN_DURATION_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

export interface StoredLoot {
  player: number;
  at: number;
  point: number;
}

export interface LootCorrection {
  player: number;
  at: number;
  before: number;
  after: number;
}

export type SkipReason = 'conflict' | 'inconsistent';

export interface SkippedPlayerWeek {
  player: number;
  weekStart: number;
  reason: SkipReason;
  readings: ReplayedLoot[];
}

export interface ReplayedLoot {
  at: number;
  before: number;
  after: number;
  kind: LootReadingKind;
}

export interface CorrectionSegment {
  player: number;
  from: number;
  to: number;
  beforeBase: number;
  afterBase: number;
  rows: number;
}

export interface WeekReplay {
  corrections: LootCorrection[];
  segments: CorrectionSegment[];
  peaks: Map<number, number>;
  skipped: SkippedPlayerWeek[];
  refusedByStrictRules: number;
}

function runsOf(rows: StoredLoot[]): Map<number, StoredLoot[]> {
  const runs = new Map<number, StoredLoot[]>();
  for (const row of [...rows].sort((a, b) => a.at - b.at || a.player - b.player)) {
    const run = runs.get(row.at) ?? [];
    run.push(row);
    runs.set(row.at, run);
  }
  return runs;
}

function hourlyPace(from: StoredLoot, to: StoredLoot | undefined): number {
  if (!to) return 0;
  const gain = lootCounterValue(to.point) - lootCounterValue(from.point);
  return Math.max(0, gain) / Math.max(1, Math.round((to.at - from.at) / HOUR_MS));
}

function nextPaces(rows: StoredLoot[]): Map<StoredLoot, number> {
  const byPlayer = new Map<number, StoredLoot[]>();
  for (const row of [...rows].sort((a, b) => a.at - b.at))
    byPlayer.set(row.player, [...(byPlayer.get(row.player) ?? []), row]);
  const paces = new Map<StoredLoot, number>();
  for (const readings of byPlayer.values()) {
    readings.forEach((row, index) => {
      const next = readings[index + 1];
      paces.set(row, next ? Math.min(hourlyPace(row, next), hourlyPace(next, readings[index + 2])) : 0);
    });
  }
  return paces;
}

function replayRuns(rows: StoredLoot[], reset: LootReset, replay: boolean): Map<number, ReplayedLoot[]> {
  const recent = new Map<number, LootReading[]>();
  const paces = nextPaces(rows);
  const replayed = new Map<number, ReplayedLoot[]>();
  for (const [at, run] of runsOf(rows)) {
    const results = unwrapLootRun(
      run.map((row) => ({ raw: row.point, recent: recent.get(row.player) ?? [], nextPace: paces.get(row) })),
      { at, finishedAt: at + ASSUMED_RUN_DURATION_MS, reset, replay },
    );
    for (const [index, row] of run.entries()) {
      const result = results[index];
      recent.set(row.player, [{ at, point: result.point }, ...(recent.get(row.player) ?? [])].slice(0, 2));
      const readings = replayed.get(row.player) ?? [];
      readings.push({ at, before: row.point, after: result.point, kind: result.kind });
      replayed.set(row.player, readings);
    }
  }
  return replayed;
}

function judgePlayerWeek(readings: ReplayedLoot[]): SkipReason | 'corrected' | 'unchanged' {
  if (readings.some((reading) => reading.after < reading.before)) return 'conflict';
  if (readings.some((reading) => (reading.after - reading.before) % LOOT_COUNTER_RANGE !== 0)) return 'conflict';
  if (readings.every((reading) => reading.after === reading.before)) return 'unchanged';
  const firstWrap = readings.findIndex((reading) => reading.kind === 'wrapped');
  const afterWrap = readings.slice(firstWrap + 1);
  if (afterWrap.some((reading) => reading.kind === 'decreased' || reading.kind === 'refused')) return 'inconsistent';
  return 'corrected';
}

function baseOf(point: number): number {
  return Math.floor(point / LOOT_COUNTER_RANGE);
}

function segmentsOf(player: number, readings: ReplayedLoot[]): CorrectionSegment[] {
  const segments: CorrectionSegment[] = [];
  let open: CorrectionSegment | undefined;
  for (const reading of readings) {
    if (reading.after === reading.before) {
      open = undefined;
      continue;
    }
    const beforeBase = baseOf(reading.before);
    const afterBase = baseOf(reading.after);
    if (open && open.beforeBase === beforeBase && open.afterBase === afterBase) {
      open.to = reading.at;
      open.rows++;
      continue;
    }
    open = { player, from: reading.at, to: reading.at, beforeBase, afterBase, rows: 1 };
    segments.push(open);
  }
  return segments;
}

function wraps(readings: ReplayedLoot[] | undefined): number {
  return readings?.filter((reading) => reading.kind === 'wrapped').length ?? 0;
}

export function replayLootWeek(rows: StoredLoot[], weekStart: number, reset: LootReset): WeekReplay {
  const replayed = replayRuns(rows, reset, true);
  const live = replayRuns(rows, reset, false);
  const replay: WeekReplay = { corrections: [], segments: [], peaks: new Map(), skipped: [], refusedByStrictRules: 0 };
  for (const [player, readings] of replayed) {
    replay.refusedByStrictRules += Math.max(0, wraps(live.get(player)) - wraps(readings));
    const verdict = judgePlayerWeek(readings);
    if (verdict === 'unchanged') continue;
    if (verdict !== 'corrected') {
      replay.skipped.push({ player, weekStart, reason: verdict, readings });
      continue;
    }
    for (const reading of readings) {
      if (reading.after === reading.before) continue;
      replay.corrections.push({ player, at: reading.at, before: reading.before, after: reading.after });
    }
    replay.segments.push(...segmentsOf(player, readings));
    replay.peaks.set(player, Math.max(...readings.map((reading) => reading.after)));
  }
  return replay;
}
