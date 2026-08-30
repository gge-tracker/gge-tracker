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

import { SWAP_RANK_POINTS_TABLE } from '../../src/definitions/swap-rank-points.config';
import { TEMP_SERVER_SETTINGS } from '../../src/definitions/temp-server-events.config';
import { ApiRequest } from '../harness/fake-api';
import { Sandbox, withSandbox } from '../harness/sandbox';

const COLLECTOR_SETTING = '10';
const MIGHT_SETTING = '8';
const RANK_SWAP_LT = 66;
const MIGHT_LT = 61;
const COLLECTOR_LT = 65;
const TABLE = 'outer_realms_ranking';
const PAGE_SIZE = 10;

interface Entrant {
  oid: number;
  name: string;
  score: number;
  level: number;
  legendaryLevel: number;
  might: number;
  castle: [number, number];
}

function entrant(oid: number): Entrant {
  return {
    oid,
    name: `Player${oid}_FR1`,
    score: 10_000 - oid,
    level: 70 + (oid % 5),
    legendaryLevel: oid % 3,
    might: 900_000 + oid,
    castle: [100 + oid, 200 + oid],
  };
}

function row(e: Entrant, rank: number): unknown[] {
  return [
    rank,
    e.score,
    {
      OID: e.oid,
      N: e.name,
      L: e.level,
      LL: e.legendaryLevel,
      MP: e.might,
      AP: [[0, 0, e.castle[0], e.castle[1], 1]],
    },
    null,
    rank,
  ];
}

function serveOuterRealms(sandbox: Sandbox, entrants: Entrant[]): void {
  sandbox.api.on('hgh', (request: ApiRequest) => {
    const sv = Number(request.parameters.SV);
    const lastStart = Math.max(1, entrants.length - PAGE_SIZE + 1);
    const start = Math.min(Math.max(sv - Math.floor((PAGE_SIZE - 1) / 2), 1), lastStart);
    const window = entrants.slice(start - 1, start - 1 + PAGE_SIZE);
    return {
      return_code: '0',
      content: { LR: entrants.length, L: window.map((e, index) => row(e, start + index)) },
    };
  });
}

