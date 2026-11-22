/**
 * A neighbourhood seeded below the map (y 1400-1530, which the game never uses), so the whole answer is known
 */
import axios from 'axios';
import { FixtureDatabase } from './postgres';
import { ClickHouseTarget } from './clickhouse';

export const SCENARIO_FIRST_ID = 99_000_001;
export const SCENARIO_LAST_ID = 99_000_999;

const HOUR = 60;
const DAY = 24 * HOUR;

export const ALLIANCES = { mine: 99_000_001, rival: 99_000_002 } as const;

export type ScenarioName =
  | 'me'
  | 'ally'
  | 'foe'
  | 'raider'
  | 'mover'
  | 'leaver'
  | 'newbie'
  | 'far'
  | 'old'
  | 'monument'
  | 'ruined'
  | 'mighty'
  | 'outsider'
  | 'castleless';

export interface ScenarioPlayer {
  id: number;
  name: string;
  allianceId: number | null;
  castles: [number, number, number][];
  honor: number;
  peaceSeconds?: number;
  peaceEndsInMinutes?: number;
  isRuin?: boolean;
  firstSeenMinutesAgo?: number;
  might: number;
}

const player = (offset: number, rest: Omit<ScenarioPlayer, 'id' | 'name' | 'might'> & { might?: number }): ScenarioPlayer => ({
  id: SCENARIO_FIRST_ID + offset,
  name: `Vicinity_${offset}`,
  might: 1_000_000 + offset,
  ...rest,
});

export const PLAYERS: Record<ScenarioName, ScenarioPlayer> = {
  me: player(0, { allianceId: ALLIANCES.mine, castles: [[10, 1450, 1], [10, 1490, 4], [12, 1440, 26]], honor: 500 }),
  ally: player(1, { allianceId: ALLIANCES.mine, castles: [[20, 1450, 1]], honor: 300 }),
  foe: player(2, { allianceId: ALLIANCES.rival, castles: [[1280, 1452, 1]], honor: 1030 }),
  raider: player(3, { allianceId: ALLIANCES.rival, castles: [[600, 1450, 1], [12, 1500, 4]], honor: 900 }),
  mover: player(4, { allianceId: null, castles: [[30, 1460, 1]], honor: 10 }),
  leaver: player(5, { allianceId: null, castles: [[700, 1450, 1]], honor: 10 }),
  newbie: player(6, { allianceId: null, castles: [[10, 1425, 1]], honor: 0, peaceSeconds: 3 * 86_400, peaceEndsInMinutes: 3 * DAY, firstSeenMinutesAgo: 4 * HOUR }),
  far: player(7, { allianceId: ALLIANCES.rival, castles: [[55, 1450, 1]], honor: 50 }),
  old: player(8, { allianceId: ALLIANCES.rival, castles: [[15, 1455, 1]], honor: 50, firstSeenMinutesAgo: 9 * DAY }),
  monument: player(9, { allianceId: ALLIANCES.rival, castles: [[13, 1452, 26], [11, 1451, 23], [9, 1449, 28]], honor: 50 }),
  ruined: player(10, { allianceId: null, castles: [[10, 1470, 1]], honor: 50, isRuin: true }),
  mighty: player(11, { allianceId: ALLIANCES.rival, castles: [[40, 1490, 1]], honor: 50, might: 52_020_000 }),
  outsider: player(12, { allianceId: ALLIANCES.rival, castles: [[41, 1490, 1], [10, 1521, 4]], honor: 50 }),
  castleless: player(13, { allianceId: null, castles: [], honor: 0 }),
};

export interface ScenarioMovement {
  by: ScenarioName;
  castleType: number;
  movement: 'add' | 'remove' | 'move';
  from?: [number, number];
  to?: [number, number];
  previousOwner?: ScenarioName;
  minutesAgo: number;
}

export const MOVEMENTS: ScenarioMovement[] = [
  { by: 'raider', castleType: 4, movement: 'add', to: [12, 1500], previousOwner: 'me', minutesAgo: 5 * HOUR },
  { by: 'mover', castleType: 1, movement: 'move', from: [600, 1460], to: [30, 1460], minutesAgo: 6 * HOUR },
  { by: 'leaver', castleType: 1, movement: 'move', from: [25, 1450], to: [700, 1450], minutesAgo: 8 * HOUR },
  { by: 'outsider', castleType: 4, movement: 'add', to: [10, 1521], minutesAgo: 7 * HOUR },
  { by: 'monument', castleType: 26, movement: 'add', to: [13, 1452], minutesAgo: 1 * HOUR },
  { by: 'me', castleType: 4, movement: 'add', to: [10, 1490], minutesAgo: 12 * HOUR },
  { by: 'mover', castleType: 1, movement: 'move', from: [700, 1460], to: [600, 1460], minutesAgo: 8 * DAY },
];

