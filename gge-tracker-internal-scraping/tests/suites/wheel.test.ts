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

const WHEEL_LT = 72;
const TABLE = 'wheel_unimaginable_affluence';

describe('insertWheelOfUnimaginableAffluenceData', () => {
  it('collects every entrant of the ranking exactly once', async () => {
    await withSandbox({}, async (sandbox) => {
      const wheel = fixtures.wheel();
      assert.equal(wheel.meta.complete, true, 'the fixture is the whole live ranking');
      sandbox.api.serveRanking(wheel);
      await sandbox.call('insertWheelOfUnimaginableAffluenceData');
      const rows = sandbox.clickhouse.rows(TABLE);
      assert.equal(rows.length, wheel.totalRanked);
      const byPlayer = new Map(rows.map((row) => [Number(row.player_id), row]));
      assert.equal(byPlayer.size, rows.length, 'no entrant is counted twice');
      for (const [, point, player] of wheel.rows) {
        assert.deepEqual(byPlayer.get(Number(player.OID)), {
          player_id: Number(player.OID),
          point,
          created_at: '2026-08-29 12:00:00',
        });
      }
    });
  });

  it('pages one window past the end of the ranking before stopping', async () => {
    await withSandbox({}, async (sandbox) => {
      const wheel = fixtures.wheel();
      sandbox.api.serveRanking(wheel);
      await sandbox.call('insertWheelOfUnimaginableAffluenceData');
      const [probe, ...pages] = sandbox.api.svSequence();
      assert.equal(probe, 1);
      assert.equal(pages[0], Math.ceil(wheel.pageSize / 2));
      for (const [index, sv] of pages.entries()) {
        assert.equal(sv, pages[0] + index * wheel.pageSize);
      }
      assert.ok(pages.at(-1)! > wheel.totalRanked, 'the loop only stops once it has run past the end');
    });
  });

  it('does nothing at all when the event is not running', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(ranking('hgh-warrealms-lt44-lid1', { lt: WHEEL_LT, lid: 1 }));
      await sandbox.call('insertWheelOfUnimaginableAffluenceData');
      assert.deepEqual(sandbox.clickhouse.calls, []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
      assert.equal(sandbox.api.svSequence().length, 1, 'the probe alone settles it');
    });
  });

  it('retries the whole fetch three times before counting a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      let attempts = 0;
      sandbox.api.on('hgh', () => {
        attempts++;
        throw new Error('the bridge is down');
      });
      await sandbox.call('insertWheelOfUnimaginableAffluenceData');
      assert.equal(attempts, 4, 'the first try plus three retries');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(sandbox.clickhouse.calls, []);
    });
  });

  it('recovers when a later attempt succeeds', async () => {
    await withSandbox({}, async (sandbox) => {
      const wheel = fixtures.wheel();
      let attempts = 0;
      sandbox.api.on('hgh', (request) => {
        if (attempts++ === 0) throw new Error('the bridge is down');
        return rankingResponse(wheel, Number(request.parameters.SV));
      });
      await sandbox.call('insertWheelOfUnimaginableAffluenceData');
      assert.equal(sandbox.clickhouse.rows(TABLE).length, wheel.totalRanked);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('drops a duplicate the game returns twice in the same sweep', async () => {
    await withSandbox({}, async (sandbox) => {
      const wheel = fixtures.wheel();
      sandbox.api.on('hgh', () => rankingResponse(wheel, 1));
      await sandbox.call('insertWheelOfUnimaginableAffluenceData');
      const rows = sandbox.clickhouse.rows(TABLE);
      assert.equal(rows.length, wheel.pageSize, 'only the distinct entrants of the repeated page survive');
      assert.equal(new Set(rows.map((row) => row.player_id)).size, rows.length);
    });
  });

  it('counts a critical error when the rows cannot be written', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.wheel());
      sandbox.clickhouse.failWith(...Array.from({ length: 6 }, () => new Error('clickhouse is gone')));
      await sandbox.call('insertWheelOfUnimaginableAffluenceData');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });
});
