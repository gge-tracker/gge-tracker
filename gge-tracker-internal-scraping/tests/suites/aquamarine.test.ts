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

import { aquamarineByPlayer, fixtures, otherRealmCastles } from '../harness/fixtures';
import { timeout } from '../harness/fake-api';
import { Sandbox, withSandbox } from '../harness/sandbox';

const TABLE = 'player_metrics';
const EID = 102;
const AQUAMARINE_REALM = 4;
const CARGO_METRIC_ID = 100;

function serveAquamarine(sandbox: Sandbox): Map<number, Record<string, any>> {
  const byPlayer = aquamarineByPlayer();
  sandbox.api.on('gpe', (request) => {
    const payload = byPlayer.get(Number(request.parameters.PID));
    if (!payload) return timeout('gpe');
    return { server: 'TEST', command: 'gpe', return_code: 0, content: payload };
  });
  return byPlayer;
}

function seedFromLootTop(sandbox: Sandbox, covered: Set<number>): void {
  const state: Record<string, any[]> = {};
  for (const [, , player] of fixtures.lootHead().rows) {
    if (!covered.has(Number(player.OID))) continue;
    const slots: any[] = [];
    slots[13] = otherRealmCastles(player);
    state[String(player.OID)] = slots;
  }
  sandbox.setState('playerLootAndMightPointHistoryList', state);
}

describe('fillPlayerAquamarineData', () => {
  it('asks only for the players holding a castle in the aquamarine realm', async () => {
    await withSandbox({}, async (sandbox) => {
      const byPlayer = serveAquamarine(sandbox);
      const eligible: Record<string, any[]> = {};
      const withCastle: any[] = [];
      const withoutCastle: any[] = [];
      withCastle[13] = [[AQUAMARINE_REALM, 10, 20, 12]];
      withoutCastle[13] = [[1, 10, 20, 12]];
      eligible['900262'] = withCastle;
      eligible['900263'] = withoutCastle;
      eligible['900264'] = [];
      sandbox.setState('playerLootAndMightPointHistoryList', eligible);
      await sandbox.call('fillPlayerAquamarineData');
      assert.deepEqual(
        sandbox.api.callsFor('gpe').map((call) => Number(call.parameters.PID)),
        [900262],
      );
      assert.equal(sandbox.api.callsFor('gpe')[0].parameters.EID, EID);
      assert.ok(byPlayer.size > 0);
    });
  });

  it('turns each reported statistic into a row, plus one for the cargo', async () => {
    await withSandbox({}, async (sandbox) => {
      const byPlayer = serveAquamarine(sandbox);
      seedFromLootTop(sandbox, new Set(byPlayer.keys()));
      await sandbox.call('fillPlayerAquamarineData');
      const rows = sandbox.clickhouse.rows(TABLE);
      const expected = [...byPlayer.values()].flatMap((payload) => [
        ...payload.PST.map((item: any) => ({
          player_id: Number(payload.PID),
          metric_id: Number(item.PSI),
          value: Number(item.AMT ?? 0),
          collected_at: '2026-08-29 12:00:00',
        })),
        {
          player_id: Number(payload.PID),
          metric_id: CARGO_METRIC_ID,
          value: Number(payload.AMT ?? 0),
          collected_at: '2026-08-29 12:00:00',
        },
      ]);
      assert.equal(rows.length, expected.length);
      const key = (row: any): string => `${row.player_id}/${row.metric_id}`;
      const byKey = new Map(rows.map((row) => [key(row), row]));
      for (const row of expected) assert.deepEqual(byKey.get(key(row)), row);
    });
  });

  it('skips a player who never entered the event', async () => {
    await withSandbox({}, async (sandbox) => {
      const byPlayer = aquamarineByPlayer();
      const [playerId, payload] = [...byPlayer.entries()][0];
      sandbox.api.on('gpe', () => ({ return_code: 0, content: { ...payload, PE: 0 } }));
      const slots: any[] = [];
      slots[13] = [[AQUAMARINE_REALM, 10, 20, 12]];
      sandbox.setState('playerLootAndMightPointHistoryList', { [String(playerId)]: slots });
      await sandbox.call('fillPlayerAquamarineData');
      assert.deepEqual(sandbox.clickhouse.calls, [], 'a player who did not enter has nothing to record');
    });
  });

  it('carries on when the game does not answer for one player', async () => {
    await withSandbox({}, async (sandbox) => {
      const byPlayer = aquamarineByPlayer();
      const ids = [...byPlayer.keys()].slice(0, 3);
      sandbox.api.on('gpe', (request) => {
        const playerId = Number(request.parameters.PID);
        if (playerId === ids[1]) return timeout('gpe');
        return { return_code: 0, content: byPlayer.get(playerId) };
      });
      const state: Record<string, any[]> = {};
      for (const id of ids) {
        const slots: any[] = [];
        slots[13] = [[AQUAMARINE_REALM, 10, 20, 12]];
        state[String(id)] = slots;
      }
      sandbox.setState('playerLootAndMightPointHistoryList', state);
      await sandbox.call('fillPlayerAquamarineData');
      const collected = new Set(sandbox.clickhouse.rows(TABLE).map((row) => Number(row.player_id)));
      assert.deepEqual([...collected].sort(), [ids[0], ids[2]].sort());
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('writes nothing when no player holds an aquamarine castle', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAquamarine(sandbox);
      const slots: any[] = [];
      slots[13] = [[1, 10, 20, 12]];
      sandbox.setState('playerLootAndMightPointHistoryList', { '900262': slots });
      await sandbox.call('fillPlayerAquamarineData');
      assert.deepEqual(sandbox.api.requests, []);
      assert.deepEqual(sandbox.clickhouse.calls, []);
    });
  });

  it('does not run once the run has recorded a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAquamarine(sandbox);
      sandbox.state('DB_UPDATES').criticalErrors = 1;
      const slots: any[] = [];
      slots[13] = [[AQUAMARINE_REALM, 10, 20, 12]];
      sandbox.setState('playerLootAndMightPointHistoryList', { '900262': slots });
      await sandbox.call('fillPlayerAquamarineData');
      assert.deepEqual(sandbox.api.requests, []);
    });
  });
});