export const ALLIANCE_CHANGES: { by: ScenarioName; from: number | null; to: number | null; minutesAgo: number }[] = [
  { by: 'foe', from: ALLIANCES.mine, to: ALLIANCES.rival, minutesAgo: 3 * HOUR },
  { by: 'far', from: null, to: ALLIANCES.rival, minutesAgo: 2 * HOUR },
  { by: 'old', from: null, to: ALLIANCES.rival, minutesAgo: 8 * DAY },
];

export const RENAMES: { by: ScenarioName; from: string; minutesAgo: number }[] = [
  { by: 'ally', from: 'Vicinity_old_name', minutesAgo: 2 * HOUR },
];

export interface ScenarioStateChange {
  by: ScenarioName;
  minutesAgo: number;
  honor?: [number, number];
  peace?: [boolean, boolean];
  peaceUntilOffsetMinutes?: [number | null, number | null];
  ruin?: [boolean, boolean];
}

export const STATE_CHANGES: ScenarioStateChange[] = [
  { by: 'foe', minutesAgo: 2 * HOUR, honor: [990, 1030] },
  { by: 'foe', minutesAgo: 30 * HOUR, honor: [1000, 990] },
  { by: 'foe', minutesAgo: 9 * DAY, honor: [700, 1000] },
  { by: 'foe', minutesAgo: 1 * HOUR, peace: [true, false], peaceUntilOffsetMinutes: [10 * HOUR, null] },
  { by: 'newbie', minutesAgo: 4 * HOUR, peace: [false, true], peaceUntilOffsetMinutes: [null, 3 * DAY] },
  { by: 'ruined', minutesAgo: 10 * HOUR, ruin: [false, true] },
  { by: 'old', minutesAgo: 20 * HOUR, peace: [true, false], peaceUntilOffsetMinutes: [-30, null] },
];

// Hourly readings, 35 days back: a steady 10k an hour, then +6M three hours ago and -4M two hours ago
export const MIGHT_HOURS = 35 * 24;
export function mightAt(hoursAgo: number): number {
  let point = 50_000_000 + 10_000 * (MIGHT_HOURS - hoursAgo);
  if (hoursAgo <= 3) point += 6_000_000;
  if (hoursAgo <= 2) point -= 4_000_000;
  return point;
}

export async function removeScenario(db: FixtureDatabase): Promise<void> {
  const range = [SCENARIO_FIRST_ID, SCENARIO_LAST_ID];
  for (const table of ['player_castle_movements_history', 'player_alliance_update', 'player_name_update_history', 'player_state_history']) {
    await db.query(`DELETE FROM ${table} WHERE player_id BETWEEN $1 AND $2`, range, `vicinity-remove ${table}`);
  }
  await db.query(`DELETE FROM players WHERE id BETWEEN $1 AND $2`, range, 'vicinity-remove players');
  await db.query(`DELETE FROM alliances WHERE id BETWEEN $1 AND $2`, range, 'vicinity-remove alliances');
}

