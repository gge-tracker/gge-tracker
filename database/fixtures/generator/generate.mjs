import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { lootWeekStart, parseLootReset } from '../../../gge-tracker-backend-api/src/api/helper/loot-reset.ts';
import { assignCastleIds, bridgeRecord } from './bridge-data.mjs';
import { buildChanges, hourIndexOf } from './changes.mjs';
import {
  writeDailyGames,
  writeGlobalPlayers,
  writeGrandTournament,
  writeLiveOuterRealms,
  writeRiftRaid,
  writeTemporaryServerEvents,
} from './cross-server.mjs';
import { CsvWriter, clickHouseDateTime, sqlTimestamp, sqlTimestampTz } from './csv-writer.mjs';
import { Dataset, writeRows } from './dataset.mjs';
import { writeDungeons, writeStorms } from './map-features.mjs';
import { NameForge } from './names.mjs';
import { Random } from './random.mjs';
import { readGlobalDefinition, readServerDefinition } from './server-definition.mjs';
import { RANKED_EVENTS, writeAquamarineMetrics, writeRankedEvents, writeWheelOfAffluence } from './server-events.mjs';
import { HourlyTotals, buildTimeline, growingSeries, weeklyLootSeries } from './series.mjs';
import { buildWorld } from './world.mjs';

const EVENT_HOST = 'FR1';
const GLORY_MIGRATION = [['player-glory-history.clickhouse.sql', 'player_glory_history']];

const { values: options } = parseArgs({
  options: {
    servers: { type: 'string' },
    players: { type: 'string', default: '2000' },
    days: { type: 'string', default: '14' },
    seed: { type: 'string', default: '1' },
    anchor: { type: 'string', default: 'now' },
    mode: { type: 'string', default: 'merge' },
    'servers-file': { type: 'string' },
    'schema-dir': { type: 'string' },
    'migrations-dir': { type: 'string' },
    out: { type: 'string' },
  },
});

const usage = () => {
  console.error(
    'usage: generate.mjs --servers FR1[,INT1] [--players 2000|FR1=2000,INT1=300] [--days 14] [--seed 1] [--anchor now|ISO] [--mode merge|full]\n' +
      '                    --servers-file F --schema-dir D --migrations-dir M --out O',
  );
  process.exit(2);
};

const serverNames = (options.servers || '').split(',').map((name) => name.trim()).filter(Boolean);
const days = Number(options.days);
const now = options.anchor === 'now' ? Date.now() : Date.parse(options.anchor);
if (serverNames.length === 0 || !Number.isInteger(days) || days < 1 || Number.isNaN(now) || !['merge', 'full'].includes(options.mode)) usage();

const playersFor = (name) => {
  const perServer = Object.fromEntries(
    options.players.split(',').filter((part) => part.includes('=')).map((part) => part.split('=').map((value) => value.trim())),
  );
  const count = Number(perServer[name] ?? (options.players.includes('=') ? 2000 : options.players));
  if (!Number.isInteger(count) || count < 20) usage();
  return count;
};

const seedFor = (label) =>
  [...label].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0, (Number(options.seed) * 2_654_435_761) >>> 0);

const dataset = new Dataset(options.out, options['schema-dir'], options['migrations-dir']);
const timeline = buildTimeline(now, days);
const generated = [];
for (const name of serverNames) {
  generated.push(await generateServer(readServerDefinition(options['servers-file'], name), playersFor(name)));
}

const crossRandom = new Random(seedFor('cross-server'));
const host = generated.find(({ server }) => server.name === EVENT_HOST);
if (host) await writeTemporaryServerEvents(crossRandom, dataset, host.server, generated, now);

if (options.mode === 'full') {
  const global = readGlobalDefinition(options['servers-file']);
  dataset.postgresSchema(global.sql, 'global');
  dataset.clickhouseSchema(global.olap, 'global', 'ggetracker_global');
  dataset.clickhouseSchema('logs', 'logs', 'logs');
  await writeGlobalPlayers(
    { players: dataset.postgres(global.sql, 'global_players'), ranking: dataset.postgres(global.sql, 'global_ranking') },
    generated,
    now,
  );
  await writeDailyGames(crossRandom, dataset.postgres(global.sql, 'mini_games'), generated, now, days, true);
  await writeGrandTournament(crossRandom, dataset, global.sql, generated, now);
  await writeLiveOuterRealms(crossRandom, dataset, global.olap, generated, now);
  await writeRiftRaid(crossRandom, dataset, global.olap, generated, now);
} else {
  dataset.file('shared/target', generated.map(({ server }) => `${server.name} ${server.globalName}`).join('\n') + '\n');
  await writeGlobalPlayers({ players: dataset.shared('global_players'), ranking: dataset.shared('global_ranking') }, generated, now);
  await writeDailyGames(crossRandom, dataset.shared('mini_games'), generated, now, days, false);
}

