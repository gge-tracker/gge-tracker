//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { StoredLoot, replayLootWeek } from '../../src/loot-backfill-replay';
import {
  midWeekDropsQuery,
  reverseSegments,
  segmentsCountQuery,
  segmentsMutation,
  weekReadingsQuery,
} from '../../src/loot-backfill-sql';
import { LOOT_COUNTER_RANGE, LootReading, lootCounterValue, unwrapLoot } from '../../src/loot-counter';
import { LootReset, lootWeekStart, parseLootReset } from '../../src/loot-reset';
import { fixtures } from '../harness/fixtures';

const R = LOOT_COUNTER_RANGE;
const PARIS: LootReset = parseLootReset('Europe/Paris', 'MON 00:00')!;
const HOUR = 3_600_000;
// Wednesday 2026-09-16 10:00 UTC, mid-week on every server
const WEDNESDAY = Date.parse('2026-09-16T10:00:00Z');

function hourly(player: number, points: number[], from = WEDNESDAY): StoredLoot[] {
  return points.map((point, index) => ({ player, at: from + index * HOUR, point }));
}

function replayStream(name: string): { stored: StoredLoot[]; live: number[]; afterBackfill: number[] } {
  const stream = fixtures.lootStreams().streams[name];
  const reset = parseLootReset(stream.resetTimezone, stream.resetTime)!;
  const stored = stream.readings.map(([iso, raw]) => ({
    player: 1,
    at: Date.parse(iso),
    point: lootCounterValue(raw),
  }));
  const history: LootReading[] = [];
  const live = stream.readings.map(([iso, raw]) => {
    const point = unwrapLoot(raw, Date.parse(iso), [...history].reverse(), reset).point;
    history.push({ at: Date.parse(iso), point });
    return point;
  });
  const weeks = new Map<number, StoredLoot[]>();
  for (const row of stored) {
    const week = lootWeekStart(row.at, reset);
    weeks.set(week, [...(weeks.get(week) ?? []), row]);
  }
  const corrected = new Map<number, number>();
  for (const [week, rows] of weeks) {
    for (const correction of replayLootWeek(rows, week, reset).corrections)
      corrected.set(correction.at, correction.after);
  }
  return { stored, live, afterBackfill: stored.map((row) => corrected.get(row.at) ?? row.point) };
}

