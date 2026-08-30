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

import { ranking } from '../harness/fixtures';
import { RankingFixture } from '../harness/fixture-types';
import { Sandbox, withSandbox } from '../harness/sandbox';

const TIMESTAMP_TABLE = 'event_dates';

interface EventFill {
  method: string;
  lt: number;
  table: string;
  categories: number;
}

const EVENT_FILLS: EventFill[] = [
  { method: 'fillWarRealmsHistory', lt: 44, table: 'player_event_war_realms_history', categories: 5 },
  { method: 'fillSamuraiHistory', lt: 51, table: 'player_event_samurai_history', categories: 5 },
  { method: 'fillNomadsHistory', lt: 46, table: 'player_event_nomad_history', categories: 5 },
  { method: 'fillBerimondKingdomHistory', lt: 30, table: 'player_event_berimond_kingdom_history', categories: 4 },
  { method: 'fillBloodcrowHistory', lt: 58, table: 'player_event_bloodcrow_history', categories: 5 },
];

const CATEGORY_CAPTURES = [
  'hgh-nomads-lt46-lid1',
  'hgh-nomads-lt46-lid2',
  'hgh-nomads-lt46-lid3',
  'hgh-nomads-lt46-lid4',
  'hgh-nomads-lt46-lid5',
];

function categoriesFor(lt: number, count: number): RankingFixture[] {
  return Array.from({ length: count }, (_, index) => ranking(CATEGORY_CAPTURES[index], { lt, lid: index + 1 }));
}

function playersOf(categories: RankingFixture[]): Set<number> {
  const players = new Set<number>();
  for (const category of categories) {
    for (const [, , player] of category.rows) players.add(Number(player.OID));
  }
  return players;
}

describe('event fills', () => {
  for (const event of EVENT_FILLS) {
    it(`${event.method} reads LT ${event.lt} and writes to ${event.table}`, async () => {
      await withSandbox({}, async (sandbox: Sandbox) => {
        const categories = categoriesFor(event.lt, event.categories);
        sandbox.api.serveRanking(...categories);
        await sandbox.call(event.method);
        assert.deepEqual(
          [...new Set(sandbox.api.callsFor('hgh').map((call) => Number(call.parameters.LT)))],
          [event.lt],
          'the sweep never reads another event by mistake',
        );
        assert.deepEqual(sandbox.clickhouse.tables.sort(), [TIMESTAMP_TABLE, event.table].sort());
        assert.equal(sandbox.clickhouse.rows(event.table).length, playersOf(categories).size);
        assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
      });
    });

    it(`${event.method} sweeps ${event.categories} level categories`, async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.api.serveRanking(...categoriesFor(event.lt, event.categories));
        await sandbox.call(event.method);
        const swept = [...new Set(sandbox.api.callsFor('hgh').map((call) => Number(call.parameters.LID)))].sort(
          (a, b) => a - b,
        );
        assert.deepEqual(
          swept,
          Array.from({ length: event.categories }, (_, index) => index + 1),
        );
      });
    });

    it(`${event.method} stamps ${event.table} once the points are in`, async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.api.serveRanking(...categoriesFor(event.lt, event.categories));
        await sandbox.call(event.method);
        assert.deepEqual(sandbox.clickhouse.rows(TIMESTAMP_TABLE), [
          { table_name: event.table, created_at: '2026-08-29 12:00:00' },
        ]);
      });
    });

    it(`${event.method} does not start once the run has recorded a critical error`, async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.api.serveRanking(...categoriesFor(event.lt, event.categories));
        sandbox.state('DB_UPDATES').criticalErrors = 1;
        await sandbox.call(event.method);
        assert.deepEqual(sandbox.api.requests, []);
        assert.deepEqual(sandbox.clickhouse.calls, []);
      });
    });

    it(`${event.method} writes nothing while its event is not running`, async () => {
      await withSandbox({}, async (sandbox) => {
        await sandbox.call(event.method);
        assert.deepEqual(sandbox.clickhouse.calls, [], 'no points and no timestamp');
        assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0, 'an event that is not running is not a failure');
      });
    });
  }

  it('takes the page size from the response rather than the increment it declares', async () => {
    await withSandbox({}, async (sandbox) => {
      const berimond = EVENT_FILLS.find((event) => event.method === 'fillBerimondKingdomHistory')!;
      const categories = categoriesFor(berimond.lt, berimond.categories);
      assert.equal(categories[0].pageSize, 8, 'the captured ranking pages 8 at a time');
      sandbox.api.serveRanking(...categories);
      await sandbox.call(berimond.method);
      assert.equal(sandbox.clickhouse.rows(berimond.table).length, playersOf(categories).size);
    });
  });
});

describe('addEventTimestamp', () => {
  it('records which event table was just filled, and when', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('addEventTimestamp', sandbox.now, 'player_event_nomad_history');
      assert.deepEqual(sandbox.clickhouse.rows(TIMESTAMP_TABLE), [
        { table_name: 'player_event_nomad_history', created_at: '2026-08-29 12:00:00' },
      ]);
    });
  });

  it('counts a critical error when the stamp cannot be written', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.failWith(...Array.from({ length: 6 }, () => new Error('clickhouse is gone')));
      await sandbox.call('addEventTimestamp', sandbox.now, 'player_event_nomad_history');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });

  it('refuses to stamp without a ClickHouse configuration', async () => {
    await withSandbox({ clickhouse: false }, async (sandbox) => {
      await assert.rejects(
        () => sandbox.call('addEventTimestamp', sandbox.now, 'player_event_nomad_history'),
        /ClickHouse configuration is missing/,
      );
    });
  });
});
