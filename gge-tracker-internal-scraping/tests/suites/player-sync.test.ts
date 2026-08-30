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

import { PlayerDatabase } from '../../src/interfaces';
import { fixtures } from '../harness/fixtures';
import { pgError } from '../harness/fake-postgres';
import { Sandbox, withSandbox } from '../harness/sandbox';

function slots(overrides: Record<number, unknown> = {}): any[] {
  const base: any[] = [];
  base[0] = 2000; // loot
  base[1] = 1000; // might
  base[2] = 500001; // alliance id
  base[3] = 'Alliance_500001';
  base[4] = [[10, 20, 1]]; // castles
  base[5] = 300; // honor
  base[6] = 0; // remaining peace time
  base[7] = 'Player_900001';
  base[8] = 70; // level
  base[9] = 950; // legendary level
  base[10] = '12345'; // highest fame
  base[11] = '999'; // current fame
  base[12] = 0; // remaining relocation time
  base[13] = [[1, 30, 40, 12]]; // outer realm castles
  base[14] = '2026-09-01T00:00:00.000Z'; // peace expiry
  base[15] = 8; // alliance rank
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base;
}

function stored(playerId: number, overrides: Partial<PlayerDatabase> = {}): PlayerDatabase {
  return {
    playerId,
    allianceId: 500001,
    playerName: 'Player_900001',
    allianceName: 'Alliance_500001',
    castles: [[10, 20, 1]],
    ...overrides,
  };
}

function tmpRows(sandbox: Sandbox): any[][] {
  const insert = sandbox.db.one(/INSERT INTO tmp_players_update/);
  const width = 17;
  const rows: any[][] = [];
  for (let index = 0; index < insert.params.length; index += width) {
    rows.push(insert.params.slice(index, index + width));
  }
  return rows;
}

