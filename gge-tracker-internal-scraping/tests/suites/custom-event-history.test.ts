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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ranking } from '../harness/fixtures';
import { RankingFixture, RankingRow } from '../harness/fixture-types';
import { Sandbox, SandboxOptions, withSandbox } from '../harness/sandbox';
import { flushDiscordPosts } from '../../src/discord-schedule';

const OUTER_REALMS_LT = 76;
const EVENT_TABLE = 'outer_realms_event';
const HISTORY_TABLE = 'outer_realms_event_history';

function crossServer(servers: string[], name = 'hgh-loot-lt2-head'): RankingFixture {
  const fixture = ranking(name);
  const rows = fixture.rows.map(
    ([rank, point, player], index): RankingRow => [
      rank,
      point,
      { ...player, N: `${player.N}_${servers[index % servers.length]}` },
    ],
  );
  return { ...fixture, rows, lt: OUTER_REALMS_LT, lid: 6 };
}

function byPlayerId(fixture: RankingFixture): RankingRow[] {
  return [...fixture.rows].sort((a, b) => Number(a[2].OID) - Number(b[2].OID));
}

function insertedPlayer(params: any[], index: number): Record<string, any> {
  const [eventNum, playerId, server, level, legendaryLevel, point, rank, playerName, allianceName] = params.slice(
    index * 9,
    index * 9 + 9,
  );
  return { eventNum, playerId, server, level, legendaryLevel, point, rank, playerName, allianceName };
}

function run(sandbox: Sandbox, dryRun = false): Promise<number> {
  return sandbox.call(
    'executeCustomEventHistory',
    'Outer Realms',
    EVENT_TABLE,
    HISTORY_TABLE,
    OUTER_REALMS_LT,
    10,
    6,
    dryRun,
  );
}

