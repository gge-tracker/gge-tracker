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

import { fixtures, mainRealmCastles } from '../harness/fixtures';
import { withSandbox } from '../harness/sandbox';

describe('getDatabasePlayers', () => {
  it('splits the joined rows into players and the alliances behind them', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/FROM players P LEFT JOIN alliances A/, {
        rows: [
          {
            player_id: 900001,
            alliance_id: 500001,
            player_name: 'Player_900001',
            castles: [[10, 20, 1]],
            alliance_name: 'Alliance_500001',
            is_searching_alliance: true,
            auto_join_enabled: false,
            is_island_king: false,
            language: 'fr',
            description: 'a description',
          },
          {
            player_id: 900002,
            alliance_id: 500001,
            player_name: 'Player_900002',
            castles: null,
            alliance_name: 'Alliance_500001',
            is_searching_alliance: true,
            auto_join_enabled: false,
            is_island_king: false,
            language: 'fr',
            description: 'a description',
          },
          {
            player_id: 900003,
            alliance_id: null,
            player_name: 'Player_900003',
            castles: [],
            alliance_name: null,
          },
        ],
      });
      const { players, alliances } = await sandbox.call('getDatabasePlayers');
      assert.equal(players.length, 3);
      assert.deepEqual(players[0], {
        playerId: 900001,
        allianceId: 500001,
        playerName: 'Player_900001',
        allianceName: 'Alliance_500001',
        castles: [[10, 20, 1]],
      });
      assert.deepEqual(players[1].castles, [], 'a player with no castles column reads as holding none');
      assert.equal(alliances.length, 1, 'the alliance behind two players is only listed once');
      assert.deepEqual(alliances[0], {
        allianceId: 500001,
        is_searching_alliance: true,
        auto_join_enabled: false,
        language: 'fr',
        description: 'a description',
        is_island_king: false,
      });
    });
  });

  it('loads nothing once the run has recorded a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.state('DB_UPDATES').criticalErrors = 1;
      const result = await sandbox.call('getDatabasePlayers');
      assert.deepEqual(result, { players: [], alliances: [] });
      assert.deepEqual(sandbox.db.queries, []);
    });
  });
});

describe('run parameters', () => {
  it('clears every parameter before a run starts', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('clearParameters');
      assert.equal(sandbox.db.one(/UPDATE parameters/).sql, 'UPDATE parameters SET value = NULL');
    });
  });

  it('updates a parameter that the seed already created', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('updateParameter', 'is_currently_updating', 1);
      const update = sandbox.db.one(/UPDATE parameters SET value/);
      assert.equal(update.sql, 'UPDATE parameters SET value = $1, updated_at = NOW() WHERE identifier = $2');
      assert.deepEqual(update.params, [1, 'is_currently_updating']);
    });
  });

  it('creates a parameter on its first run and overwrites it afterwards', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('upsertParameter', 'storm_radius', 353);
      const upsert = sandbox.db.one(/INSERT INTO parameters/);
      assert.equal(
        upsert.sql,
        'INSERT INTO parameters (id, identifier, value, updated_at) SELECT COALESCE(MAX(id), 0) + 1, $1, $2, NOW() FROM parameters ON CONFLICT (identifier) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
      );
      assert.deepEqual(upsert.params, ['storm_radius', 353]);
    });
  });
});

describe('updateInactivePlayers', () => {
  it('asks for the players nothing has touched in a day', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', manyPlayers(150));
      await sandbox.call('updateInactivePlayers');
      const select = sandbox.db.one(/SELECT id FROM players/);
      assert.equal(
        select.sql,
        "SELECT id FROM players WHERE updated_at < NOW() - INTERVAL '24 hours' AND castles IS NOT NULL",
      );
    });
  });

  it('leaves the abandoned accounts of IN1 out of the refresh', async () => {
    await withSandbox({ server: 'IN1' }, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', manyPlayers(150));
      await sandbox.call('updateInactivePlayers');
      assert.ok(
        sandbox.db.one(/SELECT id FROM players/).sql.endsWith('AND might_current > 35'),
        'IN1 is never cleaned, so its dormant accounts are skipped rather than refreshed one by one',
      );
    });
  });

  it('does not run at all after a run that collected almost nothing', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', manyPlayers(99));
      await sandbox.call('updateInactivePlayers');
      assert.deepEqual(
        sandbox.db.queries,
        [],
        'too few players means the rankings failed, not that the server emptied',
      );
    });
  });

  it('does not run once the run has recorded a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', manyPlayers(150));
      sandbox.state('DB_UPDATES').criticalErrors = 1;
      await sandbox.call('updateInactivePlayers');
      assert.deepEqual(sandbox.db.queries, []);
    });
  });
});

describe('refreshInactivePlayer', () => {
  it('writes back what the game still knows about the player', async () => {
    await withSandbox({}, async (sandbox) => {
      const player = fixtures.lootHead().rows[0][2];
      sandbox.api.on('gdi', () => ({ return_code: 0, content: { O: { ...player, P: 12345 } } }));
      await sandbox.call('refreshInactivePlayer', Number(player.OID));
      const update = sandbox.db.one(/UPDATE players SET might_current/);
      assert.deepEqual(update.params, [
        player.MP,
        12345,
        player.MP,
        12345,
        JSON.stringify(mainRealmCastles(player)),
        player.H,
        player.H,
        player.RPT,
        player.L,
        player.LL,
        new Date(sandbox.now.getTime() + player.RPT * 1000).toISOString(),
        Number(player.OID),
      ]);
      assert.ok(/GREATEST\(COALESCE\(might_all_time, 0\), \$3\)/.test(update.sql), 'all-time columns only ever grow');
    });
  });

  it('empties a player the game no longer has a record of', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('gdi', () => ({ return_code: 0, content: {} }));
      await sandbox.call('refreshInactivePlayer', 900001);
      const wipe = sandbox.db.one(/UPDATE players SET castles/);
      assert.ok(/castles = '\[\]'::jsonb/.test(wipe.sql));
      assert.ok(/alliance_id = NULL/.test(wipe.sql));
      assert.deepEqual(wipe.params, [900001]);
    });
  });
});

function manyPlayers(count: number): Record<string, any[]> {
  const state: Record<string, any[]> = {};
  for (let index = 0; index < count; index++) state[String(900000 + index)] = [0, 0];
  return state;
}
