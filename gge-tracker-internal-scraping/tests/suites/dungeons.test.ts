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
import { Sandbox, withSandbox } from '../harness/sandbox';

const WORLD = 1;
const DUNGEON_OBJECT_ID = '11';
const CASTLES = /SELECT castles_realm FROM players/;
const READY_DUNGEONS = /SELECT kid, position_x, position_y, global_available_at FROM dungeons/;
const INSERT_DUNGEONS = /INSERT INTO dungeons \(kid, position_x, position_y, global_available_at\)/;
const UPDATE_DUNGEONS = /UPDATE dungeons d/;
const INSERT_HISTORY = /INSERT INTO dungeons_history/;
const INSERT_COOLDOWNS = /INSERT INTO dungeon_player_cooldowns/;
const SCAN_PARAMETER = /INSERT INTO parameters|UPDATE parameters/;
const KNOWN_DUNGEONS = /SELECT kid, position_x, position_y FROM dungeons/;
const TRY_LOCK = /pg_try_advisory_lock/;
const UNLOCK = /pg_advisory_unlock/;
const PLAYER_COOLDOWN_SECONDS = 4 * 24 * 60 * 60;

const CURRENT_BOUNDARY_HOURS = 496539;
const PREVIOUS_BOUNDARY_HOURS = CURRENT_BOUNDARY_HOURS - 168;
const LONE_TILE_CASTLE = 555;
const LONE_TILE_ORIGIN = 505;

function realmCastles(...positions: [number, number][]): { rows: { castles_realm: unknown }[] } {
  return { rows: positions.map(([x, y]) => ({ castles_realm: [[WORLD, x, y, 12]] })) };
}

function knownDungeons(...positions: [number, number][]): { rows: unknown[] } {
  return { rows: positions.map(([x, y]) => ({ kid: WORLD, position_x: x, position_y: y })) };
}

function discoveryStamp(sandbox: Sandbox): number | undefined {
  const written = sandbox.db.matching(SCAN_PARAMETER).find((query) => query.params[0] === 'dungeons_discovery');
  return written?.params[1] as number | undefined;
}

function scannedTiles(sandbox: Sandbox): [number, number][] {
  return sandbox.api
    .callsFor('gaa')
    .map((call): [number, number] => [Number(call.parameters.AX1), Number(call.parameters.AY1)]);
}

function runUnattended(sandbox: Sandbox): void {
  sandbox.setState('askConfirmation', async () => true);
}

function areaResponse(dungeons: unknown[][]): Record<string, unknown> {
  return { return_code: '0', content: { AI: dungeons } };
}

function dungeonAt(x: number, y: number, cooldown: number, playerId: number): unknown[] {
  return [DUNGEON_OBJECT_ID, x, y, 0, 0, cooldown, playerId];
}

