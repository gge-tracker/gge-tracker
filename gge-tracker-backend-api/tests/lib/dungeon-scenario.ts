import { FixtureDatabase } from './postgres';
import { CacheClient } from './redis';

export const SCENARIO_KID = 9;

const MINUTE = 1;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GLOBAL_COOLDOWN = DAY;
const PLAYER_COOLDOWN = GLOBAL_COOLDOWN + 4 * DAY;

export type ScenarioPlayer = 'heavy' | 'once' | 'never' | 'ghost';

export interface ScenarioDungeon {
  name: string;
  x: number;
  y: number;
  attacks: { by: ScenarioPlayer; at: number }[];
  globalAt?: number;
}

export const SCENARIO: ScenarioDungeon[] = [
  { name: 'never attacked', x: 100, y: 100, attacks: [], globalAt: -2 * HOUR },
  { name: 'tie, lower x', x: 99, y: 300, attacks: [], globalAt: -3 * HOUR },
  { name: 'tie, higher x', x: 100, y: 120, attacks: [], globalAt: -3 * HOUR },
  { name: 'attacked once, free in 2 min', x: 110, y: 100, attacks: [{ by: 'once', at: 2 * MINUTE - GLOBAL_COOLDOWN }] },
  { name: 'unknown attacker, free in 30 min', x: 120, y: 100, attacks: [{ by: 'ghost', at: 30 * MINUTE - GLOBAL_COOLDOWN }] },
  { name: 'free in 5 h', x: 130, y: 100, attacks: [{ by: 'heavy', at: 5 * HOUR - GLOBAL_COOLDOWN }] },
  {
    name: 'attacked four times, one recorded late',
    x: 140,
    y: 100,
    attacks: [
      { by: 'heavy', at: -10 * DAY },
      { by: 'ghost', at: -4 * DAY },
      { by: 'heavy', at: -30 * MINUTE },
      { by: 'heavy', at: -20 * DAY },
    ],
  },
  { name: 'free, own cooldown 3 days left', x: 150, y: 100, attacks: [{ by: 'heavy', at: -2 * DAY }] },
  { name: 'own cooldown ended after the global one', x: 160, y: 100, attacks: [{ by: 'heavy', at: -6 * DAY }] },
  { name: 'own cooldown ends in 3 min', x: 170, y: 100, attacks: [{ by: 'heavy', at: 3 * MINUTE - PLAYER_COOLDOWN }] },
  { name: 'own cooldown ends in 40 min', x: 180, y: 100, attacks: [{ by: 'heavy', at: 40 * MINUTE - PLAYER_COOLDOWN }] },
  {
    name: 'global cooldown outlasts own',
    x: 190,
    y: 100,
    attacks: [
      { by: 'heavy', at: -6 * DAY },
      { by: 'ghost', at: -1 * HOUR },
    ],
  },
];

export function scenarioDungeon(name: string): ScenarioDungeon {
  return SCENARIO.find((dungeon) => dungeon.name === name)!;
}

export function globalAt(dungeon: ScenarioDungeon): number {
  if (dungeon.attacks.length === 0) return dungeon.globalAt!;
  return Math.max(...dungeon.attacks.map((attack) => attack.at)) + GLOBAL_COOLDOWN;
}

export function playerAvailableAt(dungeon: ScenarioDungeon, player: ScenarioPlayer): number | undefined {
  const own = dungeon.attacks.filter((attack) => attack.by === player);
  if (own.length === 0) return undefined;
  return Math.max(...own.map((attack) => attack.at)) + PLAYER_COOLDOWN;
}

export function effectiveAt(dungeon: ScenarioDungeon, player?: ScenarioPlayer): number {
  const own = player === undefined ? undefined : playerAvailableAt(dungeon, player);
  return own === undefined ? globalAt(dungeon) : Math.max(globalAt(dungeon), own);
}

export interface ScenarioPlayers {
  heavy: { id: number; name: string };
  once: { id: number; name: string };
  never: { id: number; name: string };
  ghost: { id: number };
}

export interface SeededScenario {
  players: ScenarioPlayers;
  startMs: number;
}

