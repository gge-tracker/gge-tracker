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

import { fixtures, ranking } from '../harness/fixtures';
import { rankingResponse } from '../harness/fake-api';
import { withSandbox } from '../harness/sandbox';

const LOOT_LT = 2;
const TABLE = 'player_loot_history';
const OVERFLOW_OFFSET = 2 ** 32;

describe('fillLootHistory', () => {
  it('inserts every player of a ranking that holds no zero score', async () => {
    await withSandbox({}, async (sandbox) => {
      const head = fixtures.lootHead();
      assert.ok(
        head.rows.every(([, point]) => point > 0),
        'the captured head of the ladder is all positive',
      );
      sandbox.api.serveRanking(head);
      await sandbox.call('fillLootHistory');
      const rows = sandbox.clickhouse.rows(TABLE);
      assert.equal(rows.length, head.totalRanked);
      const byPlayer = new Map(rows.map((row) => [Number(row.player_id), row]));
      for (const [, point, player] of head.rows) {
        assert.deepEqual(byPlayer.get(Number(player.OID)), {
          player_id: Number(player.OID),
          point,
          created_at: '2026-08-29 12:00:00',
        });
      }
    });
  });

  it('records the loot in slot 0 of the run state and leaves the might slot alone', async () => {
    await withSandbox({}, async (sandbox) => {
      const head = fixtures.lootHead();
      sandbox.api.serveRanking(head);
      await sandbox.call('fillLootHistory');
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      const [, point, player] = head.rows[0];
      assert.equal(state[String(player.OID)][0], point, 'slot 0: weekly loot');
      assert.equal(state[String(player.OID)][1], undefined, 'slot 1 belongs to the might fill');
      assert.equal(state[String(player.OID)][7], player.N);
    });
  });

  it('stops the forward sweep on the first page that ends on a zero score', async () => {
    await withSandbox({}, async (sandbox) => {
      const tail = fixtures.lootTail();
      assert.equal(tail.rows[9][1], 0, 'the tenth rank of the captured tail is on zero');
      sandbox.api.serveRanking(tail);
      await sandbox.call('fillLootHistory');
      const forwardSweep = sandbox.api.svSequence().slice(0, 2);
      assert.deepEqual(forwardSweep, [5, 5], 'one probe and one page, then the sweep turns around');
    });
  });

  it('walks back from the last rank and unwraps the scores that overflowed', async () => {
    await withSandbox({}, async (sandbox) => {
      const tail = fixtures.lootTail();
      const negatives = tail.rows.filter(([, point]) => point < 0);
      assert.ok(negatives.length > 0, 'the captured tail holds scores that came back negative');
      sandbox.api.serveRanking(tail);
      await sandbox.call('fillLootHistory');
      const rows = sandbox.clickhouse.rows(TABLE);
      const byPlayer = new Map(rows.map((row) => [Number(row.player_id), Number(row.point)]));
      for (const [, point, player] of negatives) {
        assert.equal(
          byPlayer.get(Number(player.OID)),
          point + OVERFLOW_OFFSET,
          'a negative score is stored as the unsigned value the game meant',
        );
        assert.ok(byPlayer.get(Number(player.OID))! > 0);
      }
    });
  });

  it('walks the tail backwards one page at a time', async () => {
    await withSandbox({}, async (sandbox) => {
      const tail = fixtures.lootTail();
      sandbox.api.serveRanking(tail);
      await sandbox.call('fillLootHistory');
      const backward = sandbox.api.svSequence().slice(2);
      assert.deepEqual(backward, [1, tail.totalRanked, tail.totalRanked - tail.pageSize]);
    });
  });

  it('stops the backward sweep at the first player back on a non-negative score', async () => {
    await withSandbox({}, async (sandbox) => {
      const tail = fixtures.lootTail();
      sandbox.api.serveRanking(tail);
      await sandbox.call('fillLootHistory');
      const inserted = new Set(sandbox.clickhouse.rows(TABLE).map((row) => Number(row.player_id)));
      const negativeIds = tail.rows.filter(([, point]) => point < 0).map(([, , player]) => Number(player.OID));
      for (const id of negativeIds) {
        assert.ok(inserted.has(id), 'every negative score in reach of the backward sweep is collected');
      }
      assert.equal(inserted.size, 10 + negativeIds.length);
    });
  });

  it('reports a critical error and inserts nothing when the ranking answers with an empty page', async () => {
    await withSandbox({}, async (sandbox) => {
      const head = fixtures.lootHead();
      sandbox.api.on('hgh', (_request, callIndex) => {
        if (callIndex === 0) return rankingResponse(head, 5);
        return { return_code: 0, content: { L: [], LR: head.totalRanked } };
      });
      await sandbox.call('fillLootHistory');
      assert.deepEqual(sandbox.clickhouse.calls, []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });

  it('treats a loot ranking that publishes no rows as a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(ranking('hgh-warrealms-lt44-lid1', { lt: LOOT_LT, lid: 1 }));
      await sandbox.call('fillLootHistory');
      assert.deepEqual(sandbox.clickhouse.calls, []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(sandbox.state('playerLootAndMightPointHistoryList'), {});
      assert.equal(sandbox.api.svSequence().length, 12, 'the probe, one page and ten retries');
    });
  });

  it('pages an Empire 4 Kingdoms server six ranks at a time', async () => {
    await withSandbox({ server: 'E4K-INT1' }, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.lootHead());
      await sandbox.call('fillLootHistory');
      assert.deepEqual(sandbox.api.svSequence().slice(0, 4), [3, 3, 9, 15]);
    });
  });

  it('does not run at all without a ClickHouse configuration', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.lootHead());
      await sandbox.call('fillLootHistory');
      assert.deepEqual(sandbox.api.requests, []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });
});
