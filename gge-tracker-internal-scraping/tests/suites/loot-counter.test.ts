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

import {
  LOOT_COUNTER_RANGE,
  LootReading,
  LootRunPlayer,
  MAX_WRAPS_PER_RUN,
  lootCounterValue,
  unwrapLoot,
  unwrapLootRun,
} from '../../src/loot-counter';
import { LootReset, parseLootReset } from '../../src/loot-reset';
import { fixtures } from '../harness/fixtures';

const R = LOOT_COUNTER_RANGE;
const PARIS: LootReset = parseLootReset('Europe/Paris', 'MON 00:00')!;
const LONDON: LootReset = parseLootReset('Europe/London', 'MON 00:00')!;
const HOUR = 3_600_000;

function player(raw: number, at: number, ...history: number[]): LootRunPlayer {
  return { raw, recent: history.map((point, index) => ({ at: at - (index + 1) * HOUR, point })) };
}

interface Replayed {
  at: string;
  raw: number;
  point: number;
  kind: string;
}

function replay(name: string): Replayed[] {
  const stream = fixtures.lootStreams().streams[name];
  const stored: LootReading[] = [];
  return stream.readings.map(([iso, raw]) => {
    const at = Date.parse(iso);
    const result = unwrapLoot(raw, at, [...stored].reverse(), parseLootReset(stream.resetTimezone, stream.resetTime)!);
    stored.push({ at, point: result.point });
    return { at: iso, raw, ...result };
  });
}

function at(readings: Replayed[], iso: string): Replayed {
  const reading = readings.find((candidate) => candidate.at === iso);
  assert.ok(reading, `no reading at ${iso}`);
  return reading;
}

function assertNeverDecreasesWithinAWeek(readings: Replayed[]): void {
  for (let i = 1; i < readings.length; i++) {
    if (readings[i].kind === 'fresh' || readings[i].kind === 'early-reset') continue;
    assert.ok(readings[i].point >= readings[i - 1].point, `${readings[i].at} went down without a reset`);
  }
}

describe('lootCounterValue', () => {
  it('reads a negative score as the unsigned counter the game meant', () => {
    assert.equal(lootCounterValue(-1), R - 1);
    assert.equal(lootCounterValue(-(2 ** 31)), 2 ** 31);
    assert.equal(lootCounterValue(2 ** 31 - 1), 2 ** 31 - 1);
  });

  it('leaves an already unsigned value alone, so a stored point reads back as its counter', () => {
    assert.equal(lootCounterValue(4_294_570_200), 4_294_570_200);
    assert.equal(lootCounterValue(R + 11_788_416), 11_788_416);
  });
});