describe('getDungeonsList', () => {
  it('does nothing when no player has a castle recorded', async () => {
    await withSandbox({}, async (sandbox) => {
      runUnattended(sandbox);
      await sandbox.call('getDungeonsList', WORLD);
      assert.deepEqual(sandbox.api.callsFor('gaa'), []);
      assert.deepEqual(sandbox.db.matching(INSERT_DUNGEONS), []);
    });
  });

  it('ignores castles of another realm or another kind', async () => {
    await withSandbox({}, async (sandbox) => {
      runUnattended(sandbox);
      sandbox.db.when(CASTLES, {
        rows: [
          { castles_realm: [[2, 500, 500, 12]] },
          { castles_realm: [[WORLD, 500, 500, 3]] },
          { castles_realm: [[WORLD, 500, 500]] },
          { castles_realm: null },
        ],
      });
      await sandbox.call('getDungeonsList', WORLD);
      assert.deepEqual(sandbox.api.callsFor('gaa'), [], 'no castle of realm 12 in this world, nothing to scan');
    });
  });

  it('stops before scanning when the operator declines', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('askConfirmation', async () => false);
      sandbox.db.when(CASTLES, { rows: [{ castles_realm: [[WORLD, 600, 600, 12]] }] });
      await sandbox.call('getDungeonsList', WORLD);
      assert.deepEqual(sandbox.api.callsFor('gaa'), []);
      assert.deepEqual(sandbox.db.matching(INSERT_DUNGEONS), []);
    });
  });

  it('scans a margin of two zones around the castles, clamped to the map', async () => {
    await withSandbox({}, async (sandbox) => {
      runUnattended(sandbox);
      sandbox.db.when(CASTLES, { rows: [{ castles_realm: [[WORLD, 640, 640, 12]] }] });
      sandbox.api.on('gaa', () => areaResponse([]));
      await sandbox.call('getDungeonsList', WORLD);

      const tiles = sandbox.api.callsFor('gaa').map((c) => [Number(c.parameters.AX1), Number(c.parameters.AY1)]);
      assert.ok(tiles.length > 0);
      const xs = tiles.map(([x]) => x);
      const ys = tiles.map(([, y]) => y);
      assert.equal(Math.min(...xs), 404, '640 - 202 rounded down to a multiple of the 101 zone');
      assert.equal(Math.min(...ys), 404);
      assert.ok(Math.max(...xs) <= 1286);
      for (const call of sandbox.api.callsFor('gaa')) {
        assert.equal(Number(call.parameters.KID), WORLD);
        assert.equal(Number(call.parameters.AX2) - Number(call.parameters.AX1), 100);
      }
    });
  });

  it('keeps only object 11 and writes its global cooldown', async () => {
    await withSandbox({}, async (sandbox) => {
      runUnattended(sandbox);
      sandbox.db.when(CASTLES, { rows: [{ castles_realm: [[WORLD, 640, 640, 12]] }] });
      let served = false;
      sandbox.api.on('gaa', () => {
        if (served) return areaResponse([]);
        served = true;
        return areaResponse([dungeonAt(700, 710, 3600, 42), ['12', 701, 711, 0, 0, 60, 43]]);
      });
      await sandbox.call('getDungeonsList', WORLD);

      const insert = sandbox.db.one(INSERT_DUNGEONS);
      assert.deepEqual(insert.params, [WORLD, 700, 710, new Date(sandbox.now.getTime() + 3600 * 1000)]);
    });
  });

  it('gives up once ten tiles in a row have failed', async () => {
    await withSandbox({}, async (sandbox) => {
      runUnattended(sandbox);
      sandbox.db.when(CASTLES, { rows: [{ castles_realm: [[WORLD, 640, 640, 12]] }] });
      let attempts = 0;
      sandbox.api.on('gaa', () => {
        attempts++;
        throw new Error('the bridge is down');
      });
      await sandbox.call('getDungeonsList', WORLD);
      assert.equal(attempts, 10);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 10);
      assert.deepEqual(sandbox.db.matching(INSERT_DUNGEONS), [], 'an aborted scan writes nothing');
    });
  });

  it('retries a tile once when the game answers with a bad return code', async () => {
    await withSandbox({}, async (sandbox) => {
      runUnattended(sandbox);
      sandbox.db.when(CASTLES, { rows: [{ castles_realm: [[WORLD, 640, 640, 12]] }] });
      const seen: number[] = [];
      sandbox.api.on('gaa', (request: ApiRequest, callIndex: number) => {
        seen.push(Number(request.parameters.AX1));
        if (callIndex === 0) return { return_code: '-1', content: {} };
        if (callIndex === 1) return areaResponse([dungeonAt(700, 710, 120, 7)]);
        return areaResponse([]);
      });
      await sandbox.call('getDungeonsList', WORLD);
      assert.equal(seen[0], seen[1], 'the retry asks for the same tile');
      assert.equal(sandbox.db.one(INSERT_DUNGEONS).params[1], 700, 'the retry result is kept');
    });
  });
});

