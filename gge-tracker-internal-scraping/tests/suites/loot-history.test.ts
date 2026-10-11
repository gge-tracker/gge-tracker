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
import { withLogSpy } from '../harness/log-spy';
import { withSandbox } from '../harness/sandbox';
import { parseLootReset } from '../../src/loot-reset';

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

  it('asks for the first page again while the bridge does not answer', async () => {
    await withSandbox({}, async (sandbox) => {
      const head = fixtures.lootHead();
      sandbox.api.on('hgh', (request, callIndex) => {
        if (callIndex < 3) return { return_code: -1, error: 'Timeout' };
        return rankingResponse(head, Number(request.parameters.SV));
      });
      await sandbox.call('fillLootHistory');
      assert.deepEqual(sandbox.api.svSequence().slice(0, 4), [5, 5, 5, 5], 'three failed asks, then the answer');
      assert.equal(sandbox.clickhouse.rows(TABLE).length, head.totalRanked);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('does not ask again for a first page the game answered, even without a list', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('hgh', () => ({ return_code: 0, content: { LR: 0 } }));
      await sandbox.call('fillLootHistory');
      assert.equal(sandbox.api.callsFor('hgh').length, 1, 'only a failed answer is worth ten more seconds');
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

describe('fillLootHistory past 2^32', () => {
  const RECENT_LOOT = /FROM player_loot_history/;
  const WEEK_START = Date.parse('2026-08-23T22:00:00Z') / 1000;
  const PARIS = parseLootReset('Europe/Paris', 'MON 00:00');
  const AN_HOUR_AGO = Date.parse('2026-08-29T11:00:00Z') / 1000;

  function storedPoints(sandbox: any): Map<number, number> {
    return new Map(sandbox.clickhouse.rows(TABLE).map((row: any) => [Number(row.player_id), Number(row.point)]));
  }

  it('reads the current week of stored loot before inserting, and only that week', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('lootReset', PARIS);
      sandbox.api.serveRanking(fixtures.lootHead());
      await sandbox.call('fillLootHistory');
      const [select] = sandbox.clickhouse.selects(RECENT_LOOT);
      assert.ok(select, 'one read of the stored loot');
      assert.ok(select.query.includes(`created_at >= toDateTime(${WEEK_START})`), select.query);
      assert.equal(sandbox.clickhouse.rows(TABLE).length, fixtures.lootHead().totalRanked);
    });
  });

  it('adds 2^32 to a player whose counter went back down since the last hour', async () => {
    await withSandbox({}, async (sandbox) => {
      const [, point, player] = fixtures.lootHead().rows[0];
      sandbox.setState('lootReset', PARIS);
      sandbox.clickhouse.when(RECENT_LOOT, [
        { player_id: Number(player.OID), recent: [[AN_HOUR_AGO, String(OVERFLOW_OFFSET - 1000)]] },
      ]);
      sandbox.api.serveRanking(fixtures.lootHead());
      await sandbox.call('fillLootHistory');
      assert.equal(storedPoints(sandbox).get(Number(player.OID)), OVERFLOW_OFFSET + point);
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      assert.equal(state[String(player.OID)][0], OVERFLOW_OFFSET + point, 'loot_current gets the same value');
    });
  });

  it('keeps the wraps a negative score already carried this week', async () => {
    await withSandbox({}, async (sandbox) => {
      const tail = fixtures.lootTail();
      const [, point, player] = tail.rows.find(([, score]) => score < 0)!;
      const counter = point + OVERFLOW_OFFSET;
      sandbox.setState('lootReset', PARIS);
      sandbox.clickhouse.when(RECENT_LOOT, [
        { player_id: Number(player.OID), recent: [[AN_HOUR_AGO, String(OVERFLOW_OFFSET + counter - 1000)]] },
      ]);
      sandbox.api.serveRanking(tail);
      await sandbox.call('fillLootHistory');
      assert.equal(storedPoints(sandbox).get(Number(player.OID)), OVERFLOW_OFFSET + counter);
    });
  });

  it('stores the counter and reads nothing back when the server declares no reset', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('lootReset', null);
      sandbox.api.serveRanking(fixtures.lootHead());
      await sandbox.call('fillLootHistory');
      assert.deepEqual(sandbox.clickhouse.selects(RECENT_LOOT), []);
      assert.equal(sandbox.clickhouse.rows(TABLE).length, fixtures.lootHead().totalRanked);
    });
  });

  function lastHourJustBelowTheTop(rows: ReturnType<typeof fixtures.lootHead>['rows']): Record<string, unknown>[] {
    return rows.map(([, , player]) => ({
      player_id: Number(player.OID),
      recent: [[AN_HOUR_AGO, String(OVERFLOW_OFFSET - 1)]],
    }));
  }

  it('reports what each run did with the counters', async () => {
    await withLogSpy(async (spy) => {
      await withSandbox({}, async (sandbox) => {
        sandbox.setState('lootReset', PARIS);
        sandbox.clickhouse.when(RECENT_LOOT, lastHourJustBelowTheTop(fixtures.lootHead().rows.slice(0, 2)));
        sandbox.api.serveRanking(fixtures.lootHead());
        await sandbox.call('fillLootHistory');
      });
      const [[level, record]] = spy.calls.logRecord;
      const [first, second] = fixtures.lootHead().rows;
      assert.equal(level, 'info');
      assert.deepEqual(record, {
        event: 'loot_counters',
        fresh: fixtures.lootHead().totalRanked - 2,
        counted: 0,
        wrapped: 2,
        decreased: 0,
        refused: 0,
        earlyReset: 0,
        moves: [
          {
            player: Number(first[2].OID),
            kind: 'wrapped',
            before: OVERFLOW_OFFSET - 1,
            after: OVERFLOW_OFFSET + first[1],
          },
          {
            player: Number(second[2].OID),
            kind: 'wrapped',
            before: OVERFLOW_OFFSET - 1,
            after: OVERFLOW_OFFSET + second[1],
          },
        ],
      });
    });
  });

  it('stores the counters as they are and warns when more than 50 players would gain 2^32 at once', async () => {
    await withLogSpy(async (spy) => {
      await withSandbox({}, async (sandbox) => {
        const rows = fixtures.lootHead().rows.slice(0, 51);
        sandbox.setState('lootReset', PARIS);
        sandbox.clickhouse.when(RECENT_LOOT, lastHourJustBelowTheTop(rows));
        sandbox.api.serveRanking(fixtures.lootHead());
        await sandbox.call('fillLootHistory');
        const stored = storedPoints(sandbox);
        for (const [, point, player] of rows) assert.equal(stored.get(Number(player.OID)), point);
      });
      const [[level, record, message]] = spy.calls.logRecord;
      assert.equal(level, 'warn');
      assert.equal((record as Record<string, number>).refused, 51);
      assert.equal(
        (record as { moves: unknown[] }).moves.length,
        20,
        'a capped sample of the players, not all of them',
      );
      assert.match(String(message), /51 players would have gained 2\^32 at once/);
    });
  });

  it('inserts nothing when the stored loot cannot be read, rather than a wrong week', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('lootReset', PARIS);
      sandbox.clickhouse.failWith(new Error('connect ECONNREFUSED'));
      sandbox.api.serveRanking(fixtures.lootHead());
      await sandbox.call('fillLootHistory');
      assert.deepEqual(sandbox.clickhouse.rows(TABLE), []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });
});
