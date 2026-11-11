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
  StoredLeagueDay,
  decideLeagueDay,
  isInCollectionWindow,
  isLastCollectionHour,
  leagueClock,
  packedAllianceScore,
  packedPlayerScore,
  pageValues,
} from '../../src/kingdoms-league';
import { ApiRequest, rankingWindow, timeout } from '../harness/fake-api';
import { Sandbox, withSandbox } from '../harness/sandbox';

const PAGE_SIZE = 8;
const LAST_DAY = /FROM kingdoms_league_days/;
const IN_WINDOW = new Date('2026-11-12T01:30:00.000Z');
const LAST_HOUR = new Date('2026-11-12T06:30:00.000Z');

interface Contender {
  rank: number;
  title: number;
  gold: number;
  silver: number;
  bronze: number;
}

function contenders(count: number, topGold = 29): Contender[] {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    title: Math.max(1, 19 - Math.floor(index / 4)),
    gold: Math.max(1, topGold - index),
    silver: index % 6,
    bronze: index % 4,
  }));
}

function playerRow(contender: Contender): unknown[] {
  return [
    contender.rank,
    packedPlayerScore(contender.title, contender),
    {
      OID: 9000 + contender.rank,
      N: `Player ${contender.rank}`,
      AID: contender.rank % 5 === 0 ? -1 : 300 + (contender.rank % 3),
      AN: contender.rank % 5 === 0 ? 'stale name' : `Alliance ${300 + (contender.rank % 3)}`,
      KLMO: [
        [1, contender.gold],
        [2, contender.silver],
        [3, contender.bronze],
      ],
      KLRID: contender.title,
    },
  ];
}

function allianceRow(contender: Contender): unknown[] {
  return [
    contender.rank,
    packedAllianceScore(contender),
    [700 + contender.rank, `Alliance ${contender.rank}`, 12, 123456789],
    {
      KLMO: [
        [1, contender.gold],
        [2, contender.silver],
        [3, contender.bronze],
      ],
    },
  ];
}

function ranking(lt: number, rows: unknown[][], sv: number): Record<string, unknown> {
  const window = rankingWindow(rows as any, PAGE_SIZE, rows.length, sv);
  return { return_code: 0, content: { LT: lt, L: window, LR: rows.length, SV: String(sv), FR: sv, IGH: 0 } };
}

function serveLeague(sandbox: Sandbox, players: Contender[], alliances: Contender[] = contenders(10)): void {
  const playerRows = players.map(playerRow);
  const allianceRows = alliances.map(allianceRow);
  sandbox.api.on('hgh', (request: ApiRequest) => {
    const sv = Number(request.parameters.SV);
    return Number(request.parameters.LT) === 63 ? ranking(63, playerRows, sv) : ranking(67, allianceRows, sv);
  });
}

function storedDay(sandbox: Sandbox, day: Partial<StoredLeagueDay>): void {
  sandbox.clickhouse.when(LAST_DAY, [
    { season_id: 3, day: '2026-11-11', ranked_players: 20, top_gold: 28, top_signature: 'older', ...day },
  ]);
}

function leagueRecords(sandbox: Sandbox): Record<string, any>[] {
  return sandbox.outbound
    .filter((call) => String(call.url).includes('/loki/api/v1/push'))
    .map((call) => (call.body as any).streams[0])
    .filter((stream) => stream.stream.job === 'kingdoms-league')
    .map((stream) => ({ ...JSON.parse(stream.values[0][1]), level: stream.stream.level }));
}

