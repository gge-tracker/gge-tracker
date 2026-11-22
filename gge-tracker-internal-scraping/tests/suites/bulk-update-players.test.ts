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
import { fixtures, mainRealmCastles, otherRealmCastles } from '../harness/fixtures';
import { Sandbox, withSandbox } from '../harness/sandbox';

const COLUMNS = [
  'id',
  'might_current',
  'loot_current',
  'might_all_time',
  'loot_all_time',
  'alliance_rank',
  'castles',
  'castles_realm',
  'honor',
  'max_honor',
  'remaining_peace_time',
  'level',
  'legendary_level',
  'highest_fame',
  'current_fame',
  'remaining_relocation_time',
  'peace_disabled_at',
  'is_ruin',
];

function slots(overrides: Record<number, unknown> = {}): any[] {
  const base = [
    2000, // 0 loot_current
    1000, // 1 might_current
    500001, // 2 alliance_id
    'Alliance_500001', // 3 alliance_name
    [[10, 20, 1]], // 4 castles
    300, // 5 honor
    0, // 6 remaining_peace_time
    'Player_900001', // 7 player_name
    70, // 8 level
    950, // 9 legendary_level
    '12345', // 10 highest_fame
    '999', // 11 current_fame
    0, // 12 remaining_relocation_time
    [[1, 30, 40, 12]], // 13 castles_realm
    null, // 14 peace_disabled_at
    8, // 15 alliance_rank
    false, // 16 is_ruin
  ];
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value as any;
  return base;
}

function runBulk(sandbox: Sandbox, updates: Record<number, any[]>): Promise<unknown> {
  return sandbox.call('bulkUpdatePlayers', updates);
}