describe('startOuterRealmsDataFetch', () => {
  it('refuses to run when Redis names no temporary server', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = await sandbox.call('startOuterRealmsDataFetch');
      assert.equal(result, null);
      assert.equal(sandbox.redis.store.get('outerRealmsDataFetchError'), 'No active event found with known LT codes');
      assert.deepEqual(sandbox.clickhouse.calls, []);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });

  it('maps the temporary server setting to its highscore list and clears the stale error', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', COLLECTOR_SETTING);
      sandbox.redis.store.set('outerRealmsDataFetchError', 'stale');
      serveOuterRealms(sandbox, [entrant(1)]);
      const result = await sandbox.call('startOuterRealmsDataFetch');
      assert.equal(result, 'collector');
      assert.deepEqual([...new Set(sandbox.api.callsFor('hgh').map((c) => Number(c.parameters.LT)))], [COLLECTOR_LT]);
      assert.equal(sandbox.redis.store.has('outerRealmsDataFetchError'), false);
    });
  });

  it('still reports the scoring system when the event turns out to be over', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', MIGHT_SETTING);
      sandbox.api.on('hgh', () => ({ return_code: '1', content: {} }));
      const result = await sandbox.call('startOuterRealmsDataFetch');
      assert.equal(result, 'might', 'the caller still needs to know which event it was');
      assert.equal(sandbox.redis.store.get('outerRealmsDataFetchError'), 'No active event found with known LT codes');
      assert.deepEqual(sandbox.clickhouse.calls, []);
    });
  });

  it('fails when Redis points at a setting that does not exist', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', '999999');
      const result = await sandbox.call('startOuterRealmsDataFetch');
      assert.equal(result, null);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(sandbox.api.callsFor('hgh'), [], 'nothing is fetched for an unknown setting');
    });
  });

  it('collects every entrant once and writes it with its castle and fetch date', async () => {
    await withSandbox({}, async (sandbox) => {
      const entrants = Array.from({ length: 34 }, (_, index) => entrant(index + 1));
      sandbox.redis.store.set('temporaryServerData', COLLECTOR_SETTING);
      serveOuterRealms(sandbox, entrants);
      await sandbox.call('startOuterRealmsDataFetch');

      const rows = sandbox.clickhouse.rows(TABLE);
      assert.equal(rows.length, entrants.length);
      assert.equal(new Set(rows.map((r) => r.player_id)).size, rows.length);
      assert.equal(sandbox.state('DB_UPDATES').playersCreated, entrants.length);
      const first = rows.find((r) => Number(r.player_id) === 1);
      assert.deepEqual(first, {
        player_id: 1,
        player_name: 'Player1',
        server: 'FR1',
        score: entrants[0].score,
        rank: 1,
        level: entrants[0].level,
        legendary_level: entrants[0].legendaryLevel,
        might: entrants[0].might,
        castle_position_x: entrants[0].castle[0],
        castle_position_y: entrants[0].castle[1],
        fetch_date: '2026-08-29 12:00:00',
      });
    });
  });

  it('stamps the same fetch date on the ranking and on latest_fetch_date', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', COLLECTOR_SETTING);
      serveOuterRealms(sandbox, [entrant(1), entrant(2)]);
      await sandbox.call('startOuterRealmsDataFetch');
      const [marker] = sandbox.clickhouse.rows('latest_fetch_date');
      assert.deepEqual(marker, { fetch_date: '2026-08-29 12:00:00' });
      for (const r of sandbox.clickhouse.rows(TABLE)) assert.equal(r.fetch_date, marker.fetch_date);
    });
  });

  it('stops paging as soon as a page repeats what it already holds', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', COLLECTOR_SETTING);
      const entrants = Array.from({ length: 40 }, (_, index) => entrant(index + 1));
      sandbox.api.on('hgh', (request: ApiRequest) => {
        const sv = Number(request.parameters.SV);
        const window = sv === 1 ? entrants.slice(0, PAGE_SIZE) : entrants.slice(0, PAGE_SIZE);
        return {
          return_code: '0',
          content: { LR: entrants.length, L: window.map((e, index) => row(e, index + 1)) },
        };
      });
      await sandbox.call('startOuterRealmsDataFetch');
      assert.equal(sandbox.clickhouse.rows(TABLE).length, PAGE_SIZE);
      assert.equal(sandbox.api.callsFor('hgh').length, 3, 'the probe, the first page, then the all-duplicate page');
    });
  });

  it('scores a rank-swap event off the rank table rather than the reported points', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', rankSwapSetting());
      const entrants = [entrant(1), entrant(2)];
      serveOuterRealms(sandbox, entrants);
      await sandbox.call('startOuterRealmsDataFetch');
      assert.deepEqual([...new Set(sandbox.api.callsFor('hgh').map((c) => Number(c.parameters.LT)))], [RANK_SWAP_LT]);
      const rows = sandbox.clickhouse.rows(TABLE);
      for (const r of rows) {
        const expected = SWAP_RANK_POINTS_TABLE.find(
          (rp) => Number(r.rank) >= rp.maxRank && Number(r.rank) <= rp.minRank,
        );
        assert.equal(r.score, expected ? expected.rankPoints : 0);
      }
    });
  });

  it('reads the rank of a might event out of the fifth column', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', MIGHT_SETTING);
      sandbox.api.on('hgh', () => ({
        return_code: '0',
        content: {
          LR: 1,
          L: [[1, 5000, { OID: 9, N: 'Nine_FR1', L: 70, LL: 0, MP: 1, AP: [[0, 0, 5, 6, 1]] }, null, 77]],
        },
      }));
      await sandbox.call('startOuterRealmsDataFetch');
      assert.deepEqual([...new Set(sandbox.api.callsFor('hgh').map((c) => Number(c.parameters.LT)))], [MIGHT_LT]);
      const [only] = sandbox.clickhouse.rows(TABLE);
      assert.equal(only.rank, 77, 'the might board carries its rank in entry[4]');
      assert.equal(only.score, 5000);
    });
  });

  it('counts a critical error when ClickHouse refuses the rows', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.redis.store.set('temporaryServerData', COLLECTOR_SETTING);
      serveOuterRealms(sandbox, [entrant(1)]);
      sandbox.clickhouse.failWith(...Array.from({ length: 6 }, () => new Error('clickhouse is gone')));
      const result = await sandbox.call('startOuterRealmsDataFetch');
      assert.equal(result, 'collector');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });
});

function rankSwapSetting(): string {
  const setting = TEMP_SERVER_SETTINGS.find((s) => s.scoringSystem === 'rankSwap');
  if (!setting) throw new Error('no rankSwap setting in TEMP_SERVER_SETTINGS');
  return String(setting.settingID);
}
