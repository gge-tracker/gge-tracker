//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { Random } from './random';

const MAP_SIZE = 1286;
const FIRST_PLAYER_ID = 900_001;
const FIRST_ALLIANCE_ID = 500_001;
const TOP_ALLIANCE_SIZES = [64, 64, 63, 63, 13];

export interface GeneratedPlayer {
  id: number;
  name: string;
  level: number;
  legendaryLevel: number;
  might: number;
  currentFame: number;
  highestFame: number;
  honor: number;
  avp: number;
  prefix: number;
  suffix: number;
  topx: number;
  ruin: boolean;
  allianceId: number | null;
  allianceRank: number;
  castles: number[][];
  villages: number[][];
  banner: Record<string, number>;
  flags: { SA: number; VF: number; PF: number; RRD: number; TI: number };
  topLooter: boolean;
  tailLooter: boolean;
}

export interface GeneratedAlliance {
  id: number;
  name: string;
  memberIds: number[];
  language: string;
  emblem: Record<string, unknown>;
  lookParts: Record<string, unknown>[];
  memberLimitLevel: number;
  isIslandKing: boolean;
}

export interface World {
  players: GeneratedPlayer[];
  byId: Map<number, GeneratedPlayer>;
  alliances: Map<number, GeneratedAlliance>;
}

// [count, level, legendary level range]: enough players in every band the might and nomad categories read
const BANDS: [number, [number, number], [number, number]][] = [
  [120, [3, 19], [0, 0]],
  [80, [20, 29], [0, 0]],
  [80, [30, 39], [0, 0]],
  [80, [40, 49], [0, 0]],
  [100, [50, 69], [0, 0]],
  [60, [70, 70], [0, 9]],
  [120, [70, 70], [10, 300]],
  [80, [70, 70], [301, 649]],
  [80, [70, 70], [650, 949]],
  [260, [70, 70], [950, 950]],
];

function mightOf(random: Random, level: number, legendaryLevel: number): number {
  if (level < 70) return Math.round((20_000 + level ** 3 * 6) * random.between(0.5, 2));
  return Math.round(300_000 * (1 + legendaryLevel / 30) ** 1.6 * random.between(0.5, 5));
}

function banner(random: Random): Record<string, number> {
  const colour = (): number => random.integer(0, 0xffffff);
  const first = colour();
  const second = colour();
  return {
    BGT: random.integer(0, 3),
    BGC1: first,
    BGC2: second,
    SPT: random.integer(1, 4),
    S1: random.pick([13, 29, 82]),
    SC1: first,
    S2: random.pick([13, 29, 82]),
    SC2: second,
    IS: 1,
  };
}

class Map2D {
  private readonly taken = new Map<number, Set<number>>();

  constructor(private readonly random: Random) {}

  public claim(kingdom: number, near?: { x: number; y: number }, spread = 0): [number, number] {
    const taken = this.taken.get(kingdom) ?? new Set<number>();
    this.taken.set(kingdom, taken);
    for (;;) {
      const x = near ? clamp(near.x + this.random.integer(-spread, spread)) : this.random.integer(0, MAP_SIZE);
      const y = near ? clamp(near.y + this.random.integer(-spread, spread)) : this.random.integer(0, MAP_SIZE);
      if (taken.has(x * 2000 + y)) continue;
      taken.add(x * 2000 + y);
      return [x, y];
    }
  }
}

const clamp = (value: number): number => Math.max(0, Math.min(MAP_SIZE, value));

