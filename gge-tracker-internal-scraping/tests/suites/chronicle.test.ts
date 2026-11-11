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
  PERSONA_SHARE_CAP,
  PlayerFeatures,
  WorldEventRow,
  assignPersonas,
  buildEntries,
  chronicleServers,
  fullStoryHours,
  chronicleWindow,
  activityCalendar,
  bannerTimeline,
  buildRanking,
  buildReign,
  daysUnderBanner,
  isNotableClimb,
  rankWorldEvent,
  higherThanPct,
  longestRun,
  pickRivals,
  playerTier,
  selectSlides,
  serverTier,
  standing,
  trackedDays,
} from '../../src/chronicle-model';
import { eventRunStarts, lootWeekStarts } from '../../src/chronicle-queries';
import { parseLootReset } from '../../src/loot-reset';
import { ScrapingServer } from '../../src/servers-file';

const WINDOW = chronicleWindow(2026);

function player(overrides: Partial<PlayerFeatures> = {}): PlayerFeatures {
  return {
    id: 1,
    name: 'Someone',
    allianceId: 7,
    allianceName: 'Knights',
    allianceChanges: 0,
    hours: 5000,
    mightStart: 1000,
    mightEnd: 2000,
    mightPeak: 2000,
    mightLow: 1000,
    bestDay: '2026-03-02',
    bestDayGain: 400,
    peakDay: '2026-03-02',
    lootTotal: 500,
    bestWeekLoot: 100,
    bestWeekStart: '2026-03-02',
    weeklyLoot: [100, 0, 400],
    activeDays: 40,
    longestStreak: 12,
    calendar: '110',
    hourly: new Array(24).fill(1),
    allianceHistory: [],
    monthly: [1000, 2000],
    gloryCurrent: 0,
    gloryHighest: 0,
    world: {},
    firstDay: '2026-01-01',
    events: { nomad: { runs: 2, bestRank: 9, podiums: 0 } },
    topDays: [],
    ...overrides,
  };
}

function server(overrides: Partial<ScrapingServer> = {}): ScrapingServer {
  return {
    name: 'LIVE',
    server: 'FR1',
    outerName: 'FR1',
    zone: 'EmpireEx_3',
    sql: 'empire-ranking',
    olap: 'empire_ranking',
    limit: 1,
    dungeon: false,
    storm: false,
    alertAfterFailures: null,
    kind: 'ep',
    lootReset: null,
    enabledBeta: true,
    enabledPublic: true,
    ...overrides,
  };
}

describe('Chronicle tiers', () => {
  it('counts tracked days inside the window only', () => {
    assert.equal(trackedDays(Date.UTC(2025, 5, 1), WINDOW), 334);
    assert.equal(trackedDays(Date.UTC(2026, 9, 22), WINDOW), 40);
    assert.equal(trackedDays(Date.UTC(2026, 11, 20), WINDOW), 0);
  });

  it('splits servers at 240 and 21 days', () => {
    assert.equal(serverTier(240), 'full');
    assert.equal(serverTier(239), 'season');
    assert.equal(serverTier(21), 'season');
    assert.equal(serverTier(20), 'too-recent');
  });

  it('serves only public, non-beta game servers, once per database', () => {
    const kept = chronicleServers([
      server(),
      server({ name: 'COPY', server: 'FR1_COPY' }),
      server({ server: 'E4K_PL1_BETA', olap: 'beta' }),
      server({ server: 'HIDDEN', olap: 'hidden', enabledPublic: false }),
      server({ server: 'OUTER', olap: 'outer', kind: 'internal' }),
      server({ server: 'GLOBAL', olap: 'global', kind: 'global' }),
    ]);
    assert.deepEqual(
      kept.map((row) => row.server),
      ['FR1'],
    );
  });

  it('asks less history of players on a young server', () => {
    assert.equal(fullStoryHours(), 720);
    assert.equal(fullStoryHours(35), 504);
    assert.equal(playerTier(player({ hours: 600 }), fullStoryHours(35)), 'full');
  });

  it('gives a player the full story only with 30 days and some activity', () => {
    assert.equal(playerTier(player()), 'full');
    assert.equal(playerTier(player({ hours: 719 })), 'short');
    assert.equal(playerTier(player({ activeDays: 0, events: {} })), 'short');
  });
});

