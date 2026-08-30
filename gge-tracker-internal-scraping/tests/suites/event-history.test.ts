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
import { RankingFixture } from '../harness/fixture-types';
import { Sandbox, withSandbox } from '../harness/sandbox';

const NOMAD_LT = 46;
const TABLE = 'player_event_nomad_history';

function nomadArgs(levelCategorySize: number): Record<string, unknown> {
  return {
    lt: NOMAD_LT,
    increment: 8,
    tableName: TABLE,
    query: `INSERT INTO ${TABLE} (player_id, category, point, created_at) VALUES (?, ?, ?, ?)`,
    levelCategorySize,
  };
}

function runFill(sandbox: Sandbox, levelCategorySize: number, eventName = 'nomads'): Promise<unknown> {
  const onSuccess = { called: 0 };
  return sandbox
    .call('genericFillHistory', nomadArgs(levelCategorySize), sandbox.now, eventName, () => {
      onSuccess.called++;
    })
    .then(() => onSuccess);
}

function expectedEntities(...categories: RankingFixture[]): Map<number, { point: number }> {
  const entities = new Map<number, { point: number }>();
  for (const category of categories) {
    for (const [, point, player] of category.rows) entities.set(Number(player.OID), { point });
  }
  return entities;
}

describe('genericFillHistory', () => {
  it('sweeps a category with the SV sequence the live server expects', async () => {
    await withSandbox({}, async (sandbox) => {
      const category1 = fixtures.nomadsCategory1();
      sandbox.api.serveRanking(category1);
      await runFill(sandbox, 1);
      const pages = Math.ceil(category1.totalRanked / category1.pageSize);
      const expected = [1, ...Array.from({ length: pages }, (_, index) => 4 + index * category1.pageSize)];
      assert.deepEqual(sandbox.api.svSequence(), expected);
    });
  });

  it('writes one row per player of the ranking', async () => {
    await withSandbox({}, async (sandbox) => {
      const category1 = fixtures.nomadsCategory1();
      sandbox.api.serveRanking(category1);
      await runFill(sandbox, 1);
      const rows = sandbox.clickhouse.rows(TABLE);
      const entities = expectedEntities(category1);
      assert.equal(rows.length, entities.size);
      assert.equal(rows.length, category1.totalRanked, 'no player of the ranking is dropped');
      const byPlayer = new Map(rows.map((row) => [Number(row.player_id), row]));
      for (const [playerId, entity] of entities) {
        assert.deepEqual(byPlayer.get(playerId), {
          player_id: playerId,
          point: entity.point,
          created_at: '2026-08-29 12:00:00',
        });
      }
    });
  });

  it('merges every category into a single insert keyed by player', async () => {
    await withSandbox({}, async (sandbox) => {
      const categories = [
        fixtures.nomadsCategory1(),
        fixtures.nomadsCategory2(),
        ranking('hgh-nomads-lt46-lid3'),
        ranking('hgh-nomads-lt46-lid4'),
        ranking('hgh-nomads-lt46-lid5'),
      ];
      sandbox.api.serveRanking(...categories);
      const outcome: any = await runFill(sandbox, 5);
      const entities = expectedEntities(...categories);
      const rows = sandbox.clickhouse.rows(TABLE);
      assert.equal(rows.length, entities.size);
      assert.equal(sandbox.clickhouse.insertsInto(TABLE).length, 1, 'a run this size fits in one chunk');
      assert.equal(outcome.called, 1, 'the success callback runs once, after the insert');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('records each player point under the event LT for the server statistics', async () => {
    await withSandbox({}, async (sandbox) => {
      const category1 = fixtures.nomadsCategory1();
      sandbox.api.serveRanking(category1);
      await runFill(sandbox, 1);
      const history = sandbox.state<Record<string, Record<string, number>>>('playerEventPointHistoryList');
      const entities = expectedEntities(category1);
      assert.equal(Object.keys(history).length, entities.size);
      for (const [playerId, entity] of entities) {
        assert.deepEqual(history[String(playerId)], { [String(NOMAD_LT)]: entity.point });
      }
    });
  });

  it('stops without inserting when the first category is not running', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(ranking('hgh-warrealms-lt44-lid1', { lt: NOMAD_LT, lid: 1 }));
      await runFill(sandbox, 5);
      assert.deepEqual(sandbox.clickhouse.calls, [], 'nothing is written for an event that is not running');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0, 'a stopped event is not an error');
      assert.equal(sandbox.api.svSequence().length, 1, 'the sweep gives up after the first probe');
    });
  });

  it('stops without inserting when a later category is not running', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.nomadsCategory1());
      await runFill(sandbox, 5);
      assert.deepEqual(sandbox.clickhouse.calls, [], 'a partial sweep is never written');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('skips the first two categories for bloodcrows and war realms', async () => {
    // PATCH #2512091 / #2512161: on those two events the live ranking starts at category 2 or 3
    for (const eventName of ['bloodcrows', 'war realms']) {
      await withSandbox({}, async (sandbox) => {
        const category3 = ranking('hgh-nomads-lt46-lid3', { lid: 3 });
        sandbox.api.serveRanking(category3);
        await runFill(sandbox, 3, eventName);
        assert.equal(
          sandbox.clickhouse.rows(TABLE).length,
          category3.totalRanked,
          `${eventName} keeps sweeping past its empty leading categories`,
        );
      });
    }
  });

  it('retries a category that answers with no return code before giving up', async () => {
    await withSandbox({}, async (sandbox) => {
      const category2 = fixtures.nomadsCategory2();
      const timeout = fixtures.socketTimeout();
      let probes = 0;
      sandbox.api.on('hgh', (request) => {
        const sv = Number(request.parameters.SV);
        const lid = Number(request.parameters.LID);
        if (lid !== 2) return { return_code: 0, content: { L: [], LR: 0 } };
        if (sv === 1 && probes++ === 0) return timeout.rawResponse;
        return rankingResponse(category2, sv);
      });
      await runFill(sandbox, 2, 'bloodcrows');
      assert.equal(sandbox.clickhouse.rows(TABLE).length, category2.totalRanked, 'the retry recovered the category');
      assert.ok(sandbox.api.svSequence().filter((sv) => sv === 1).length >= 2, 'the probe was retried');
    });
  });

  it('counts a critical error and inserts nothing when a page comes back empty mid-sweep', async () => {
    await withSandbox({}, async (sandbox) => {
      const category1 = fixtures.nomadsCategory1();
      sandbox.api.on('hgh', (request) => {
        const sv = Number(request.parameters.SV);
        if (sv > 20) return { return_code: 0, content: { L: [], LR: category1.totalRanked } };
        return rankingResponse(category1, sv);
      });
      await runFill(sandbox, 1);
      assert.deepEqual(sandbox.clickhouse.calls, []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });

  it('does not run at all without a ClickHouse configuration', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.nomadsCategory1());
      await runFill(sandbox, 1);
      assert.deepEqual(sandbox.api.requests, [], 'the configuration is checked before the first request');
    });
  });
});
