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
          position_x_old, position_y_old, position_x_new, position_y_new, previous_owner_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`),
      );
      assert.deepEqual(movements[0].params, [
        900001,
        before[0][2],
        'add',
        null,
        null,
        before[0][0] + 5,
        before[0][1],
        null,
      ]);
    });
  });

  it('names the player who held a captured outpost in the previous fill', async () => {
    await withSandbox({}, async (sandbox) => {
      const outpost = [300, 400, 4];
      sandbox.setState('currentPlayers', [
        existing({ castles: [[100, 100, 1]] as any }),
        existing({ playerId: 900002, playerName: 'Player_900002', castles: [[50, 50, 1], outpost] as any }),
      ]);
      await upsert(sandbox, { castles: [[100, 100, 1], outpost] });
      const movement = sandbox.db.one(/INSERT INTO player_castle_movements_history/);
      assert.deepEqual(movement.params, [900001, 4, 'add', null, null, 300, 400, 900002]);
    });
  });

  const MONUMENT = 26;
  const LABORATORY = 28;
  const PARIS = { timezone: 'Europe/Paris', minutesFromMonday: 0 };

  async function claimedFromAnother(now: string, castleType: number, lootReset: unknown = PARIS): Promise<unknown> {
    let previousOwner: unknown;
    await withSandbox({ now: new Date(now) }, async (sandbox) => {
      const castle = [300, 400, castleType];
      sandbox.setState('lootReset', lootReset);
      sandbox.setState('currentPlayers', [
        existing({ castles: [[100, 100, 1]] as any }),
        existing({ playerId: 900002, playerName: 'Player_900002', castles: [[50, 50, 1], castle] as any }),
      ]);
      await upsert(sandbox, { castles: [[100, 100, 1], castle] });
      previousOwner = sandbox.db.one(/INSERT INTO player_castle_movements_history/).params[7];
    });
    return previousOwner;
  }

  it('names the previous owner of any capturable castle taken outside the monthly resets', async () => {
    assert.equal(await claimedFromAnother('2026-11-15T12:00:00Z', MONUMENT), 900002);
    assert.equal(await claimedFromAnother('2026-11-15T12:00:00Z', LABORATORY), 900002);
    assert.equal(await claimedFromAnother('2026-11-15T12:00:00Z', 22), 900002, 'a trade metropolis');
  });

  it('names nobody for a monument claimed in the hours after local midnight of the 2nd', async () => {
    assert.equal(await claimedFromAnother('2026-11-01T23:30:00Z', MONUMENT), null, '00:30 in Paris');
    assert.equal(await claimedFromAnother('2026-11-02T02:30:00Z', MONUMENT), null, '03:30 in Paris');
    assert.equal(await claimedFromAnother('2026-11-02T03:30:00Z', MONUMENT), 900002, '04:30 in Paris');
    assert.equal(await claimedFromAnother('2026-11-01T23:30:00Z', LABORATORY), 900002, 'laboratories wait a day');
    assert.equal(await claimedFromAnother('2026-11-01T23:30:00Z', 22), 900002, 'a trade metropolis is not reset');
  });

  it('names nobody for a laboratory claimed in the hours after local midnight of the 3rd', async () => {
    assert.equal(await claimedFromAnother('2026-11-02T23:30:00Z', LABORATORY), null);
    assert.equal(await claimedFromAnother('2026-11-02T23:30:00Z', MONUMENT), 900002);
  });

  it('follows the declared timezone and its daylight saving', async () => {
    const sydney = { timezone: 'Australia/Sydney', minutesFromMonday: 0 };
    assert.equal(await claimedFromAnother('2026-11-01T13:30:00Z', MONUMENT, sydney), null, 'AEDT, 00:30 on the 2nd');
    assert.equal(await claimedFromAnother('2026-08-01T14:30:00Z', MONUMENT, sydney), null, 'AEST, 00:30 on the 2nd');
    assert.equal(await claimedFromAnother('2026-11-01T23:30:00Z', MONUMENT, sydney), 900002, 'midday in Sydney');
  });

  it('covers every server midnight when no timezone is declared', async () => {
    assert.equal(await claimedFromAnother('2026-11-01T13:30:00Z', MONUMENT, null), null);
    assert.equal(await claimedFromAnother('2026-11-02T06:30:00Z', MONUMENT, null), null);
    assert.equal(await claimedFromAnother('2026-11-02T09:30:00Z', MONUMENT, null), 900002);
  });

  it('names nobody for a main castle settled where another player stood', async () => {
    assert.equal(await claimedFromAnother('2026-11-15T12:00:00Z', 1), null);
  });

  it('names nobody for an outpost no stored player held', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('currentPlayers', [existing({ castles: [[100, 100, 1]] as any })]);
      await upsert(sandbox, {
        castles: [
          [100, 100, 1],
          [300, 400, 4],
        ],
      });
      const movement = sandbox.db.one(/INSERT INTO player_castle_movements_history/);
      assert.equal(movement.params[7], null);
    });
  });

  it('writes the movement without the previous owner where the column does not exist yet', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/previous_owner_id/, { error: pgError('42703') });
      sandbox.setState('currentPlayers', [existing({ castles: [[100, 100, 1]] as any })]);
      await upsert(sandbox, {
        castles: [
          [100, 100, 1],
          [300, 400, 4],
          [310, 410, 4],
        ],
      });
      const movements = sandbox.db.matching(/INSERT INTO player_castle_movements_history/);
      assert.equal(movements.filter((query) => query.sql.includes('previous_owner_id')).length, 1, 'asked once');
      const written = movements.filter((query) => !query.sql.includes('previous_owner_id'));
      assert.deepEqual(
        written.map((query) => query.params),
        [
          [900001, 4, 'add', null, null, 300, 400],
          [900001, 4, 'add', null, null, 310, 410],
        ],
      );
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
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
