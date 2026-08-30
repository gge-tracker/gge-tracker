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

import { GenericFetchAndSaveBackend } from '../../src/main';
import { StormIsleState } from '../../src/interfaces';
import { clickHouseError, networkError } from '../harness/fake-clickhouse';
import { withSandbox } from '../harness/sandbox';

const MAP_SIZE = 1286;
const TILE_SPAN = 100;
const TILE_SPACING = 101;
const HALF_SPAN = 50;

describe('ClickHouse failure classification', () => {
  const parse = (error: unknown): unknown => (GenericFetchAndSaveBackend as any).parseClickHouseErrorCode(error);
  const retryable = (error: unknown): boolean => (GenericFetchAndSaveBackend as any).isClickHouseRetryable(error);

  it('reads the error code out of the body ClickHouse returns', () => {
    assert.equal(parse(clickHouseError(500, 241)), 241);
    assert.equal(parse(clickHouseError(400)), undefined, 'a body with no code yields none');
    assert.equal(parse(networkError()), undefined, 'a failure with no response yields none');
  });

  it('retries anything that never reached the server', () => {
    assert.equal(retryable(networkError()), true);
    assert.equal(retryable(new Error('socket hang up')), true);
  });

  it('retries a busy server but not a rejected statement', () => {
    assert.equal(retryable(clickHouseError(503)), true);
    assert.equal(retryable(clickHouseError(500, 252)), true, 'TOO_MANY_PARTS clears on its own');
    assert.equal(retryable(clickHouseError(400, 62)), false, 'a syntax error will fail the same way forever');
    assert.equal(retryable(clickHouseError(400)), false);
  });
});

describe('PostgreSQL failure classification', () => {
  it('retries the failures that mean the connection went away', async () => {
    await withSandbox({}, async (sandbox) => {
      const transient = (message: string): boolean => (sandbox.backend as any).isTransientPgError({ message });
      for (const message of [
        'Connection terminated unexpectedly',
        'Connection terminated due to connection timeout',
        'timeout exceeded when trying to connect',
        'sorry, too many clients already',
        'the database system is starting up',
        'read ECONNRESET',
        'connect ECONNREFUSED 10.0.0.1:5432',
        'connect ETIMEDOUT',
        'write EPIPE',
      ]) {
        assert.equal(transient(message), true, message);
      }
      assert.equal(transient('duplicate key value violates unique constraint'), false);
      assert.equal(transient(''), false);
    });
  });

  it('retries a transient query three times before giving up', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/SELECT 1/, { error: Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }) });
      await assert.rejects(() => sandbox.call('pgSqlQuery', 'SELECT 1'));
      assert.equal(sandbox.db.matching(/SELECT 1/).length, 3);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 1);
    });
  });

  it('does not retry a statement the database rejected', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.db.when(/SELECT 1/, { error: Object.assign(new Error('syntax error'), { code: '42601' }) });
      await assert.rejects(() => sandbox.call('pgSqlQuery', 'SELECT 1'));
      assert.equal(sandbox.db.matching(/SELECT 1/).length, 1);
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0, 'a bad statement is a bug, not an incident');
    });
  });
});

describe('storm map geometry', () => {
  it('tiles a ring into the squares the map query accepts', async () => {
    await withSandbox({}, async (sandbox) => {
      const tiles = (ring: number): any[] => (sandbox.backend as any).getStormRingTiles(ring);
      const centre = tiles(0);
      assert.equal(centre.length, 1, 'the middle of the map is a single tile');
      assert.deepEqual(centre[0], { AX1: 594, AY1: 594, AX2: 694, AY2: 694 });
      assert.equal(tiles(1).length, 8);
      assert.equal(tiles(2).length, 16);
      for (const tile of tiles(2)) {
        assert.equal(tile.AX2 - tile.AX1, TILE_SPAN);
        assert.equal(tile.AY2 - tile.AY1, TILE_SPAN);
        assert.ok(tile.AX1 >= 0 && tile.AY1 >= 0 && tile.AX2 <= MAP_SIZE && tile.AY2 <= MAP_SIZE);
      }
    });
  });

  it('drops the tiles of an outer ring that fall off the map', async () => {
    await withSandbox({}, async (sandbox) => {
      const tiles = (ring: number): any[] => (sandbox.backend as any).getStormRingTiles(ring);
      assert.ok(tiles(6).length < 8 * 6, 'the corners of a far ring are outside the map');
    });
  });

  it('converts between a scanned radius and a number of rings', async () => {
    await withSandbox({}, async (sandbox) => {
      const toRings = (radius: number): number => (sandbox.backend as any).stormRadiusToRings(radius);
      const toRadius = (rings: number): number => (sandbox.backend as any).stormRingsToRadius(rings);

      assert.equal(toRings(HALF_SPAN), 0);
      assert.equal(toRings(HALF_SPAN + TILE_SPACING), 1);
      assert.equal(toRings(0), 0, 'never negative');
      assert.equal(toRings(100_000), 5, 'never past the ring budget');
      assert.equal(toRadius(0), HALF_SPAN);
      assert.equal(toRadius(3), HALF_SPAN + 3 * TILE_SPACING);
      assert.equal(toRings(toRadius(4)), 4, 'the two are inverses inside the budget');
    });
  });

  it('places a coordinate in the twelve-wide square the dungeon query uses', async () => {
    await withSandbox({}, async (sandbox) => {
      const square = (x: number, y: number): Promise<any> =>
        (sandbox.backend as any).getCorrespondingSquare(x, y, MAP_SIZE);
      assert.deepEqual(await square(0, 0), { AX1: 0, AY1: 0, AX2: 12, AY2: 12 });
      assert.deepEqual(await square(12, 12), { AX1: 0, AY1: 0, AX2: 12, AY2: 12 });
      assert.deepEqual(await square(13, 13), { AX1: 13, AY1: 13, AX2: 25, AY2: 25 });
      assert.deepEqual(await square(MAP_SIZE, MAP_SIZE), { AX1: 1274, AY1: 1274, AX2: 1286, AY2: 1286 });
      assert.equal(await square(MAP_SIZE + 1, 0), null, 'a square running off the map is refused');
    });
  });
});

