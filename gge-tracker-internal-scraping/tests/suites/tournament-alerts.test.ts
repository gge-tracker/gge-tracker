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

import { flushDiscordPosts, nextPostingMark } from '../../src/discord-schedule';
import { resultsEmbed } from '../../src/tournament-alerts';
import { ApiRequest } from '../harness/fake-api';
import { Sandbox, withSandbox } from '../harness/sandbox';

const BOT_API = 'http://discord.test/api';
const EP_EVENTS = '100000001';
const E4K_EVENTS = '100000002';
const EP_RESULTS = '100000003';
const E4K_RESULTS = '100000004';
const HOUR = 3600;

const SERVERS_FILE = join(mkdtempSync(join(tmpdir(), 'tournament-alerts-')), 'servers.xml');
writeFileSync(
  SERVERS_FILE,
  `<root><servers>
    <server><name>DE1</name><kind>ep</kind><zone>EmpireEx</zone></server>
    <server><name>FR1</name><kind>ep</kind><zone>EmpireEx_3</zone></server>
    <server><name>E4K_DE1</name><kind>e4k</kind><zone>EmpirefourkingdomsExGG</zone></server>
    <server><name>E4K_FR1</name><kind>e4k</kind><zone>EmpirefourkingdomsExGG_3</zone></server>
  </servers></root>`,
);

const ALERTS_ON = {
  env: {
    DISCORD_EP_TOURNAMENT_EVENTS_CHANNEL_ID: EP_EVENTS,
    DISCORD_E4K_TOURNAMENT_EVENTS_CHANNEL_ID: E4K_EVENTS,
    DISCORD_EP_TOURNAMENT_RESULTS_CHANNEL_ID: EP_RESULTS,
    DISCORD_E4K_TOURNAMENT_RESULTS_CHANNEL_ID: E4K_RESULTS,
    SERVERS_FILE,
  },
};

