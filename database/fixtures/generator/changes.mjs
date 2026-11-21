import { CASTLE_TYPES, MAP_SIZE } from './world.mjs';

const HOUR = 3_600_000;

export function buildChanges(random, names, world, timeline) {
  const randomInstant = () => timeline.at(random.integer(1, timeline.length - 1)) + random.integer(60, 240) * 1000;
  const sortedInstants = (count) => Array.from({ length: count }, randomInstant).sort((a, b) => a - b);
  const allianceRenames = renameAlliances(random, names, world.alliances, sortedInstants);
  const nameAt = allianceNameAt(world.alliances, allianceRenames);
  return {
    allianceRenames,
    allianceDescriptions: describeAlliances(random, names, world.alliances, randomInstant),
    allianceMoves: moveBetweenAlliances(random, world, sortedInstants, nameAt),
    playerRenames: renamePlayers(random, names, world.players, sortedInstants),
    castleMovements: moveCastles(random, world, randomInstant),
  };
}

function renameAlliances(random, names, alliances, sortedInstants) {
  const events = [];
  for (const alliance of alliances) {
    if (!random.chance(0.04)) continue;
    const instants = sortedInstants(random.integer(1, 2));
    const chain = [...instants.map(() => names.alliance()), alliance.name];
    instants.forEach((at, index) => events.push({ allianceId: alliance.id, oldName: chain[index], newName: chain[index + 1], at }));
  }
  return events;
}

function allianceNameAt(alliances, renames) {
  const current = new Map(alliances.map((alliance) => [alliance.id, alliance.name]));
  const byAlliance = Map.groupBy(renames, (event) => event.allianceId);
  return (allianceId, at) => {
    if (allianceId === null) return null;
    const later = (byAlliance.get(allianceId) || []).find((event) => event.at > at);
    return later ? later.oldName : current.get(allianceId);
  };
}

function describeAlliances(random, names, alliances, randomInstant) {
  return alliances
    .filter((alliance) => alliance.description && random.chance(0.08))
    .map((alliance) => ({
      allianceId: alliance.id,
      oldDescription: random.chance(0.5) ? names.description() : null,
      newDescription: alliance.description,
      at: randomInstant(),
    }));
}

function moveBetweenAlliances(random, world, sortedInstants, nameAt) {
  const events = [];
  for (const player of world.players) {
    if (!random.chance(0.12)) continue;
    const instants = sortedInstants(random.integer(1, 3));
    const chain = [player.allianceId];
    for (let index = 0; index < instants.length; index++) {
      const next = chain[0];
      let previous = random.chance(0.25) ? null : random.pick(world.alliances).id;
      if (previous === next) previous = next === null ? random.pick(world.alliances).id : null;
      chain.unshift(previous);
    }
    instants.forEach((at, index) => {
      const [oldAllianceId, newAllianceId] = [chain[index], chain[index + 1]];
      events.push({
        playerId: player.id,
        oldAllianceId,
        newAllianceId,
        oldAllianceName: nameAt(oldAllianceId, at),
        newAllianceName: nameAt(newAllianceId, at),
        at,
      });
    });
  }
  return events;
}

function renamePlayers(random, names, players, sortedInstants) {
  const events = [];
  for (const player of players) {
    if (!random.chance(0.04)) continue;
    const instants = sortedInstants(random.integer(1, 2));
    const chain = [...instants.map(() => names.player()), player.name];
    instants.forEach((at, index) => events.push({ playerId: player.id, oldName: chain[index], newName: chain[index + 1], at }));
  }
  return events;
}

function moveCastles(random, world, randomInstant) {
  const events = [];
  const freeSpot = () => {
    for (;;) {
      const x = random.integer(0, MAP_SIZE);
      const y = random.integer(0, MAP_SIZE);
      if (world.occupancy.isFree(0, x, y)) return [x, y];
    }
  };
  for (const player of world.players) {
    const main = player.castles.find((castle) => castle[2] === CASTLE_TYPES.MAIN_CASTLE);
    if (!main) continue;
    if (random.chance(0.06)) events.push(movement(player, CASTLE_TYPES.MAIN_CASTLE, 'move', freeSpot(), main, randomInstant()));
    for (const castle of player.castles) {
      if (castle[2] === CASTLE_TYPES.MAIN_CASTLE) continue;
      const odds = castle[2] === CASTLE_TYPES.OUTPOST ? 0.05 : 0.5;
      if (random.chance(odds)) events.push(movement(player, castle[2], 'add', null, castle, randomInstant()));
    }
    if (random.chance(0.08)) {
      const type = random.pick([CASTLE_TYPES.OUTPOST, CASTLE_TYPES.MONUMENT, CASTLE_TYPES.LABORATORY]);
      events.push(movement(player, type, 'remove', freeSpot(), null, randomInstant()));
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

function movement(player, castleType, movementType, from, to, at) {
  return {
    playerId: player.id,
    castleType,
    movementType,
    oldX: from ? from[0] : null,
    oldY: from ? from[1] : null,
    newX: to ? to[0] : null,
    newY: to ? to[1] : null,
    at,
  };
}

export const hourIndexOf = (timeline, instant) =>
  Math.max(0, Math.min(timeline.length - 1, Math.floor((instant - timeline[0]) / HOUR)));