describe('unwrapLoot', () => {
  it('counts both wraps of a player who passed 2^32 twice in one week', () => {
    const readings = replay('twoWrapsInOneWeek');
    assert.deepEqual(
      readings.filter((reading) => reading.kind === 'wrapped').map((reading) => reading.at),
      ['2026-10-01T20:37:10Z', '2026-10-03T20:37:10Z'],
    );
    assert.equal(at(readings, '2026-10-01T20:37:10Z').point, R + 114_387_403);
    assert.equal(at(readings, '2026-10-04T21:37:10Z').point, 2 * R + 368_248_298, 'the real peak of the week');
    assertNeverDecreasesWithinAWeek(readings);
  });

  it('starts the next week from the counter, never from the previous week', () => {
    const readings = replay('twoWrapsInOneWeek');
    assert.deepEqual(at(readings, '2026-09-27T22:37:10Z'), {
      at: '2026-09-27T22:37:10Z',
      raw: 9_082_637,
      point: 9_082_637,
      kind: 'fresh',
    });
    assert.equal(at(readings, '2026-10-04T22:37:11Z').point, 4_306_544);
  });

  it('follows a player gaining over a billion an hour through three wraps in one day', () => {
    const readings = replay('threeWrapsInOneDay');
    assert.equal(readings.filter((reading) => reading.kind === 'wrapped').length, 3);
    assert.equal(readings.at(-1)!.point, 3 * R + 3_623_475_249);
    assertNeverDecreasesWithinAWeek(readings);
  });

  it('accepts the fastest wrap measured in production, about 2 billion in one hour', () => {
    const wrap = at(replay('wrapAtTwoBillionPerHour'), '2026-07-25T13:32:08Z');
    assert.deepEqual([wrap.kind, wrap.point], ['wrapped', R + 1_915_034_107]);
  });

  it('keeps a wrap that lands in the last hour before the reset, when the gain matches the last hour', () => {
    const readings = replay('wrapRightBeforeReset');
    const wrap = at(readings, '2026-06-28T21:33:11Z');
    assert.deepEqual([wrap.kind, wrap.point], ['wrapped', R + 6_493_854]);
    assert.equal(at(readings, '2026-06-28T23:33:07Z').kind, 'fresh', 'and the reset still starts a new week');
  });

  it('reads an early reset on a WORLD server as a reset, not as 4 billion points', () => {
    const reading = at(replay('earlyResetOnWorld'), '2026-09-13T22:05:07Z');
    assert.deepEqual([reading.kind, reading.point], ['early-reset', 103_561]);
  });

  it('starts the AU1 week an hour earlier once Sydney is on summer time', () => {
    const readings = replay('sydneySummerTime');
    assert.deepEqual(at(readings, '2026-10-04T13:19:08Z'), {
      at: '2026-10-04T13:19:08Z',
      raw: 106_513,
      point: 106_513,
      kind: 'fresh',
    });
    assert.equal(at(readings, '2026-10-04T14:19:07Z').kind, 'counted');
  });

  it('stores a small mid-week decrease as it is', () => {
    const reading = at(replay('smallDecrease'), '2026-09-09T15:42:07Z');
    assert.deepEqual([reading.kind, reading.point], ['decreased', 5_515_149]);
  });

  it('keeps the wraps already counted this week through a decrease', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const recent = [{ at: now - 3_600_000, point: R + 500_000_000 }];
    assert.deepEqual(unwrapLoot(499_000_000, now, recent, PARIS), { point: R + 499_000_000, kind: 'decreased' });
  });

  it('spreads the allowed gain over the hours a player was not read', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const twoHoursAgo = { at: now - 2 * 3_600_000, point: 2_500_000_000 };
    const oneHourAgo = { ...twoHoursAgo, at: now - 3_600_000 };
    assert.equal(unwrapLoot(2_000_000_000, now, [twoHoursAgo], PARIS).kind, 'wrapped', '3.8 billion over two hours');
    assert.equal(unwrapLoot(2_000_000_000, now, [oneHourAgo], PARIS).kind, 'decreased', '3.8 billion in one hour');
  });

  it('accepts the fastest hours measured in production, 2.62 billion then a wrap at 2.58 billion (US1)', () => {
    const at = Date.parse('2026-10-11T00:07:08Z');
    const recent = [
      { at: at - 3_600_000, point: R + 2_937_565_872 },
      { at: at - 2 * 3_600_000, point: R + 316_202_937 },
    ];
    assert.deepEqual(unwrapLoot(1_218_436_974, at, recent, PARIS), { point: 2 * R + 1_218_436_974, kind: 'wrapped' });
  });

  it('still reads a drop of under 0.8 billion in one hour as a decrease, not a wrap', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const oneHourAgo = [{ at: now - 3_600_000, point: 1_500_000_000 }];
    assert.equal(
      unwrapLoot(750_000_000, now, oneHourAgo, PARIS).kind,
      'decreased',
      'a wrap would mean 3.54 billion in one hour',
    );
    assert.equal(
      unwrapLoot(650_000_000, now, oneHourAgo, PARIS).kind,
      'wrapped',
      'a wrap here means 3.44 billion in one hour',
    );
  });

  it('ignores readings older than the current week', () => {
    const now = Date.parse('2026-10-05T10:00:00Z');
    const lastWeek = [{ at: Date.parse('2026-10-04T21:00:00Z'), point: 2 * R + 100 }];
    assert.deepEqual(unwrapLoot(-5, now, lastWeek, PARIS), { point: R - 5, kind: 'fresh' });
  });
});