describe('updatePlayersMightAndLoot', () => {
  it('carries every slot of the run state into the row that is written', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', { 900001: slots({ 6: 3600 }) });
      sandbox.setState('currentPlayers', [stored(900001)]);
      await sandbox.call('updatePlayersMightAndLoot');
      assert.deepEqual(tmpRows(sandbox), [
        [
          900001,
          1000,
          2000,
          1000,
          2000,
          8,
          '[[10,20,1]]',
          '[[1,30,40,12]]',
          300,
          300,
          3600,
          70,
          950,
          '12345',
          '999',
          0,
          '2026-09-01T00:00:00.000Z',
        ],
      ]);
    });
  });

  it('drops the peace expiry of a player who is no longer protected', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {
        900001: slots({ 6: 3600 }),
        900002: slots({ 6: 0 }),
      });
      sandbox.setState('currentPlayers', [stored(900001), stored(900002)]);
      await sandbox.call('updatePlayersMightAndLoot');
      const rows = tmpRows(sandbox);
      assert.equal(rows[0][16], '2026-09-01T00:00:00.000Z', 'a running timer keeps the instant it expires');
      assert.equal(rows[1][16], null, 'an expired timer carries no instant at all');
    });
  });

  it('turns a missing value into the default the column expects', async () => {
    await withSandbox({}, async (sandbox) => {
      const empty: any[] = [];
      sandbox.setState('playerLootAndMightPointHistoryList', { 900001: empty });
      sandbox.setState('currentPlayers', [stored(900001, { allianceId: null, playerName: null as any, castles: [] })]);
      await sandbox.call('updatePlayersMightAndLoot');
      const [row] = tmpRows(sandbox);
      assert.deepEqual(row.slice(0, 6), [900001, 0, 0, 0, 0, null], 'scores fall back to zero, the rank to null');
      assert.equal(row[6], null, 'castles');
      assert.equal(row[7], null, 'castles_realm');
    });
  });

  it('upserts only the players whose identity or castles moved', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {
        900001: slots({ 7: 'Player_900001' }), // unchanged
        900002: slots({ 7: 'Player_renamed' }), // renamed
        900003: slots({ 2: 500009, 3: 'Alliance_500009' }), // moved alliance
        900004: slots({ 3: 'Alliance_renamed' }), // alliance renamed under them
        900005: slots({ 4: [[99, 99, 1]] }), // main castle moved
        900006: slots(), // never seen before
      });
      sandbox.setState('currentPlayers', [
        stored(900001),
        stored(900002),
        stored(900003),
        stored(900004),
        stored(900005),
      ]);
      await sandbox.call('updatePlayersMightAndLoot');
      assert.deepEqual(
        sandbox.db.matching(/INSERT INTO players/).map((query) => query.params[0]),
        [900006],
        'only the player the database has never seen is created',
      );
      assert.deepEqual(
        sandbox.db.matching(/UPDATE players SET name/).map((query) => query.params[1]),
        [900002],
      );
      assert.deepEqual(
        sandbox.db.matching(/INSERT INTO player_alliance_update/).map((query) => query.params[0]),
        [900003],
      );
      assert.deepEqual(
        sandbox.db.matching(/INSERT INTO alliance_update_history/).map((query) => query.params[0]),
        [500001],
        'the rename is recorded once, against the alliance',
      );
      assert.deepEqual(
        sandbox.db.matching(/INSERT INTO player_castle_movements_history/).map((query) => query.params[0]),
        [900005],
      );
    });
  });

  it('writes a row for every player, including the ones it did not need to upsert', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {
        900001: slots(),
        900002: slots(),
        900003: slots(),
      });
      sandbox.setState('currentPlayers', [stored(900001), stored(900002), stored(900003)]);
      await sandbox.call('updatePlayersMightAndLoot');
      assert.deepEqual(sandbox.db.matching(/INSERT INTO players/), [], 'nothing changed, so nothing is upserted');
      assert.equal(tmpRows(sandbox).length, 3, 'the bulk update still carries all three');
      assert.deepEqual(sandbox.db.matching(/player_name_update_history|player_alliance_update/), []);
    });
  });

  it('finishes every upsert before folding the temp table', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {
        900001: slots({ 7: 'Player_renamed' }),
        900002: slots(),
      });
      sandbox.setState('currentPlayers', [stored(900001)]);
      await sandbox.call('updatePlayersMightAndLoot');
      const statements = sandbox.db.queries.map((query) => query.sql);
      const lastIndexOf = (pattern: RegExp): number =>
        statements.reduce((last, sql, index) => (pattern.test(sql) ? index : last), -1);
      const lastUpsert = Math.max(lastIndexOf(/^INSERT INTO players/), lastIndexOf(/^UPDATE players SET name/));
      const fold = statements.findIndex((sql) => /^INSERT INTO tmp_players_update/.test(sql));
      assert.ok(lastUpsert >= 0 && fold >= 0);
      assert.ok(lastUpsert < fold, 'every upsert lands before the temp table is loaded');
      assert.ok(
        statements.findIndex((sql) => /^UPDATE players p SET/.test(sql)) > fold,
        'and the fold runs after the load',
      );
    });
  });

  it('refreshes each alliance the run saw, once', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {
        900001: slots({ 2: 500001 }),
        900002: slots({ 2: 500001 }),
        900003: slots({ 2: 500002 }),
      });
      sandbox.setState('currentPlayers', [stored(900001), stored(900002), stored(900003, { allianceId: 500002 })]);
      await sandbox.call('updatePlayersMightAndLoot');
      assert.deepEqual(
        sandbox.api.callsFor('ain').map((call) => call.parameters.AID),
        [500001, 500002],
      );
    });
  });

  it('asks the game about the players with no alliance as if they had one', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', { 900001: slots({ 2: undefined }) });
      sandbox.setState('currentPlayers', [stored(900001, { allianceId: null, allianceName: null })]);
      await sandbox.call('updatePlayersMightAndLoot');
      assert.deepEqual(
        sandbox.api.callsFor('ain').map((call) => call.parameters.AID),
        [null],
      );
      assert.deepEqual(sandbox.db.matching(/UPDATE alliances SET/), [], 'and writes nothing for it');
    });
  });

  it('does nothing once the run has recorded a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', { 900001: slots() });
      sandbox.state('DB_UPDATES').criticalErrors = 1;
      await sandbox.call('updatePlayersMightAndLoot');
      assert.deepEqual(sandbox.db.queries, []);
      assert.deepEqual(sandbox.api.requests, []);
    });
  });

  it('counts a critical error when the bulk update cannot run', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/CREATE TEMP TABLE/, { error: pgError('42501', 'permission denied') });
      sandbox.setState('playerLootAndMightPointHistoryList', { 900001: slots() });
      sandbox.setState('currentPlayers', [stored(900001)]);
      await sandbox.call('updatePlayersMightAndLoot');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(sandbox.api.callsFor('ain'), [], 'the alliance refresh never starts after that');
    });
  });

  it('holds up on a run state built from captured rankings', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.lootHead(), fixtures.might());
      await sandbox.call('fillLootHistory');
      await sandbox.call('fillMightPointsHistory');
      await sandbox.call('updatePlayersMightAndLoot');
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      const players = Object.keys(state);
      assert.ok(players.length > 100, 'the two rankings together cover a realistic run');
      assert.equal(tmpRows(sandbox).length, players.length, 'every player collected gets a row');
      assert.equal(
        sandbox.db.matching(/INSERT INTO players/).length,
        players.length,
        'against an empty database every one of them is created',
      );
      const alliances = new Set(players.map((id) => state[id][2] || null));
      assert.equal(sandbox.api.callsFor('ain').length, alliances.size);
    });
  });
});
