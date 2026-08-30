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
import { withSandbox } from '../harness/sandbox';

const DIVISIONS = 5;
const LAST_EVENT = /SELECT event_id, created_at FROM grand_tournament/;
const INSERT = /INSERT INTO grand_tournament/;
const REFRESH = /REFRESH MATERIALIZED VIEW/;

interface Contender {
  serverId: number;
  allianceId: number;
  name: string;
  rank: number;
  score: number;
}

function subdivision(contenders: Contender[]): Record<string, unknown> {
  return {
    content: {
      L: contenders.map((c) => ({
        SI: `season-1-${c.allianceId}`,
        I: c.serverId,
        A: c.name,
        R: c.rank,
        S: c.score,
      })),
    },
  };
}

function serveDivisions(
  sandbox: { api: { on: (c: string, h: (r: ApiRequest) => unknown) => unknown } },
  perDivision = 2,
): void {
  sandbox.api.on('llsp', (request: ApiRequest) => {
    const lid = Number(request.parameters.LID);
    const sdi = Number(request.parameters.SDI);
    if (sdi > 1) return { content: {} };
    return subdivision(
      Array.from({ length: perDivision }, (_, index) => ({
        serverId: 1,
        allianceId: lid * 100 + index,
        name: `Alliance ${lid}-${index}`,
        rank: index + 1,
        score: 1000 - index,
      })),
    );
  });
}

describe('fillGrandTournamentResults', () => {
  it('numbers the first event 1 when the table is empty', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      await sandbox.call('fillGrandTournamentResults');
      const insert = sandbox.db.one(INSERT);
      const eventIds = insert.params.filter((_, index) => index % 9 === 8);
      assert.deepEqual([...new Set(eventIds)], [1]);
    });
  });

  it('opens a new event when the last one is more than 24 hours old', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(LAST_EVENT, {
        rows: [{ event_id: 7, created_at: new Date(sandbox.now.getTime() - 25 * 3600 * 1000) }],
      });
      serveDivisions(sandbox);
      await sandbox.call('fillGrandTournamentResults');
      const eventIds = sandbox.db.one(INSERT).params.filter((_, index) => index % 9 === 8);
      assert.deepEqual([...new Set(eventIds)], [8]);
    });
  });

  it('keeps writing into the running event when the last row is recent', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(LAST_EVENT, {
        rows: [{ event_id: 7, created_at: new Date(sandbox.now.getTime() - 3600 * 1000) }],
      });
      serveDivisions(sandbox);
      await sandbox.call('fillGrandTournamentResults');
      const eventIds = sandbox.db.one(INSERT).params.filter((_, index) => index % 9 === 8);
      assert.deepEqual([...new Set(eventIds)], [7]);
    });
  });

  it('walks every division and stops each one on its first empty subdivision', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      await sandbox.call('fillGrandTournamentResults');
      const calls = sandbox.api.callsFor('llsp');
      const byDivision = new Map<number, number[]>();
      for (const call of calls) {
        const lid = Number(call.parameters.LID);
        byDivision.set(lid, [...(byDivision.get(lid) ?? []), Number(call.parameters.SDI)]);
      }
      assert.deepEqual([...byDivision.keys()], [1, 2, 3, 4, 5]);
      for (const subdivisions of byDivision.values()) {
        // A page without an L is indistinguishable from a dropped request, so it is
        // retried three times before the division is treated as finished
        assert.deepEqual(subdivisions, [1, 2, 2, 2]);
      }
      assert.equal(sandbox.db.one(INSERT).params.length, DIVISIONS * 2 * 9);
    });
  });

  it('records the alliance the first time it is seen and never twice', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('llsp', (request: ApiRequest) => {
        if (Number(request.parameters.LID) !== 1 || Number(request.parameters.SDI) > 2) return { content: {} };
        return subdivision([
          { serverId: 1, allianceId: 42, name: 'Twice', rank: Number(request.parameters.SDI), score: 500 },
        ]);
      });
      await sandbox.call('fillGrandTournamentResults');
      const insert = sandbox.db.one(INSERT);
      assert.equal(insert.params.length, 9, 'the alliance is inserted once');
      const [serverId, name, subdivisionId, divisionId, allianceId, , rank] = insert.params;
      assert.deepEqual(
        { serverId, name, subdivisionId, divisionId, allianceId, rank },
        {
          serverId: 1,
          name: 'Twice',
          subdivisionId: 1,
          divisionId: 1,
          allianceId: 42,
          rank: 1,
        },
      );
    });
  });

  it('splits the insert into batches of fifty', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox, 24);
      await sandbox.call('fillGrandTournamentResults');
      const inserts = sandbox.db.matching(INSERT);
      assert.equal(inserts.length, 3, '120 alliances across 5 divisions land in three batches');
      assert.deepEqual(
        inserts.map((query) => query.params.length / 9),
        [50, 50, 20],
      );
    });
  });

  it('bumps the cache version and refreshes the view once records were written', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      await sandbox.call('fillGrandTournamentResults');
      assert.equal(sandbox.redis.store.get('grand-tournament:event-dates:version'), '1');
      assert.equal(sandbox.db.matching(REFRESH).length, 1);
    });
  });

  it('leaves the cache and the view alone when the tournament is not running', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('llsp', () => ({ content: {} }));
      await sandbox.call('fillGrandTournamentResults');
      assert.deepEqual(sandbox.db.matching(INSERT), []);
      assert.deepEqual(sandbox.db.matching(REFRESH), []);
      assert.equal(sandbox.redis.store.has('grand-tournament:event-dates:version'), false);
    });
  });

  it('counts a critical error when the insert fails but still finishes the run', async () => {
    await withSandbox({}, async (sandbox) => {
      serveDivisions(sandbox);
      sandbox.db.when(INSERT, { error: new Error('the table is gone') });
      await sandbox.call('fillGrandTournamentResults');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.equal(sandbox.db.matching(REFRESH).length, 1, 'the run carries on past a failed batch');
    });
  });

  it('gives up on a subdivision after three failed fetches', async () => {
    await withSandbox({}, async (sandbox) => {
      let attempts = 0;
      sandbox.api.on('llsp', () => {
        attempts++;
        throw new Error('the bridge is down');
      });
      await sandbox.call('fillGrandTournamentResults');
      assert.equal(attempts, DIVISIONS * 3, 'three tries per division, then the division ends');
      assert.deepEqual(sandbox.db.matching(INSERT), []);
    });
  });
});
