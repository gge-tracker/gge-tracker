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

import { ApiRequest } from '../harness/fake-api';
import { clickHouseError } from '../harness/fake-clickhouse';
import { Sandbox, withSandbox } from '../harness/sandbox';

const DIVISIONS = 6;
const LAST_EVENT = /FROM rift_raid_hours/;
const EP_LAST_EVENT = /rift_raid_hours[\s\S]*game = 'ep'/;
const RANKING = 'rift_raid_ranking';
const HOURS = 'rift_raid_hours';

interface Contender {
  serverId: number;
  allianceId: number;
  name: string;
  rank: number;
  score: number;
}

function page(contenders: Contender[], total = contenders.length): Record<string, unknown> {
  return {
    return_code: 0,
    content: {
      L: contenders.map((c) => ({
        SI: `12-1-${c.serverId}-${c.allianceId}`,
        I: c.serverId,
        A: c.name,
        R: c.rank,
        S: c.score,
      })),
      T: total,
    },
  };
}

/**
 * The game slides a window that would run past the last rank back to the end of the list
 */
function window(contenders: Contender[], startRank: number, size: number): Record<string, unknown> {
  const start = Math.min(Math.max(startRank, 1), Math.max(contenders.length - size + 1, 1));
  return page(contenders.slice(start - 1, start - 1 + size), contenders.length);
}

function ladder(count: number, divisionId: number, subdivisionId: number): Contender[] {
  return Array.from({ length: count }, (_, index) => ({
    serverId: 1 + (index % 3),
    allianceId: divisionId * 100000 + subdivisionId * 10000 + index,
    name: `Alliance ${divisionId}-${subdivisionId}-${index}`,
    rank: index + 1,
    score: 100000 - index,
  }));
}

function serveDivisions(sandbox: Sandbox, subdivisionsPerDivision = 1, perSubdivision = 2): void {
  sandbox.api.on('llsp', (request: ApiRequest) => {
    const lid = Number(request.parameters.LID);
    const sdi = Number(request.parameters.SDI);
    if (sdi > subdivisionsPerDivision) return page([]);
    return window(ladder(perSubdivision, lid, sdi), Number(request.parameters.R ?? 1), Number(request.parameters.M));
  });
}

