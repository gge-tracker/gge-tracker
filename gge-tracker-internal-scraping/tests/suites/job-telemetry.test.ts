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

import {
  ApiRequest,
  STORM_BORDER_OBJECT,
  ownCastles,
  ownPlayerInfo,
  stormArea,
  stormFort,
  stormIsle,
} from '../harness/fake-api';
import { fixtures, ranking } from '../harness/fixtures';
import { withSandbox } from '../harness/sandbox';

const WHEEL_LT = 72;
const STORM_STATE = /NOT EXISTS \(SELECT 1 FROM storm_forts\)/;
const LAST_EVENT = /SELECT event_id, created_at FROM grand_tournament/;
const REALM_CASTLES = /SELECT castles_realm FROM players/;

interface LokiRecord {
  job: string;
  level: string;
  [field: string]: unknown;
}

interface TelemetrySandbox {
  outbound: { url: unknown; body: unknown }[];
}

function lokiRecords(sandbox: TelemetrySandbox): LokiRecord[] {
  return sandbox.outbound
    .filter((call) => String(call.url).includes('/loki/api/v1/push'))
    .map((call) => {
      const stream = (call.body as any).streams[0];
      return { ...JSON.parse(stream.values[0][1]), job: stream.stream.job, level: stream.stream.level };
    });
}

function recordFor(sandbox: TelemetrySandbox, job: string): LokiRecord {
  const found = lokiRecords(sandbox).filter((record) => record.job === job);
  assert.equal(found.length, 1, `expected exactly one ${job} record, got ${found.length}`);
  return found[0];
}

function settledStorm(now: Date, fields: Record<string, unknown> = {}): { rows: Record<string, unknown>[] } {
  return {
    rows: [
      {
        database_now: now,
        map_is_empty: false,
        scan_radius: 50,
        season_started_at: now,
        season_checked_at: now,
        own_isle_object_id: 515,
        own_isle_x: 619,
        own_isle_y: 609,
        ...fields,
      },
    ],
  };
}

function subdivision(alliances: { id: number; name: string; rank: number; score: number }[]): Record<string, unknown> {
  return {
    content: {
      L: alliances.map((alliance) => ({
        SI: `season-1-${alliance.id}`,
        I: 1,
        A: alliance.name,
        R: alliance.rank,
        S: alliance.score,
      })),
    },
  };
}