const RIFT_HOURS = /FROM rift_raid_hours/;
const RIFT_STANDINGS = /FROM rift_raid_ranking[\s\S]*LIMIT 3 BY division_id/;
const GT_LAST_EVENT = /SELECT event_id, created_at FROM grand_tournament/;
const GT_HOURS = /FROM grand_tournament_hours_mv/;
const GT_STANDINGS = /ROW_NUMBER\(\) OVER \(PARTITION BY division_id/;
const GT_INSERT = /INSERT INTO grand_tournament/;

function botPosts(sandbox: Sandbox): any[] {
  return sandbox.outbound.filter((call) => call.url === BOT_API).map((call) => call.body);
}

function posts(sandbox: Sandbox, channelId: string): any[] {
  return botPosts(sandbox).filter((body) => body.channelId === channelId);
}

function hoursAgo(sandbox: Sandbox, hours: number): Date {
  return new Date(sandbox.now.getTime() - hours * HOUR * 1000);
}

function hourText(date: Date): string {
  return date.toISOString().slice(0, 13).replace('T', ' ') + ':00:00';
}

function lastRiftRaidHour(sandbox: Sandbox, eventId: number, lastAgo: number): void {
  const last = hoursAgo(sandbox, lastAgo);
  sandbox.clickhouse.when(RIFT_HOURS, [
    { event_id: eventId, last_seen: Math.floor(last.getTime() / 1000), last_hour: hourText(last) },
  ]);
}

function lastGrandTournamentHour(sandbox: Sandbox, eventId: number, lastAgo: number): void {
  const hour = new Date(Math.floor(hoursAgo(sandbox, lastAgo).getTime() / (HOUR * 1000)) * HOUR * 1000);
  sandbox.db.when(GT_HOURS, { rows: [{ event_id: eventId, last_hour: hour }] });
}

function serveRiftRaid(sandbox: Sandbox): void {
  sandbox.api.on('llsp', (request: ApiRequest) => {
    const lid = Number(request.parameters.LID);
    if (Number(request.parameters.SDI) > 1) return { return_code: 0, content: { L: [], T: 0 } };
    const entries = [0, 1].map((index) => ({
      SI: `12-1-3-${lid * 100 + index}`,
      I: 3,
      A: `A${lid}-${index}`,
      R: index + 1,
      S: 9 - index,
    }));
    return { return_code: 0, content: { L: entries, T: entries.length } };
  });
}

function serveEndedRiftRaid(sandbox: Sandbox): void {
  sandbox.api.on('llsp', () => ({ return_code: 0, content: { L: [], T: 0 } }));
}

function serveGrandTournament(sandbox: Sandbox, answer?: Record<string, unknown>): void {
  sandbox.api.on('llsp', (request: ApiRequest) => {
    if (answer) return answer;
    const lid = Number(request.parameters.LID);
    if (Number(request.parameters.SDI) > 1) return { content: {} };
    return { content: { L: [{ SI: `s-1-${lid}`, I: 3, A: `G${lid}`, R: 1, S: 100 }] } };
  });
}

async function runRiftRaid(sandbox: Sandbox, game: 'ep' | 'e4k'): Promise<void> {
  await sandbox.call('fillRiftRaidResults', game);
  await flushDiscordPosts();
}

async function runGrandTournament(sandbox: Sandbox, game: 'ep' | 'e4k'): Promise<void> {
  await sandbox.call('fillGrandTournamentResults', game);
  await flushDiscordPosts();
}

describe('posting time', () => {
  it('rounds up to the next five minutes', () => {
    assert.equal(nextPostingMark(new Date('2026-11-09T09:03:10Z')).toISOString(), '2026-11-09T09:05:00.000Z');
    assert.equal(nextPostingMark(new Date('2026-11-09T09:57:00Z')).toISOString(), '2026-11-09T10:00:00.000Z');
  });

  it('keeps a time already on the mark', () => {
    assert.equal(nextPostingMark(new Date('2026-11-09T09:05:00Z')).toISOString(), '2026-11-09T09:05:00.000Z');
  });

  it('stamps the message with the minute it is posted at', async () => {
    await withSandbox({ ...ALERTS_ON, now: new Date('2026-08-29T12:43:20Z') }, async (sandbox) => {
      lastRiftRaidHour(sandbox, 7, 100);
      serveRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'ep');
      assert.equal(posts(sandbox, EP_EVENTS)[0].embeds[0].timestamp, '2026-08-29T12:45:00.000Z');
    });
  });
});