describe('storm objects', () => {
  it('reads a fort out of a raw map row', async () => {
    await withSandbox({}, async (sandbox) => {
      const observedAt = new Date('2026-08-29T12:00:00.000Z');
      const fort = (sandbox.backend as any).parseStormFort([25, 640, 650, 0, 0, 77, 3600, 12, 0], observedAt);
      assert.deepEqual(fort, {
        positionX: 640,
        positionY: 650,
        isleId: 77,
        victoryCount: 12,
        isVisible: true,
        availableAt: new Date(observedAt.getTime() + 3600 * 1000),
      });
    });
  });

  it('treats a fort with no cooldown as available now', async () => {
    await withSandbox({}, async (sandbox) => {
      const observedAt = new Date('2026-08-29T12:00:00.000Z');
      const fort = (sandbox.backend as any).parseStormFort([25, 640, 650, 0, 0, 77, 0, 0, 1], observedAt);
      assert.equal(fort.availableAt.getTime(), observedAt.getTime());
      assert.equal(fort.isVisible, false, 'the last column is a hidden flag, not a visible one');
    });
  });

  it('tells an occupied isle from a respawning one and a free one', async () => {
    await withSandbox({}, async (sandbox) => {
      const observedAt = new Date('2026-08-29T12:00:00.000Z');
      const parse = (row: any[]): any => (sandbox.backend as any).parseStormIsle(row, observedAt);
      const occupied = parse([24, 100, 200, 24, 900001, 0, 0, 0, 55, 0]);
      assert.equal(occupied.state, StormIsleState.OCCUPIED);
      assert.equal(occupied.occupierId, 900001);
      assert.equal(occupied.availableAt.getTime(), observedAt.getTime());
      const respawning = parse([24, 100, 200, 24, 0, 0, 0, 0, 55, 600]);
      assert.equal(respawning.state, StormIsleState.RESPAWNING);
      assert.equal(respawning.occupierId, null);
      assert.equal(respawning.availableAt.getTime(), observedAt.getTime() + 600 * 1000);
      const free = parse([24, 100, 200, 24, 0, 0, 0, 0, 55, 0]);
      assert.equal(free.state, StormIsleState.FREE);
      assert.equal(free.occupierId, null);
    });
  });

  it('puts the season boundary on the first of the month at half past midnight UTC', async () => {
    await withSandbox({ now: new Date('2026-08-29T12:00:00.000Z') }, async (sandbox) => {
      const boundary = (sandbox.backend as any).getLastStormSeasonBoundary();
      assert.equal(boundary.toISOString(), '2026-08-01T00:30:00.000Z');
    });
    await withSandbox({ now: new Date('2026-08-01T00:15:00.000Z') }, async (sandbox) => {
      const boundary = (sandbox.backend as any).getLastStormSeasonBoundary();
      assert.equal(boundary.toISOString(), '2026-07-01T00:30:00.000Z', 'before the reset the season is still July');
    });
  });
});