describe('unwrapLootRun', () => {
  it('never reads the 1.4 billion decrease measured on FR1 as a wrap', () => {
    const at = Date.parse('2026-03-22T21:08:09Z');
    const [reading] = unwrapLootRun([player(772_553_044, at, 2_189_559_026, 2_188_453_907)], {
      at,
      finishedAt: at,
      reset: PARIS,
    });
    assert.deepEqual(reading, { point: 772_553_044, kind: 'early-reset' });
  });

  it('refuses every wrap of a run still collecting when the reset fires', () => {
    const at = Date.parse('2026-10-04T21:30:00Z');
    const topPlayer = player(50_000_000, at, 4_000_000_000, 3_800_000_000);
    const beforeReset = unwrapLootRun([topPlayer], { at, finishedAt: at + 20 * 60_000, reset: PARIS });
    const acrossReset = unwrapLootRun([topPlayer], { at, finishedAt: at + 35 * 60_000, reset: PARIS });
    assert.equal(beforeReset[0].kind, 'wrapped', 'the same reading is a wrap when the whole run is before the reset');
    assert.deepEqual(acrossReset[0], { point: 50_000_000, kind: 'early-reset' });
  });

  it('reads several players dropping together before the reset as a reset, even one whose pace fits a wrap', () => {
    const at = Date.parse('2026-09-13T22:05:07Z');
    const results = unwrapLootRun(
      [
        player(30_000_000, at, 4_100_000_000, 3_900_000_000),
        player(100_000, at, 900_000_000),
        player(2_000_000, at, 1_500_000_000),
        player(700_000_000, at, 650_000_000),
      ],
      { at, finishedAt: at, reset: LONDON },
    );
    assert.deepEqual(
      results.map((result) => result.kind),
      ['early-reset', 'early-reset', 'early-reset', 'counted'],
    );
    assert.equal(results[0].point, 30_000_000);
  });

  it('keeps two wraps in the same run before the reset, as DE1 had on 2026-01-11', () => {
    const at = Date.parse('2026-01-11T21:37:10Z');
    const results = unwrapLootRun(
      [player(10_000_000, at, 4_285_000_000, 4_280_000_000), player(8_000_000, at, 4_288_000_000, 4_278_700_000)],
      { at, finishedAt: at, reset: PARIS },
    );
    assert.deepEqual(results, [
      { point: R + 10_000_000, kind: 'wrapped' },
      { point: R + 8_000_000, kind: 'wrapped' },
    ]);
  });

  it('keeps every wrap of a mid-week run, however many players wrap at once', () => {
    const at = Date.parse('2026-07-19T00:37:10Z');
    const results = unwrapLootRun(
      [
        player(50_000_000, at, 4_200_000_000),
        player(80_000_000, at, 4_100_000_000),
        player(20_000_000, at, 4_250_000_000),
      ],
      { at, finishedAt: at, reset: PARIS },
    );
    assert.deepEqual(
      results.map((result) => result.kind),
      ['wrapped', 'wrapped', 'wrapped'],
    );
  });

  it('refuses every wrap of a run where more than 50 players would gain 2^32, keeping the wraps already counted', () => {
    const at = Date.parse('2026-07-15T12:00:00Z');
    const wrapping = (count: number): LootRunPlayer[] =>
      Array.from({ length: count }, (_, index) => player(10_000_000 + index, at, R + 4_200_000_000));
    const limit = unwrapLootRun(wrapping(MAX_WRAPS_PER_RUN), { at, finishedAt: at, reset: PARIS });
    const beyond = unwrapLootRun(wrapping(MAX_WRAPS_PER_RUN + 1), { at, finishedAt: at, reset: PARIS });
    assert.ok(
      limit.every((result) => result.kind === 'wrapped'),
      '50 wraps in one run are still believed',
    );
    assert.ok(beyond.every((result) => result.kind === 'refused'));
    assert.deepEqual(beyond[0], { point: R + 10_000_000, kind: 'refused' });
  });
});
