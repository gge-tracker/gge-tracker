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

import { collapse } from '../harness/fake-postgres';
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
        `INSERT INTO tmp_players_update (${COLUMNS.join(', ')}) VALUES (${placeholders(1, 17)})`,
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

      const rows = chunkRows(sandbox.db.one(/INSERT INTO tmp_players_update/).params, 17);
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

      const ranks = chunkRows(sandbox.db.one(/INSERT INTO tmp_players_update/).params, 17).map((row) => row[5]);
      assert.deepEqual(ranks, [0, 100, null, null, null]);
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
        inserts.map((insert) => insert.params.length / 17),
        [3000, 3000, 1001],
      );
      assert.ok(inserts[0].sql.endsWith(`(${placeholders(2999 * 17 + 1, 17)})`));
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
            updated_at = CURRENT_TIMESTAMP
          FROM tmp_players_update tmp
          WHERE p.id = tmp.id
        `),
      );
      assert.deepEqual(update.params, []);
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
