/**
 * Ground truth for the dungeon routes, read from the fixture tables rather than from the columns the API reads
 */
import { FixtureDatabase } from './postgres';

export const GLOBAL_COOLDOWN_SECONDS = 24 * 3600;
export const MAP_WIDTH = 1287;

export interface Attacker {
  name: string;
  might: string | null;
  level: number | null;
  legendaryLevel: number | null;
}

export interface DungeonTruth {
  key: string;
  kid: number;
  x: number;
  y: number;
  globalMs: number;
  attackCount: number;
  lastAttackMs: number | null;
  gapSeconds: number | null;
  lastAttackerId: number | null;
  attacker: Attacker | null;
}

export interface ExpectedDungeon {
  kid: number;
  position_x: number;
  position_y: number;
  player_id: string | null;
  player_name: string | null;
  player_might: string | null;
  player_level: number | null;
  player_legendary_level: number | null;
  total_attack_count: number | null;
  available_duration_seconds: number;
  global_available_at: number;
  effective_cooldown_until: number;
  last_attack: number | null;
}

export interface PlayerAttack {
  kid: number;
  x: number;
  y: number;
  attackedMs: number;
}

export function dungeonKey(kid: number, x: number, y: number): string {
  return `${kid}/${x}/${y}`;
}

export function keyOf(row: { kid: unknown; position_x: unknown; position_y: unknown }): string {
  return dungeonKey(Number(row.kid), Number(row.position_x), Number(row.position_y));
}

// node-pg truncates a timestamp to the millisecond, so the truth does too
function epochMs(column: string): string {
  return `floor(extract(epoch from ${column}) * 1000)::float8`;
}

export async function readDungeonTruth(db: FixtureDatabase, kids: number[]): Promise<Map<string, DungeonTruth>> {
  const rows = await db.query(
    `
      WITH ranked AS (
        SELECT
          kid, position_x, position_y, player_id, attacked_at,
          row_number() OVER (PARTITION BY kid, position_x, position_y ORDER BY attacked_at DESC, id DESC) AS rank,
          count(*) OVER (PARTITION BY kid, position_x, position_y) AS attacks
        FROM dungeons_history
        WHERE kid = ANY($1::smallint[])
      )
      SELECT
        D.kid, D.position_x, D.position_y,
        ${epochMs('D.global_available_at')} AS global_ms,
        coalesce(L.attacks, 0)::int AS attack_count,
        ${epochMs('L.attacked_at')} AS last_attack_ms,
        extract(epoch from (L.attacked_at - P2.attacked_at))::float8 AS gap_seconds,
        L.player_id AS last_attacker_id,
        P.name AS attacker_name,
        P.might_current::text AS attacker_might,
        P.level AS attacker_level,
        P.legendary_level AS attacker_legendary_level
      FROM dungeons D
      LEFT JOIN ranked L ON L.kid = D.kid AND L.position_x = D.position_x AND L.position_y = D.position_y AND L.rank = 1
      LEFT JOIN ranked P2 ON P2.kid = D.kid AND P2.position_x = D.position_x AND P2.position_y = D.position_y AND P2.rank = 2
      LEFT JOIN players P ON P.id = L.player_id
      WHERE D.kid = ANY($1::smallint[])
    `,
    [kids],
    'dungeon-truth',
  );
  const truth = new Map<string, DungeonTruth>();
  for (const row of rows) {
    const key = dungeonKey(row.kid, row.position_x, row.position_y);
    truth.set(key, {
      key,
      kid: row.kid,
      x: row.position_x,
      y: row.position_y,
      globalMs: row.global_ms,
      attackCount: row.attack_count,
      lastAttackMs: row.last_attack_ms,
      gapSeconds: row.gap_seconds,
      lastAttackerId: row.last_attacker_id,
      attacker:
        row.attacker_name === null
          ? null
          : {
              name: row.attacker_name,
              might: row.attacker_might,
              level: row.attacker_level,
              legendaryLevel: row.attacker_legendary_level,
            },
    });
  }
  return truth;
}

export async function readPlayerCooldowns(db: FixtureDatabase, playerId: number): Promise<Map<string, number>> {
  const rows = await db.query(
    `SELECT kid, position_x, position_y, ${epochMs('available_at')} AS available_ms FROM dungeon_player_cooldowns WHERE player_id = $1`,
    [playerId],
    'dungeon-player-cooldowns',
  );
  return new Map(rows.map((row) => [dungeonKey(row.kid, row.position_x, row.position_y), row.available_ms]));
}