describe('bulkUpdatePlayers', () => {
  it('creates the temp table with the columns the fold reads back', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, { 900001: slots() });

      const create = sandbox.db.one(/CREATE TEMP TABLE tmp_players_update/);
      for (const column of COLUMNS) {
        assert.ok(new RegExp(`\\b${column}\\b`).test(create.sql), `the temp table declares ${column}`);
      }
      assert.ok(/id INTEGER PRIMARY KEY/.test(create.sql), 'one row per player, enforced by the table itself');
    });
  });

  it('maps every run-state slot onto its column', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, { 900001: slots() });

      const insert = sandbox.db.one(/INSERT INTO tmp_players_update/);
      assert.equal(
        insert.sql,
        `INSERT INTO tmp_players_update (${COLUMNS.join(', ')}) VALUES (${placeholders(1, 18)})`,
      );
      assert.deepEqual(insert.params, [
        900001,
        1000, // might_current
        2000, // loot_current
        1000, // might_all_time
        2000, // loot_all_time
        8, // alliance_rank
        '[[10,20,1]]',
        '[[1,30,40,12]]',
        300, // honor
        300, // max_honor
        0, // remaining_peace_time
        70,
        950,
        '12345',
        '999',
        0,
        null, // peace_disabled_at
        false, // is_ruin
      ]);
    });
  });

  it('keeps peace_disabled_at only while the player is still under protection', async () => {
    await withSandbox({}, async (sandbox) => {
      const expiry = '2026-09-01T00:00:00.000Z';
      await runBulk(sandbox, {
        900001: slots({ 6: 3600, 14: expiry }),
        900002: slots({ 6: 0, 14: expiry }),
      });

      const rows = chunkRows(sandbox.db.one(/INSERT INTO tmp_players_update/).params, 18);
      assert.equal(rows[0][16], expiry, 'a running peace timer carries the instant it expires');
      assert.equal(rows[1][16], null, 'an expired timer drops the instant rather than keeping a stale one');
    });
  });

  it('drops an alliance rank that is outside the range a rank can take', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, {
        900001: slots({ 15: 0 }),
        900002: slots({ 15: 100 }),
        900003: slots({ 15: 101 }),
        900004: slots({ 15: -1 }),
        900005: slots({ 15: undefined }),
      });

      const ranks = chunkRows(sandbox.db.one(/INSERT INTO tmp_players_update/).params, 18).map((row) => row[5]);
      assert.deepEqual(ranks, [0, 100, null, null, null]);
    });
  });

  it('stores the ruin flag only when the slot is exactly true', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, {
        900001: slots({ 16: true }),
        900002: slots({ 16: false }),
        900003: slots({ 16: undefined }),
      });

      const flags = chunkRows(sandbox.db.one(/INSERT INTO tmp_players_update/).params, 18).map((row) => row[17]);
      assert.deepEqual(flags, [true, false, false]);
    });
  });

  it('stores a missing castle list as null rather than an empty array', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, { 900001: slots({ 4: null, 13: null }) });

      const params = sandbox.db.one(/INSERT INTO tmp_players_update/).params;
      assert.equal(params[6], null, 'castles');
      assert.equal(params[7], null, 'castles_realm');
    });
  });

  it('serialises real captured castles as the JSON the players table stores', async () => {
    await withSandbox({}, async (sandbox) => {
      const player = fixtures.lootHead().rows[0][2];
      await runBulk(sandbox, { 900001: slots({ 4: mainRealmCastles(player), 13: otherRealmCastles(player) }) });

      const params = sandbox.db.one(/INSERT INTO tmp_players_update/).params;
      assert.deepEqual(JSON.parse(params[6] as string), mainRealmCastles(player));
      assert.deepEqual(JSON.parse(params[7] as string), otherRealmCastles(player));
    });
  });

  it('splits the load into chunks of three thousand players', async () => {
    await withSandbox({}, async (sandbox) => {
      const updates: Record<number, any[]> = {};
      for (let index = 0; index < 7001; index++) updates[900000 + index] = slots();

      await runBulk(sandbox, updates);

      const inserts = sandbox.db.matching(/INSERT INTO tmp_players_update/);
      assert.deepEqual(
        inserts.map((insert) => insert.params.length / 18),
        [3000, 3000, 1001],
      );
      assert.ok(inserts[0].sql.endsWith(`(${placeholders(2999 * 18 + 1, 18)})`));
    });
  });

  it('folds the temp table into players, keeping the best all-time value of each column', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, { 900001: slots() });

      const update = sandbox.db.one(/UPDATE players p/);
      assert.equal(
        update.sql,
        collapse(`
          UPDATE players p
          SET
            loot_current = tmp.loot_current,
            might_current = tmp.might_current,
            loot_all_time = GREATEST(COALESCE(p.loot_all_time, 0), tmp.loot_all_time),
            might_all_time = GREATEST(COALESCE(p.might_all_time, 0), tmp.might_all_time),
            alliance_rank = tmp.alliance_rank,
            castles = tmp.castles,
            castles_realm = tmp.castles_realm,
            honor = tmp.honor,
            max_honor = GREATEST(COALESCE(p.max_honor, 0), tmp.max_honor),
            remaining_peace_time = tmp.remaining_peace_time,
            level = GREATEST(COALESCE(p.level, 0), tmp.level),
            legendary_level = GREATEST(COALESCE(p.legendary_level, 0), tmp.legendary_level),
            highest_fame = GREATEST(COALESCE(p.highest_fame, 0), tmp.highest_fame),
            current_fame = tmp.current_fame,
            remaining_relocation_time = tmp.remaining_relocation_time,
            peace_disabled_at = tmp.peace_disabled_at,
            is_ruin = tmp.is_ruin,
            updated_at = CURRENT_TIMESTAMP
          FROM tmp_players_update tmp
          WHERE p.id = tmp.id
        `),
      );
      assert.deepEqual(update.params, []);
    });
  });

  it('records honor, protection and ruin transitions from the previous row before the fold overwrites it', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, { 900001: slots() });

      const statements = sandbox.db.queries.map((query) => query.sql);
      const record = statements.findIndex((sql) => sql.startsWith('INSERT INTO player_state_history'));
      const lastChunk = statements.map((sql) => sql.startsWith('INSERT INTO tmp_players_update')).lastIndexOf(true);
      const fold = statements.findIndex((sql) => sql.startsWith('UPDATE players p'));
      assert.ok(lastChunk < record && record < fold, 'read after the temp table is full, before players moves');

      const sql = statements[record];
      assert.ok(sql.includes('FROM tmp_players_update tmp JOIN players p ON p.id = tmp.id'));
      assert.ok(sql.includes('WHERE p.honor IS NOT NULL'), 'a player inserted this run has no previous state');
      assert.ok(
        sql.includes("jsonb_typeof(p.castles) = 'array' THEN jsonb_array_length(p.castles) > 0"),
        'a wiped player coming back is not a change',
      );
      for (const change of [
        'p.honor IS DISTINCT FROM tmp.honor',
        '(COALESCE(p.remaining_peace_time, 0) > 0) <> (COALESCE(tmp.remaining_peace_time, 0) > 0)',
        'COALESCE(p.is_ruin, FALSE) <> tmp.is_ruin',
      ]) {
        assert.ok(sql.includes(change), `records a row when ${change}`);
      }
      assert.deepEqual(sandbox.db.one(/INSERT INTO player_state_history/).params, []);
    });
  });

  it('keeps 35 days of state history', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, { 900001: slots() });

      assert.equal(
        sandbox.db.one(/DELETE FROM player_state_history/).sql,
        "DELETE FROM player_state_history WHERE created_at < NOW() - INTERVAL '35 days'",
      );
    });
  });

  it('still folds the players when the state history cannot be written', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/INSERT INTO player_state_history/, {
        error: pgError('42P01', 'relation "player_state_history" does not exist'),
      });

      await runBulk(sandbox, { 900001: slots() });

      assert.equal(sandbox.db.matching(/UPDATE players p/).length, 1);
      assert.equal(sandbox.db.matching(/DELETE FROM player_state_history/).length, 0);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0, 'a missing history is not a failed fill');
    });
  });

  it('still creates the temp table and folds it when there is nothing to update', async () => {
    await withSandbox({}, async (sandbox) => {
      await runBulk(sandbox, {});

      assert.equal(sandbox.db.matching(/INSERT INTO tmp_players_update/).length, 0, 'no empty VALUES clause');
      assert.equal(sandbox.db.matching(/CREATE TEMP TABLE/).length, 1);
      assert.equal(sandbox.db.matching(/UPDATE players p/).length, 1);
    });
  });
});

function placeholders(start: number, count: number): string {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(', ');
}

function chunkRows(params: any[], width: number): any[][] {
  const rows: any[][] = [];
  for (let index = 0; index < params.length; index += width) rows.push(params.slice(index, index + width));
  return rows;
}
