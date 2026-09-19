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

import { STORM_BORDER_OBJECT, ownCastles, ownPlayerInfo, stormArea, stormFort, stormIsle } from '../harness/fake-api';
import { Sandbox, withSandbox } from '../harness/sandbox';

const STORM_STATE = /NOT EXISTS \(SELECT 1 FROM storm_forts\)/;
const TRUNCATE = /TRUNCATE storm_forts, storm_isles/;
const SEASON_START = /INSERT INTO storm_meta \(id, season_started_at, season_checked_at/;
const SEASON_CHECK = /INSERT INTO storm_meta \(id, season_checked_at/;
const PRUNE_FORTS = /DELETE FROM storm_forts WHERE updated_at/;
const PRUNE_ISLES = /DELETE FROM storm_isles WHERE updated_at/;
const SCAN_STAMP = /UPDATE storm_meta SET scan_radius/;

const OWN_ISLE = { x: 619, y: 609, objectId: 515 };
const BACKOFF_MINUTES = 15;

function stormState(now: Date, fields: Record<string, unknown> = {}): { rows: Record<string, unknown>[] } {
  return {
    rows: [
      {
        database_now: now,
        map_is_empty: false,
        scan_radius: 50,
        season_started_at: now,
        season_checked_at: now,
        own_isle_object_id: OWN_ISLE.objectId,
        own_isle_x: OWN_ISLE.x,
        own_isle_y: OWN_ISLE.y,
        ...fields,
      },
    ],
  };
}

function minutesBefore(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function dueStorm(now: Date, fields: Record<string, unknown> = {}): { rows: Record<string, unknown>[] } {
  return stormState(now, {
    season_started_at: new Date('2026-07-01T00:30:00.000Z'),
    season_checked_at: minutesBefore(now, BACKOFF_MINUTES + 1),
    ...fields,
  });
}

function inEvent(sandbox: Sandbox, isle = OWN_ISLE): void {
  sandbox.api.on('gpi', () => ownPlayerInfo());
  sandbox.api.on('gdi', () => ownCastles([{ kid: 0 }, { kid: 4, ...isle }]));
}

function outOfEvent(sandbox: Sandbox): void {
  sandbox.api.on('gpi', () => ownPlayerInfo());
  sandbox.api.on('gdi', () => ownCastles([{ kid: 0 }]));
}

function servesOneFort(sandbox: Sandbox): void {
  sandbox.api.on('gaa', () => stormArea([stormFort(644, 644), stormIsle(645, 644), [STORM_BORDER_OBJECT, 0, 0]]));
}

describe('storm season', () => {
  describe('when the game is asked at all', () => {
    it('asks nothing while the map is filled and the season is fresh', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now));
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.api.callsFor('gpi').length, 0);
        assert.equal(sandbox.api.callsFor('gdi').length, 0);
        assert.equal(sandbox.api.callsFor('gaa').length, 1);
      });
    });

    it('asks when the map is empty, the one state the scan cannot explain by itself', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(
          STORM_STATE,
          stormState(sandbox.now, { map_is_empty: true, season_checked_at: minutesBefore(sandbox.now, 60) }),
        );
        inEvent(sandbox);
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.api.callsFor('gpi').length, 1);
        assert.equal(Number(sandbox.api.callsFor('gdi')[0].parameters.PID), 5_500_473);
      });
    });

    it('asks once the calendar month rolled over, even on a map that still holds objects', async () => {
      await withSandbox({ now: new Date('2026-09-02T04:00:00.000Z') }, async (sandbox) => {
        sandbox.db.when(
          STORM_STATE,
          stormState(sandbox.now, {
            season_started_at: new Date('2026-08-01T00:30:00.000Z'),
            season_checked_at: new Date('2026-08-20T00:00:00.000Z'),
          }),
        );
        inEvent(sandbox);
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.api.callsFor('gpi').length, 1);
      });
    });

    it('holds the question for the backoff window, so a closed event is not asked every two minutes', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(
          STORM_STATE,
          stormState(sandbox.now, {
            map_is_empty: true,
            season_checked_at: minutesBefore(sandbox.now, BACKOFF_MINUTES - 1),
          }),
        );
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.api.callsFor('gpi').length, 0);
        assert.equal(sandbox.api.callsFor('ksc').length, 0);
      });
    });
  });

  describe('when the account holds no isle', () => {
    it('enters the event and starts a season dated from the isle the game granted', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now, { map_is_empty: true, season_checked_at: null }));
        sandbox.api.on('gpi', () => ownPlayerInfo());
        sandbox.api.on('gdi', (request, callIndex) =>
          callIndex === 0
            ? ownCastles([{ kid: 0 }])
            : ownCastles([{ kid: 0 }, { kid: 4, x: 700, y: 688, objectId: 1969 }]),
        );
        sandbox.api.on('ksc', () => ({ return_code: 0 }));
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        const entry = sandbox.api.callsFor('ksc')[0];
        assert.equal(Number(entry.parameters.ID), 16);
        assert.equal(Number(entry.parameters.SID), 4);
        assert.equal(sandbox.db.matching(TRUNCATE).length, 1);
        assert.deepEqual(sandbox.db.one(SEASON_START).params, [50, 1969, 700, 688]);
      });
    });

    it('leaves the stored map alone when the event refuses the entry', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, dueStorm(sandbox.now));
        outOfEvent(sandbox);
        sandbox.api.on('ksc', () => ({ return_code: 21 }));
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.db.matching(TRUNCATE).length, 0);
        assert.equal(sandbox.api.callsFor('gaa').length, 0);
      });
    });

    it('stamps the attempt before sending it, so a crash cannot turn the retry into a burst', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, dueStorm(sandbox.now));
        outOfEvent(sandbox);
        sandbox.api.on('ksc', () => ({ return_code: 21 }));

        await sandbox.call('updateStormMap');

        assert.deepEqual(sandbox.db.one(SEASON_CHECK).params, [null, null, null]);
      });
    });
  });

  describe('when the account holds an isle', () => {
    it('records the isle it saw without wiping anything', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now, { map_is_empty: true, season_checked_at: null }));
        inEvent(sandbox);
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.db.matching(TRUNCATE).length, 0);
        assert.deepEqual(sandbox.db.one(SEASON_CHECK).params, [OWN_ISLE.objectId, OWN_ISLE.x, OWN_ISLE.y]);
      });
    });

    it('starts a new season when the game handed out a different isle', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, dueStorm(sandbox.now));
        inEvent(sandbox, { x: 640, y: 678, objectId: 525 });
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.db.matching(TRUNCATE).length, 1);
        assert.deepEqual(sandbox.db.one(SEASON_START).params, [50, 525, 640, 678]);
      });
    });

    it('takes the first isle it ever sees as the season it is already in', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(
          STORM_STATE,
          stormState(sandbox.now, {
            own_isle_object_id: null,
            own_isle_x: null,
            own_isle_y: null,
            season_checked_at: null,
          }),
        );
        inEvent(sandbox);
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.db.matching(TRUNCATE).length, 0);
        assert.equal(sandbox.db.matching(SEASON_CHECK).length, 1);
      });
    });
  });

  describe('when the bridge does not answer', () => {
    it('scans nothing and touches nothing', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now, { map_is_empty: true, season_checked_at: null }));
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.api.callsFor('gaa').length, 0);
        assert.equal(sandbox.db.matching(TRUNCATE).length, 0);
        assert.equal(sandbox.db.matching(SEASON_CHECK).length, 0);
        assert.equal(sandbox.db.matching(SCAN_STAMP).length, 0);
      });
    });
  });

  describe('retiring what the map no longer holds', () => {
    it('deletes the objects a complete sweep did not see again', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now));
        servesOneFort(sandbox);

        await sandbox.call('updateStormMap');

        assert.equal((sandbox.db.one(PRUNE_FORTS).params[0] as Date).getTime(), sandbox.now.getTime());
        assert.equal((sandbox.db.one(PRUNE_ISLES).params[0] as Date).getTime(), sandbox.now.getTime());
      });
    });

    it('keeps them when a tile never answered, since absent is not the same as gone', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now, { scan_radius: 151 }));
        sandbox.api.on('gaa', (request, callIndex) =>
          callIndex === 0
            ? stormArea([stormFort(644, 644), stormIsle(645, 644)])
            : { return_code: -1, error: 'Timeout' },
        );

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.db.matching(PRUNE_FORTS).length, 0);
        assert.equal(sandbox.db.matching(PRUNE_ISLES).length, 0);
      });
    });

    it('retries a tile the bridge refused while its socket was down, not only a timed-out one', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now));
        sandbox.api.on('gaa', (request, callIndex) => {
          if (callIndex === 0) throw new Error('Request failed with status code 500');
          return stormArea([stormFort(644, 644), stormIsle(645, 644), [STORM_BORDER_OBJECT, 0, 0]]);
        });

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.api.callsFor('gaa').length, 2);
        assert.equal(sandbox.db.matching(PRUNE_FORTS).length, 1);
        assert.equal(sandbox.db.matching(SCAN_STAMP).length, 1);
      });
    });

    it('keeps them when the game cut a tile at its object ceiling', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now));
        const crowded = Array.from({ length: 1200 }, (unused, index) => stormFort(600 + (index % 90), 600));
        sandbox.api.on('gaa', () => stormArea([...crowded, [STORM_BORDER_OBJECT, 0, 0]]));

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.db.matching(PRUNE_FORTS).length, 0);
        assert.equal(sandbox.db.matching(SCAN_STAMP).length, 1);
      });
    });

    it('keeps the radius it had when the frontier ring answered nothing', async () => {
      await withSandbox({}, async (sandbox) => {
        sandbox.db.when(STORM_STATE, stormState(sandbox.now, { scan_radius: 151 }));
        sandbox.api.on('gaa', (request, callIndex) =>
          callIndex === 0 ? stormArea([stormFort(644, 644)]) : { return_code: -1, error: 'Timeout' },
        );

        await sandbox.call('updateStormMap');

        assert.equal(sandbox.db.one(SCAN_STAMP).params[0], 151);
      });
    });
  });
});