export async function readPlayerAttacksWithDungeonJoin(db: FixtureDatabase, playerId: number, lastDays: number): Promise<PlayerAttack[]> {
  const rows = await db.query(
    `
      SELECT D.kid, D.position_x, D.position_y, ${epochMs('DH.attacked_at')} AS attacked_ms
      FROM dungeons_history DH
      JOIN dungeons D ON D.kid = DH.kid AND D.position_x = DH.position_x AND D.position_y = DH.position_y
      WHERE DH.player_id = $1 AND DH.attacked_at >= NOW() - make_interval(days => $2)
      ORDER BY DH.attacked_at DESC
    `,
    [playerId, lastDays],
    'dungeon-player-attacks',
  );
  return rows.map((row) => ({ kid: row.kid, x: row.position_x, y: row.position_y, attackedMs: row.attacked_ms }));
}

export async function databaseNowMs(db: FixtureDatabase): Promise<number> {
  const [row] = await db.query(`SELECT ${epochMs('LOCALTIMESTAMP')} AS now_ms`, [], 'now');
  return row.now_ms;
}

export function effectiveCooldownMs(truth: DungeonTruth, playerCooldownMs: number | undefined): number {
  return playerCooldownMs === undefined ? truth.globalMs : Math.max(truth.globalMs, playerCooldownMs);
}

export function expectedDungeon(truth: DungeonTruth, code: string, playerCooldownMs?: number): ExpectedDungeon {
  return {
    kid: truth.kid,
    position_x: truth.x,
    position_y: truth.y,
    player_id: truth.lastAttackerId === null ? null : `${truth.lastAttackerId}${code}`,
    player_name: truth.attacker?.name ?? null,
    player_might: truth.attacker?.might ?? null,
    player_level: truth.attacker?.level ?? null,
    player_legendary_level: truth.attacker?.legendaryLevel ?? null,
    total_attack_count: truth.attackCount === 0 ? null : truth.attackCount,
    available_duration_seconds:
      truth.gapSeconds === null ? 0 : Math.round(Math.max(truth.gapSeconds - GLOBAL_COOLDOWN_SECONDS, 0)),
    global_available_at: truth.globalMs,
    effective_cooldown_until: effectiveCooldownMs(truth, playerCooldownMs),
    last_attack: truth.lastAttackMs,
  };
}

function instant(value: unknown): number | null {
  return value === null || value === undefined ? null : Date.parse(String(value));
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function normalizeDungeon(row: any): ExpectedDungeon {
  return {
    kid: Number(row.kid),
    position_x: Number(row.position_x),
    position_y: Number(row.position_y),
    player_id: row.player_id ?? null,
    player_name: row.player_name ?? null,
    player_might: row.player_might === null || row.player_might === undefined ? null : String(row.player_might),
    player_level: nullableNumber(row.player_level),
    player_legendary_level: nullableNumber(row.player_legendary_level),
    total_attack_count: nullableNumber(row.total_attack_count),
    available_duration_seconds: Number(row.available_duration_seconds),
    global_available_at: instant(row.global_available_at),
    effective_cooldown_until: instant(row.effective_cooldown_until),
    last_attack: instant(row.last_attack),
  };
}

export function fieldDifferences(expected: ExpectedDungeon, actual: ExpectedDungeon, fields: (keyof ExpectedDungeon)[]): string[] {
  return fields
    .filter((field) => expected[field] !== actual[field])
    .map((field) => `${field}: expected ${expected[field]}, got ${actual[field]}`);
}

export function wrappedDistanceSquared(x: number, y: number, fromX: number, fromY: number): number {
  const dx = Math.abs(x - fromX);
  return Math.min(dx, MAP_WIDTH - dx) ** 2 + (y - fromY) ** 2;
}

export function displayedDistance(distanceSquared: number): number {
  return Number.parseFloat(Math.sqrt(distanceSquared).toFixed(1));
}

export function byPosition(a: { kid: number; position_x: number; position_y: number }, b: typeof a): number {
  return a.kid - b.kid || a.position_x - b.position_x || a.position_y - b.position_y;
}

export function byDefaultOrder(nowMs: number) {
  return (a: ExpectedDungeon, b: ExpectedDungeon): number => {
    const aReady = a.effective_cooldown_until <= nowMs ? 0 : 1;
    const bReady = b.effective_cooldown_until <= nowMs ? 0 : 1;
    return aReady - bReady || a.effective_cooldown_until - b.effective_cooldown_until || byPosition(a, b);
  };
}
