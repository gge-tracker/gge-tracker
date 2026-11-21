import { writeRows } from './dataset.mjs';
import { sqlTimestamp, sqlTimestampTz } from './csv-writer.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DUNGEON_KINGDOMS = [1, 2, 3];
const DUNGEON_RADIUS = 30;
const STORM_AREA = { min: 493, max: 792 };
const ISLE_TYPES = [1, 2, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
const FORT_TYPES = [7, 8, 9, 10, 10, 10, 10, 10, 10, 11, 11, 11, 12, 13, 14];

export async function writeDungeons(random, dataset, server, world, now) {
  const dungeons = [];
  const history = [];
  const cooldowns = new Map();
  for (const kingdom of DUNGEON_KINGDOMS) {
    const castles = world.players.flatMap((player) =>
      player.realmCastles.filter((castle) => castle[0] === kingdom).map((castle) => ({ player, x: castle[1], y: castle[2] })),
    );
    const taken = new Set(castles.map((castle) => castle.x * 2000 + castle.y));
    for (const anchor of castles) {
      if (!random.chance(0.7)) continue;
      const offset = () => Math.max(-DUNGEON_RADIUS, Math.min(DUNGEON_RADIUS, Math.round(random.gaussian(0, DUNGEON_RADIUS / 2))));
      const x = anchor.x + offset();
      const y = anchor.y + offset();
      if (x < 0 || y < 0 || x > 1286 || y > 1286 || taken.has(x * 2000 + y)) continue;
      taken.add(x * 2000 + y);
      const neighbours = castles.filter((castle) => Math.abs(castle.x - x) <= DUNGEON_RADIUS && Math.abs(castle.y - y) <= DUNGEON_RADIUS);
      const attacks = Array.from({ length: random.integer(0, 40) }, () => now - random.next() * 30 * DAY).sort((a, b) => a - b);
      for (const attackedAt of attacks) {
        const attacker = random.pick(neighbours).player;
        history.push([kingdom, x, y, attacker.id, attackedAt]);
        cooldowns.set(`${kingdom}:${x}:${y}:${attacker.id}`, [kingdom, x, y, attacker.id, attackedAt + random.between(12, 120) * HOUR]);
      }
      const lastAttack = attacks.at(-1);
      const availableAt = lastAttack === undefined ? now - random.between(1, 10) * DAY : lastAttack + random.between(1, 6) * HOUR;
      dungeons.push([kingdom, x, y, sqlTimestamp(availableAt)]);
    }
  }
  await writeRows(dataset.postgres(server.sql, 'dungeons'), dungeons);
  history.sort((a, b) => a[4] - b[4]);
  await writeRows(dataset.postgres(server.sql, 'dungeons_history'), history.map((row, index) => [index + 1, ...row.slice(0, 4), sqlTimestamp(row[4])]));
  await writeRows(
    dataset.postgres(server.sql, 'dungeon_player_cooldowns'),
    [...cooldowns.values()].map((row) => [...row.slice(0, 4), sqlTimestamp(row[4])]),
  );
}

export async function writeStorms(random, dataset, server, world, now) {
  const taken = new Set();
  const spot = () => {
    for (;;) {
      const x = random.integer(STORM_AREA.min, STORM_AREA.max);
      const y = random.integer(STORM_AREA.min, STORM_AREA.max);
      if (!taken.has(x * 2000 + y)) {
        taken.add(x * 2000 + y);
        return [x, y];
      }
    }
  };
  const updatedAt = sqlTimestampTz(now - 60_000);
  const entrants = random.shuffle(world.players.filter((player) => player.realmCastles.some((castle) => castle[0] === 4)));
  const count = Math.max(100, Math.round(world.players.length * 0.3));
  const objectIds = random.uniqueIntegers(count, 1000, 999_999);
  const isles = objectIds.map((objectId, index) => {
    const occupier = index < entrants.length * 0.6 ? entrants[index] : null;
    const state = occupier ? 1 : random.pick([0, 2]);
    const availableAt = state === 2 ? now + random.between(0.2, 12) * HOUR : now - random.between(1, 72) * HOUR;
    return [...spot(), objectId, random.pick(ISLE_TYPES), occupier?.id ?? null, state, sqlTimestampTz(availableAt), updatedAt];
  });
  const forts = Array.from({ length: count }, () => {
    const onTimer = random.chance(0.3);
    const availableAt = onTimer ? now + random.between(0.2, 8) * HOUR : now - random.between(1, 48) * HOUR;
    return [...spot(), random.pick(FORT_TYPES), random.integer(0, 9), random.chance(0.75), sqlTimestampTz(availableAt), updatedAt];
  });
  await writeRows(dataset.postgres(server.sql, 'storm_isles'), isles);
  await writeRows(dataset.postgres(server.sql, 'storm_forts'), forts);
}
