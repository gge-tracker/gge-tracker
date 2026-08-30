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

import { clickHouseError, networkError } from '../harness/fake-clickhouse';
import { CLICKHOUSE_PORT, CLICKHOUSE_URL, withSandbox } from '../harness/sandbox';

const RETRYABLE_CODES = [159, 202, 203, 209, 210, 241, 252, 394, 425, 745];
const CHUNK_SIZE = 50_000;

function rows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({ player_id: 900000 + index, point: index }));
}

describe('insertRowsClickHouse', () => {
  it('posts JSONEachRow to the configured database with async inserts acknowledged', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(2));
      const [call] = sandbox.clickhouse.calls;
      assert.equal(call.query, 'INSERT INTO player_loot_history FORMAT JSONEachRow');
      assert.equal(call.database, 'empire_ranking_test');
      assert.equal(call.params.async_insert, '1');
      assert.equal(
        call.params.wait_for_async_insert,
        '1',
        'the run waits for the insert, otherwise a failure is never seen',
      );
      assert.deepEqual(call.auth, { username: 'test-user', password: 'test-password' });
      assert.deepEqual(call.rows, rows(2));
    });
  });

  it('sends the rows to another database when one is named', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1), { database: 'empire_ranking_de1' });
      assert.equal(sandbox.clickhouse.calls[0].database, 'empire_ranking_de1');
    });
  });

  it('does not call out at all for an empty row set', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('insertRowsClickHouse', 'player_loot_history', []);
      assert.deepEqual(sandbox.clickhouse.calls, []);
    });
  });

  it('splits a large insert into chunks and keeps every row', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('insertRowsClickHouse', 'player_might_history', rows(CHUNK_SIZE + 7));
      const calls = sandbox.clickhouse.insertsInto('player_might_history');
      assert.deepEqual(
        calls.map((call) => call.rows.length),
        [CHUNK_SIZE, 7],
      );
      assert.equal(sandbox.clickhouse.rows('player_might_history').length, CHUNK_SIZE + 7);
    });
  });

  it('honours a smaller chunk size when one is asked for', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('insertRowsClickHouse', 'player_metrics', rows(5), { chunkSize: 2 });
      assert.deepEqual(
        sandbox.clickhouse.insertsInto('player_metrics').map((call) => call.rows.length),
        [2, 2, 1],
      );
    });
  });

  it('retries an insert that fails on a code worth retrying', async () => {
    for (const code of RETRYABLE_CODES) {
      await withSandbox({}, async (sandbox) => {
        sandbox.clickhouse.failWith(clickHouseError(500, code), null);
        await sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1));
        assert.equal(sandbox.clickhouse.calls.length, 2, `code ${code} is retried`);
      });
    }
  });

  it('retries the HTTP statuses that mean the server is busy rather than wrong', async () => {
    for (const status of [429, 502, 503, 504]) {
      await withSandbox({}, async (sandbox) => {
        sandbox.clickhouse.failWith(clickHouseError(status), null);
        await sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1));
        assert.equal(sandbox.clickhouse.calls.length, 2, `HTTP ${status} is retried`);
      });
    }
  });

  it('retries a failure that never reached the server', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.failWith(networkError(), null);
      await sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1));
      assert.equal(sandbox.clickhouse.calls.length, 2);
    });
  });

  it('gives up immediately on a statement the server rejected', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.failWith(clickHouseError(400, 62));
      await assert.rejects(() => sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1)));
      assert.equal(sandbox.clickhouse.calls.length, 1);
    });
  });

  it('gives up after six attempts and lets the caller see the failure', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.failWith(...Array.from({ length: 8 }, () => clickHouseError(503)));
      await assert.rejects(() => sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1)));
      assert.equal(sandbox.clickhouse.calls.length, 6);
    });
  });

  it('accepts a shorter retry budget from the caller', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.failWith(...Array.from({ length: 8 }, () => clickHouseError(503)));
      await assert.rejects(() =>
        sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1), { maxAttempts: 2 }),
      );
      assert.equal(sandbox.clickhouse.calls.length, 2);
    });
  });

  it('builds the URL from the configured host and port', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1));
      const url = new URL(sandbox.clickhouse.calls[0].url);
      assert.equal(url.origin, `${CLICKHOUSE_URL}:${CLICKHOUSE_PORT}`);
      assert.equal(url.pathname, '/');
      assert.deepEqual([...url.searchParams.keys()].sort(), [
        'async_insert',
        'database',
        'query',
        'wait_for_async_insert',
      ]);
    });
  });

  it('refuses to insert without a ClickHouse configuration', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      await assert.rejects(
        () => sandbox.call('insertRowsClickHouse', 'player_loot_history', rows(1)),
        /ClickHouse configuration is missing/,
      );
    });
  });
});