describe('loot backfill replay', () => {
  for (const name of ['twoWrapsInOneWeek', 'threeWrapsInOneDay', 'wrapAtTwoBillionPerHour', 'wrapRightBeforeReset']) {
    it(`rebuilds ${name} exactly as the live fill stores it`, () => {
      const { live, afterBackfill } = replayStream(name);
      assert.deepEqual(afterBackfill, live);
    });
  }

  it('leaves the WORLD early reset and the small decrease as they are stored', () => {
    for (const name of ['earlyResetOnWorld', 'smallDecrease']) {
      const { stored, afterBackfill } = replayStream(name);
      assert.deepEqual(
        afterBackfill,
        stored.map((row) => row.point),
        name,
      );
    }
  });

  it('corrects every reading after a wrap, and only those', () => {
    const replay = replayLootWeek(hourly(7, [4_000_000_000, 4_200_000_000, 100_000_000, 300_000_000]), 0, PARIS);
    assert.deepEqual(
      replay.corrections.map((each) => [each.before, each.after]),
      [
        [100_000_000, R + 100_000_000],
        [300_000_000, R + 300_000_000],
      ],
    );
    assert.deepEqual(replay.segments, [
      { player: 7, from: WEDNESDAY + 2 * HOUR, to: WEDNESDAY + 3 * HOUR, beforeBase: 0, afterBase: 1, rows: 2 },
    ]);
    assert.equal(replay.peaks.get(7), R + 300_000_000);
  });

  it('changes nothing on a week the live fill already unwrapped', () => {
    const replay = replayLootWeek(
      hourly(7, [4_000_000_000, 4_200_000_000, R + 100_000_000, R + 300_000_000]),
      0,
      PARIS,
    );
    assert.deepEqual([replay.corrections, replay.skipped], [[], []]);
  });

  it('cuts one segment per wrap, so a single mutation never mixes two bases', () => {
    const replay = replayLootWeek(
      hourly(7, [4_000_000_000, 100_000_000, 1_400_000_000, 2_700_000_000, 4_000_000_000, 1_000_000_000]),
      0,
      PARIS,
    );
    assert.deepEqual(
      replay.segments.map((segment) => [segment.beforeBase, segment.afterBase, segment.rows]),
      [
        [0, 1, 4],
        [0, 2, 1],
      ],
    );
  });

  it('refuses the 2^31 drops of old DE1 rows that the live rules would read as a wrap', () => {
    const replay = replayLootWeek(
      hourly(5_499_229, [2_745_000_000, 2_751_008_914, 2_757_262_910, 617_516_099, 625_489_878, 3_025_098_514]),
      0,
      PARIS,
    );
    assert.deepEqual([replay.corrections, replay.skipped], [[], []]);
    assert.equal(replay.refusedByStrictRules, 1);
  });

  it('refuses a one-hour 2^31 dip even though the restore looks like a fast hour', () => {
    const replay = replayLootWeek(
      hourly(5_499_229, [2_745_000_000, 2_757_262_910, 617_516_099, 2_775_000_000, 2_785_000_000]),
      0,
      PARIS,
    );
    assert.deepEqual([replay.corrections, replay.skipped], [[], []]);
  });

  it('keeps a wrap after a pause when the next two hours confirm the pace', () => {
    const replay = replayLootWeek(
      hourly(674_513, [3_810_075_683, 3_811_989_683, 149_973_033, 1_276_726_722, 2_420_416_393]),
      0,
      PARIS,
    );
    assert.deepEqual(
      replay.corrections.map((each) => each.after),
      [R + 149_973_033, R + 1_276_726_722, R + 2_420_416_393],
    );
  });

  it('refuses a small decrease after a skipped reading, which the live cap reads as a wrap', () => {
    const rows = [
      { player: 9_885_852, at: WEDNESDAY, point: 5_944_250 },
      { player: 9_885_852, at: WEDNESDAY + 2 * HOUR, point: 5_944_186 },
    ];
    const replay = replayLootWeek(rows, 0, PARIS);
    assert.deepEqual([replay.corrections, replay.refusedByStrictRules], [[], 1]);
  });

  it('never lets a skipped reading widen the cap, even for a player whose pace would allow it', () => {
    const rows = [
      ...hourly(7, [1_000_000_000, 1_800_000_000, 2_600_000_000]),
      { player: 7, at: WEDNESDAY + 4 * HOUR, point: 2_599_999_936 },
    ];
    assert.deepEqual(replayLootWeek(rows, 0, PARIS).corrections, []);
  });

  it('never lowers a stored point, and leaves that week alone', () => {
    const replay = replayLootWeek(hourly(7, [100_000_000, R + 50_000_000]), 0, PARIS);
    assert.deepEqual(replay.corrections, []);
    assert.deepEqual(
      replay.skipped.map((each) => [each.player, each.reason]),
      [[7, 'conflict']],
    );
  });

  it('leaves alone a week where the counter goes down again after a wrap', () => {
    const replay = replayLootWeek(hourly(7, [4_200_000_000, 100_000_000, 99_999_000]), 0, PARIS);
    assert.deepEqual(replay.corrections, []);
    assert.deepEqual(
      replay.skipped.map((each) => each.reason),
      ['inconsistent'],
    );
  });

  it('applies the 50-wrap refusal to the run as a whole', () => {
    const rows = Array.from({ length: 51 }, (_, index) => hourly(index + 1, [4_200_000_000, 100_000_000])).flat();
    assert.deepEqual(replayLootWeek(rows, 0, PARIS).corrections, []);
  });
});

describe('loot backfill SQL', () => {
  const segment = { player: 7, from: WEDNESDAY, to: WEDNESDAY + HOUR, beforeBase: 0, afterBase: 1, rows: 2 };

  it('rewrites only rows still holding the old base, keeping their counter', () => {
    assert.equal(
      segmentsMutation('empire_ranking_de1', [segment]),
      'ALTER TABLE `empire_ranking_de1`.player_loot_history UPDATE point = multiIf(' +
        '(player_id = 7 AND created_at BETWEEN toDateTime(1789552800) AND toDateTime(1789556400) AND intDiv(point, 4294967296) = 0), ' +
        'point % 4294967296 + 4294967296, point) WHERE ' +
        '(player_id = 7 AND created_at BETWEEN toDateTime(1789552800) AND toDateTime(1789556400) AND intDiv(point, 4294967296) = 0)',
    );
  });

  it('counts the same rows before and after with the matching base', () => {
    assert.match(segmentsCountQuery('db', [segment], 'before'), /intDiv\(point, 4294967296\) = 0\)$/);
    assert.match(segmentsCountQuery('db', [segment], 'after'), /intDiv\(point, 4294967296\) = 1\)$/);
  });

  it('rolls back by swapping the bases', () => {
    assert.deepEqual(reverseSegments([segment]), [{ ...segment, beforeBase: 1, afterBase: 0 }]);
  });

  it('refuses a database name it would have to escape', () => {
    assert.throws(() => segmentsMutation('db`; DROP', [segment]), /Unexpected ClickHouse database name/);
    assert.throws(() => weekReadingsQuery('db', 0, HOUR, [1.5]), /Unexpected value/);
  });

  it('only looks for drops between two readings of the same week', () => {
    const query = midWeekDropsQuery('db', [{ start: 0, end: 168 * HOUR }]);
    assert.match(query, /= arrayFirstIndex\(end -> end > toUnixTimestamp\(previous_at\)/);
    assert.match(query, /counter < previous/);
  });
});