describe('tournament start', () => {
  it('posts the EP start to the EP channel only', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastRiftRaidHour(sandbox, 7, 100);
      serveRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'ep');
      const sent = botPosts(sandbox);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].channelId, EP_EVENTS);
      const [embed] = sent[0].embeds;
      assert.equal(embed.title, ':trophy: The Rift Tournament has begun');
      assert.match(embed.description, /open on Goodgame Empire\./);
      assert.doesNotMatch(JSON.stringify(sent[0]), /Four Kingdoms|e4k/);
      assert.equal(embed.url, 'https://gge-tracker.com/rift-raid?utm_source=discord');
      assert.ok(
        embed.description.includes(`[Follow the Rift Tournament](${embed.url})`),
        'the text carries the link behind a label',
      );
    });
  });

  it('posts the E4K start to the E4K channel only', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastRiftRaidHour(sandbox, 3, 100);
      serveRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'e4k');
      const sent = botPosts(sandbox);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].channelId, E4K_EVENTS);
      assert.match(sent[0].embeds[0].description, /open on Empire: Four Kingdoms\./);
      assert.equal(sent[0].embeds[0].url, 'https://gge-tracker.com/rift-raid?utm_source=discord');
    });
  });

  it('stays silent while the event keeps running', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastRiftRaidHour(sandbox, 8, 1);
      serveRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'ep');
      assert.deepEqual(botPosts(sandbox), []);
    });
  });

  it('stays silent on the first event ever collected, which may have started long ago', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      serveRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'ep');
      assert.deepEqual(botPosts(sandbox), []);
    });
  });

  it('posts nothing for a game whose start channel is not set', async () => {
    const env = { ...ALERTS_ON.env, DISCORD_E4K_TOURNAMENT_EVENTS_CHANNEL_ID: undefined };
    await withSandbox({ env }, async (sandbox) => {
      lastRiftRaidHour(sandbox, 3, 100);
      serveRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'e4k');
      assert.deepEqual(botPosts(sandbox), []);
    });
  });

  it('posts the Grand Tournament start of its own game', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      sandbox.db.when(GT_LAST_EVENT, { rows: [{ event_id: 2, created_at: hoursAgo(sandbox, 500) }] });
      serveGrandTournament(sandbox);
      await runGrandTournament(sandbox, 'e4k');
      const [message] = posts(sandbox, E4K_EVENTS);
      assert.equal(message.embeds[0].title, ':trophy: The Grand Tournament has begun');
      assert.equal(message.embeds[0].url, 'https://gge-tracker.com/grand-tournament?utm_source=discord');
      assert.deepEqual(posts(sandbox, EP_EVENTS), []);
    });
  });

  it('waits for a run that stored the Grand Tournament, so a failed insert never announces it twice', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      sandbox.db.when(GT_LAST_EVENT, { rows: [{ event_id: 13, created_at: hoursAgo(sandbox, 500) }] });
      sandbox.db.when(GT_INSERT, { error: new Error('connection terminated') });
      serveGrandTournament(sandbox);
      await runGrandTournament(sandbox, 'ep');
      assert.deepEqual(botPosts(sandbox), []);
    });
  });
});

