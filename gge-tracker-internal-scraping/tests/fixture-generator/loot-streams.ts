//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { LootReading, unwrapLoot } from '../../src/loot-counter';
import { parseLootReset } from '../../src/loot-reset';
import { Random } from './random';

const R = 2 ** 32;
const HOUR = 3_600_000;

interface Stream {
  server: string;
  resetTimezone: string;
  resetTime: string;
  readings: [string, number][];
}

interface Scenario {
  server: string;
  timezone: string;
  totals: [number, number][];
  // What the unwrap must read: the true weekly total, and the kind, at the readings that make the case
  expect: { at: number; kind: string; point: number }[];
}

const iso = (instant: number): string => new Date(instant).toISOString().replace('.000Z', 'Z');

function fromGains(from: number, start: number, gains: number[]): [number, number][] {
  const totals: [number, number][] = [[from, start]];
  for (const gain of gains) totals.push([totals.at(-1)![0] + HOUR, totals.at(-1)![1] + gain]);
  return totals;
}

function hourly(
  random: Random,
  from: number,
  start: number,
  hours: number,
  pace: number,
  spread = 0.4,
): [number, number][] {
  const totals: [number, number][] = [];
  let total = start;
  for (let hour = 0; hour < hours; hour++) {
    totals.push([from + hour * HOUR + random.integer(0, 2) * 1000, total]);
    total += Math.round(pace * random.between(1 - spread, 1 + spread));
  }
  return totals;
}

// A reading carries the total modulo 2^32, exactly what the game stores in its counter
function toStream(scenario: Scenario): Stream {
  return {
    server: scenario.server,
    resetTimezone: scenario.timezone,
    resetTime: 'MON 00:00',
    readings: scenario.totals.map(([at, total]) => [iso(at), total % R]),
  };
}

function verify(name: string, scenario: Scenario): void {
  const reset = parseLootReset(scenario.timezone, 'MON 00:00')!;
  const stored: LootReading[] = [];
  const results = new Map<number, { kind: string; point: number }>();
  for (const [at, total] of scenario.totals) {
    const result = unwrapLoot(total % R, at, [...stored].reverse(), reset);
    stored.push({ at, point: result.point });
    results.set(at, result);
  }
  for (const expected of scenario.expect) {
    const actual = results.get(expected.at);
    if (actual?.kind !== expected.kind || actual.point !== expected.point) {
      throw new Error(
        `${name} at ${iso(expected.at)}: expected ${expected.kind} ${expected.point}, the unwrap read ${actual?.kind} ${actual?.point}`,
      );
    }
  }
}

const wrapsOf = (totals: [number, number][]): [number, number][] =>
  totals.filter(([, total], index) => index > 0 && Math.floor(total / R) > Math.floor(totals[index - 1][1] / R));