dataset.file(
  'manifest.txt',
  [
    `anchor=${new Date(now).toISOString()} days=${days} seed=${options.seed} mode=${options.mode}`,
    ...generated.map(
      ({ server, world }) => `server=${server.name} sql=${server.sql} olap=${server.olap} players=${world.players.length} alliances=${world.alliances.length}`,
    ),
  ].join('\n') + '\n',
);
for (const { server, world } of generated) {
  console.log(`  generated ${server.name}: ${world.players.length} players, ${world.alliances.length} alliances, ${days} days of hourly history`);
}

async function generateServer(server, playerCount) {
  const reset = parseLootReset(server.resetTimezone, server.resetTime);
  if (!reset) throw new Error(`${server.name} declares an unreadable reset: ${server.resetTimezone} ${server.resetTime}`);
  const random = new Random(seedFor(server.name));
  const names = new NameForge(random);
  const world = buildWorld(random, names, playerCount);
  assignCastleIds(world);
  const changes = buildChanges(random, names, world, timeline);
  dataset.postgresSchema(server.sql, 'server');
  dataset.clickhouseSchema(server.olap, 'server', 'empire_ranking', GLORY_MIGRATION);

  const totals = await writeHistories(random, server, world, reset);
  const eventHours = await writeRankedEvents(random, dataset, server, world, timeline);
  await writeStatistics(server, world, changes, totals, eventHours);
  await writePlayers(server, world);
  await writeRows(
    dataset.postgres(server.sql, 'alliances'),
    world.alliances.map((alliance) => [alliance.id, alliance.name, null, null, null, null, alliance.description]),
  );
  await writeChanges(server, changes);
  await writeServerState(server);
  await writeWheelOfAffluence(random, dataset, server, world, timeline);
  if (server.hasStorms) {
    await writeStorms(random, dataset, server, world, now);
    await writeAquamarineMetrics(random, dataset, server, world, timeline);
  }
  if (server.hasDungeons) await writeDungeons(random, dataset, server, world, now);
  dataset.file(join('bridge', `${server.zone}.json`), JSON.stringify(bridgeRecord(random, server, world)));
  return { server, world };
}

async function writeHistories(random, server, world, reset) {
  const might = dataset.clickhouse(server.olap, 'player_might_history');
  const loot = dataset.clickhouse(server.olap, 'player_loot_history');
  const glory = dataset.clickhouse(server.olap, 'player_glory_history');
  const stamps = timeline.map(clickHouseDateTime);
  const weekStarts = timeline.map((instant) => lootWeekStart(instant, reset));
  const totals = new HourlyTotals(timeline.length);
  for (const player of world.players) {
    const mightSeries = growingSeries(random, player.might, timeline.length, player.active, 0.25);
    const glorySeries = growingSeries(random, player.fame, timeline.length, player.active, 0.1);
    const lootSeries = weeklyLootSeries(random, player.lootPace, timeline, weekStarts);
    player.mightAllTime = Math.max(...mightSeries) + Math.round(player.might * random.between(0, 0.1));
    player.loot = lootSeries.at(-1);
    player.lootAllTime = Math.max(...lootSeries, Math.round(player.lootPace * 60 * random.between(0.8, 1.6)));
    player.highestFame = Math.max(player.highestFame, ...glorySeries);
    for (let index = 0; index < timeline.length; index++) {
      await might.write([player.id, mightSeries[index], stamps[index]]);
      await glory.write([player.id, glorySeries[index], stamps[index]]);
      if (player.lootPace > 0) await loot.write([player.id, lootSeries[index], stamps[index]]);
    }
    totals.add(player.id, mightSeries, lootSeries);
  }
  await Promise.all([might.close(), loot.close(), glory.close()]);
  return totals;
}

async function writePlayers(server, world) {
  const updatedAt = sqlTimestamp(timeline.at(-1) + 150_000);
  await writeRows(
    dataset.postgres(server.sql, 'players'),
    world.players.map((player) => [
      player.id, player.name, player.allianceId, player.might, player.mightAllTime, player.loot, player.lootAllTime,
      player.level, player.legendaryLevel, player.highestFame, player.fame, 0,
      player.castles.length > 0 ? player.castles : null, player.realmCastles.length > 0 ? player.realmCastles : null,
      player.honor, player.maxHonor, player.peaceSeconds, updatedAt,
      player.peaceDisabledDaysAgo === null ? null : sqlTimestampTz(now - player.peaceDisabledDaysAgo * 86_400_000),
      player.allianceId === null ? null : player.allianceRank,
    ]),
  );
}

