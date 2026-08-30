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

import { fixtures, mainRealmCastles, otherRealmCastles, ranking } from '../harness/fixtures';
import { rankingResponse } from '../harness/fake-api';
import { RankingFixture } from '../harness/fixture-types';
import { withSandbox } from '../harness/sandbox';

const TABLE = 'player_might_history';

function allCategories(): RankingFixture[] {
  return [
    fixtures.might(),
    ranking('hgh-might-lt6-lid2'),
    ranking('hgh-might-lt6-lid3'),
    ranking('hgh-might-lt6-lid4'),
    ranking('hgh-might-lt6-lid5'),
    ranking('hgh-might-lt6-lid6'),
  ];
}

describe('fillMightPointsHistory', () => {
  it('sweeps all six categories and inserts one row per player holding castles', async () => {
    await withSandbox({}, async (sandbox) => {
      const categories = allCategories();
      sandbox.api.serveRanking(...categories);
      await sandbox.call('fillMightPointsHistory');
      const expected = new Map<number, number>();
      for (const category of categories) {
        for (const [, , player] of category.rows) {
          if (player.MP > 0 && player.AP?.length > 0) expected.set(Number(player.OID), player.MP);
        }
      }
      const rows = sandbox.clickhouse.rows(TABLE);
      assert.equal(rows.length, expected.size);
      for (const row of rows) {
        assert.equal(row.point, expected.get(Number(row.player_id)));
        assert.equal(row.created_at, '2026-08-29 12:00:00');
      }
    });
  });

  it('skips a player with no castle but still records their might in the run state', async () => {
    await withSandbox({}, async (sandbox) => {
      const category1 = fixtures.might();
      const castleless = category1.rows.filter(([, , player]) => !(player.AP?.length > 0));
      assert.ok(castleless.length > 0, 'the captured ranking contains a player with no castle');
      sandbox.api.serveRanking(category1);
      await sandbox.call('fillMightPointsHistory');
      const inserted = new Set(sandbox.clickhouse.rows(TABLE).map((row) => Number(row.player_id)));
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      for (const [, , player] of castleless) {
        assert.equal(inserted.has(Number(player.OID)), false, 'no history row for an account with no castle');
        assert.equal(state[String(player.OID)][1], player.MP, 'the might is still carried into the run state');
      }
    });
  });

  it('fills every slot of the run state from the ranking payload', async () => {
    await withSandbox({}, async (sandbox) => {
      const category1 = ranking('hgh-might-lt6-lid6', { lid: 1 });
      sandbox.api.serveRanking(category1);
      await sandbox.call('fillMightPointsHistory');
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      const [, , player] = category1.rows.find(
        ([, , candidate]) => mainRealmCastles(candidate).length > 0 && otherRealmCastles(candidate).length > 0,
      )!;
      const slots = state[String(player.OID)];
      assert.equal(slots[1], player.MP, 'slot 1: might points');
      assert.equal(slots[2], player.AID, 'slot 2: alliance id');
      assert.equal(slots[3], player.AN, 'slot 3: alliance name');
      assert.deepEqual(slots[4], mainRealmCastles(player), 'slot 4: castles of the main realm as [x, y, type]');
      assert.equal(slots[5], player.H, 'slot 5: honor');
      assert.equal(slots[6], player.RPT, 'slot 6: remaining peace time in seconds');
      assert.equal(slots[7], player.N, 'slot 7: player name');
      assert.equal(slots[8], player.L, 'slot 8: level');
      assert.equal(slots[9], player.LL, 'slot 9: legendary level');
      assert.equal(slots[10], player.HF, 'slot 10: highest fame');
      assert.equal(slots[11], player.CF, 'slot 11: current fame');
      assert.equal(slots[12], player.RRD, 'slot 12: remaining relocation time');
      assert.deepEqual(slots[13], otherRealmCastles(player), 'slot 13: outer realm castles as [realm, x, y, type]');
      assert.equal(
        slots[14],
        new Date(sandbox.now.getTime() + Number(player.RPT) * 1000).toISOString(),
        'slot 14: the instant protection expires, derived from the peace timer',
      );
      assert.equal(slots[15], player.AR, 'slot 15: alliance rank');
      assert.equal(slots[0], undefined, 'slot 0 belongs to the loot fill and is left untouched');
    });
  });

  it('separates main realm castles from outer realm ones', async () => {
    await withSandbox({}, async (sandbox) => {
      const category = ranking('hgh-might-lt6-lid6', { lid: 1 });
      sandbox.api.serveRanking(category);
      await sandbox.call('fillMightPointsHistory');
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      const withOuterRealms = category.rows.filter(([, , player]) => otherRealmCastles(player).length > 0);
      assert.ok(withOuterRealms.length > 0, 'the captured ranking contains players holding outer realm castles');
      const realms = new Set<number>();
      for (const [, , player] of withOuterRealms) {
        const slots = state[String(player.OID)];
        assert.deepEqual(slots[4], mainRealmCastles(player), 'main realm castles, as [x, y, type]');
        assert.deepEqual(slots[13], otherRealmCastles(player), 'outer realm castles, as [realm, x, y, type]');
        for (const castle of slots[13]) realms.add(castle[0]);
      }
      assert.deepEqual(
        [...realms].sort(),
        [1, 2, 3, 4],
        'all four outer realms are represented, so dropping one would be caught',
      );
    });
  });

  it('pages an Empire 4 Kingdoms server six ranks at a time', async () => {
    await withSandbox({ server: 'e4k-fr1' }, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.might());
      await sandbox.call('fillMightPointsHistory');
      const first = sandbox.api.svSequence().slice(0, 4);
      assert.deepEqual(first, [3, 3, 9, 15], 'the sweep starts at 3 and steps by 6 rather than 10');
    });
  });

  it('refuses to insert anything once the run has recorded a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(...allCategories());
      sandbox.state('DB_UPDATES').criticalErrors = 1;
      await sandbox.call('fillMightPointsHistory');
      assert.deepEqual(sandbox.clickhouse.calls, [], 'a partial or suspect sweep never reaches the database');
    });
  });

  it('reports a critical error when a category answers with a rank list that is empty mid-sweep', async () => {
    await withSandbox({}, async (sandbox) => {
      const category1 = fixtures.might();
      sandbox.api.on('hgh', (request) => {
        const sv = Number(request.parameters.SV);
        if (Number(request.parameters.LID) !== 1) return { return_code: 0, content: { L: [], LR: 0 } };
        if (sv > 20) return { return_code: 0, content: { L: [], LR: category1.totalRanked } };
        return rankingResponse(category1, sv);
      });
      await sandbox.call('fillMightPointsHistory');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(sandbox.clickhouse.calls, [], 'the insert is skipped because of the error it just counted');
    });
  });

  it('stops sweeping the lowest category on IN1, where the server is never cleaned', async () => {
    await withSandbox({ server: 'IN1' }, async (sandbox) => {
      const rows = fixtures
        .might()
        .rows.map(([rank, point, player]): [number, number, any] => [rank, point, { ...player, MP: 30 }]);
      sandbox.api.serveRanking({ ...fixtures.might(), rows });
      await sandbox.call('fillMightPointsHistory');
      const category1Requests = sandbox.api.callsFor('hgh').filter((call) => Number(call.parameters.LID) === 1);
      assert.equal(category1Requests.length, 2, 'one probe and a single page before the sweep gives up');
    });
  });
});