export async function seedScenario(db: FixtureDatabase): Promise<void> {
  await removeScenario(db);
  const [{ start }] = await db.query(`SELECT to_char(LOCALTIMESTAMP, 'YYYY-MM-DD HH24:MI:SS.US') AS start`, [], 'vicinity-clock');
  const ago = (parameter: number): string => `$1::timestamp - $${parameter}::float8 * interval '1 minute'`;

  await db.query(
    `INSERT INTO alliances (id, name) VALUES ($1, 'Vicinity_mine'), ($2, 'Vicinity_rival')`,
    [ALLIANCES.mine, ALLIANCES.rival],
    'vicinity-alliances',
  );
  for (const seeded of Object.values(PLAYERS)) {
    await db.query(
      `INSERT INTO players (id, name, alliance_id, might_current, might_all_time, loot_current, loot_all_time, level, legendary_level,
         castles, castles_realm, honor, max_honor, remaining_peace_time, peace_disabled_at, is_ruin, first_seen_at)
       VALUES ($2, $3, $4, $5, $5, 0, 0, 70, 100, $6::jsonb, '[]'::jsonb, $7, $7, $8,
         CASE WHEN $9::float8 IS NULL THEN NULL ELSE ($1::timestamp + $9::float8 * interval '1 minute') AT TIME ZONE 'UTC' END,
         $10, CASE WHEN $11::float8 IS NULL THEN NULL ELSE ${ago(11)} END)`,
      [
        start,
        seeded.id,
        seeded.name,
        seeded.allianceId,
        seeded.might,
        JSON.stringify(seeded.castles),
        seeded.honor,
        seeded.peaceSeconds ?? 0,
        seeded.peaceEndsInMinutes ?? null,
        seeded.isRuin === true,
        seeded.firstSeenMinutesAgo ?? null,
      ],
      `vicinity-player ${seeded.name}`,
    );
  }
  for (const movement of MOVEMENTS) {
    await db.query(
      `INSERT INTO player_castle_movements_history
         (player_id, castle_type, movement_type, position_x_old, position_y_old, position_x_new, position_y_new, previous_owner_id, created_at)
       VALUES ($2, $3, $4, $5, $6, $7, $8, $9, ${ago(10)})`,
      [
        start,
        PLAYERS[movement.by].id,
        movement.castleType,
        movement.movement,
        movement.from?.[0] ?? null,
        movement.from?.[1] ?? null,
        movement.to?.[0] ?? null,
        movement.to?.[1] ?? null,
        movement.previousOwner ? PLAYERS[movement.previousOwner].id : null,
        movement.minutesAgo,
      ],
      `vicinity-movement ${movement.by}`,
    );
  }
  for (const change of ALLIANCE_CHANGES) {
    const name = (id: number | null) => (id === null ? null : id === ALLIANCES.mine ? 'Vicinity_mine' : 'Vicinity_rival');
    await db.query(
      `INSERT INTO player_alliance_update (player_id, old_alliance_id, new_alliance_id, old_alliance_name, new_alliance_name, created_at)
       VALUES ($2, $3, $4, $5, $6, ${ago(7)})`,
      [start, PLAYERS[change.by].id, change.from, change.to, name(change.from), name(change.to), change.minutesAgo],
      `vicinity-alliance ${change.by}`,
    );
  }
  for (const rename of RENAMES) {
    await db.query(
      `INSERT INTO player_name_update_history (player_id, old_name, new_name, created_at) VALUES ($2, $3, $4, ${ago(5)})`,
      [start, PLAYERS[rename.by].id, rename.from, PLAYERS[rename.by].name, rename.minutesAgo],
      `vicinity-rename ${rename.by}`,
    );
  }
  for (const change of STATE_CHANGES) {
    const honor = change.honor ?? [PLAYERS[change.by].honor, PLAYERS[change.by].honor];
    const peace = change.peace ?? [false, false];
    const until = change.peaceUntilOffsetMinutes ?? [null, null];
    const ruin = change.ruin ?? [false, false];
    const offset = (parameter: number) =>
      `CASE WHEN $${parameter}::float8 IS NULL THEN NULL ELSE ($1::timestamp - $11::float8 * interval '1 minute' + $${parameter}::float8 * interval '1 minute') AT TIME ZONE 'UTC' END`;
    await db.query(
      `INSERT INTO player_state_history
         (player_id, honor_old, honor_new, peace_old, peace_new, peace_until_old, peace_until_new, ruin_old, ruin_new, created_at)
       VALUES ($2, $3, $4, $5, $6, ${offset(7)}, ${offset(8)}, $9, $10, ${ago(11)})`,
      [start, PLAYERS[change.by].id, honor[0], honor[1], peace[0], peace[1], until[0], until[1], ruin[0], ruin[1], change.minutesAgo],
      `vicinity-state ${change.by}`,
    );
  }
}

async function clickhouse(target: ClickHouseTarget, statement: string): Promise<void> {
  await axios.post(`${target.url}/?mutations_sync=2`, statement, {
    auth: { username: target.username, password: target.password },
    timeout: 15_000,
  });
}

export async function seedMight(target: ClickHouseTarget, database: string): Promise<void> {
  await removeMight(target, database);
  const hours = Array.from({ length: MIGHT_HOURS + 1 }, (_, index) => MIGHT_HOURS - index);
  const point = `[${hours.map(mightAt).join(',')}][number + 1]`;
  await clickhouse(
    target,
    `INSERT INTO \`${database}\`.player_might_history (player_id, point, created_at)
     SELECT ${PLAYERS.mighty.id}, ${point}, now() - toIntervalMinute(60 * (${MIGHT_HOURS} - number) + 1)
     FROM numbers(${MIGHT_HOURS + 1})`,
  );
}

export async function removeMight(target: ClickHouseTarget, database: string): Promise<void> {
  await clickhouse(
    target,
    `ALTER TABLE \`${database}\`.player_might_history DELETE WHERE player_id BETWEEN ${SCENARIO_FIRST_ID} AND ${SCENARIO_LAST_ID}`,
  );
}