describe('Chronicle slides', () => {
  it('never headlines a player who lost might', () => {
    const slides = selectSlides(player({ mightEnd: 500 }), 'full');
    assert.equal(slides.includes('climb'), false);
    assert.equal(slides.includes('great-day'), false);
  });

  it('keeps the summit for players who really came down from somewhere', () => {
    const fell = player({ mightStart: 90_000, mightEnd: 50_000, mightPeak: 90_000 });
    const flat = player({ mightStart: 300, mightEnd: 300, mightPeak: 300 });
    const steady = player({ mightStart: 90_000, mightEnd: 90_000, mightPeak: 90_500 });
    assert.equal(selectSlides(fell, 'full').includes('summit'), true);
    assert.equal(selectSlides(flat, 'full').includes('summit'), false);
    assert.equal(selectSlides(steady, 'full').includes('summit'), false);
  });

  it('hides a great day that is a small part of the year', () => {
    assert.equal(selectSlides(player({ bestDayGain: 10 }), 'full').includes('great-day'), false);
  });

  it('shows the glory page only with glory points', () => {
    assert.equal(selectSlides(player(), 'full').includes('glory'), false);
    assert.equal(selectSlides(player({ gloryHighest: 5000 }), 'full').includes('glory'), true);
  });

  it('hides the rhythm below 30 active days', () => {
    assert.equal(selectSlides(player({ activeDays: 29 }), 'full').includes('rhythm'), false);
  });

  it('keeps a short chronicle to one highlight', () => {
    assert.deepEqual(selectSlides(player(), 'short'), ['cover', 'climb', 'wall']);
    assert.deepEqual(
      selectSlides(
        player({ mightEnd: 0, monthly: [], lootTotal: 0, events: {}, activeDays: 0, allianceId: null }),
        'short',
      ),
      ['cover', 'wall'],
    );
  });

  it('always opens on the cover and ends on the share screen', () => {
    const slides = selectSlides(player(), 'full');
    assert.equal(slides[0], 'cover');
    assert.equal(slides.at(-1), 'wall');
  });
});

describe('Chronicle numbers', () => {
  it('counts only strictly lower values as beaten', () => {
    assert.equal(higherThanPct([10, 20, 30, 40], 30), 50);
    assert.equal(higherThanPct([10, 20, 30, 40], 41), 100);
    assert.equal(higherThanPct([10, 20], 0), 0);
  });

  it('splits event runs on the same 24 hour gap as the event pages', () => {
    assert.deepEqual(eventRunStarts([0, 3600, 7200, 7200 + 86_401, 7200 + 90_000]), [0, 7200 + 86_401]);
    assert.deepEqual(eventRunStarts([]), []);
  });

  it('starts weeks on the declared local reset across a clock change', () => {
    const reset = parseLootReset('Europe/Paris', 'MON 00:00')!;
    const starts = lootWeekStarts(WINDOW, reset);
    const seconds = (date: number): number => date / 1000;
    assert.ok(starts.includes(seconds(Date.UTC(2026, 2, 22, 23))), 'winter week starts at 23:00 UTC');
    assert.ok(starts.includes(seconds(Date.UTC(2026, 2, 29, 22))), 'summer week starts at 22:00 UTC');
  });
});

describe('Chronicle personas', () => {
  const crowd = Array.from({ length: 200 }, (_, index) =>
    player({ id: index + 1, mightEnd: 2000 + index, lootTotal: 500 + (index % 13), longestStreak: 31 + (index % 7) }),
  );

  it('never lets one persona pass the cap', () => {
    const counts = new Map<string, number>();
    for (const persona of assignPersonas(crowd).values()) counts.set(persona, (counts.get(persona) ?? 0) + 1);
    const limit = Math.ceil(crowd.length * PERSONA_SHARE_CAP);
    for (const [persona, count] of counts) {
      if (persona !== 'steadfast') assert.ok(count <= limit, `${persona} has ${count}`);
    }
  });

  it('gives every full player a persona and short players none', () => {
    const entries = buildEntries([...crowd, player({ id: 999, hours: 10 })], {
      window: WINDOW,
      months: [202601, 202602],
    });
    assert.ok(entries.filter((entry) => entry.tier === 'full').every((entry) => entry.persona !== null));
    assert.equal(entries.find((entry) => entry.id === 999)?.persona, null);
  });

  it('only calls someone a wanderer after three alliance changes', () => {
    const personas = assignPersonas([player({ id: 1, allianceChanges: 2 }), player({ id: 2, allianceChanges: 3 })]);
    assert.notEqual(personas.get(1), 'wanderer');
  });
});