describe('fillRiftRaidResults', () => {
  it('asks for leaderboard 89 across every division until one answers empty', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox, 2);
      await sandbox.call('fillRiftRaidResults', 'ep');
      const calls = sandbox.api.callsFor('llsp');
      assert.deepEqual([...new Set(calls.map((call) => Number(call.parameters.LT)))], [89]);
      assert.deepEqual([...new Set(calls.map((call) => Number(call.parameters.M)))], [1000]);
      const byDivision = new Map<number, number[]>();
      for (const call of calls) {
        const lid = Number(call.parameters.LID);
        byDivision.set(lid, [...(byDivision.get(lid) ?? []), Number(call.parameters.SDI)]);
      }
      assert.deepEqual([...byDivision.keys()], [1, 2, 3, 4, 5, 6]);
      for (const subdivisions of byDivision.values()) {
        assert.deepEqual(subdivisions, [1, 2, 3], 'the empty third page ends the division at once');
      }
    });
  });

  it('walks a subdivision larger than one page from the last rank it read', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('llsp', (request: ApiRequest) => {
        if (Number(request.parameters.LID) !== 1 || Number(request.parameters.SDI) > 1) return page([]);
        return window(ladder(1143, 1, 1), Number(request.parameters.R ?? 1), Number(request.parameters.M));
      });
      await sandbox.call('fillRiftRaidResults', 'ep');
      const startRanks = sandbox.api
        .callsFor('llsp')
        .filter((call) => Number(call.parameters.LID) === 1 && Number(call.parameters.SDI) === 1)
        .map((call) => call.parameters.R ?? 'none');
      assert.deepEqual(startRanks, ['none', 1001], 'the second window slides back and reaches the last rank');
      assert.equal(sandbox.clickhouse.rows(RANKING).length, 1143, 'every alliance is stored exactly once');
    });
  });

  it('writes the snapshot into ClickHouse with the shape the table declares', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      await sandbox.call('fillRiftRaidResults', 'ep');
      const rows = sandbox.clickhouse.rows(RANKING);
      assert.equal(rows.length, DIVISIONS * 2);
      assert.deepEqual(rows[0], {
        game: 'ep',
        event_id: 1,
        created_at: '2026-08-29 12:00:00',
        division_id: 1,
        subdivision_id: 1,
        rank: 1,
        server_id: 1,
        alliance_id: 110000,
        alliance_name: 'Alliance 1-1-0',
        score: 100000,
      });
    });
  });

  it('stamps the run hour once so the dates endpoint never scans the ranking', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.deepEqual(sandbox.clickhouse.rows(HOURS), [{ game: 'ep', event_id: 1, hour: '2026-08-29 12:00:00' }]);
    });
  });

  it('numbers the first event 1 when nothing was ever collected', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.deepEqual([...new Set(sandbox.clickhouse.rows(RANKING).map((row) => row.event_id))], [1]);
    });
  });

  it('keeps writing into the running event while snapshots are recent', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.when(LAST_EVENT, [
        { event_id: 7, last_seen: Math.floor(sandbox.now.getTime() / 1000) - 3600 },
      ]);
      serveDivisions(sandbox);
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.deepEqual([...new Set(sandbox.clickhouse.rows(RANKING).map((row) => row.event_id))], [7]);
    });
  });

  it('opens a new event when the last snapshot is more than a day old', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.when(LAST_EVENT, [
        { event_id: 7, last_seen: Math.floor(sandbox.now.getTime() / 1000) - 25 * 3600 },
      ]);
      serveDivisions(sandbox);
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.deepEqual([...new Set(sandbox.clickhouse.rows(RANKING).map((row) => row.event_id))], [8]);
    });
  });

  it('numbers each universe on its own history, so E4K never inherits the EP event', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.clickhouse.when(EP_LAST_EVENT, [
        { event_id: 9, last_seen: Math.floor(sandbox.now.getTime() / 1000) - 3600 },
      ]);
      serveDivisions(sandbox);
      await sandbox.call('fillRiftRaidResults', 'e4k');
      const rows = sandbox.clickhouse.rows(RANKING);
      assert.deepEqual([...new Set(rows.map((row) => row.game))], ['e4k']);
      assert.deepEqual([...new Set(rows.map((row) => row.event_id))], [1], 'the EP event is not this one');
      const lookups = sandbox.clickhouse.selects(/rift_raid_hours/);
      assert.equal(lookups.length, 1);
      assert.match(lookups[0].query, /game = 'e4k'/);
    });
  });

  it('records an alliance the first time it is seen and never twice', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('llsp', (request: ApiRequest) => {
        if (Number(request.parameters.LID) !== 1 || Number(request.parameters.SDI) > 2) return page([]);
        return page([{ serverId: 4, allianceId: 42, name: 'Twice', rank: Number(request.parameters.SDI), score: 500 }]);
      });
      await sandbox.call('fillRiftRaidResults', 'ep');
      const rows = sandbox.clickhouse.rows(RANKING);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].subdivision_id, 1);
      assert.equal(rows[0].rank, 1);
    });
  });

  it('stores nothing and bumps nothing while the event is not running', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('llsp', () => page([]));
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.deepEqual(sandbox.clickhouse.insertsInto(RANKING), []);
      assert.deepEqual(sandbox.clickhouse.insertsInto(HOURS), []);
      assert.equal(sandbox.redis.store.has('rift-raid:event-dates:version'), false);
    });
  });

  it('bumps the cache version once the snapshot is stored', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.equal(sandbox.redis.store.get('rift-raid:event-dates:version'), '1');
    });
  });

  it('gives up on a subdivision after three unreadable answers and keeps the pages it had', async () => {
    await withSandbox({}, async (sandbox) => {
      let attempts = 0;
      sandbox.api.on('llsp', (request: ApiRequest) => {
        if (Number(request.parameters.SDI) === 1) {
          return page([{ serverId: 1, allianceId: 5, name: 'Early', rank: 1, score: 10 }]);
        }
        attempts++;
        throw new Error('the bridge is down');
      });
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.equal(attempts, DIVISIONS * 3, 'three tries per division, then the division ends');
      assert.equal(sandbox.clickhouse.rows(RANKING).length, 1, 'the alliance read before the failure is kept');
    });
  });

  it('counts a critical error when ClickHouse refuses the snapshot', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      // The first call is the event lookup, the second the ranking insert
      sandbox.clickhouse.failWith(null, clickHouseError(400, 60));
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(sandbox.clickhouse.insertsInto(HOURS), [], 'the hour is only stamped once the rows landed');
      assert.equal(sandbox.redis.store.has('rift-raid:event-dates:version'), false);
    });
  });

  it('asks the first page of a subdivision without a start rank, so an absent one answers empty', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox, 1);
      await sandbox.call('fillRiftRaidResults', 'ep');
      const firstPages = sandbox.api.callsFor('llsp').filter((call) => Number(call.parameters.SDI) === 2);
      assert.equal(firstPages.length, DIVISIONS, 'one call each, no retry, to learn the division ended');
      assert.deepEqual([...new Set(firstPages.map((call) => call.parameters.R))], [undefined]);
    });
  });

  it('asks for fewer entries when the game will not serve a page of that size', async () => {
    await withSandbox({}, async (sandbox) => {
      const rows = ladder(1143, 1, 1);
      sandbox.api.on('llsp', (request: ApiRequest) => {
        if (Number(request.parameters.LID) !== 1 || Number(request.parameters.SDI) > 1) return page([]);
        const size = Number(request.parameters.M);
        const startRank = Number(request.parameters.R ?? 1);
        if (startRank > 1 && size > 100) throw new Error('the frame does not fit');
        return window(rows, startRank, size);
      });
      await sandbox.call('fillRiftRaidResults', 'ep');
      const sizes = sandbox.api
        .callsFor('llsp')
        .filter((call) => Number(call.parameters.SDI) === 1 && Number(call.parameters.LID) === 1)
        .map((call) => Number(call.parameters.M));
      assert.deepEqual(sizes.slice(0, 4), [1000, 1000, 250, 62], 'each retry quarters the window');
      assert.equal(sandbox.clickhouse.rows(RANKING).length, 1143, 'the smaller pages still reach the last rank');
    });
  });

  it('keeps the pages it read and says how many entries the unreadable tail held', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('llsp', (request: ApiRequest) => {
        if (Number(request.parameters.LID) !== 1 || Number(request.parameters.SDI) > 1) return page([]);
        if (request.parameters.R !== undefined) throw new Error('the game never answers this tail');
        return window(ladder(1143, 1, 1), 1, Number(request.parameters.M));
      });
      await sandbox.call('fillRiftRaidResults', 'ep');
      assert.equal(sandbox.clickhouse.rows(RANKING).length, 1000);
      const record = JSON.parse(String((sandbox.outbound.at(-1)?.body as any).streams[0].values[0][1]));
      assert.equal(record.subdivisions, 1);
      assert.equal(record.partialSubdivisions, 1);
      assert.equal(record.missingEntries, 143);
      assert.equal(record.criticalErrors, 0, 'a tail the game will not serve is not a failed run');
    });
  });
});