describe('tournament results', () => {
  it('posts the final standings of the event that ended in the previous hour', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastRiftRaidHour(sandbox, 3, 1);
      sandbox.clickhouse.when(RIFT_STANDINGS, [
        { division_id: 6, alliance_name: 'Second_one', server_id: 3, score: '300', read_at: '2026-08-29 11:45:31' },
        { division_id: 6, alliance_name: 'Winners', server_id: 1, score: '500', read_at: '2026-08-29 11:45:31' },
        { division_id: 5, alliance_name: 'Fifth', server_id: 99, score: '50', read_at: '2026-08-29 11:45:31' },
      ]);
      serveEndedRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'ep');
      const sent = botPosts(sandbox);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].channelId, EP_RESULTS);
      assert.equal(sent[0].embeds.length, 1);
      const [embed] = sent[0].embeds;
      assert.equal(embed.title, ':checkered_flag: Rift Tournament results - Goodgame Empire');
      assert.match(embed.description, /<t:\d+:f>/);
      assert.equal(embed.fields[0].name, 'Division 6');
      assert.equal(
        embed.fields[0].value,
        ':first_place: **Winners** (DE1) - 500\n:second_place: **Second\\_one** (FR1) - 300',
      );
      assert.equal(embed.fields[1].value, 'Division 5: **Fifth** - 50');
      assert.equal(embed.url, 'https://gge-tracker.com/rift-raid?utm_source=discord');
      assert.equal(embed.fields[2].value, `:arrow_right: [See the full ranking](${embed.url})`);
      assert.match(sandbox.clickhouse.selects(RIFT_STANDINGS)[0].query, /game = 'ep' AND event_id = 3/);
    });
  });

  it('posts the E4K results to the E4K results channel with E4K server names', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastRiftRaidHour(sandbox, 3, 1);
      sandbox.clickhouse.when(RIFT_STANDINGS, [
        { division_id: 6, alliance_name: 'Kings', server_id: 3, score: '9', read_at: '2026-08-29 11:36:56' },
      ]);
      serveEndedRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'e4k');
      const sent = botPosts(sandbox);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].channelId, E4K_RESULTS);
      assert.equal(sent[0].embeds[0].fields[0].value, ':first_place: **Kings** (FR1) - 9');
      assert.match(sent[0].embeds[0].title, /Empire: Four Kingdoms/);
    });
  });

  it('posts nothing when the event ended more than an hour before this run', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastRiftRaidHour(sandbox, 3, 2);
      serveEndedRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'ep');
      assert.deepEqual(botPosts(sandbox), []);
      assert.deepEqual(sandbox.clickhouse.selects(RIFT_STANDINGS), []);
    });
  });

  it('does not read a game that stopped answering as the end of the event', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastRiftRaidHour(sandbox, 3, 1);
      sandbox.api.on('llsp', () => ({ error: 'Timeout', return_code: -1 }));
      await runRiftRaid(sandbox, 'ep');
      assert.deepEqual(botPosts(sandbox), []);
    });
  });

  it('posts the Grand Tournament results once the game answers an empty ranking', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastGrandTournamentHour(sandbox, 13, 1);
      sandbox.db.when(GT_STANDINGS, {
        rows: [{ division_id: 5, alliance_name: 'Top', server_id: 3, score: 309100, read_at: hoursAgo(sandbox, 1) }],
      });
      serveGrandTournament(sandbox, { content: {} });
      await runGrandTournament(sandbox, 'ep');
      const [message] = posts(sandbox, EP_RESULTS);
      assert.equal(message.embeds[0].title, ':checkered_flag: Grand Tournament results - Goodgame Empire');
      assert.equal(message.embeds[0].fields[0].value, ':first_place: **Top** (FR1) - 309,100');
      assert.deepEqual(sandbox.db.one(GT_STANDINGS).params, ['ep', 13]);
    });
  });

  it('does not read a Grand Tournament timeout as its end', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      lastGrandTournamentHour(sandbox, 13, 1);
      serveGrandTournament(sandbox, { error: 'Timeout', return_code: -1 });
      await runGrandTournament(sandbox, 'ep');
      assert.deepEqual(botPosts(sandbox), []);
      assert.deepEqual(sandbox.db.matching(GT_STANDINGS), []);
    });
  });

  it('keeps the Outer Realms and Beyond the Horizon rankings on their own channel, unchanged', async () => {
    await withSandbox(ALERTS_ON, async (sandbox) => {
      const body = sandbox.backend.getDiscordApiMessageBody('Outer Realms', 1, 1, []);
      assert.equal(body.channelId, '1234567890', 'the tournament channels never take the rankings');
      assert.equal(body.embeds[0].title, 'Outer Realms Leaderboard Update');
      assert.doesNotMatch(JSON.stringify(body), /Goodgame Empire|Four Kingdoms|E4K/);
    });
  });

  it('reads the rankings channel under its new name first', async () => {
    await withSandbox({ env: { DISCORD_EP_OR_BTH_RESULTS_CHANNEL_ID: '200000001' } }, async (sandbox) => {
      assert.equal(sandbox.backend.getDiscordApiMessageBody('Beyond the Horizon', 1, 1, []).channelId, '200000001');
    });
  });
});

describe('alerts switched off', () => {
  it('posts nothing and asks nothing more when no channel is set', async () => {
    await withSandbox({}, async (sandbox) => {
      lastRiftRaidHour(sandbox, 7, 100);
      serveRiftRaid(sandbox);
      await runRiftRaid(sandbox, 'ep');
      assert.deepEqual(botPosts(sandbox), []);
      assert.equal(sandbox.clickhouse.selects(RIFT_HOURS).length, 1, 'only the event lookup the run always made');
    });
  });
});

describe('resultsEmbed', () => {
  it('lists the lower divisions from the highest down', () => {
    const embed = resultsEmbed({
      kind: 'rift-raid',
      game: 'e4k',
      eventId: 1,
      readAt: new Date('2026-11-16T11:36:56Z'),
      standings: [1, 4, 6, 2].map((divisionId) => ({
        divisionId,
        allianceName: `D${divisionId}`,
        server: null,
        score: divisionId,
      })),
    });
    assert.equal(embed.fields[1].value, 'Division 4: **D4** - 4\nDivision 2: **D2** - 2\nDivision 1: **D1** - 1');
  });
});