describe('executeCustomEventHistory', () => {
  it('splits the home server off the player name', async () => {
    await withSandbox({}, async (sandbox) => {
      const fixture = crossServer(['FR1', 'DE1']);
      sandbox.api.serveRanking(fixture);
      await run(sandbox);
      const insert = sandbox.db.matching(/INSERT INTO outer_realms_event_history/)[0];
      const [rank, point, player] = byPlayerId(fixture)[0];
      const stored = insertedPlayer(insert.params, 0);
      const [, homeServer] = /^(.*)_([A-Za-z0-9]+)$/.exec(player.N)!.slice(1);
      assert.equal(stored.server, homeServer, 'the suffix is the home server');
      assert.equal(stored.playerName, String(player.N).slice(0, -(homeServer.length + 1)), 'and it is stripped off');
      assert.equal(stored.point, point);
      assert.equal(stored.rank, rank);
      assert.equal(stored.level, player.L);
      assert.equal(stored.legendaryLevel, player.LL);
      assert.equal(stored.allianceName, player.AN ?? null);
    });
  });

  it('opens a new event numbered after the last one stored', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['FR1']));
      sandbox.db.when(/FROM outer_realms_event_history WHERE event_num =/, {
        rows: [{ event_num: 11, player_name: 'someone else', level: 1, point: 1, rank: 1 }],
      });
      await run(sandbox);
      const event = sandbox.db.one(/INSERT INTO outer_realms_event \(/);
      assert.equal(
        event.sql,
        'INSERT INTO outer_realms_event (event_num, collect_date, fr, igh, top1_player_id, top1_player_score) VALUES ($1, $2, $3, $4, $5, $6)',
      );
      assert.equal(event.params[0], 12, 'the next event number');
      assert.equal((event.params[1] as Date).getTime(), sandbox.now.getTime());
      assert.equal(typeof event.params[4], 'number', 'top1_player_id');
      assert.equal(typeof event.params[5], 'number', 'top1_player_score');
    });
  });

  it('starts at event one when the table is empty', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['FR1']));
      await run(sandbox);
      assert.equal(sandbox.db.one(/INSERT INTO outer_realms_event \(/).params[0], 1);
    });
  });

  it('recognises a ranking it has already stored and writes nothing', async () => {
    await withSandbox({}, async (sandbox) => {
      const fixture = crossServer(['FR1']);
      sandbox.api.serveRanking(fixture);
      sandbox.db.when(/FROM outer_realms_event_history WHERE event_num =/, {
        rows: fixture.rows.slice(0, 10).map(([rank, point, player]) => ({
          event_num: 7,
          player_name: String(player.N).split('_').slice(0, -1).join('_'),
          level: player.L,
          point,
          rank,
        })),
      });
      const result = await run(sandbox);
      assert.equal(result, -1);
      assert.deepEqual(sandbox.db.matching(/INSERT INTO/), [], 'the same final ranking is never stored twice');
    });
  });

  it('stores the ranking again when a single entry differs', async () => {
    await withSandbox({}, async (sandbox) => {
      const fixture = crossServer(['FR1']);
      sandbox.api.serveRanking(fixture);
      sandbox.db.when(/FROM outer_realms_event_history WHERE event_num =/, {
        rows: fixture.rows.slice(0, 10).map(([rank, point, player], index) => ({
          event_num: 7,
          player_name: String(player.N).split('_').slice(0, -1).join('_'),
          level: player.L,
          point: index === 3 ? point + 1 : point,
          rank,
        })),
      });
      const result = await run(sandbox);
      assert.equal(result, 0);
      assert.equal(sandbox.db.matching(/INSERT INTO outer_realms_event \(/).length, 1);
    });
  });

  it('resolves each player against the database of their own server', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['FR1', 'WLD1', 'HANT', 'PL1']));
      sandbox.db.when(/FROM pg_database WHERE datname/, { rows: [{ '?column?': 1 }], rowCount: 1 });
      sandbox.db.when(/unnest\(\$1::text\[\]\)/, { rows: [] });
      await run(sandbox);
      const probed = sandbox.db
        .matching(/FROM pg_database WHERE datname/)
        .map((query) => query.params[0])
        .sort();
      assert.deepEqual(probed, ['empire-ranking-hant1', 'empire-ranking-pl1', 'empire-ranking-world1']);
      const lookups = sandbox.db.matching(/unnest\(\$1::text\[\]\)/);
      assert.deepEqual(lookups.map((query) => query.database).sort(), [
        'empire-ranking-hant1',
        'empire-ranking-pl1',
        'empire-ranking-test',
        'empire-ranking-world1',
      ]);
      assert.deepEqual(
        sandbox.db.endedDatabases.sort(),
        ['empire-ranking-hant1', 'empire-ranking-pl1', 'empire-ranking-world1'],
        'every temporary pool is closed again',
      );
    });
  });

  it('skips a server whose database does not exist', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['XX9']));
      sandbox.db.when(/FROM pg_database WHERE datname/, { rows: [], rowCount: 0 });
      await run(sandbox);
      assert.deepEqual(sandbox.db.matching(/unnest\(\$1::text\[\]\)/), []);
      const insert = sandbox.db.matching(/INSERT INTO outer_realms_event_history/)[0];
      assert.equal(insert.params[1], undefined, 'the player is still stored, with no resolved id');
    });
  });

  it('attaches the real player id it resolved', async () => {
    await withSandbox({}, async (sandbox) => {
      const fixture = crossServer(['FR1']);
      const ordered = byPlayerId(fixture);
      const resolvedName = String(ordered[0][2].N).replace(/_FR1$/, '');
      sandbox.api.serveRanking(fixture);
      sandbox.db.when(/unnest\(\$1::text\[\]\)/, { rows: [{ name: resolvedName, id: 4242 }] });
      await run(sandbox);
      const insert = sandbox.db.matching(/INSERT INTO outer_realms_event_history/)[0];
      assert.equal(insertedPlayer(insert.params, 0).playerId, 4242);
      assert.equal(
        insertedPlayer(insert.params, 1).playerId,
        undefined,
        'a player the lookup did not resolve is stored with no id',
      );
    });
  });

  it('posts the top ten to Discord', async () => {
    await withSandbox({}, async (sandbox) => {
      const fixture = crossServer(['FR1']);
      sandbox.api.serveRanking(fixture);
      await run(sandbox);
      await flushDiscordPosts();
      const discord = sandbox.outbound.find((call) => call.url.includes('discord'));
      assert.ok(discord, 'a notification was sent');
      const body = discord!.body as any;
      assert.equal(body.embeds[0].title, 'Outer Realms Leaderboard Update');
      assert.equal(body.embeds[0].footer.text, `gge-tracker.com - ${fixture.totalRanked} players`);
    });
  });

  it('collects the ranking but writes nothing on a dry run', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['FR1']));
      const result = await run(sandbox, true);
      assert.equal(result, 0);
      assert.deepEqual(sandbox.db.matching(/INSERT INTO/), []);
      assert.ok(sandbox.api.callsFor('hgh').length > 1, 'the sweep still happened');
    });
  });

  it('gives up on an event that is not running', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(ranking('hgh-warrealms-lt44-lid1', { lt: OUTER_REALMS_LT, lid: 6 }));
      const result = await run(sandbox);
      assert.equal(result, -1);
      assert.deepEqual(sandbox.db.matching(/INSERT INTO/), []);
    });
  });

  it('collects the whole ranking when the declared page size matches the live one', async () => {
    await withSandbox({}, async (sandbox) => {
      const fixture = crossServer(['FR1']);
      assert.equal(fixture.pageSize, 10, 'the captured ranking pages ten at a time, like the declared increment');
      sandbox.api.serveRanking(fixture);
      await run(sandbox);
      const insert = sandbox.db.matching(/INSERT INTO outer_realms_event_history/)[0];
      assert.equal(insert.params.length / 9, fixture.totalRanked, 'nobody is missing from the final ranking');
    });
  });

  it('silently skips players when the declared page size is larger than the live one', async () => {
    await withSandbox({}, async (sandbox) => {
      const fixture = crossServer(['FR1'], 'hgh-nomads-lt46-lid1');
      assert.equal(fixture.pageSize, 8);
      sandbox.api.serveRanking(fixture);
      await run(sandbox);
      const insert = sandbox.db.matching(/INSERT INTO outer_realms_event_history/)[0];
      assert.ok(
        insert.params.length / 9 < fixture.totalRanked,
        'the mismatch is silent: the run reports success while dropping players',
      );
    });
  });

  it('refuses to run without a PostgreSQL configuration', async () => {
    await withSandbox({ postgres: false }, async (sandbox) => {
      const result = await run(sandbox);
      assert.equal(result, -1);
      assert.deepEqual(sandbox.api.requests, []);
    });
  });
});