async function writeChanges(server, changes) {
  const table = (name, events, toRow) =>
    writeRows(dataset.postgres(server.sql, name), [...events].sort((a, b) => a.at - b.at).map((event, index) => toRow(event, index + 1)));
  await table('player_alliance_update', changes.allianceMoves, (event, id) => [
    id, event.playerId, event.oldAllianceId, event.newAllianceId, sqlTimestamp(event.at), event.oldAllianceName, event.newAllianceName,
  ]);
  await table('player_name_update_history', changes.playerRenames, (event, id) => [id, event.playerId, event.oldName, event.newName, sqlTimestamp(event.at)]);
  await table('alliance_update_history', changes.allianceRenames, (event, id) => [id, event.allianceId, event.oldName, event.newName, sqlTimestamp(event.at)]);
  await table('alliance_description_history', changes.allianceDescriptions, (event, id) => [
    id, event.allianceId, event.oldDescription, event.newDescription, sqlTimestamp(event.at),
  ]);
  await table('player_castle_movements_history', changes.castleMovements, (event, id) => [
    id, event.playerId, event.castleType, event.movementType, event.oldX, event.oldY, event.newX, event.newY, sqlTimestamp(event.at),
  ]);
}

async function writeStatistics(server, world, changes, totals, eventHours) {
  const count = world.players.length;
  const honor = world.players.reduce((sum, player) => sum + player.honor, 0);
  const level = world.players.reduce((sum, player) => sum + player.level, 0);
  const inPeace = world.players.filter((player) => player.peaceSeconds > 0).length;
  const allianceCount = world.alliances.filter((alliance) => alliance.members.length > 0).length;
  const perHour = (events) => {
    const counts = new Array(timeline.length).fill(0);
    for (const event of events) counts[hourIndexOf(timeline, event.at)]++;
    return counts;
  };
  const [allianceMoves, playerRenames, allianceRenames] = [changes.allianceMoves, changes.playerRenames, changes.allianceRenames].map(perHour);
  const byKey = Object.fromEntries(RANKED_EVENTS.map((event) => [event.key, event]));
  const writer = new CsvWriter(join(options.out, 'postgres', server.sql, 'server_statistics.csv.gz'));
  for (let hour = 0; hour < timeline.length; hour++) {
    const previous = Math.max(0, hour - 1);
    const slot = (key) => eventHours.at(byKey[key], hour);
    const top = {};
    const participation = {};
    for (const event of RANKED_EVENTS) {
      const running = slot(event.key);
      if (!running) continue;
      top[event.lt] = [...running.top].sort((a, b) => b.point - a.point);
      participation[event.lt] = [running.players, running.players / count];
    }
    const points = (key) => slot(key)?.points ?? 0;
    const players = (key) => slot(key)?.players ?? 0;
    await writer.write([
      hour + 1, totals.might[hour] / count, totals.loot[hour] / count, honor / count, level / count,
      totals.maxMight[hour], totals.maxMightPlayer[hour], totals.maxLootPlayer[hour], totals.maxLoot[hour],
      count, allianceCount, inPeace, allianceMoves[hour], playerRenames[hour],
      totals.might[hour], totals.loot[hour], honor,
      totals.might[hour] - totals.might[previous], totals.loot[hour] - totals.loot[previous], 0,
      allianceRenames[hour], Object.keys(top).length, JSON.stringify(top), JSON.stringify(participation),
      points('nomad'), points('war_realms'), points('bloodcrow'), points('samurai'), null, points('berimond_kingdom'),
      players('nomad'), null, players('berimond_kingdom'), players('bloodcrow'), players('samurai'), players('war_realms'),
      sqlTimestamp(timeline[hour] + 180_000),
    ]);
  }
  await writer.close();
}

async function writeServerState(server) {
  const stamp = (offsetSeconds) => sqlTimestamp(timeline.at(-1) + offsetSeconds * 1000);
  await writeRows(dataset.postgres(server.sql, 'parameters'), [
    [1, 'is_currently_updating', 0, stamp(240)],
    [2, 'loot', 1, stamp(0)],
    [3, 'war_realms', 1, stamp(12)],
    [4, 'samurai', 1, stamp(16)],
    [5, 'berimond_invasion', null, stamp(20)],
    [6, 'berimond_kingdom', 1, stamp(30)],
    [7, 'bloodcrow', 1, stamp(34)],
    [8, 'nomad', 1, stamp(38)],
    [9, 'might', 1, stamp(95)],
    [10, 'duration', 240, stamp(240)],
  ]);
  if (!server.hasStorms) return;
  const month = new Date(now);
  const seasonStart = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1, 0, 30);
  await writeRows(dataset.postgres(server.sql, 'storm_meta'), [['t', sqlTimestampTz(seasonStart), 151, sqlTimestampTz(now)]]);
}
