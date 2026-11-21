export const MAP_SIZE = 1286;

const MAIN_CASTLE = 1;
const OUTPOST = 4;
const REALM_CASTLE = 12;
const MONUMENT = 26;
const LABORATORY = 28;
const SMALL_LANDMARKS = [22, 23];
const REALM_KINGDOMS = [1, 2, 3, 4];
const ALLIANCE_CAPACITY = 70;
const LEVEL_70_MIGHT = 1_500_000;
const MIN_MIGHT = 1_500;

export function buildWorld(random, names, playerCount) {
  const alliances = buildAlliances(random, names, Math.max(3, Math.round(playerCount / 9)));
  const players = buildPlayers(random, names, playerCount);
  joinAlliances(random, players, alliances);
  rankMembers(random, alliances);
  const occupancy = placeCastles(random, players, alliances);
  return { alliances, players, occupancy };
}

function buildAlliances(random, names, count) {
  const ids = random.uniqueIntegers(count, 1, 210_000);
  return ids.map((id, index) => ({
    id,
    name: names.alliance(),
    description: random.chance(0.4) ? names.description() : null,
    popularity: 1 / Math.pow(index + 1, 0.8),
    center: { x: random.integer(80, MAP_SIZE - 80), y: random.integer(80, MAP_SIZE - 80) },
    members: [],
  }));
}

function buildPlayers(random, names, count) {
  const ids = random.uniqueIntegers(count, 10_000, 9_999_999);
  const players = ids.map((id, index) => {
    const might = Math.round(3.5e8 * Math.pow(index + 1, -1.08) * random.between(0.85, 1.15)) + MIN_MIGHT;
    return { id, name: names.player(), might };
  });
  players.sort((a, b) => b.might - a.might);
  players.forEach((player, rank) => describePlayer(random, player, rank / count));
  return players;
}

function describePlayer(random, player, percentile) {
  const isMaxLevel = player.might >= LEVEL_70_MIGHT;
  player.level = isMaxLevel ? 70 : levelFromMight(player.might);
  player.legendaryLevel = isMaxLevel ? Math.min(950, Math.round(950 * Math.pow(1 - percentile, 0.6) * random.between(0.85, 1.1))) : 0;
  player.active = random.chance(percentile < 0.5 ? 0.7 : 0.4);
  player.honor = random.integer(0, 2500);
  player.maxHonor = player.honor + random.integer(0, 800);
  player.fame = Math.round(player.might * random.between(0.5, 3));
  player.highestFame = player.fame + Math.round(player.fame * random.between(0, 0.3));
  player.peaceSeconds = random.chance(0.1) ? random.integer(3600, 7 * 86_400) : 0;
  player.peaceDisabledDaysAgo = random.chance(0.05) ? random.between(1, 60) : null;
  player.lootPace = player.active ? Math.pow(player.might, 0.85) * random.between(0.5, 2) : 0;
}

function levelFromMight(might) {
  const progress = Math.log(might / MIN_MIGHT) / Math.log(LEVEL_70_MIGHT / MIN_MIGHT);
  return Math.max(1, Math.min(69, Math.round(15 + 54 * progress)));
}

function joinAlliances(random, players, alliances) {
  const totalPopularity = alliances.reduce((sum, alliance) => sum + alliance.popularity, 0);
  for (const player of players) {
    player.allianceId = null;
    if (!random.chance(player.level === 70 ? 0.85 : 0.5)) continue;
    for (let attempt = 0; attempt < 10; attempt++) {
      let roll = random.next() * totalPopularity;
      const alliance = alliances.find((candidate) => (roll -= candidate.popularity) <= 0) || alliances.at(-1);
      if (alliance.members.length >= ALLIANCE_CAPACITY) continue;
      alliance.members.push(player);
      player.allianceId = alliance.id;
      break;
    }
  }
}

function rankMembers(random, alliances) {
  for (const alliance of alliances) {
    alliance.members.forEach((member, index) => {
      if (index === 0) member.allianceRank = 0;
      else if (index < 2) member.allianceRank = 1;
      else if (index < 4) member.allianceRank = 2;
      else if (index < 9) member.allianceRank = random.integer(3, 5);
      else member.allianceRank = random.pick([6, 7, 7, 7, 8]);
    });
  }
}

class Occupancy {
  constructor(random) {
    this.random = random;
    this.taken = new Map(REALM_KINGDOMS.concat(0).map((kingdom) => [kingdom, new Set()]));
  }

  claim(kingdom, near, spread) {
    const taken = this.taken.get(kingdom);
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = near ? clamp(Math.round(this.random.gaussian(near.x, spread))) : this.random.integer(0, MAP_SIZE);
      const y = near ? clamp(Math.round(this.random.gaussian(near.y, spread))) : this.random.integer(0, MAP_SIZE);
      const key = x * 2000 + y;
      if (taken.has(key)) continue;
      taken.add(key);
      return { x, y };
    }
    return null;
  }

  isFree(kingdom, x, y) {
    return !this.taken.get(kingdom).has(x * 2000 + y);
  }
}

const clamp = (value) => Math.max(0, Math.min(MAP_SIZE, value));

function placeCastles(random, players, alliances) {
  const occupancy = new Occupancy(random);
  const centers = new Map(alliances.map((alliance) => [alliance.id, alliance.center]));
  players.forEach((player, rank) => {
    player.castles = [];
    player.realmCastles = [];
    if (!random.chance(player.level === 70 ? 0.9 : 0.75)) {
      player.active = false;
      player.lootPace = 0;
      return;
    }
    const main = occupancy.claim(0, centers.get(player.allianceId) ?? null, 70);
    if (!main) return;
    player.castles.push([main.x, main.y, MAIN_CASTLE]);
    const outposts = player.level === 70 ? random.pick([0, 1, 2, 3, 3, 3, 3, 3, 3, 4, 5]) : random.integer(0, 2);
    for (let index = 0; index < outposts; index++) addCastle(player, occupancy.claim(0, main, 20), OUTPOST);
    if (rank < players.length * 0.12) {
      if (random.chance(0.5)) addCastle(player, occupancy.claim(0, null, 0), MONUMENT);
      if (random.chance(0.3)) addCastle(player, occupancy.claim(0, null, 0), LABORATORY);
    }
    if (random.chance(0.05)) addCastle(player, occupancy.claim(0, null, 0), random.pick(SMALL_LANDMARKS));
    if (player.level !== 70) return;
    for (const kingdom of REALM_KINGDOMS) {
      if (!random.chance(kingdom === 4 ? 0.6 : 0.9)) continue;
      const spot = occupancy.claim(kingdom, null, 0);
      if (spot) player.realmCastles.push([kingdom, spot.x, spot.y, REALM_CASTLE]);
    }
  });
  return occupancy;
}

function addCastle(player, spot, type) {
  if (spot) player.castles.push([spot.x, spot.y, type]);
}

export const CASTLE_TYPES = { MAIN_CASTLE, OUTPOST, MONUMENT, LABORATORY };