type EventPlayer = Parameters<Sandbox['backend']['getDiscordApiMessageBody']>[3][number];

const E4K_SERVERS_FILE = join(mkdtempSync(join(tmpdir(), 'e4k-events-')), 'servers.xml');
const E4K_RESULTS_CHANNEL = '300000001';

function e4kServersFile(): string {
  const server = (name: string, kind: string, outerName: string, code: string, sql: string, open = true): string => `
    <server><name>${name}</name><kind>${kind}</kind>
      <api><beta><enabled>true</enabled></beta><public><enabled>${open}</enabled></public></api>
      <outer-name>${outerName}</outer-name><code>${code}</code><databases><sql>${sql}</sql></databases>
    </server>`;
  writeFileSync(
    E4K_SERVERS_FILE,
    `<root><servers>
      ${server('WORLD1', 'ep', 'WLD1', '060', 'empire-ranking-world1')}
      ${server('HANT1', 'ep', 'HANT', '025', 'empire-ranking-hant1')}
      ${server('DE1', 'ep', 'DE1', '010', 'empire-ranking-de1')}
      ${server('E4K_WORLD1', 'e4k', 'E4K_WORLD1', '606', 'ggetracker-e4k-world1')}
      ${server('E4K_HANT1', 'e4k', 'E4K_HANT1', '462', 'ggetracker-e4k-hant1')}
      ${server('E4K_DE1', 'e4k', 'E4K_DE1', '121', 'ggetracker-e4k-de1', false)}
      ${server('E4K_KR1', 'e4k', 'E4K_KR1', '612', 'ggetracker-e4k-kr1')}
    </servers></root>`,
  );
  return E4K_SERVERS_FILE;
}