describe('updateDungeonsList', () => {
  const readyRow = { kid: WORLD, position_x: 700, position_y: 710, global_available_at: new Date(0) };

  it('does nothing when no dungeon has come off cooldown', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('updateDungeonsList');
      assert.deepEqual(sandbox.api.callsFor('gaa'), []);
      assert.deepEqual(sandbox.db.matching(UPDATE_DUNGEONS), []);
    });
  });

  it('writes the global cooldown, the history and the per-player cooldown together', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(READY_DUNGEONS, { rows: [readyRow] });
      sandbox.api.on('gaa', () => areaResponse([dungeonAt(700, 710, 7200, 55)]));
      await sandbox.call('updateDungeonsList');

      const globalAvailable = new Date(sandbox.now.getTime() + 7200 * 1000);
      const playerAvailable = new Date(sandbox.now.getTime() + (7200 + PLAYER_COOLDOWN_SECONDS) * 1000);
      assert.deepEqual(sandbox.db.one(UPDATE_DUNGEONS).params, [globalAvailable, WORLD, 700, 710]);
      assert.deepEqual(sandbox.db.one(INSERT_HISTORY).params, [WORLD, 700, 710, 55]);
      assert.deepEqual(sandbox.db.one(INSERT_COOLDOWNS).params, [WORLD, 700, 710, 55, playerAvailable]);
    });
  });

  it('counts a dungeon it saw but skips one that is already available', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(READY_DUNGEONS, { rows: [readyRow] });
      sandbox.api.on('gaa', () => areaResponse([dungeonAt(700, 710, 0, 55), dungeonAt(701, 711, 60, 56)]));
      await sandbox.call('updateDungeonsList');

      assert.equal(sandbox.state('DB_UPDATES').playersCreated, 2, 'both dungeons were observed');
      assert.deepEqual(
        sandbox.db.one(INSERT_HISTORY).params,
        [WORLD, 701, 711, 56],
        'only the one on cooldown is written',
      );
    });
  });

  it('records how many dungeons the scan is about to write', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(READY_DUNGEONS, { rows: [readyRow] });
      sandbox.api.on('gaa', () => areaResponse([dungeonAt(700, 710, 60, 1), dungeonAt(701, 711, 60, 2)]));
      await sandbox.call('updateDungeonsList');
      const parameter = sandbox.db.matching(SCAN_PARAMETER).at(-1);
      assert.ok(parameter, 'the scan size is stored as a parameter');
      assert.ok(parameter!.params.includes(2));
    });
  });

  it('stops the whole sweep and warns Discord when the game answers -1', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(READY_DUNGEONS, { rows: [readyRow, { ...readyRow, position_x: 800 }] });
      sandbox.api.on('gaa', () => ({ return_code: '-1', content: {} }));
      await sandbox.call('updateDungeonsList');

      assert.equal(sandbox.api.callsFor('gaa').length, 1, 'the sweep stops at the first bad answer');
      const warnings = sandbox.outbound.filter((call) => call.url === 'http://discord.test/webhook');
      assert.equal(warnings.length, 1);
      assert.deepEqual(sandbox.db.matching(UPDATE_DUNGEONS), []);
    });
  });

  it('counts a critical error on a bad answer when no webhook is configured', async () => {
    await withSandbox({ env: { WEBHOOK_URL: '' } }, async (sandbox) => {
      sandbox.db.when(READY_DUNGEONS, { rows: [readyRow] });
      sandbox.api.on('gaa', () => ({ return_code: '-1', content: {} }));
      await sandbox.call('updateDungeonsList');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(
        sandbox.outbound.filter((call) => call.url === 'http://discord.test/webhook'),
        [],
      );
    });
  });

  it('counts a critical error and writes nothing when the game cannot be reached', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(READY_DUNGEONS, { rows: [readyRow] });
      sandbox.api.on('gaa', () => {
        throw new Error('the bridge is down');
      });
      await sandbox.call('updateDungeonsList');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
      assert.deepEqual(sandbox.db.matching(UPDATE_DUNGEONS), []);
    });
  });
});

describe('isDungeonDiscoveryDue', () => {
  it('is due when the server has never run a discovery', async () => {
    await withSandbox({}, async (sandbox) => {
      assert.equal(await sandbox.call('isDungeonDiscoveryDue'), true);
    });
  });

  it('is due when the stamp predates the current weekly boundary', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/SELECT value FROM parameters/, { rows: [{ value: PREVIOUS_BOUNDARY_HOURS }] });
      assert.equal(await sandbox.call('isDungeonDiscoveryDue'), true);
    });
  });

  it('is not due again inside the same week', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/SELECT value FROM parameters/, { rows: [{ value: CURRENT_BOUNDARY_HOURS }] });
      assert.equal(await sandbox.call('isDungeonDiscoveryDue'), false);
    });
  });

  it('reads the stamp of this server only', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('isDungeonDiscoveryDue');
      assert.deepEqual(sandbox.db.one(/SELECT value FROM parameters/).params, ['dungeons_discovery']);
    });
  });
});

