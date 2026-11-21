import { writeRows } from './dataset.mjs';
import { clickHouseDateTime, sqlTimestamp, sqlTimestampTz } from './csv-writer.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const EVENT_HISTORY_DAYS = 180;

const everyone = (generated) =>
  generated.flatMap(({ server, world }) => {
    const allianceNames = new Map(world.alliances.map((alliance) => [alliance.id, alliance.name]));
    return world.players.map((player) => ({ server, player, allianceName: allianceNames.get(player.allianceId) ?? null }));
  });

function eventDates(now, weekdays, everyOtherWeek) {
  const dates = [];
  for (let day = Math.floor(now / DAY) * DAY - EVENT_HISTORY_DAYS * DAY; day <= now; day += DAY) {
    const date = new Date(day);
    const week = Math.floor(day / (7 * DAY));
    if (!weekdays.includes(date.getUTCDay()) || (everyOtherWeek && week % 2 === 1)) continue;
    if (day + 13 * HOUR <= now) dates.push(day + 13 * HOUR);
  }
  return dates;
}

export async function writeTemporaryServerEvents(random, dataset, host, generated, now) {
  const players = everyone(generated).filter(({ player }) => player.castles.length > 0);
  const kinds = [
    { prefix: 'outer_realms', dates: eventDates(now, [1, 4], false), maxRows: 2000, scale: [16_000, 650_000], nameLength: 30 },
    { prefix: 'beyond_the_horizon', dates: eventDates(now, [1], true), maxRows: 2000, scale: [1e6, 1.9e8], nameLength: 40 },
  ];
  let lastOuterRealms = null;
  for (const kind of kinds) {
    const events = [];
    const ranking = [];
    for (const [index, collectDate] of kind.dates.entries()) {
      const entrants = players
        .filter(() => random.chance(0.35))
        .map((entry) => ({ ...entry, point: Math.round(random.between(...kind.scale) * Math.pow(random.next(), 2.5)) }))
        .sort((a, b) => b.point - a.point)
        .slice(0, kind.maxRows);
      if (entrants.length === 0) continue;
      const eventNum = index + 1;
      events.push([eventNum, sqlTimestamp(collectDate), 5, 1, entrants[0].player.id, entrants[0].point, sqlTimestamp(collectDate + 25)]);
      entrants.forEach((entry, rank) =>
        ranking.push([
          ranking.length + 1, eventNum, entry.player.id, entry.server.name, entry.player.level, entry.player.legendaryLevel,
          entry.point, rank + 1, entry.player.name, entry.allianceName?.slice(0, kind.nameLength) ?? null,
        ]),
      );
      if (kind.prefix === 'outer_realms') lastOuterRealms = { collectDate, entrants };
    }
    await writeRows(dataset.postgres(host.sql, `${kind.prefix}_event`), events);
    await writeRows(dataset.postgres(host.sql, `${kind.prefix}_ranking`), ranking);
  }
  return lastOuterRealms;
}

export async function writeLiveOuterRealms(random, dataset, globalOlap, generated, now) {
  const entrants = everyone(generated).filter(({ player }) => player.castles.length > 0 && random.chance(0.35));
  const finals = new Map(entrants.map((entry) => [entry, Math.round(random.between(16_000, 650_000) * Math.pow(random.next(), 2.5))]));
  const rows = [];
  for (let snapshot = 11; snapshot >= 0; snapshot--) {
    const fetchDate = Math.floor(now / HOUR) * HOUR - snapshot * HOUR + 55 * 60_000;
    if (fetchDate > now) continue;
    const progress = (12 - snapshot) / 12;
    const scored = entrants
      .map((entry) => ({ entry, score: Math.round(finals.get(entry) * progress) }))
      .sort((a, b) => b.score - a.score);
    scored.forEach(({ entry, score }, rank) => {
      const main = entry.player.castles.find((castle) => castle[2] === 1);
      rows.push([
        entry.player.id, entry.player.name, entry.server.name, score, rank + 1, entry.player.level, entry.player.legendaryLevel,
        Math.min(entry.player.might, 4_294_967_295), main?.[0] ?? null, main?.[1] ?? null, clickHouseDateTime(fetchDate), entry.player.name.toLowerCase(),
      ]);
    });
  }
  await writeRows(dataset.clickhouse(globalOlap, 'outer_realms_ranking'), rows);
}