function castlesOf(
  random: Random,
  map: Map2D,
  level: number,
  legendaryLevel: number,
  castleIds: () => number,
): number[][] {
  const [x, y] = map.claim(0);
  const castles = [[0, castleIds(), x, y, 1]];
  const outposts = level < 20 ? 0 : level < 70 ? random.integer(0, 2) : random.pick([1, 2, 3, 3, 3, 3, 4]);
  for (let index = 0; index < outposts; index++) castles.push([0, castleIds(), ...map.claim(0, { x, y }, 25), 4]);
  // The game lists the main castle first about two times in three, after some outposts otherwise
  if (castles.length > 1 && random.chance(0.4))
    castles.splice(random.integer(1, castles.length - 1), 0, castles.shift()!);
  if (level === 70) {
    for (const landmark of [23, 26, 28, 22])
      if (random.chance(0.06)) castles.push([0, castleIds(), ...map.claim(0), landmark]);
    for (const kingdom of [1, 2, 3])
      if (random.chance(0.9)) castles.push([kingdom, castleIds(), ...map.claim(kingdom), 12]);
    if (random.chance(legendaryLevel === 950 ? 1 : 0.4))
      castles.push([4, castleIds(), ...map.claim(4), random.chance(0.85) ? 12 : 24]);
    if (random.chance(0.03)) castles.push([2, castleIds(), ...map.claim(2), 28]);
  }
  return castles;
}

export function buildWorld(random: Random): World {
  const map = new Map2D(random);
  let nextCastleId = 100_000;
  const castleIds = (): number => (nextCastleId += random.integer(1, 9_000));
  const players: GeneratedPlayer[] = [];
  for (const [count, [minLevel, maxLevel], [minLegendary, maxLegendary]] of BANDS) {
    for (let index = 0; index < count; index++) {
      const id = FIRST_PLAYER_ID + players.length;
      const level = random.integer(minLevel, maxLevel);
      const legendaryLevel = random.integer(minLegendary, maxLegendary);
      const might = mightOf(random, level, legendaryLevel);
      const currentFame = Math.round(might * random.between(0.5, 3));
      const hasCastles = random.chance(level < 20 ? 0.95 : 0.995);
      players.push({
        id,
        name: `Player_${id}`,
        level,
        legendaryLevel,
        might,
        currentFame,
        highestFame: currentFame + Math.round(currentFame * random.between(0, 0.4)),
        honor: random.integer(0, 2500),
        avp: random.chance(0.3) ? 0 : random.integer(500, 100_000),
        prefix: random.pick([0, 0, 13, 3, 105, 113, 1]),
        suffix: random.pick([-1, -1, -1, 29, 31, 28, 111, 27]),
        topx: random.chance(0.93) ? -1 : random.pick([50, 100, 10, 1]),
        ruin: random.chance(0.035),
        allianceId: null,
        allianceRank: 8,
        castles: hasCastles ? castlesOf(random, map, level, legendaryLevel, castleIds) : [],
        villages: random.chance(0.35)
          ? Array.from({ length: random.integer(1, 8) }, () => [1, castleIds(), ...map.claim(0), 10])
          : [],
        banner: banner(random),
        flags: {
          SA: random.chance(0.005) ? 1 : 0,
          VF: random.chance(0.16) ? 1 : 0,
          PF: random.chance(0.13) ? 1 : 0,
          RRD: random.chance(0.14) ? -1 : 0,
          TI: random.chance(0.01) ? random.integer(51, 54) : -1,
        },
        topLooter: false,
        tailLooter: false,
      });
    }
  }
  const byId = new Map(players.map((player) => [player.id, player]));
  const alliances = formAlliances(random, players);
  markLooters(random, players, alliances);
  return { players, byId, alliances };
}

function newAlliance(random: Random, id: number): GeneratedAlliance {
  const parts = random.integer(6, 10);
  return {
    id,
    name: `Alliance_${id}`,
    memberIds: [],
    language: random.pick(['fr', 'fr', 'fr', 'ar', 'en']),
    emblem: { ACCA: { ACLI: random.integer(1, 12), ACCS: [random.integer(3, 13)] }, ACFB: {} },
    lookParts: Array.from({ length: parts }, (_, index) => ({
      ACLI: index + 1,
      ACCS: Array.from({ length: random.integer(1, 3) }, () => random.integer(3, 19)),
      ACIA: index === 0,
      ACLET: 0,
    })),
    memberLimitLevel: random.pick([8, 25]),
    isIslandKing: random.chance(0.5),
  };
}