function e4kSandbox(env: Record<string, string | undefined> = {}): SandboxOptions {
  return {
    server: 'E4KFR1',
    env: { SERVERS_FILE: e4kServersFile(), DISCORD_E4K_OR_BTH_RESULTS_CHANNEL_ID: E4K_RESULTS_CHANNEL, ...env },
  };
}

describe('executeCustomEventHistory on E4K', () => {
  it('reads each suffix through the EP server of that name, and the home suffix from its own database', async () => {
    await withSandbox(e4kSandbox(), async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['WLD1', 'HANT', 'DE1', 'KR1', 'FR1']));
      sandbox.db.when(/FROM pg_database WHERE datname/, { rows: [{ '?column?': 1 }], rowCount: 1 });
      await run(sandbox);
      const probed = sandbox.db
        .matching(/FROM pg_database WHERE datname/)
        .map((query) => query.params[0])
        .sort();
      assert.deepEqual(probed, [
        'ggetracker-e4k-de1',
        'ggetracker-e4k-hant1',
        'ggetracker-e4k-kr1',
        'ggetracker-e4k-world1',
      ]);
      assert.ok(
        !probed.some((database: string) => database.startsWith('empire-ranking')),
        'an E4K ranking never reads an EP database',
      );
    });
  });

  it('skips a suffix no E4K server carries instead of guessing a database', async () => {
    await withSandbox(e4kSandbox(), async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['XX9']));
      await run(sandbox);
      assert.deepEqual(sandbox.db.matching(/FROM pg_database WHERE datname/), []);
      const insert = sandbox.db.matching(/INSERT INTO outer_realms_event_history/)[0];
      assert.equal(insert.params[1], undefined, 'the player is still stored, with no resolved id');
    });
  });

  it('posts to the E4K results channel, with links that open the E4K event', async () => {
    await withSandbox(e4kSandbox(), async (sandbox) => {
      sandbox.api.serveRanking(crossServer(['FR1']));
      await run(sandbox);
      await flushDiscordPosts();
      const body = sandbox.outbound.find((call) => call.url.includes('discord'))!.body as any;
      assert.equal(body.channelId, E4K_RESULTS_CHANNEL);
      assert.equal(body.embeds[0].url, 'https://gge-tracker.com/events/outer-realms/1?game=e4k');
      assert.match(body.embeds[0].image.url, /\/assets\/og\/event\/outer-realms\/1\.jpg\?game=e4k$/);
    });
  });

  it('never falls back to the EP channel when the E4K one is not set', async () => {
    await withSandbox(e4kSandbox({ DISCORD_E4K_OR_BTH_RESULTS_CHANNEL_ID: undefined }), async (sandbox) => {
      assert.throws(
        () => sandbox.backend.getDiscordApiMessageBody('Outer Realms', 1, 1, []),
        /Missing Discord Channel ID/,
      );
    });
  });

  it('links a player to the E4K server of their suffix, and only when that server is public', async () => {
    await withSandbox(e4kSandbox(), async (sandbox) => {
      const player = (server: string, realPlayerId: number): EventPlayer => ({
        server,
        level: 70,
        legendaryLevel: 0,
        point: 1,
        rank: 1,
        realPlayerId,
        playerName: `P${realPlayerId}`,
        allianceName: '',
      });
      const codes = (sandbox.backend as any).readPlayerIdCodes();
      const body = sandbox.backend.getDiscordApiMessageBody(
        'Outer Realms',
        2,
        1,
        [player('WLD1', 11), player('DE1', 12)],
        codes,
      );
      const description = body.embeds[0].description ?? '';
      assert.ok(description.includes('/player/11606)'), 'WLD1 is E4K_WORLD1, code 606');
      assert.ok(!description.includes('/player/12'), 'E4K_DE1 is not public, so it gets no link');
    });
  });
});
