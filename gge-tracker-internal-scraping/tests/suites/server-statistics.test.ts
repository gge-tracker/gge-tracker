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

import { fixtures } from '../harness/fixtures';
import { Sandbox, withSandbox } from '../harness/sandbox';

const COLUMNS = [
  'avg_might',
  'avg_loot',
  'avg_honor',
  'avg_level',
  'players_count',
  'alliance_count',
  'players_in_peace',
  'players_who_changed_alliance',
  'players_who_changed_name',
  'total_might',
  'total_loot',
  'total_honor',
  'variation_might',
  'variation_loot',
  'variation_honor',
  'alliances_changed_name',
  'events_count',
  'events_top_3_names',
  'events_participation_rate',
  'event_nomad_points',
  'event_war_realms_points',
  'event_bloodcrow_points',
  'event_samurai_points',
  'event_berimond_kingdom_points',
  'event_nomad_players',
  'event_war_realms_players',
  'event_bloodcrow_players',
  'event_samurai_players',
  'event_berimond_kingdom_players',
  'max_might',
  'max_loot',
  'max_might_player_id',
  'max_loot_player_id',
];

const NOMAD_LT = 46;
const WAR_REALMS_LT = 44;
const SAMURAI_LT = 51;
const BERIMOND_LT = 30;
const BLOODCROW_LT = 58;

const PEACE_CEILING = 60 * 60 * 24 * 63;

function player(overrides: Record<number, unknown> = {}): any[] {
  const base: any[] = [];
  base[0] = 100; // loot
  base[1] = 1000; // might
  base[2] = 500001; // alliance id
  base[4] = [[10, 20, 1]]; // castles
  base[5] = 50; // honor
  base[6] = 0; // remaining peace time
  base[8] = 30; // level
  base[9] = 5; // legendary level
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base;
}

async function runStats(
  sandbox: Sandbox,
  state: Record<string, any[]>,
  events: Record<string, Record<string, number>> = {},
  lastStats?: Record<string, number>,
): Promise<any[]> {
  sandbox.setState('playerLootAndMightPointHistoryList', state);
  sandbox.setState('playerEventPointHistoryList', events);
  if (lastStats) sandbox.db.when(/SELECT \* FROM server_statistics/, { rows: [lastStats] });
  await sandbox.call('updateServerStatistics');
  return sandbox.db.one(/INSERT INTO server_statistics/).params;
}