// Five alliances gather the top of the server, the way the loot top 10 spread over five alliances
function formAlliances(random: Random, players: GeneratedPlayer[]): Map<number, GeneratedAlliance> {
  const alliances = new Map<number, GeneratedAlliance>();
  const strongest = players.filter((player) => player.legendaryLevel === 950).sort((a, b) => b.might - a.might);
  let id = FIRST_ALLIANCE_ID;
  let cursor = 0;
  for (const size of TOP_ALLIANCE_SIZES) {
    const alliance = newAlliance(random, id++);
    for (const member of strongest.slice(cursor, cursor + size)) join(alliance, member);
    cursor += size;
    alliances.set(alliance.id, alliance);
  }
  const others: GeneratedAlliance[] = Array.from({ length: 60 }, () => newAlliance(random, id++));
  for (const alliance of others) alliances.set(alliance.id, alliance);
  for (const player of players) {
    if (player.allianceId !== null || !random.chance(player.level === 70 ? 0.85 : 0.6)) continue;
    join(random.pick(others), player);
  }
  for (const alliance of alliances.values()) {
    alliance.memberIds
      .map((memberId) => players.find((player) => player.id === memberId)!)
      .sort((a, b) => b.might - a.might)
      .forEach(
        (member, index) =>
          (member.allianceRank =
            index === 0 ? 0 : index < 3 ? 1 : index < 10 ? random.integer(2, 6) : random.pick([6, 7, 7, 8, 8])),
      );
  }
  return alliances;
}

function join(alliance: GeneratedAlliance, player: GeneratedPlayer): void {
  alliance.memberIds.push(player.id);
  player.allianceId = alliance.id;
}

// The loot top 10 is two members of each top alliance; the rest of the head and the tail are drawn wider
function markLooters(random: Random, players: GeneratedPlayer[], alliances: Map<number, GeneratedAlliance>): void {
  const top = [...alliances.values()].slice(0, TOP_ALLIANCE_SIZES.length);
  const head: GeneratedPlayer[] = [];
  for (const alliance of top)
    for (const memberId of alliance.memberIds.slice(0, 2)) head.push(players.find((player) => player.id === memberId)!);
  const rest = random.shuffle(
    players.filter(
      (player) =>
        player.legendaryLevel === 950 &&
        player.allianceId !== null &&
        player.castles.length > 0 &&
        !head.includes(player),
    ),
  );
  head.push(...rest.slice(0, 60 - head.length));
  head.forEach((player) => (player.topLooter = true));
  players.sort((a, b) => Number(b.topLooter) - Number(a.topLooter) || head.indexOf(a) - head.indexOf(b) || a.id - b.id);
  const loners = random
    .shuffle(players.filter((player) => !player.topLooter && player.allianceId === null && player.castles.length > 0))
    .slice(0, 23);
  const members = random
    .shuffle(players.filter((player) => !player.topLooter && player.allianceId !== null && player.castles.length > 0))
    .slice(0, 17);
  [...loners, ...members].forEach((player) => (player.tailLooter = true));
}

// The owner object a ranking row, an alliance member list and the aquamarine standings all carry
export function playerObject(world: World, id: number): Record<string, unknown> {
  const player = world.byId.get(id)!;
  const alliance = player.allianceId === null ? undefined : world.alliances.get(player.allianceId);
  const allianceFields = alliance
    ? { AID: alliance.id, AR: player.allianceRank, AN: alliance.name, aee: alliance.emblem }
    : { AID: -1 };
  return {
    OID: player.id,
    DUM: false,
    N: player.name,
    E: player.banner,
    L: player.level,
    LL: player.legendaryLevel,
    H: player.honor,
    AVP: player.avp,
    CF: player.currentFame,
    HF: player.highestFame,
    PRE: player.prefix,
    SUF: player.suffix,
    TOPX: player.topx,
    MP: player.might,
    R: player.ruin ? 1 : 0,
    ...allianceFields,
    RPT: 0,
    AP: player.castles,
    VP: player.villages,
    ...player.flags,
  };
}