function scenarios(random: Random): Record<string, Scenario> {
  // DE1, Paris: the week of Monday 28 September (Sunday 22:00 UTC), at about 54 million an hour
  const week = hourly(random, Date.parse('2026-09-27T22:37:10Z'), 7_164_219, 168, 54_000_000, 0.2);
  const nextWeek: [number, number] = [Date.parse('2026-10-04T22:37:11Z'), 3_918_406];
  const twoWraps = [
    [Date.parse('2026-09-27T20:37:10Z'), 2_391_552_204],
    [Date.parse('2026-09-27T21:37:10Z'), 2_405_118_377],
    ...week,
    nextWeek,
  ] as [number, number][];

  // A player gaining a billion an hour in two long bursts, through three wraps before the Sunday reset
  const day = fromGains(
    Date.parse('2026-09-19T12:37:10Z'),
    163_904_512,
    [
      0, 0, 1_204_331, 0, 0, 1_480_203, 2_115_874, 2_906_118, 5_337_219, 38_904_552, 812_440_917, 66_212_305,
      418_665_120, 1_062_118_407, 1_048_203_665, 1_071_588_210, 1_055_904_331, 1_066_117_874, 812_009_563, 0, 1_119_442,
      1_408_225, 2_205_117, 601_774_902, 1_058_331_740, 1_070_662_119, 1_049_118_506, 1_061_903_227, 1_052_446_810,
      1_066_771_093, 702_118_459, 2_331_906, 241_087_312,
    ],
  );

  // The fastest hour of a burst crosses 2^32: 1.3, then 2.0, then 1.4 billion
  const burst = fromGains(
    Date.parse('2026-07-25T06:32:08Z'),
    2_601_337_908,
    [
      3_104_662, 15_220_917, 11_408_215, 13_995_063, 20_871_452, 1_287_604_118, 2_016_338_472, 1_366_092_731, 0,
      16_309_884, 12_457_660,
    ],
  );

  const pace = 10_587_331;
  const beforeReset: [number, number][] = Array.from({ length: 10 }, (_, index) => [
    Date.parse('2026-06-28T12:33:09Z') + index * HOUR,
    R + 6_487_331 - (9 - index) * pace,
  ]);

  const world = hourly(random, Date.parse('2026-09-13T16:05:07Z'), 3_014_662_380, 6, 4_000_000, 0.3);
  const sydney = hourly(random, Date.parse('2026-10-04T08:19:09Z'), 7_402_116, 5, 30_000, 0.3);
  const decreasing = hourly(random, Date.parse('2026-09-09T08:42:07Z'), 5_301_742, 7, 9_000, 0.3);
  const decreased = decreasing.at(-1)![1] - 19_633;

  return {
    twoWrapsInOneWeek: {
      server: 'DE1',
      timezone: 'Europe/Paris',
      totals: twoWraps,
      expect: [
        { at: week[0][0], kind: 'fresh', point: week[0][1] },
        ...wrapsOf(week).map(([at, total]) => ({ at, kind: 'wrapped', point: total })),
        { at: nextWeek[0], kind: 'fresh', point: nextWeek[1] },
      ],
    },
    threeWrapsInOneDay: {
      server: 'DE1',
      timezone: 'Europe/Paris',
      totals: day,
      expect: wrapsOf(day).map(([at, total]) => ({ at, kind: 'wrapped', point: total })),
    },
    wrapAtTwoBillionPerHour: {
      server: 'SA1',
      timezone: 'Europe/Paris',
      totals: burst,
      expect: wrapsOf(burst).map(([at, total]) => ({ at, kind: 'wrapped', point: total })),
    },
    wrapRightBeforeReset: {
      server: 'ES1',
      timezone: 'Europe/Paris',
      totals: [
        ...beforeReset,
        [Date.parse('2026-06-28T23:33:07Z'), 21_904_517],
        [Date.parse('2026-06-29T00:33:08Z'), 32_118_904],
      ],
      expect: [
        { at: beforeReset.at(-1)![0], kind: 'wrapped', point: R + 6_487_331 },
        { at: Date.parse('2026-06-28T23:33:07Z'), kind: 'fresh', point: 21_904_517 },
      ],
    },
    earlyResetOnWorld: {
      server: 'WORLD1',
      timezone: 'Europe/London',
      totals: [
        ...world,
        [Date.parse('2026-09-13T22:05:07Z'), 98_204],
        [Date.parse('2026-09-13T23:05:08Z'), 2_311_906],
        [Date.parse('2026-09-14T00:05:07Z'), 19_870_455],
        [Date.parse('2026-09-14T01:05:08Z'), 44_903_118],
        [Date.parse('2026-09-14T02:05:08Z'), 71_266_301],
      ],
      expect: [{ at: Date.parse('2026-09-13T22:05:07Z'), kind: 'early-reset', point: 98_204 }],
    },
    sydneySummerTime: {
      server: 'AU1',
      timezone: 'Australia/Sydney',
      totals: [
        ...sydney,
        [Date.parse('2026-10-04T13:19:08Z'), 101_877],
        ...hourly(random, Date.parse('2026-10-04T14:19:07Z'), 112_430, 4, 6_000, 0.3),
      ],
      expect: [{ at: Date.parse('2026-10-04T13:19:08Z'), kind: 'fresh', point: 101_877 }],
    },
    smallDecrease: {
      server: 'E4K_FR1',
      timezone: 'Europe/Paris',
      totals: [
        ...decreasing,
        [Date.parse('2026-09-09T15:42:07Z'), decreased],
        ...hourly(random, Date.parse('2026-09-09T16:42:08Z'), decreased + 14_000, 4, 95_000, 0.3),
      ],
      expect: [{ at: Date.parse('2026-09-09T15:42:07Z'), kind: 'decreased', point: decreased }],
    },
  };
}

export function lootStreams(): { streams: Record<string, Stream>; expectations: Record<string, Scenario['expect']> } {
  const all = scenarios(new Random(4_294_967));
  const streams: Record<string, Stream> = {};
  const expectations: Record<string, Scenario['expect']> = {};
  for (const [name, scenario] of Object.entries(all)) {
    verify(name, scenario);
    streams[name] = toStream(scenario);
    expectations[name] = scenario.expect;
  }
  return { streams, expectations };
}