describe('updateServerStatistics', () => {
  it('writes the columns in the order the placeholders expect', async () => {
    await withSandbox({}, async (sandbox) => {
      await runStats(sandbox, { 900001: player() });
      const insert = sandbox.db.one(/INSERT INTO server_statistics/);
      const declared = /INSERT INTO server_statistics \( (.*?) \) VALUES/.exec(insert.sql)![1].split(', ');
      assert.deepEqual(declared, COLUMNS);
      assert.equal(insert.params.length, COLUMNS.length);
      assert.equal(/\$33\)/.test(insert.sql), true, 'the last placeholder matches the last column');
    });
  });

  it('averages over the players that still hold a castle', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(sandbox, {
        900001: player({ 0: 100, 1: 1000, 5: 50, 8: 30, 9: 5 }),
        900002: player({ 0: 300, 1: 3000, 5: 150, 8: 40, 9: 15 }),
        900003: player({ 4: [] }),
      });
      assert.equal(params[COLUMNS.indexOf('players_count')], 2);
      assert.equal(params[COLUMNS.indexOf('avg_might')], '2000.00000000');
      assert.equal(params[COLUMNS.indexOf('avg_loot')], '200.00000000');
      assert.equal(params[COLUMNS.indexOf('avg_honor')], '100.00000000');
      assert.equal(params[COLUMNS.indexOf('avg_level')], '45.00000000');
      assert.equal(params[COLUMNS.indexOf('total_might')], 4000);
      assert.equal(params[COLUMNS.indexOf('total_loot')], 400);
      assert.equal(params[COLUMNS.indexOf('total_honor')], 200);
    });
  });

  it('leaves out a player whose peace timer is longer than two months', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(sandbox, {
        900001: player(),
        900002: player({ 6: PEACE_CEILING }),
      });
      assert.equal(params[COLUMNS.indexOf('players_count')], 1, 'a timer that long is a dormant account');
    });
  });

  it('counts only established players as being under protection', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(sandbox, {
        900001: player({ 6: 3600, 8: 30 }),
        900002: player({ 6: 3600, 8: 10 }),
        900003: player({ 6: 0, 8: 30 }),
      });
      assert.equal(params[COLUMNS.indexOf('players_in_peace')], 1);
    });
  });

  it('counts the distinct alliances of the players it kept', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(sandbox, {
        900001: player({ 2: 500001 }),
        900002: player({ 2: 500001 }),
        900003: player({ 2: 500002 }),
        900004: player({ 2: -1 }),
        900005: player({ 2: undefined }),
      });
      assert.equal(params[COLUMNS.indexOf('alliance_count')], 2, 'neither -1 nor a missing id counts as an alliance');
      assert.equal(sandbox.state('customPlayersAttributesList').alliances_count, 2);
    });
  });

  it('reports the strongest and richest player of the run', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(sandbox, {
        900001: player({ 1: 1000, 0: 900 }),
        900002: player({ 1: 5000, 0: 100 }),
        900003: player({ 1: 200, 0: 4000 }),
      });
      assert.equal(params[COLUMNS.indexOf('max_might')], 5000);
      assert.equal(params[COLUMNS.indexOf('max_might_player_id')], 900002);
      assert.equal(params[COLUMNS.indexOf('max_loot')], 4000);
      assert.equal(params[COLUMNS.indexOf('max_loot_player_id')], 900003);
    });
  });

  it('measures the variation against the previous row of the table', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(
        sandbox,
        { 900001: player({ 0: 100, 1: 1000, 5: 50 }) },
        {},
        { total_might: 600, total_loot: 40, total_honor: 20 },
      );
      assert.equal(params[COLUMNS.indexOf('variation_might')], 400);
      assert.equal(params[COLUMNS.indexOf('variation_loot')], 60);
      assert.equal(params[COLUMNS.indexOf('variation_honor')], 30);
    });
  });

  it('treats the very first run of a server as a variation from zero', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(sandbox, { 900001: player({ 0: 100, 1: 1000, 5: 50 }) });
      assert.equal(params[COLUMNS.indexOf('variation_might')], 1000);
      assert.equal(params[COLUMNS.indexOf('variation_loot')], 100);
      assert.equal(params[COLUMNS.indexOf('variation_honor')], 50);
    });
  });

  it('totals each event and counts the players who entered it', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(
        sandbox,
        { 900001: player(), 900002: player() },
        {
          '900001': { [NOMAD_LT]: 10, [WAR_REALMS_LT]: 5, [SAMURAI_LT]: 1, [BERIMOND_LT]: 2, [BLOODCROW_LT]: 3 },
          '900002': { [NOMAD_LT]: 20, [WAR_REALMS_LT]: 0 },
        },
      );
      assert.equal(params[COLUMNS.indexOf('event_nomad_points')], 30);
      assert.equal(params[COLUMNS.indexOf('event_nomad_players')], 2);
      assert.equal(params[COLUMNS.indexOf('event_war_realms_points')], 5);
      assert.equal(params[COLUMNS.indexOf('event_war_realms_players')], 1, 'a zero score does not count as entered');
      assert.equal(params[COLUMNS.indexOf('event_samurai_points')], 1);
      assert.equal(params[COLUMNS.indexOf('event_bloodcrow_points')], 3);
      assert.equal(params[COLUMNS.indexOf('event_berimond_kingdom_points')], 2);
      assert.equal(params[COLUMNS.indexOf('events_count')], 5, 'one per distinct event the run collected');
    });
  });

  it('ranks the top three of every event and records its participation rate', async () => {
    await withSandbox({}, async (sandbox) => {
      const params = await runStats(
        sandbox,
        { 900001: player(), 900002: player(), 900003: player(), 900004: player() },
        {
          '900001': { [NOMAD_LT]: 10 },
          '900002': { [NOMAD_LT]: 40 },
          '900003': { [NOMAD_LT]: 30 },
          '900004': { [NOMAD_LT]: 20 },
        },
      );
      assert.deepEqual(JSON.parse(params[COLUMNS.indexOf('events_top_3_names')] as string), {
        [NOMAD_LT]: [
          { id: '900002', point: 40 },
          { id: '900003', point: 30 },
          { id: '900004', point: 20 },
        ],
      });
      assert.deepEqual(JSON.parse(params[COLUMNS.indexOf('events_participation_rate')] as string), {
        [NOMAD_LT]: [4, 1],
      });
    });
  });

  it('carries the rename counters the player pass accumulated', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('customPlayersAttributesList', {
        player_alliance_update_count: 7,
        player_name_update_count: 3,
        alliance_name_update_count: 2,
      });
      const params = await runStats(sandbox, { 900001: player() });
      assert.equal(params[COLUMNS.indexOf('players_who_changed_alliance')], 7);
      assert.equal(params[COLUMNS.indexOf('players_who_changed_name')], 3);
      assert.equal(params[COLUMNS.indexOf('alliances_changed_name')], 2);
    });
  });

  it('refuses to write a row for a run that collected nothing', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {});
      await sandbox.call('updateServerStatistics');
      assert.deepEqual(sandbox.db.matching(/INSERT INTO server_statistics/), []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1, 'an empty run is itself the anomaly');
    });
  });

  it('holds up on a whole run built from captured rankings', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.lootHead(), fixtures.might());
      await sandbox.call('fillLootHistory');
      await sandbox.call('fillMightPointsHistory');
      await sandbox.call('updateServerStatistics');
      const params = sandbox.db.one(/INSERT INTO server_statistics/).params;
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      const counted = Object.values(state).filter(
        (slots) => slots[4]?.length > 0 && (!slots[6] || slots[6] < PEACE_CEILING),
      );
      assert.equal(params[COLUMNS.indexOf('players_count')], counted.length);
      assert.equal(
        params[COLUMNS.indexOf('total_might')],
        counted.reduce((total, slots) => total + Number(slots[1] ?? 0), 0),
      );
      assert.equal(
        params[COLUMNS.indexOf('total_loot')],
        counted.reduce((total, slots) => total + Number(slots[0] ?? 0), 0),
      );
      assert.ok(Number(params[COLUMNS.indexOf('max_might')]) > 0);
    });
  });
});
