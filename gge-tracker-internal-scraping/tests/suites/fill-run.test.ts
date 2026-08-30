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
import { pgError } from '../harness/fake-postgres';
import { Sandbox, withSandbox } from '../harness/sandbox';

function serveQuietHour(sandbox: Sandbox): void {
  sandbox.api.serveRanking(
    fixtures.lootHead(),
    fixtures.might(),
    ranking('hgh-might-lt6-lid2'),
    ranking('hgh-might-lt6-lid3'),
  );
}

function parameterTrail(sandbox: Sandbox): [string, unknown][] {
  return sandbox.db
    .matching(/UPDATE parameters SET value = \$1/)
    .map((query) => [String(query.params[1]), query.params[0]] as [string, unknown]);
}

describe('executeFillInOrder', () => {
  it('sweeps the rankings in order and flags each one as it lands', async () => {
    await withSandbox({}, async (sandbox) => {
      serveQuietHour(sandbox);
      await sandbox.backend.executeFillInOrder();
      assert.deepEqual(parameterTrail(sandbox), [
        ['is_currently_updating', 1],
        ['loot', 1],
        ['war_realms', 1],
        ['samurai', 1],
        ['berimond_kingdom', 1],
        ['bloodcrow', 1],
        ['nomad', 1],
        ['might', 1],
        ['is_currently_updating', 0],
        ['duration', 0],
      ]);
    });
  });

  it('clears the parameters and loads the current players before anything else', async () => {
    await withSandbox({}, async (sandbox) => {
      serveQuietHour(sandbox);
      await sandbox.backend.executeFillInOrder();
      const statements = sandbox.db.queries.map((query) => query.sql);
      assert.equal(statements[0], 'UPDATE parameters SET value = NULL');
      assert.ok(
        /FROM players P LEFT JOIN alliances A/.test(statements[1]),
        'the run compares against the database as it was before the sweep',
      );
      assert.ok(
        statements.findIndex((sql) => /UPDATE parameters SET value = \$1/.test(sql)) > 1,
        'the in-progress flag is raised only once that snapshot is taken',
      );
    });
  });

  it('reads each ranking the game publishes and leaves the stopped events alone', async () => {
    await withSandbox({}, async (sandbox) => {
      serveQuietHour(sandbox);
      await sandbox.backend.executeFillInOrder();
      const swept = [...new Set(sandbox.api.callsFor('hgh').map((call) => Number(call.parameters.LT)))].sort(
        (a, b) => a - b,
      );
      assert.deepEqual(swept, [2, 6, 30, 44, 46, 51, 58]);
      assert.deepEqual(
        sandbox.clickhouse.tables.sort(),
        ['logs.scrapes', 'player_loot_history', 'player_might_history'],
        'the two rankings that were up, plus the record of the run itself',
      );
    });
  });

  it('bumps the fill version so the API knows the data moved', async () => {
    await withSandbox({ server: 'FR1' }, async (sandbox) => {
      serveQuietHour(sandbox);
      await sandbox.backend.executeFillInOrder();
      assert.equal(sandbox.redis.store.get('fill-version:FR1'), '1');
    });
  });

  it('records the run in ClickHouse with the counters it accumulated', async () => {
    await withSandbox({ server: 'FR1' }, async (sandbox) => {
      serveQuietHour(sandbox);
      await sandbox.backend.executeFillInOrder();
      const [row] = sandbox.clickhouse.rows('logs.scrapes');
      const state = sandbox.state<Record<string, any[]>>('playerLootAndMightPointHistoryList');
      assert.equal(row.server, 'FR1');
      assert.equal(row.durationMs, 0, 'the clock is frozen for the test, so the run takes no time');
      assert.equal(row.timestamp, Math.floor(sandbox.now.getTime() / 1000));
      assert.ok(Number(row.playersCreated) > 100, 'against an empty database every player is created');
      assert.equal(row.criticalErrors, 0);
      assert.deepEqual(state, {}, 'and the counters are taken before the state is cleared');
    });
  });

  it('clears the run state and closes the pool when it is done', async () => {
    await withSandbox({}, async (sandbox) => {
      serveQuietHour(sandbox);
      await sandbox.backend.executeFillInOrder();
      assert.deepEqual(sandbox.state('DB_UPDATES'), {
        alliancesCreated: 0,
        playersCreated: 0,
        playersAllianceUpdated: 0,
        alliancesUpdated: 0,
        criticalErrors: 0,
      });
      assert.deepEqual(sandbox.state('playerLootAndMightPointHistoryList'), {});
      assert.deepEqual(sandbox.state('playerEventPointHistoryList'), {});
      assert.deepEqual(sandbox.state('customPlayersAttributesList'), {});
      assert.deepEqual(sandbox.state('currentPlayers'), []);
      assert.deepEqual(sandbox.db.endedDatabases, ['empire-ranking-test']);
    });
  });

  it('still closes the run down when a step throws', async () => {
    await withSandbox({}, async (sandbox) => {
      serveQuietHour(sandbox);
      sandbox.db.when(/FROM players P LEFT JOIN alliances A/, { error: pgError('42501', 'permission denied') });
      await sandbox.backend.executeFillInOrder();
      assert.equal(sandbox.clickhouse.rows('logs.scrapes').length, 1, 'the run is still recorded');
      assert.deepEqual(sandbox.db.endedDatabases, ['empire-ranking-test'], 'and the pool is still closed');
      assert.deepEqual(
        parameterTrail(sandbox).map(([identifier]) => identifier),
        [],
        'nothing is flagged as done',
      );
    });
  });

  it('does not count an unhandled failure as a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      serveQuietHour(sandbox);
      sandbox.db.when(/FROM players P LEFT JOIN alliances A/, { error: pgError('42501', 'permission denied') });
      await sandbox.backend.executeFillInOrder();
      assert.equal(sandbox.clickhouse.rows('logs.scrapes')[0].criticalErrors, 0);
    });
  });

  it('stops writing history as soon as a sweep reports a critical error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(ranking('hgh-warrealms-lt44-lid1', { lt: 2, lid: 1 }), fixtures.might());
      await sandbox.backend.executeFillInOrder();
      assert.deepEqual(
        sandbox.clickhouse.tables,
        ['logs.scrapes'],
        'no history is written once the run is known to be incomplete',
      );
      assert.equal(sandbox.clickhouse.rows('logs.scrapes')[0].criticalErrors, 2);
      assert.deepEqual(
        parameterTrail(sandbox).map(([identifier]) => identifier),
        [
          'is_currently_updating',
          'loot',
          'war_realms',
          'samurai',
          'berimond_kingdom',
          'bloodcrow',
          'nomad',
          'might',
          'is_currently_updating',
          'duration',
        ],
        'the steps are still flagged even though they did nothing',
      );
    });
  });
});