describe('kingdoms league rules', () => {
  it('reproduces the scores the game sent on FR1 on 2026-11-11', () => {
    assert.equal(packedPlayerScore(19, { gold: 29, silver: 5, bronze: 3 }), 1229808056);
    assert.equal(packedPlayerScore(1, { gold: 1, silver: 0, bronze: 0 }), 64642002);
    assert.equal(packedAllianceScore({ gold: 36, silver: 4, bronze: 0 }), 5790440);
  });

  it('collects between 02:00 and 08:00 Paris, which follows daylight saving', () => {
    const inWindow = (instant: string): boolean => isInCollectionWindow(leagueClock(new Date(instant)));
    assert.equal(inWindow('2026-11-12T00:59:00Z'), false, '01:59 Paris: an hour after the payout');
    assert.equal(inWindow('2026-11-12T01:00:00Z'), true);
    assert.equal(inWindow('2026-11-12T06:59:00Z'), true);
    assert.equal(inWindow('2026-11-12T07:00:00Z'), false, '08:00 Paris: an hour before the league event ends');
    assert.equal(inWindow('2026-07-01T00:30:00Z'), true, '02:30 Paris in summer');
    assert.equal(inWindow('2026-07-01T06:30:00Z'), false, '08:30 Paris in summer');
  });

  it('dates a night by its Paris day and knows its last hour', () => {
    assert.deepEqual(leagueClock(IN_WINDOW), { day: '2026-11-12', hour: 2 });
    assert.equal(isLastCollectionHour(leagueClock(LAST_HOUR)), true);
    assert.equal(isLastCollectionHour(leagueClock(IN_WINDOW)), false);
  });

  it('asks the centre of each page so every rank is read once', () => {
    assert.deepEqual(pageValues(17, 8), [4, 12, 20]);
    assert.deepEqual(pageValues(8, 8), [4]);
    assert.deepEqual(pageValues(0, 8), []);
  });

  it('starts a season on a drop and keeps it on a rise', () => {
    const previous: StoredLeagueDay = {
      season_id: 4,
      day: '2026-11-11',
      ranked_players: 5200,
      top_gold: 29,
      top_signature: 'a',
    };
    assert.deepEqual(decideLeagueDay(null, { rankedPlayers: 12, topGold: 1, signature: 'b' }), {
      kind: 'collect',
      seasonId: 1,
      newSeason: false,
    });
    assert.deepEqual(decideLeagueDay(previous, { rankedPlayers: 5200, topGold: 29, signature: 'a' }), {
      kind: 'unchanged',
    });
    assert.deepEqual(decideLeagueDay(previous, { rankedPlayers: 5230, topGold: 30, signature: 'c' }), {
      kind: 'collect',
      seasonId: 4,
      newSeason: false,
    });
    assert.deepEqual(decideLeagueDay(previous, { rankedPlayers: 40, topGold: 1, signature: 'c' }), {
      kind: 'collect',
      seasonId: 5,
      newSeason: true,
    });
    assert.deepEqual(decideLeagueDay(previous, { rankedPlayers: 5200, topGold: 3, signature: 'c' }), {
      kind: 'collect',
      seasonId: 5,
      newSeason: true,
    });
    assert.deepEqual(decideLeagueDay(previous, { rankedPlayers: 2000, topGold: 29, signature: 'c' }), {
      kind: 'collect',
      seasonId: 5,
      newSeason: true,
    });
    assert.deepEqual(decideLeagueDay(previous, { rankedPlayers: 0, topGold: 0, signature: '' }), { kind: 'empty' });
  });
});