describe('Chronicle rivals', () => {
  const months = (rows: [number, number][]): Map<number, number>[] => Array.from({ length: 6 }, () => new Map(rows));

  it('names the player who stayed next to you for six months', () => {
    const players = [player({ id: 1, allianceId: 1 }), player({ id: 2, allianceId: 2 })];
    assert.deepEqual(
      pickRivals(
        players,
        months([
          [1, 100],
          [2, 99],
        ]),
      ).get(1),
      { id: 2, months: 6 },
    );
  });

  it('never names an ally', () => {
    const players = [player({ id: 1, allianceId: 5 }), player({ id: 2, allianceId: 5 })];
    assert.equal(
      pickRivals(
        players,
        months([
          [1, 100],
          [2, 99],
        ]),
      ).has(1),
      false,
    );
  });

  it('never names an abandoned account', () => {
    const players = [player({ id: 1, allianceId: 1 }), player({ id: 2, allianceId: 2, activeDays: 1, events: {} })];
    assert.equal(
      pickRivals(
        players,
        months([
          [1, 100],
          [2, 99],
        ]),
      ).has(1),
      false,
    );
  });

  it("tells the rival's alliance", () => {
    const players = [
      player({ id: 1, allianceId: 1, monthly: [100, 100] }),
      player({ id: 2, allianceId: 2, allianceName: 'Ravens', monthly: [99, 99] }),
    ];
    const [entry] = buildEntries(players, {
      window: WINDOW,
      months: [202601, 202602],
      rivals: new Map([[1, { id: 2, months: 6 }]]),
    });
    assert.equal(entry.rival?.allianceName, 'Ravens');
  });

  it('needs six months of proximity', () => {
    const players = [player({ id: 1, allianceId: 1 }), player({ id: 2, allianceId: 2 })];
    const short = months([
      [1, 100],
      [2, 99],
    ]).slice(0, 5);
    assert.equal(pickRivals(players, short).size, 0);
  });

  it('adds the rival slide before the persona only for full players', () => {
    const slides = selectSlides(player(), 'full', true);
    assert.equal(slides.indexOf('rival'), slides.indexOf('persona') - 1);
    assert.equal(selectSlides(player(), 'short', true).includes('rival'), false);
  });
});

describe('Chronicle banners and world events', () => {
  const stints = [
    { name: 'First Guard', from: '2026-01-01', to: '2026-01-20' },
    { name: 'Basar', from: '2026-01-20', to: '2026-02-10' },
    { name: 'First Guard', from: '2026-02-10', to: '2026-11-30' },
  ];

  it('adds up every stint under the same banner', () => {
    assert.equal(daysUnderBanner(stints, 'First Guard'), 19 + 294);
    assert.equal(daysUnderBanner(stints, 'Basar'), 21);
  });

  const row = (playerId: number, bestRank: number, server = 'FR1'): WorldEventRow => ({
    server,
    playerId,
    events: 2,
    bestRank,
    bestPoint: 100,
    months: [202601],
    ranks: [bestRank],
  });

  it('ranks players worldwide on their best finish', () => {
    const ranked = rankWorldEvent([row(1, 10), row(2, 500, 'DE1'), row(3, 90, 'DE1')]);
    assert.equal(ranked.get('FR1')?.get(1)?.rank, 1);
    assert.equal(ranked.get('DE1')?.get(2)?.rank, 3);
    assert.equal(ranked.get('FR1')?.get(1)?.of, 3);
  });

  it('merges one player found under two server labels', () => {
    const ranked = rankWorldEvent([row(7, 50), { ...row(7, 20), months: [202602], ranks: [20] }]);
    const merged = ranked.get('FR1')?.get(7);
    assert.equal(merged?.events, 4);
    assert.equal(merged?.bestRank, 20);
    assert.deepEqual(merged?.months, [202601, 202602]);
  });

  it('adds the page only for players who took part', () => {
    assert.equal(selectSlides(player(), 'full').includes('beyond'), false);
    const event = { rank: 1, of: 1, higherThanPct: 0, events: 1, bestRank: 3, bestPoint: 9, months: [], ranks: [] };
    assert.equal(selectSlides(player({ world: { horizon: event } }), 'full').includes('beyond'), true);
  });
});

