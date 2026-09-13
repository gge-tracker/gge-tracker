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

import { pgError } from '../harness/fake-postgres';
import { Sandbox, withSandbox } from '../harness/sandbox';

const TABLE_PRESENT = /to_regclass\('public.global_players'\)/;
const FOREIGN_TABLES = /FROM pg_foreign_table/;
const REFRESH = /REFRESH MATERIALIZED VIEW CONCURRENTLY global_ranking/;
const INSERT = /INSERT INTO global_players/;
const COPY_STEP =
  /^(BEGIN|COMMIT|DELETE FROM global_players WHERE region = \$1|INSERT INTO global_players|SELECT postgres_fdw_disconnect_all)/;

function mapRegions(sandbox: Sandbox, relnames: string[], present = true): void {
  sandbox.db.when(TABLE_PRESENT, { rows: [{ present }] });
  sandbox.db.when(FOREIGN_TABLES, { rows: relnames.map((relname) => ({ relname })) });
}

function statements(sandbox: Sandbox): string[] {
  return sandbox.db.queries.map((query) => query.sql);
}

describe('refreshGlobalRankings', () => {
  it('copies each region in its own transaction and drops its fdw connection before the next one', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      mapRegions(sandbox, ['players_fr1', 'players_de1']);
      await sandbox.call('refreshGlobalRankings');

      const copy = statements(sandbox).filter((sql) => COPY_STEP.test(sql));
      const perRegion = ['BEGIN', 'DELETE', 'INSERT', 'COMMIT', 'SELECT postgres_fdw_disconnect_all'];
      assert.deepEqual(
        copy.map((sql) => perRegion.find((prefix) => sql.startsWith(prefix))),
        [...perRegion, ...perRegion],
      );
      assert.deepEqual(
        sandbox.db.matching(INSERT).map((query) => [query.params[0], /FROM "players_(\w+)"/.exec(query.sql)?.[1]]),
        [
          ['fr1', 'fr1'],
          ['de1', 'de1'],
        ],
      );
      assert.equal(sandbox.state<any>('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('refreshes the materialized view only after every region is copied', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      mapRegions(sandbox, ['players_fr1', 'players_de1']);
      await sandbox.call('refreshGlobalRankings');

      const sql = statements(sandbox);
      const refreshAt = sql.findIndex((statement) => REFRESH.test(statement));
      const lastInsertAt = sql.map((statement) => INSERT.test(statement)).lastIndexOf(true);
      assert.ok(refreshAt > lastInsertAt, 'the refresh must read the copied rows');
    });
  });

  it('removes the rows of regions no longer mapped', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      mapRegions(sandbox, ['players_fr1', 'players_de1']);
      await sandbox.call('refreshGlobalRankings');

      const prune = sandbox.db.one(/DELETE FROM global_players WHERE NOT \(region = ANY/);
      assert.deepEqual(prune.params, [['fr1', 'de1']]);
    });
  });

  it('never refreshes through the foreign tables when global_players is missing', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      mapRegions(sandbox, ['players_fr1'], false);
      await sandbox.call('refreshGlobalRankings');

      assert.equal(sandbox.db.matching(REFRESH).length, 0);
      assert.equal(sandbox.db.matching(INSERT).length, 0);
      assert.equal(sandbox.state<any>('DB_UPDATES').criticalErrors, 1);
      assert.match(sandbox.state<any>('jobFailure').failureReason, /global_players is missing/);
    });
  });

  it('keeps the other regions and still refreshes when one region cannot be read', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      mapRegions(sandbox, ['players_fr1', 'players_de1']);
      sandbox.db.when(/FROM "players_fr1"/, { error: pgError('08001', 'could not connect to server "fr1_server"') });
      await sandbox.call('refreshGlobalRankings');

      const sql = statements(sandbox);
      const failedAt = sql.findIndex((statement) => /FROM "players_fr1"/.test(statement));
      assert.equal(sql[failedAt + 1], 'ROLLBACK');
      assert.equal(sql[failedAt + 2], 'SELECT postgres_fdw_disconnect_all()');
      assert.equal(sandbox.db.matching(/FROM "players_de1"/).length, 1);
      assert.equal(sandbox.db.matching(REFRESH).length, 1);
      assert.equal(sandbox.state<any>('jobFailure').failureStep, 'global players copy of fr1');
    });
  });

  it('ignores a foreign table whose suffix could not be a region name', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      mapRegions(sandbox, ['players_fr1', 'players_x"; DROP TABLE players; --']);
      await sandbox.call('refreshGlobalRankings');

      assert.deepEqual(
        sandbox.db.matching(INSERT).map((query) => query.params[0]),
        ['fr1'],
      );
    });
  });

  it('returns the dedicated client to the pool', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      mapRegions(sandbox, ['players_fr1']);
      await sandbox.call('refreshGlobalRankings');

      assert.deepEqual(
        sandbox.db.pools.map((pool) => pool.checkedOut),
        sandbox.db.pools.map(() => 0),
      );
    });
  });
});