function allianceStandings(random, generated, game, snapshotTimes, divisionSize) {
  const alliances = generated
    .filter(({ server }) => server.game === game)
    .flatMap(({ server, world }) =>
      world.alliances
        .filter((alliance) => alliance.members.length > 0)
        .map((alliance) => ({ server, alliance, strength: alliance.members.reduce((sum, member) => sum + member.might, 0) })),
    )
    .sort((a, b) => b.strength - a.strength);
  const placed = alliances.map((entry, index) => ({
    ...entry,
    division: Math.min(6, 1 + Math.floor(index / (divisionSize * 4))),
    subdivision: 1 + (Math.floor(index / divisionSize) % 4),
    pace: Math.pow(entry.strength / 1e6, 0.6) * random.between(0.3, 2),
  }));
  return snapshotTimes.flatMap((instant, index) => {
    const groups = Map.groupBy(placed, (entry) => `${entry.division}:${entry.subdivision}`);
    return [...groups.values()].flatMap((group) =>
      group
        .map((entry) => ({ entry, score: Math.round(entry.pace * 1000 * (index + 1)) }))
        .sort((a, b) => b.score - a.score)
        .map(({ entry, score }, rank) => ({ ...entry, score, rank: rank + 1, instant })),
    );
  });
}

export async function writeGrandTournament(random, dataset, globalSql, generated, now) {
  const start = Math.floor(now / HOUR) * HOUR - 3 * DAY;
  const hours = Array.from({ length: 48 }, (_, index) => start + index * HOUR + 45 * 60_000);
  const rows = [];
  const hourRows = new Set();
  for (const game of ['ep', 'e4k']) {
    for (const standing of allianceStandings(random, generated, game, hours, 25)) {
      rows.push([
        standing.server.serverId, standing.division, standing.subdivision, standing.alliance.id, standing.alliance.name.slice(0, 40),
        sqlTimestamp(standing.instant), standing.rank, standing.score, 1, game,
      ]);
      hourRows.add(`${game}|1|${sqlTimestamp(Math.floor(standing.instant / HOUR) * HOUR)}`);
    }
  }
  await writeRows(dataset.postgres(globalSql, 'grand_tournament'), rows);
  await writeRows(dataset.postgres(globalSql, 'grand_tournament_hours_mv'), [...hourRows].map((row) => row.split('|')));
}

export async function writeRiftRaid(random, dataset, globalOlap, generated, now) {
  const start = Math.floor(now / HOUR) * HOUR - 5 * DAY;
  const hours = [0, 1, 2, 3].map((offset) => start + offset * HOUR);
  const rows = [];
  const hourRows = [];
  for (const game of ['ep', 'e4k']) {
    const standings = allianceStandings(random, generated, game, hours, 12);
    for (const standing of standings) {
      rows.push([
        game, 1, clickHouseDateTime(standing.instant + 36 * 60_000), standing.division, standing.subdivision, standing.rank,
        standing.server.serverId, standing.alliance.id, standing.alliance.name, standing.score * 1000,
      ]);
    }
    if (standings.length > 0) hours.forEach((hour) => hourRows.push([game, 1, clickHouseDateTime(hour)]));
  }
  await writeRows(dataset.clickhouse(globalOlap, 'rift_raid_ranking'), rows);
  await writeRows(dataset.clickhouse(globalOlap, 'rift_raid_hours'), hourRows);
}

export async function writeGlobalPlayers(writers, generated, now) {
  const all = everyone(generated).sort((a, b) => b.player.might - a.player.might);
  for (const [rank, { server, player, allianceName }] of all.entries()) {
    await writers.players.write([
      server.globalName, player.id, player.might, player.name, player.allianceId, allianceName,
      player.allianceId === null ? null : player.allianceRank, player.level, player.legendaryLevel, player.mightAllTime,
      player.loot, player.lootAllTime, player.fame, player.highestFame, player.honor, player.maxHonor,
      player.peaceDisabledDaysAgo === null ? null : sqlTimestampTz(now - player.peaceDisabledDaysAgo * DAY),
      player.castles.length > 0,
    ]);
    await writers.ranking.write([server.globalName, player.id, rank + 1]);
  }
  await writers.players.close();
  await writers.ranking.close();
}

// One game a day per server, picked the way the route picks one, so the route never has to create it
export async function writeDailyGames(random, writer, generated, now, days, withId) {
  let id = 0;
  for (const { server, world } of generated) {
    const eligible = world.players.filter(
      (player) => player.castles.length > 0 && player.might >= 1_000_000 && player.level >= 70 && player.fame >= 10_000_000,
    );
    if (eligible.length === 0) continue;
    for (let day = days - 1; day >= 0; day--) {
      const date = new Date(now - day * DAY).toISOString().slice(0, 10);
      const player = random.pick(eligible);
      const main = player.castles.find((castle) => castle[2] === 1);
      const level = () => random.integer(3, 10);
      const row = [
        date, server.name, player.id, player.mainCastleId, main[0], main[1], player.castles.length, null, null,
        level(), level(), level(), level(), `${player.name.slice(0, 14)} Keep`, player.allianceId === null ? null : player.allianceRank,
        player.honor, null, null, player.peaceSeconds > 0, player.level, player.legendaryLevel,
        sqlTimestampTz(Date.parse(`${date}T00:05:00Z`)), player.might, player.fame, player.name.slice(0, 30),
      ];
      await writer.write(withId ? [++id, ...row] : row);
    }
  }
  await writer.close();
}