describe('Chronicle infographic data', () => {
  it('ranks a value among the players who scored', () => {
    assert.deepEqual(standing([10, 20, 30, 40], 40), { rank: 1, of: 4, higherThanPct: 75 });
    assert.deepEqual(standing([10, 20, 30, 40], 10), { rank: 4, of: 4, higherThanPct: 0 });
    assert.equal(standing([10, 20], 0).rank, 0);
  });

  it('marks active days on a calendar of the window', () => {
    const window = chronicleWindow(2026, Date.UTC(2026, 0, 6));
    assert.equal(activityCalendar(['2026-01-01', '2026-01-03', '2026-01-04', '2025-12-30'], window), '10110');
  });

  it('finds the longest run of active days', () => {
    assert.equal(longestRun('1101110'), 3);
    assert.equal(longestRun('000'), 0);
  });

  it('draws one banner for a player who never moved', () => {
    assert.deepEqual(bannerTimeline([], 'Knights', WINDOW), [
      { name: 'Knights', from: '2026-01-01', to: '2026-11-30' },
    ]);
  });

  it('follows alliance changes and merges a return to the same banner', () => {
    const timeline = bannerTimeline(
      [
        { from: 'A', to: 'B', at: '2026-03-01' },
        { from: 'B', to: 'B', at: '2026-04-01' },
      ],
      'B',
      WINDOW,
    );
    assert.deepEqual(timeline, [
      { name: 'A', from: '2026-01-01', to: '2026-03-01' },
      { name: 'B', from: '2026-03-01', to: '2026-11-30' },
    ]);
  });
});