describe('small helpers', () => {
  it('chunks an array without losing or reordering anything', async () => {
    await withSandbox({}, async (sandbox) => {
      const chunk = <T>(items: T[], size: number): T[][] => (sandbox.backend as any).chunkArray(items, size);
      assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
      assert.deepEqual(chunk([], 3), []);
      assert.deepEqual(chunk([1, 2], 10), [[1, 2]]);
    });
  });

  it('types a log attribute by its JavaScript type', async () => {
    await withSandbox({}, async (sandbox) => {
      const attribute = (value: unknown): unknown => (sandbox.backend as any).formatAttribute(value);
      assert.deepEqual(attribute(42), { intValue: 42 });
      assert.deepEqual(attribute(4.2), { doubleValue: 4.2 });
      assert.deepEqual(attribute(true), { boolValue: true });
      assert.deepEqual(attribute('text'), { stringValue: 'text' });
      assert.deepEqual(attribute(null), { stringValue: 'null' });
    });
  });

  it('maps an outer realms scoring system to its highscore list', async () => {
    await withSandbox({}, async (sandbox) => {
      const lt = (type: string): unknown => sandbox.backend.getCorrespondigLtByOuterRealmsType(type);
      assert.equal(Number(lt('collector')), 65, 'TEMP_SERVER_DAILY_COLLECTOR_POINTS');
      assert.equal(Number(lt('might')), 61, 'TEMP_SERVER_DAILY_MIGHT_POINTS_BUILDINGS');
      assert.equal(Number(lt('rankSwap')), 66, 'TEMP_SERVER_DAILY_RANK_SWAP');
      assert.equal(lt('something else'), null);
    });
  });

  it('renders a server code as its flag, and falls back to the code itself', async () => {
    await withSandbox({}, async (sandbox) => {
      const emoji = (server: string): string => (sandbox.backend as any).transformServerNameToEmoji(server);
      assert.equal(emoji('FR1'), ':flag_fr:');
      assert.equal(emoji('de2'), ':flag_de:');
      assert.equal(emoji('WLD1'), '(WLD1)', 'a code that is not a country keeps its own name');
    });
  });

  it('escapes the characters Discord would read as formatting', async () => {
    await withSandbox({}, async (sandbox) => {
      const escape = (value?: string | number): string => (sandbox.backend as any).formatValueForDiscord(value);
      assert.equal(escape('a_b*c~d`e>f|g@h#i'), String.raw`a\_b\*c\~d\`e\>f\|g\@h\#i`);
      assert.equal(escape(42), '42');
      assert.equal(escape(undefined), '');
      assert.equal(escape(null as any), '');
    });
  });
});

describe('getDiscordApiMessageBody', () => {
  const players = [
    {
      server: 'FR1',
      level: 70,
      legendaryLevel: 950,
      point: 100,
      rank: 1,
      realPlayerId: 1,
      playerName: 'Player_1',
      allianceName: 'Alliance_1',
    },
    {
      server: 'DE1',
      level: 70,
      legendaryLevel: 0,
      point: 90,
      rank: 2,
      realPlayerId: 2,
      playerName: 'Player_2',
      allianceName: '',
    },
  ];

  it('builds the embed the bot posts for a finished event', async () => {
    await withSandbox({}, async (sandbox) => {
      const body = sandbox.backend.getDiscordApiMessageBody('Outer Realms', 1234, 42, players as any);
      assert.equal(body.channelId, '1234567890');
      assert.equal(body.embeds[0].title, 'Outer Realms Leaderboard Update');
      assert.equal(body.embeds[0].image?.url, 'https://gge-tracker.com/assets/outer-realms.png');
      assert.equal(body.embeds[0].footer?.text, 'gge-tracker.com - 1234 players');
      assert.equal(body.embeds[0].timestamp, sandbox.now.toISOString());
      assert.ok(body.embeds[0].fields[0].value.includes('https://gge-tracker.com/events/outer-realms/42'));
    });
  });

  it('medals the podium, shows the legendary level and falls back for a player with no alliance', async () => {
    await withSandbox({}, async (sandbox) => {
      const body = sandbox.backend.getDiscordApiMessageBody('Beyond the Horizon', 2, 1, players as any);
      const description = body.embeds[0].fields[0].value;
      assert.ok(description.includes(':first_place: '));
      assert.ok(description.includes('(Level: 70/950, Alliance: _Alliance\\_1_)'));
      assert.ok(description.includes(':second_place: '));
      assert.ok(description.includes('(Level: 70, Alliance: _-_)'), 'no legendary level and no alliance');
    });
  });

  it('refuses to build a message with no channel configured', async () => {
    await withSandbox({ env: { DISCORD_OR_CHANNEL_ID: undefined } }, async (sandbox) => {
      assert.throws(
        () => sandbox.backend.getDiscordApiMessageBody('Outer Realms', 1, 1, players as any),
        /Missing Discord Channel ID/,
      );
    });
  });
});