describe('discoverNewDungeons', () => {
  it('scans nothing when every castle already has a dungeon inside the search radius', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([600, 600], [640, 640]));
      sandbox.db.when(KNOWN_DUNGEONS, knownDungeons([620, 620]));
      await sandbox.call('discoverNewDungeons');
      assert.deepEqual(sandbox.api.callsFor('gaa'), [], 'settled territory costs no request');
      assert.deepEqual(sandbox.db.matching(INSERT_DUNGEONS), []);
    });
  });

  it('scans a castle whose nearest known dungeon sits just outside the radius', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      sandbox.db.when(KNOWN_DUNGEONS, knownDungeons([LONE_TILE_CASTLE + 51, LONE_TILE_CASTLE]));
      sandbox.api.on('gaa', () => areaResponse([]));
      await sandbox.call('discoverNewDungeons');
      assert.deepEqual(scannedTiles(sandbox), [[LONE_TILE_ORIGIN, LONE_TILE_ORIGIN]]);
    });
  });

  it('leaves that same castle alone once the dungeon is one tile closer', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      sandbox.db.when(KNOWN_DUNGEONS, knownDungeons([LONE_TILE_CASTLE + 50, LONE_TILE_CASTLE]));
      await sandbox.call('discoverNewDungeons');
      assert.deepEqual(sandbox.api.callsFor('gaa'), []);
    });
  });

  it('asks for a 100-wide window on the realm of the castle', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      sandbox.api.on('gaa', () => areaResponse([]));
      await sandbox.call('discoverNewDungeons');
      const call = sandbox.api.callsFor('gaa')[0];
      assert.equal(Number(call.parameters.KID), WORLD);
      assert.equal(Number(call.parameters.AX2) - Number(call.parameters.AX1), 100);
      assert.equal(Number(call.parameters.AY2) - Number(call.parameters.AY1), 100);
    });
  });

  it('scans a tile once when several castles share it', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([550, 550], [560, 560], [545, 552]));
      sandbox.api.on('gaa', () => areaResponse([]));
      await sandbox.call('discoverNewDungeons');
      const tiles = scannedTiles(sandbox).map((tile) => tile.join(','));
      assert.deepEqual([...new Set(tiles)].sort(), tiles.sort(), 'no tile is requested twice');
    });
  });

  it('inserts what it finds and keeps the cooldown the game reports', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      sandbox.api.on('gaa', () => areaResponse([dungeonAt(560, 550, 3600, 42), ['12', 561, 551, 0, 0, 60, 43]]));
      await sandbox.call('discoverNewDungeons');
      const insert = sandbox.db.one(INSERT_DUNGEONS);
      assert.deepEqual(insert.params, [WORLD, 560, 550, new Date(sandbox.now.getTime() + 3600 * 1000)]);
    });
  });

  it('covers every settled tile of a server that was never initialised', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([200, 200], [900, 900]));
      sandbox.api.on('gaa', () => areaResponse([]));
      await sandbox.call('discoverNewDungeons');
      const tiles = scannedTiles(sandbox);
      assert.ok(tiles.some(([x, y]) => x === 101 && y === 101));
      assert.ok(tiles.some(([x, y]) => x === 909 && y === 909));
      assert.equal(tiles.length, 8, 'four tiles around each of the two castles');
    });
  });

  it('ignores castles of another realm or another kind', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, {
        rows: [
          { castles_realm: [[4, 555, 555, 12]] },
          { castles_realm: [[WORLD, 555, 555, 3]] },
          { castles_realm: [[WORLD, 555, 555]] },
          { castles_realm: null },
        ],
      });
      await sandbox.call('discoverNewDungeons');
      assert.deepEqual(sandbox.api.callsFor('gaa'), []);
    });
  });

  it('stamps the weekly boundary it just completed', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      sandbox.api.on('gaa', () => areaResponse([]));
      assert.equal(await sandbox.call('discoverNewDungeons'), true);
      assert.equal(discoveryStamp(sandbox), CURRENT_BOUNDARY_HOURS);
    });
  });

  it('leaves the stamp alone when the bridge never answered, so the next cycle retries', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([200, 200], [900, 900]));
      sandbox.api.on('gaa', () => {
        throw new Error('the bridge is down');
      });
      assert.equal(await sandbox.call('discoverNewDungeons'), false, 'the caller is told the week is not done');
      assert.equal(discoveryStamp(sandbox), undefined);
      assert.deepEqual(sandbox.db.matching(INSERT_DUNGEONS), []);
      assert.equal(sandbox.state<{ criticalErrors: number }>('DB_UPDATES').criticalErrors, 1);
    });
  });

  it('retries a tile once before giving the realm up', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      sandbox.api.on('gaa', (request: ApiRequest, callIndex: number) => {
        if (callIndex === 0) return { return_code: '-1', content: {} };
        return areaResponse([dungeonAt(560, 550, 120, 7)]);
      });
      await sandbox.call('discoverNewDungeons');
      assert.equal(sandbox.api.callsFor('gaa').length, 2, 'the same tile is asked twice');
      assert.equal(sandbox.db.one(INSERT_DUNGEONS).params[1], 560, 'the retry result is kept');
      assert.equal(discoveryStamp(sandbox), CURRENT_BOUNDARY_HOURS);
    });
  });

  it('writes what answered but stays due when one tile did not', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([200, 200], [900, 900]));
      sandbox.api.on('gaa', (request: ApiRequest) => {
        if (Number(request.parameters.AX1) === 909) return { return_code: '-1', content: {} };
        return areaResponse([dungeonAt(210, 210, 60, 7)]);
      });
      assert.equal(await sandbox.call('discoverNewDungeons'), false);
      assert.equal(sandbox.db.one(INSERT_DUNGEONS).params[1], 210, 'the tiles that answered are kept');
      assert.equal(discoveryStamp(sandbox), undefined, 'the week is only stamped by a complete pass');
    });
  });

  it('does nothing at all while another dungeon job holds the lock', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(TRY_LOCK, { rows: [{ acquired: false }] });
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      assert.equal(await sandbox.call('discoverNewDungeons'), false, 'a skipped pass is not a completed one');
      assert.deepEqual(sandbox.api.callsFor('gaa'), []);
      assert.deepEqual(sandbox.db.matching(CASTLES), [], 'the castles are not even read');
      assert.equal(discoveryStamp(sandbox), undefined);
      assert.deepEqual(sandbox.db.matching(UNLOCK), [], 'a lock that was not taken is not released');
    });
  });

  it('releases the lock and the client it was taken on', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(CASTLES, realmCastles([LONE_TILE_CASTLE, LONE_TILE_CASTLE]));
      sandbox.api.on('gaa', () => areaResponse([]));
      await sandbox.call('discoverNewDungeons');
      assert.equal(sandbox.db.matching(UNLOCK).length, 1);
      assert.deepEqual(sandbox.db.one(TRY_LOCK).params, sandbox.db.one(UNLOCK).params);
      assert.deepEqual(
        sandbox.db.pools.map((pool) => pool.checkedOut),
        sandbox.db.pools.map(() => 0),
      );
    });
  });
});

describe('the dungeon lock', () => {
  it('stops the cooldown sweep while a scan is running', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(TRY_LOCK, { rows: [{ acquired: false }] });
      sandbox.db.when(READY_DUNGEONS, {
        rows: [{ kid: WORLD, position_x: 700, position_y: 710, global_available_at: new Date(0) }],
      });
      await sandbox.call('updateDungeonsList');
      assert.deepEqual(sandbox.api.callsFor('gaa'), []);
      assert.deepEqual(sandbox.db.matching(UPDATE_DUNGEONS), []);
    });
  });

  it('releases it once the sweep is over', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(READY_DUNGEONS, {
        rows: [{ kid: WORLD, position_x: 700, position_y: 710, global_available_at: new Date(0) }],
      });
      sandbox.api.on('gaa', () => areaResponse([dungeonAt(700, 710, 7200, 55)]));
      await sandbox.call('updateDungeonsList');
      assert.equal(sandbox.db.matching(UNLOCK).length, 1);
    });
  });
});