describe('fillKingdomsLeague', () => {
  it('does nothing outside the night window', async () => {
    await withSandbox({ now: new Date('2026-11-12T12:00:00Z') }, async (sandbox) => {
      serveLeague(sandbox, contenders(20));
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.equal(sandbox.api.callsFor('hgh').length, 0);
      assert.equal(sandbox.clickhouse.calls.length, 0);
      assert.equal(leagueRecords(sandbox).length, 0);
    });
  });

  it('skips a night already stored without asking the game', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, contenders(20));
      storedDay(sandbox, { day: '2026-11-12' });
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.equal(sandbox.api.callsFor('hgh').length, 0);
      assert.deepEqual(sandbox.clickhouse.tables, []);
      assert.equal(leagueRecords(sandbox).length, 0, 'the six later fills of the night stay silent');
    });
  });

  it('reads both rankings without LID, one request a page', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, contenders(20), contenders(9));
      await sandbox.call('fillKingdomsLeague', 'FR1');
      const calls = sandbox.api.callsFor('hgh');
      assert.ok(
        calls.every((call) => !('LID' in call.parameters)),
        'an LID makes the bridge wait forever',
      );
      const asked = calls.map((call) => `${call.parameters.LT}@${call.parameters.SV}`);
      assert.deepEqual(asked, ['63@1', '63@4', '63@12', '63@20', '67@1', '67@4', '67@12']);
    });
  });

  it('stores every rank once with the shape the tables declare', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, contenders(20), contenders(9));
      await sandbox.call('fillKingdomsLeague', 'FR1');
      const players = sandbox.clickhouse.rows('kingdoms_league_players');
      assert.deepEqual(
        players.map((row) => row.rank),
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      assert.deepEqual(players[0], {
        server: 'FR1',
        season_id: 1,
        day: '2026-11-12',
        rank: 1,
        player_id: 9001,
        player_name: 'Player 1',
        alliance_id: 301,
        alliance_name: 'Alliance 301',
        title: 19,
        gold: 29,
        silver: 0,
        bronze: 0,
        collected_at: '2026-11-12 01:30:00',
      });
      assert.equal(players[4].alliance_id, -1, 'a player without alliance keeps -1');
      assert.equal(players[4].alliance_name, '', 'and no alliance name, whatever the game left in AN');
      const alliances = sandbox.clickhouse.rows('kingdoms_league_alliances');
      assert.equal(alliances.length, 9);
      assert.deepEqual(alliances[1], {
        server: 'FR1',
        season_id: 1,
        day: '2026-11-12',
        rank: 2,
        alliance_id: 702,
        alliance_name: 'Alliance 2',
        gold: 28,
        silver: 1,
        bronze: 1,
        collected_at: '2026-11-12 01:30:00',
      });
    });
  });

  it('marks the night done only after both rankings are written', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, contenders(20), contenders(9));
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.deepEqual(sandbox.clickhouse.tables, [
        'kingdoms_league_players',
        'kingdoms_league_alliances',
        'kingdoms_league_days',
      ]);
      const [day] = sandbox.clickhouse.rows('kingdoms_league_days');
      assert.equal(day.ranked_players, 20);
      assert.equal(day.ranked_alliances, 9);
      assert.equal(day.top_gold, 29);
      assert.equal(sandbox.clickhouse.calls.find((call) => call.table)?.database, 'empire_ranking_test');
      assert.equal(sandbox.redis.store.get('kingdoms-league-version:FR1'), '1', 'the API caches on this version');
    });
  });

  it('stores nothing when the first page did not move since the last night', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      const players = contenders(20);
      serveLeague(sandbox, players);
      const signature = players
        .slice(0, PAGE_SIZE)
        .map((player) => `${player.rank}:${9000 + player.rank}:${packedPlayerScore(player.title, player)}`)
        .join(',');
      storedDay(sandbox, { ranked_players: 20, top_gold: 29, top_signature: signature });
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.equal(sandbox.api.callsFor('hgh').length, 1, 'a night without payout costs one request');
      assert.deepEqual(sandbox.clickhouse.tables, []);
      const [record] = leagueRecords(sandbox);
      assert.equal(record.outcome, 'unchanged');
      assert.equal(record.level, 'info');
    });
  });

  it('keeps the season while medals rise and opens the next one when they drop', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, contenders(20, 30));
      storedDay(sandbox, { season_id: 3, top_gold: 29 });
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.equal(sandbox.clickhouse.rows('kingdoms_league_days')[0].season_id, 3);
    });
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, contenders(6, 1));
      storedDay(sandbox, { season_id: 3, top_gold: 29 });
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.equal(sandbox.clickhouse.rows('kingdoms_league_days')[0].season_id, 4);
      const [record] = leagueRecords(sandbox);
      assert.equal(record.newSeason, true);
      assert.equal(record.seasonId, 4);
    });
  });

  it('reports a collection with its counts', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, contenders(20), contenders(9));
      await sandbox.call('fillKingdomsLeague', 'FR1');
      const [record] = leagueRecords(sandbox);
      assert.equal(record.level, 'info');
      assert.equal(record.outcome, 'collected');
      assert.equal(record.server, 'FR1');
      assert.equal(record.day, '2026-11-12');
      assert.equal(record.playersStored, 20);
      assert.equal(record.alliancesStored, 9);
      assert.equal(record.missingRanks, 0);
      assert.equal(record.scoreMismatches, 0);
      assert.equal(record.requests, 7);
    });
  });

  it('counts the rows whose score no longer packs title and medals', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      const rows = contenders(20).map(playerRow);
      (rows[3] as any[])[1] = 42;
      sandbox.api.on('hgh', (request: ApiRequest) => {
        const sv = Number(request.parameters.SV);
        return Number(request.parameters.LT) === 63 ? ranking(63, rows, sv) : ranking(67, [], sv);
      });
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.equal(leagueRecords(sandbox)[0].scoreMismatches, 1);
    });
  });

  it('stores nothing from a ranking it could not finish, and leaves the night to the next fill', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      const rows = contenders(20).map(playerRow);
      sandbox.api.on('hgh', (request: ApiRequest) => {
        const sv = Number(request.parameters.SV);
        return sv === 12 ? timeout('hgh') : ranking(Number(request.parameters.LT), rows, sv);
      });
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.equal(sandbox.api.callsFor('hgh').filter((call) => call.parameters.SV === '12').length, 3);
      assert.deepEqual(sandbox.clickhouse.tables, [], 'a partial night would be marked done and never retried');
      assert.equal(sandbox.redis.store.size, 0);
      const [record] = leagueRecords(sandbox);
      assert.equal(record.outcome, 'failed');
      assert.equal(record.level, 'warn', 'later fills of the night still retry, so no alert yet');
      assert.match(record.failureReason, /SV 12/);
    });
  });

  it('raises an error when the last fill of the night fails', async () => {
    await withSandbox({ now: LAST_HOUR }, async (sandbox) => {
      sandbox.api.on('hgh', () => timeout('hgh'));
      await sandbox.call('fillKingdomsLeague', 'FR1');
      const [record] = leagueRecords(sandbox);
      assert.equal(record.outcome, 'missed');
      assert.equal(record.level, 'error');
    });
  });

  it('stores nothing while the season ranking is still empty', async () => {
    await withSandbox({ now: IN_WINDOW }, async (sandbox) => {
      serveLeague(sandbox, [], []);
      await sandbox.call('fillKingdomsLeague', 'FR1');
      assert.deepEqual(sandbox.clickhouse.tables, []);
      assert.equal(leagueRecords(sandbox)[0].outcome, 'empty');
    });
  });
});