describe('job telemetry', () => {
  describe('wheel of affluence', () => {
    it('reports the entrants it stored', async () => {
      await withSandbox({}, async (sandbox) => {
        const wheel = fixtures.wheel();
        sandbox.api.serveRanking(wheel);
        await sandbox.call('insertWheelOfUnimaginableAffluenceData');

        const record = recordFor(sandbox, 'wheel-of-affluence');
        assert.equal(record.level, 'info');
        assert.equal(record.eventActive, true);
        assert.equal(record.entriesStored, wheel.totalRanked);
        assert.equal(record.criticalErrors, 0);
      });
    });

    it('says the event is off rather than reporting an empty run', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.api.serveRanking(ranking('hgh-warrealms-lt44-lid1', { lt: WHEEL_LT, lid: 1 }));
        await sandbox.call('insertWheelOfUnimaginableAffluenceData');

        const record = recordFor(sandbox, 'wheel-of-affluence');
        assert.equal(record.eventActive, false);
        assert.equal(record.entriesStored, 0);
      });
    });

    it('emits one record for a run the retries never settled, at error level', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.api.on('hgh', () => {
          throw new Error('the bridge is down');
        });
        await sandbox.call('insertWheelOfUnimaginableAffluenceData');

        const record = recordFor(sandbox, 'wheel-of-affluence');
        assert.equal(record.level, 'error');
        assert.equal(record.criticalErrors, 1);
        assert.equal(record.failureStep, 'wheel of affluence collection');
        assert.equal(record.failureReason, 'the bridge is down');
      });
    });
  });

  describe('storm map', () => {
    it('reports what the scan found, not just how long it took', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, settledStorm(sandbox.now));
        sandbox.api.on('gaa', () =>
          stormArea([
            stormFort(644, 644),
            stormFort(645, 644, { locked: true }),
            stormIsle(646, 644, 77),
            stormIsle(647, 644),
            [STORM_BORDER_OBJECT, 0, 0],
          ]),
        );

        await sandbox.call('updateStormMap');

        const record = recordFor(sandbox, 'update-storm-map');
        assert.equal(record.level, 'info');
        assert.equal(record.forts, 2);
        assert.equal(record.isles, 2);
        assert.equal(record.occupiedIsles, 1);
        assert.equal(record.lockedForts, 1);
        assert.equal(record.borderReached, true);
        assert.equal(record.failedTiles, 0);
        assert.equal(record.seasonState, 'settled');
        assert.equal(record.seasonRollover, false);
        assert.equal(record.radius, 50);
      });
    });

    it('names the server, the step and the reason when the sweep fails', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, { error: new Error('storm_meta is missing on this server') });

        await assert.rejects(sandbox.call('updateStormMap'));

        const record = recordFor(sandbox, 'update-storm-map');
        assert.equal(record.level, 'error');
        assert.equal(record.server, 'TEST1');
        assert.equal(record.failureStep, 'storm map sweep');
        assert.equal(record.failureReason, 'storm_meta is missing on this server');
      });
    });

    it('names the tiles that never answered, which no exception reports', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, settledStorm(sandbox.now));
        sandbox.api.on('gaa', () => ({ return_code: -1, error: 'Timeout' }));

        await sandbox.call('updateStormMap');

        const record = recordFor(sandbox, 'update-storm-map');
        assert.equal(record.level, 'error');
        assert.equal(record.failedTiles, 1);
        assert.equal(record.failureStep, 'storm map scan');
        assert.equal(record.failureIdentifier, '421');
        assert.match(String(record.failureReason), /tile\(s\) never answered$/);
      });
    });

    it('flags the season on the run that entered it, and dates it from the isle', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, settledStorm(sandbox.now, { map_is_empty: true, season_checked_at: null }));
        sandbox.api.on('gpi', () => ownPlayerInfo());
        sandbox.api.on('gdi', (request, callIndex) =>
          callIndex === 0
            ? ownCastles([{ kid: 0 }])
            : ownCastles([{ kid: 0 }, { kid: 4, x: 619, y: 609, objectId: 515 }]),
        );
        sandbox.api.on('ksc', () => ({ return_code: 0 }));
        sandbox.api.on('gaa', () => stormArea([[STORM_BORDER_OBJECT, 0, 0]]));

        await sandbox.call('updateStormMap');

        const record = recordFor(sandbox, 'update-storm-map');
        assert.equal(record.seasonState, 'entered');
        assert.equal(record.seasonRollover, true);
        assert.equal(record.ownIsle, '619:609');
        assert.equal(record.ownIsleObjectId, 515);
      });
    });

    it('reports no counts at all when the run never scanned', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, settledStorm(sandbox.now, { map_is_empty: true, season_checked_at: null }));

        await sandbox.call('updateStormMap');

        const record = recordFor(sandbox, 'update-storm-map');
        assert.equal(record.level, 'warn');
        assert.equal(record.seasonState, 'unreachable');
        assert.equal(record.forts, undefined);
        assert.equal(record.isles, undefined);
      });
    });
  });

  describe('dungeon discovery', () => {
    it('names the tiles that never answered, a failure no exception reports', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(REALM_CASTLES, { rows: [{ castles_realm: [[1, 555, 555, 12]] }] });
        sandbox.api.on('gaa', () => {
          throw new Error('the bridge is down');
        });

        await sandbox.call('discoverNewDungeons');

        const record = recordFor(sandbox, 'discover-new-dungeons');
        assert.equal(record.level, 'error');
        assert.equal(record.failureStep, 'dungeon discovery');
        assert.equal(record.failureIdentifier, '431');
        assert.match(String(record.failureReason), /tile\(s\) never answered$/);
      });
    });
  });

  describe('grand tournament', () => {
    it('reports the rows it inserted rather than the size of the counter object', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(LAST_EVENT, { rows: [{ event_id: 12, created_at: sandbox.now }] });
        sandbox.api.on('llsp', (request: ApiRequest) => {
          const lid = Number(request.parameters.LID);
          if (Number(request.parameters.SDI) > 1) return { content: {} };
          return subdivision([
            { id: lid * 100 + 1, name: `Alliance ${lid}-1`, rank: 1, score: 900 },
            { id: lid * 100 + 2, name: `Alliance ${lid}-2`, rank: 2, score: 800 },
          ]);
        });

        await sandbox.call('fillGrandTournamentResults');

        const record = recordFor(sandbox, 'grand-tournament');
        assert.equal(record.eventId, 12);
        assert.equal(record.grandTournamentRecordsInserted, 10, 'five divisions of two alliances');
        assert.equal(record.subdivisions, 10, 'each division stops on the subdivision that answers empty');
        assert.equal(record.criticalErrors, 0);
      });
    });
  });
});
