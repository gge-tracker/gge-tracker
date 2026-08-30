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

import { collapse, pgError } from '../harness/fake-postgres';
import { fixtures, mainRealmCastles } from '../harness/fixtures';
import { PlayerDatabase } from '../../src/interfaces';
import { Sandbox, withSandbox } from '../harness/sandbox';

const INSERT_PLAYER =
  'INSERT INTO players (id, name, alliance_id, might_current, might_all_time, loot_current, loot_all_time) VALUES ($1, $2, $3, $4, $5, $6, $7)';

function existing(overrides: Partial<PlayerDatabase> = {}): PlayerDatabase {
  return {
    playerId: 900001,
    allianceId: 500001,
    playerName: 'Player_900001',
    allianceName: 'Alliance_500001',
    castles: [],
    ...overrides,
  };
}

function upsert(sandbox: Sandbox, overrides: Record<string, unknown> = {}): Promise<unknown> {
  return sandbox.call('addPlayerInDatabase', {
    playerId: 900001,
    playerName: 'Player_900001',
    allianceId: 500001,
    allianceName: 'Alliance_500001',
    might_current: 1000,
    might_all_time: null,
    loot_current: 2000,
    loot_all_time: null,
    castles: [],
    ...overrides,
  });
}

describe('addPlayerInDatabase', () => {
  it('creates a player the run has never seen', async () => {
    await withSandbox({}, async (sandbox) => {
      await upsert(sandbox);
      const insert = sandbox.db.one(/INSERT INTO players/);
      assert.equal(insert.sql, INSERT_PLAYER);
      assert.deepEqual(insert.params, [900001, 'Player_900001', 500001, 1000, null, 2000, null]);
      assert.equal(sandbox.state('DB_UPDATES').playersCreated, 1);
    });
  });

  it('stores a null rather than a zero for every score and alliance that is not set', async () => {
    await withSandbox({}, async (sandbox) => {
      await upsert(sandbox, {
        allianceId: -1,
        might_current: 0,
        might_all_time: 0,
        loot_current: 0,
        loot_all_time: 0,
      });
      assert.deepEqual(sandbox.db.one(/INSERT INTO players/).params, [
        900001,
        'Player_900001',
        null,
        null,
        null,
        null,
        null,
      ]);
    });
  });

  it('creates the missing alliance and retries when the player insert hits the foreign key', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/INSERT INTO players/, { error: pgError('23503'), onCall: 0 });
      await upsert(sandbox);
      const statements = sandbox.db.queries.map((query) => query.sql);
      assert.deepEqual(statements, [INSERT_PLAYER, 'INSERT INTO alliances (id, name) VALUES ($1, $2)', INSERT_PLAYER]);
      assert.deepEqual(sandbox.db.queries[1].params, [500001, 'Alliance_500001']);
      assert.equal(sandbox.state('DB_UPDATES').playersCreated, 1, 'the retry counts once, not twice');
    });
  });

  it('swallows a duplicate alliance without counting an error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/INSERT INTO alliances/, { error: pgError('23505') });
      await sandbox.call('addAllianceInDatabase', 500001, 'Alliance_500001');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0, 'a race on the same alliance is not an error');
    });
  });

  it('records a rename in the history table and updates the name once', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('currentPlayers', [existing({ playerName: 'Player_900001_old' })]);
      await upsert(sandbox);
      assert.deepEqual(sandbox.db.one(/UPDATE players SET name/).params, ['Player_900001', 900001]);
      assert.deepEqual(sandbox.db.one(/INSERT INTO player_name_update_history/).params, [
        900001,
        'Player_900001_old',
        'Player_900001',
      ]);
      assert.equal(sandbox.state('customPlayersAttributesList').player_name_update_count, 1);
      await upsert(sandbox);
      assert.equal(sandbox.db.matching(/INSERT INTO player_name_update_history/).length, 1);
    });
  });

  it('records an alliance change in the history table', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('currentPlayers', [existing({ allianceId: 500009, allianceName: 'Alliance_500009' })]);
      await upsert(sandbox);
      assert.deepEqual(sandbox.db.one(/UPDATE players SET alliance_id/).params, [500001, 900001]);
      assert.deepEqual(sandbox.db.one(/INSERT INTO player_alliance_update/).params, [
        900001,
        500009,
        500001,
        'Alliance_500009',
        'Alliance_500001',
      ]);
      assert.equal(sandbox.state('DB_UPDATES').playersAllianceUpdated, 1);
      assert.equal(sandbox.state('customPlayersAttributesList').player_alliance_update_count, 1);
    });
  });

  it('records an alliance rename once, however many of its members the run walks', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('currentPlayers', [
        existing({ playerId: 900001, allianceName: 'Alliance_old' }),
        existing({ playerId: 900002, allianceName: 'Alliance_old' }),
      ]);
      await upsert(sandbox);
      await upsert(sandbox, { playerId: 900002 });
      assert.deepEqual(sandbox.db.one(/UPDATE alliances SET name/).params, ['Alliance_500001', 500001]);
      assert.deepEqual(sandbox.db.one(/INSERT INTO alliance_update_history/).params, [
        500001,
        'Alliance_old',
        'Alliance_500001',
      ]);
      assert.equal(sandbox.state('DB_UPDATES').alliancesUpdated, 1);
    });
  });

  it('leaves the alliance name alone when the player also changed alliance', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('currentPlayers', [existing({ allianceId: 500009, allianceName: 'Alliance_500009' })]);
      await upsert(sandbox);
      assert.deepEqual(sandbox.db.matching(/INSERT INTO alliance_update_history/), []);
      assert.equal(sandbox.db.matching(/INSERT INTO player_alliance_update/).length, 1);
    });
  });

  it('stops after the rename when asked for a minimalist update', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('currentPlayers', [
        existing({ playerName: 'Player_900001_old', allianceId: 500009, allianceName: 'Alliance_500009' }),
      ]);
      await upsert(sandbox, { minimalist: true });
      assert.equal(sandbox.db.matching(/INSERT INTO player_name_update_history/).length, 1);
      assert.deepEqual(sandbox.db.matching(/player_alliance_update/), [], 'the alliance is left to the full pass');
    });
  });

  it('writes one movement row per castle that moved', async () => {
    await withSandbox({}, async (sandbox) => {
      const player = fixtures.lootHead().rows[0][2];
      const before = mainRealmCastles(player);
      assert.ok(before.length > 1, 'the captured player holds several castles');
      const after = before.map((castle, index) => (index === 0 ? [castle[0] + 5, castle[1], castle[2]] : castle));
      sandbox.setState('currentPlayers', [existing({ castles: before as any })]);
      await upsert(sandbox, { castles: after });
      const movements = sandbox.db.matching(/INSERT INTO player_castle_movements_history/);
      assert.equal(movements.length, 1);
      assert.equal(
        movements[0].sql,
        collapse(`INSERT INTO player_castle_movements_history (player_id, castle_type, movement_type,
          position_x_old, position_y_old, position_x_new, position_y_new) VALUES ($1, $2, $3, $4, $5, $6, $7)`),
      );
      assert.deepEqual(movements[0].params, [900001, before[0][2], 'add', null, null, before[0][0] + 5, before[0][1]]);
    });
  });

  it('counts a critical error when a castle movement cannot be written', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/INSERT INTO player_castle_movements_history/, { error: pgError('42P01') });
      sandbox.setState('currentPlayers', [existing({ castles: [[100, 100, 1]] as any })]);
      await upsert(sandbox, { castles: [[200, 200, 1]] });
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });
});