/** Three real players with no dungeon history, and an id no player carries */
export async function pickScenarioPlayers(db: FixtureDatabase, excludedIds: number[]): Promise<ScenarioPlayers | undefined> {
  const rows = await db.query(
    `
      SELECT P.id, P.name
      FROM players P
      WHERE P.name ~ '^[A-Za-z0-9]{3,20}$'
        AND P.id <> ALL($1::int[])
        AND NOT EXISTS (SELECT 1 FROM dungeons_history DH WHERE DH.player_id = P.id)
        AND NOT EXISTS (SELECT 1 FROM dungeon_player_cooldowns DPC WHERE DPC.player_id = P.id)
        AND (SELECT count(*) FROM players Q WHERE lower(Q.name) = lower(P.name)) = 1
      ORDER BY P.id
      LIMIT 3
    `,
    [excludedIds],
    'scenario-players',
  );
  if (rows.length < 3) return undefined;
  const [{ ghost }] = await db.query(`SELECT max(id) + 1 AS ghost FROM players`, [], 'scenario-ghost');
  return { heavy: rows[0], once: rows[1], never: rows[2], ghost: { id: ghost } };
}

export async function removeScenario(db: FixtureDatabase): Promise<void> {
  await db.query(`DELETE FROM dungeon_player_cooldowns WHERE kid = $1`, [SCENARIO_KID], 'scenario-remove-cooldowns');
  await db.query(`DELETE FROM dungeons_history WHERE kid = $1`, [SCENARIO_KID], 'scenario-remove-history');
  await db.query(`DELETE FROM dungeons WHERE kid = $1`, [SCENARIO_KID], 'scenario-remove-dungeons');
}

export async function seedScenario(db: FixtureDatabase, players: ScenarioPlayers): Promise<SeededScenario> {
  await removeScenario(db);
  const [{ start, start_ms }] = await db.query(
    `SELECT to_char(LOCALTIMESTAMP, 'YYYY-MM-DD HH24:MI:SS.US') AS start, floor(extract(epoch from LOCALTIMESTAMP) * 1000)::float8 AS start_ms`,
    [],
    'scenario-clock',
  );
  const at = (parameter: number) => `$1::timestamp + $${parameter}::float8 * interval '1 minute'`;

  for (const dungeon of SCENARIO) {
    await db.query(
      `INSERT INTO dungeons (kid, position_x, position_y, global_available_at) VALUES ($2, $3, $4, ${at(5)})`,
      [start, SCENARIO_KID, dungeon.x, dungeon.y, globalAt(dungeon)],
      `scenario-dungeon ${dungeon.name}`,
    );
    for (const attack of dungeon.attacks) {
      await db.query(
        `INSERT INTO dungeons_history (kid, position_x, position_y, player_id, attacked_at) VALUES ($2, $3, $4, $5, ${at(6)})`,
        [start, SCENARIO_KID, dungeon.x, dungeon.y, players[attack.by].id, attack.at],
        `scenario-attack ${dungeon.name}`,
      );
    }
    for (const player of new Set(dungeon.attacks.map((attack) => attack.by))) {
      await db.query(
        `INSERT INTO dungeon_player_cooldowns (kid, position_x, position_y, player_id, available_at) VALUES ($2, $3, $4, $5, ${at(6)})`,
        [start, SCENARIO_KID, dungeon.x, dungeon.y, players[player].id, playerAvailableAt(dungeon, player)],
        `scenario-cooldown ${dungeon.name}`,
      );
    }
  }
  return { players, startMs: start_ms };
}

export interface IsolatedCache {
  forgetPlayerHistories(): Promise<void>;
  restore(): Promise<void>;
}

export async function isolateDungeonCache(cache: CacheClient, server: string): Promise<IsolatedCache> {
  const versionKey = `dungeon-version:${server}`;
  const previousVersion = await cache.get(versionKey);
  const harnessVersion = `harness-${Date.now()}`;
  const dropPlayerHistories = async (): Promise<void> => {
    const keys = await cache.keys('dungeons:player:*');
    if (keys.length > 0) await cache.del(keys);
  };

  await dropPlayerHistories();
  await cache.set(versionKey, harnessVersion);
  return {
    forgetPlayerHistories: dropPlayerHistories,
    restore: async () => {
      if (previousVersion === null) await cache.del(versionKey);
      else await cache.set(versionKey, previousVersion);
      const lists = await cache.keys(`${server}:${harnessVersion}:dungeons:*`);
      if (lists.length > 0) await cache.del(lists);
      await dropPlayerHistories();
    },
  };
}