function days(from: string, count: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

function heldAt(position: number, list: string[]): [string, number][] {
  return list.map((day) => [day, position]);
}

describe('Chronicle reign', () => {
  const serverDays = days('2026-01-01', 60);

  it('needs seven days in a tier before it reigns', () => {
    assert.equal(buildReign(heldAt(1, serverDays.slice(0, 6)), serverDays, '2026-01-01', 2026), null);
    assert.equal(buildReign(heldAt(1, serverDays.slice(0, 7)), serverDays, '2026-01-01', 2026)?.tier, 1);
  });

  it('only reigns over #1, the top 10 and the top 100', () => {
    assert.equal(buildReign(heldAt(101, serverDays), serverDays, '2026-01-01', 2026), null);
  });

  it('shows the wider tiers and only the tighter ones that were touched', () => {
    const topDays = [...heldAt(1, serverDays.slice(0, 3)), ...heldAt(8, serverDays.slice(3, 20))];
    const reign = buildReign(topDays, serverDays, '2026-01-01', 2026)!;
    assert.equal(reign.tier, 10);
    assert.equal(reign.days, 20);
    assert.deepEqual(
      reign.rows.map((row) => [row.tier, row.days]),
      [
        [1, 3],
        [10, 20],
        [100, 20],
      ],
    );
    const plain = buildReign(heldAt(50, serverDays.slice(0, 20)), serverDays, '2026-01-01', 2026)!;
    assert.deepEqual(
      plain.rows.map((row) => row.tier),
      [100],
    );
  });

  it('merges a dip of three days on the ribbon but counts the days exactly', () => {
    const topDays = heldAt(1, [...serverDays.slice(0, 10), ...serverDays.slice(13, 30)]);
    const reign = buildReign(topDays, serverDays, '2026-01-01', 2026)!;
    assert.equal(reign.days, 27);
    assert.equal(reign.longest, 17);
    assert.equal(reign.comebacks, 0);
    assert.deepEqual(reign.rows[0].segments, [[0, 29]]);
  });

  it('counts a comeback after a longer loss', () => {
    const topDays = heldAt(1, [...serverDays.slice(0, 10), ...serverDays.slice(14, 30)]);
    const reign = buildReign(topDays, serverDays, '2026-01-01', 2026)!;
    assert.equal(reign.comebacks, 1);
    assert.deepEqual(reign.rows[0].segments, [
      [0, 9],
      [14, 29],
    ]);
  });

  it('never breaks a reign on days the server was not read', () => {
    const withOutage = [...serverDays.slice(0, 10), ...serverDays.slice(20)];
    const reign = buildReign(heldAt(1, withOutage), withOutage, '2026-01-01', 2026)!;
    assert.equal(reign.longest, withOutage.length);
    assert.equal(reign.comebacks, 0);
    assert.equal(reign.trackedDays, withOutage.length);
  });

  it('starts the track on the day the player arrived', () => {
    const reign = buildReign(heldAt(1, serverDays.slice(30)), serverDays, '2026-01-31', 2026)!;
    assert.equal(reign.start, 30);
    assert.equal(reign.end, 60);
    assert.equal(reign.trackedDays, 30);
  });

  it('calls a reign steady when every row is nearly full', () => {
    const always = buildReign(heldAt(40, serverDays), serverDays, '2026-01-01', 2026)!;
    assert.equal(always.steady, true);
    const topDays = [...heldAt(1, serverDays.slice(0, 20)), ...heldAt(5, serverDays.slice(20))];
    assert.equal(buildReign(topDays, serverDays, '2026-01-01', 2026)!.steady, false);
  });

  it('gives the best, usual and worst place held', () => {
    const topDays = [
      ...heldAt(3, serverDays.slice(0, 10)),
      ...heldAt(20, serverDays.slice(10, 40)),
      ...heldAt(90, serverDays.slice(40)),
    ];
    assert.deepEqual(buildReign(topDays, serverDays, '2026-01-01', 2026)!.places, { best: 3, usual: 20, worst: 90 });
  });

  it('adds the ranking page after the climb', () => {
    assert.deepEqual(selectSlides(player(), 'full', false, 30, true).slice(0, 3), ['cover', 'climb', 'ranking']);
  });
});

describe('Chronicle ranking journey', () => {
  const months = [202601, 202602, 202603, 202604];

  it('reads the climb from the first and last months the player was ranked', () => {
    const ranking = buildRanking([null, 9000, 4200, 4500], months)!;
    assert.equal(ranking.first, 9000);
    assert.equal(ranking.firstMonth, 202602);
    assert.equal(ranking.last, 4500);
    assert.equal(ranking.places, 4500);
    assert.equal(ranking.best, 4200);
    assert.equal(ranking.bestMonth, 202603);
  });

  it('names the tightest milestone reached and the month it was first reached', () => {
    assert.deepEqual(buildRanking([12_000, 6000, 900, 950], months)!.milestone, { top: 1000, month: 202603 });
    assert.equal(buildRanking([800, 700, 650, 600], months)!.milestone, null);
  });

  it('needs two ranked months', () => {
    assert.equal(buildRanking([null, null, 300, null], months), null);
  });

  it('only tells a climb worth a page', () => {
    assert.equal(isNotableClimb(buildRanking([12_000, 11_500], months)), false);
    assert.equal(isNotableClimb(buildRanking([12_000, 9000], months)), true);
    assert.equal(isNotableClimb(buildRanking([300, 290], months)), false);
    assert.equal(isNotableClimb(buildRanking([300, 250], months)), true);
    assert.equal(isNotableClimb(buildRanking([4000, 5000], months)), false);
  });
});

describe('Chronicle entries', () => {
  it('gives a reign to a top player and a journey to a climber', () => {
    const serverDays = days('2026-01-01', 40);
    const king = player({ id: 1, topDays: heldAt(1, serverDays), monthly: [9000, 9500] });
    const climber = player({ id: 2, monthly: [10, 3000] });
    const rest = Array.from({ length: 30 }, (_, index) =>
      player({ id: 100 + index, monthly: [500 + index * 10, 600 + index * 10] }),
    );
    const entries = buildEntries([king, climber, ...rest], {
      window: WINDOW,
      months: [202601, 202602],
      serverDays,
    });
    const [kingEntry, climberEntry] = entries;
    assert.equal(kingEntry.might.reign?.days, 40);
    assert.ok(kingEntry.slides.includes('ranking'));
    assert.equal(climberEntry.might.reign, null);
    assert.equal(climberEntry.might.ranking?.first, 32);
    assert.equal(climberEntry.might.ranking?.last, 2);
    assert.ok(climberEntry.slides.includes('ranking'));
    assert.ok(!entries[2].slides.includes('ranking'));
  });

  it('shows glory only from the first title of the game', () => {
    assert.ok(!selectSlides(player({ gloryHighest: 4443 }), 'full').includes('glory'));
    assert.ok(selectSlides(player({ gloryHighest: 4444 }), 'full').includes('glory'));
  });
});
