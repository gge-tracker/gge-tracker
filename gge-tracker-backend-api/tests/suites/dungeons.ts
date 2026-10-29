import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { HttpResult, request } from '../lib/http';
import { discard } from '../lib/journal';
import { ServerEntry, discoverServers } from '../lib/servers-source';
import { FixtureDatabase, fixtureHost, isLocalHost, openFixtureDatabase } from '../lib/postgres';
import { CacheClient, openMockedCache } from '../lib/redis';
import {
  DungeonTruth,
  ExpectedDungeon,
  byDefaultOrder,
  byPosition,
  databaseNowMs,
  displayedDistance,
  effectiveCooldownMs,
  expectedDungeon,
  fieldDifferences,
  keyOf,
  normalizeDungeon,
  readDungeonTruth,
  readPlayerAttacksWithDungeonJoin,
  readPlayerCooldowns,
  wrappedDistanceSquared,
} from '../lib/dungeon-truth';
import {
  SCENARIO,
  SCENARIO_KID,
  ScenarioPlayer,
  IsolatedCache,
  ScenarioPlayers,
  SeededScenario,
  effectiveAt,
  globalAt,
  isolateDungeonCache,
  pickScenarioPlayers,
  removeScenario,
  scenarioDungeon,
  seedScenario,
} from '../lib/dungeon-scenario';

const REALM_KIDS = [1, 2, 3];
const REALM_CASTLE_TYPE = 12;
const LISTED_PROBLEMS = 8;
const BOUNDARY_TOLERANCE_MS = 10_000;
const PARALLEL_REQUESTS = 8;
const WHOLE_LIST = 4000;
const SOON_SECONDS = { '2': 300, '3': 3600 } as const;

const SUMMARY_FIELDS: (keyof ExpectedDungeon)[] = ['total_attack_count', 'last_attack', 'available_duration_seconds'];
const ATTACKER_FIELDS: (keyof ExpectedDungeon)[] = ['player_id', 'player_name', 'player_might', 'player_level', 'player_legendary_level'];
const COOLDOWN_FIELDS: (keyof ExpectedDungeon)[] = ['global_available_at', 'effective_cooldown_until'];

interface Context {
  section: Section;
  seeds: Seeds;
  server: ServerEntry;
  db: FixtureDatabase;
  truth: Map<string, DungeonTruth>;
}

interface Named {
  id: number;
  name: string;
}

function queryString(parameters: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) search.set(name, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function list(ctx: Context, parameters: Record<string, string | number | undefined>): Promise<HttpResult> {
  return request({ path: '/dungeons' + queryString(parameters), headers: ctx.seeds.serverHeader() });
}

function rowsOf(result: HttpResult): any[] {
  return Array.isArray(result.body?.dungeons) ? result.body.dungeons : [];
}

function summarize(problems: string[]): string {
  const shown = problems.slice(0, LISTED_PROBLEMS).join('; ');
  return problems.length > LISTED_PROBLEMS ? `${problems.length} problems: ${shown} ...` : shown;
}

function judge(section: Section, name: string, problems: string[], expected: string, passed: string): void {
  section.expect(name, {
    ok: problems.length === 0,
    detail: problems.length === 0 ? passed : summarize(problems),
    expected,
    actual: problems.length === 0 ? passed : summarize(problems),
  });
}

function statusProblems(result: HttpResult, expected: number): string[] {
  return result.status === expected ? [] : [`HTTP ${result.status}, expected ${expected}: ${result.raw.slice(0, 160)}`];
}

function membershipProblems(rows: any[], expectedKeys: string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) problems.push(`${key} listed twice`);
    seen.add(key);
  }
  const wanted = new Set(expectedKeys);
  for (const key of wanted) if (!seen.has(key)) problems.push(`${key} missing`);
  for (const key of seen) if (!wanted.has(key)) problems.push(`${key} should not be listed`);
  return problems;
}

function sequenceProblems(actual: string[], expected: string[]): string[] {
  const index = actual.findIndex((key, position) => key !== expected[position]);
  if (index === -1 && actual.length === expected.length) return [];
  const at = index === -1 ? actual.length : index;
  return [`position ${at}: expected ${expected[at]}, got ${actual[at]}`];
}

function orderProblems(rows: any[], expectedKeys: string[]): string[] {
  return sequenceProblems(rows.map(keyOf), expectedKeys);
}

function valueProblems(rows: any[], expected: Map<string, ExpectedDungeon>, fields: (keyof ExpectedDungeon)[]): string[] {
  const problems: string[] = [];
  for (const row of rows) {
    const wanted = expected.get(keyOf(row));
    if (!wanted) continue;
    for (const difference of fieldDifferences(wanted, normalizeDungeon(row), fields)) problems.push(`${keyOf(row)} ${difference}`);
  }
  return problems;
}

function paginationProblems(result: HttpResult, total: number, size: number, page: number): string[] {
  const pagination = result.body?.pagination ?? {};
  const totalPages = Math.max(1, Math.ceil(total / size));
  const problems: string[] = [];
  if (pagination.total_items_count !== total) problems.push(`total_items_count ${pagination.total_items_count}, expected ${total}`);
  if (pagination.total_pages !== totalPages) problems.push(`total_pages ${pagination.total_pages}, expected ${totalPages}`);
  if (pagination.current_page !== page) problems.push(`current_page ${pagination.current_page}, expected ${page}`);
  if (pagination.current_items_count !== rowsOf(result).length) {
    problems.push(`current_items_count ${pagination.current_items_count} for ${rowsOf(result).length} rows`);
  }
  return problems;
}

function truthOfKids(ctx: Context, kids: number[]): DungeonTruth[] {
  return [...ctx.truth.values()].filter((dungeon) => kids.includes(dungeon.kid));
}

function expectedOf(ctx: Context, dungeons: DungeonTruth[], cooldowns?: Map<string, number>): Map<string, ExpectedDungeon> {
  return new Map(dungeons.map((dungeon) => [dungeon.key, expectedDungeon(dungeon, ctx.server.code, cooldowns?.get(dungeon.key))]));
}

function isNearBoundary(effectiveMs: number, nowMs: number): boolean {
  return [0, 300_000, 3_600_000].some((offset) => Math.abs(effectiveMs - nowMs - offset) < BOUNDARY_TOLERANCE_MS);
}

function matchesCooldownFilter(filter: string, effectiveMs: number, nowMs: number): boolean {
  if (filter === '1') return effectiveMs <= nowMs;
  const remainingSeconds = (effectiveMs - nowMs) / 1000;
  return remainingSeconds > 0 && remainingSeconds <= SOON_SECONDS[filter as '2' | '3'];
}

async function inParallel<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(PARALLEL_REQUESTS, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(lanes);
}

async function checkFullListing(ctx: Context): Promise<void> {
  const nowMs = await databaseNowMs(ctx.db);
  const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]' });
  const rows = rowsOf(result);
  const expected = expectedOf(ctx, truthOfKids(ctx, REALM_KIDS));

  judge(
    ctx.section,
    'lists every dungeon of the three kingdoms exactly once',
    [...statusProblems(result, 200), ...membershipProblems(rows, [...expected.keys()]), ...paginationProblems(result, expected.size, Math.max(expected.size, 1), 1)],
    `the ${expected.size} dungeons of kingdoms 1, 2 and 3 in the fixture, on one page`,
    `${rows.length} dungeons`,
  );
  judge(
    ctx.section,
    'attack count, last attack and free time match the attack history',
    valueProblems(rows, expected, SUMMARY_FIELDS),
    'total_attack_count = attacks in dungeons_history (null when none), last_attack = the latest one, available_duration_seconds = gap between the last two attacks minus 24h, floored at 0',
    `${rows.length} dungeons checked`,
  );
  judge(
    ctx.section,
    'the last attacker is named with his current profile',
    valueProblems(rows, expected, ATTACKER_FIELDS),
    'player_id = latest attacker id + server code; name, might, level and legendary level from players',
    `${rows.length} dungeons checked`,
  );
  judge(
    ctx.section,
    'without a player, the effective cooldown is the global one',
    valueProblems(rows, expected, COOLDOWN_FIELDS),
    'effective_cooldown_until = global_available_at for every dungeon when no filterByPlayerName is sent',
    `${rows.length} dungeons checked`,
  );
  judge(
    ctx.section,
    'attackable dungeons come first, then the shortest cooldown, then the position',
    orderProblems(rows, [...expected.values()].sort(byDefaultOrder(nowMs)).map(keyOf)),
    'effective_cooldown_until <= now first, then effective_cooldown_until ascending, then kid, x, y',
    'order respected',
  );
}

async function checkKingdomFilter(ctx: Context): Promise<void> {
  for (const kids of [[1], [2], [3], [1, 3]]) {
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: JSON.stringify(kids) });
    const expected = truthOfKids(ctx, kids).map((dungeon) => dungeon.key);
    judge(
      ctx.section,
      `filterByKid=${JSON.stringify(kids)} lists exactly the dungeons of those kingdoms`,
      [...statusProblems(result, 200), ...membershipProblems(rowsOf(result), expected)],
      `${expected.length} dungeons`,
      `${rowsOf(result).length} dungeons`,
    );
  }

  const sameAs = async (label: string, filterByKid: string | undefined, kids: number[]): Promise<void> => {
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid });
    judge(
      ctx.section,
      label,
      [...statusProblems(result, 200), ...membershipProblems(rowsOf(result), truthOfKids(ctx, kids).map((dungeon) => dungeon.key))],
      `the dungeons of kingdoms ${kids.join(', ')}`,
      `${rowsOf(result).length} dungeons`,
    );
  };
  await sameAs('without filterByKid, only kingdom 2 is listed', undefined, [2]);
  await sameAs('kingdom ids sent as strings are accepted', '["1"]', [1]);
  await sameAs('a kingdom id out of 0-9 is ignored next to a valid one', '[1,42]', [1]);

  for (const [filterByKid, why] of [
    ['[42]', 'only kingdoms out of range'],
    ['[]', 'no kingdom'],
    ['{"kid":1}', 'not an array'],
    ['1,2', 'not JSON'],
  ]) {
    const result = await list(ctx, { page: 1, filterByKid });
    judge(ctx.section, `filterByKid with ${why} is refused`, statusProblems(result, 400), '400', 'HTTP 400');
  }
}

async function checkPaging(ctx: Context): Promise<void> {
  const size = 50;
  const kids = [3];
  const full = rowsOf(await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: JSON.stringify(kids) }));
  const total = truthOfKids(ctx, kids).length;
  const pages = Math.ceil(total / size);
  const collected: any[] = [];
  const problems: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const result = await list(ctx, { page, size, filterByKid: JSON.stringify(kids) });
    problems.push(...statusProblems(result, 200), ...paginationProblems(result, total, size, page).map((p) => `page ${page}: ${p}`));
    collected.push(...rowsOf(result));
  }
  judge(
    ctx.section,
    `paging kingdom 3 by ${size} returns the full list once, in order`,
    [...problems, ...membershipProblems(collected, full.map(keyOf)), ...orderProblems(collected, full.map(keyOf))],
    `${pages} pages whose concatenation equals the whole list`,
    `${pages} pages, ${collected.length} dungeons`,
  );

  const pastEnd = await list(ctx, { page: pages + 1, size, filterByKid: JSON.stringify(kids) });
  judge(
    ctx.section,
    'a page past the end is empty but keeps the total',
    [...statusProblems(pastEnd, 200), ...(rowsOf(pastEnd).length === 0 ? [] : [`${rowsOf(pastEnd).length} rows`]), ...(pastEnd.body?.pagination?.total_items_count === total ? [] : [`total_items_count ${pastEnd.body?.pagination?.total_items_count}`])],
    `200, no dungeon, total_items_count ${total}`,
    'empty page',
  );

  const zero = await list(ctx, { page: 1, size: 0, filterByKid: JSON.stringify(kids) });
  judge(
    ctx.section,
    'size=0 returns the whole list, up to 4000',
    [...statusProblems(zero, 200), ...orderProblems(rowsOf(zero), full.map(keyOf))],
    `the ${full.length} dungeons of kingdom 3 on one page, as documented`,
    `${rowsOf(zero).length} dungeons`,
  );

  const firstFifteen = full.slice(0, 15).map(keyOf);
  for (const [label, parameters] of [
    ['without size, a page holds 15 dungeons', { page: 1 }],
    ['a size that is not a number falls back to 15', { page: 1, size: 'abc' }],
    ['a negative size falls back to 15', { page: 1, size: -5 }],
    ['an empty size falls back to 15', { page: 1, size: '' }],
    ['page 0 is read as page 1', { page: 0 }],
    ['a page that is not a number is read as page 1', { page: 'abc' }],
  ] as [string, Record<string, string | number>][]) {
    const result = await list(ctx, { ...parameters, filterByKid: JSON.stringify(kids) });
    judge(ctx.section, label, [...statusProblems(result, 200), ...orderProblems(rowsOf(result), firstFifteen), ...(rowsOf(result).length === 15 ? [] : [`${rowsOf(result).length} rows`])], 'the first 15 dungeons of the full list', '15 dungeons');
  }
}

async function checkCooldownFilters(ctx: Context): Promise<void> {
  const dungeons = truthOfKids(ctx, REALM_KIDS);
  for (const filter of ['1', '2', '3']) {
    const nowMs = await databaseNowMs(ctx.db);
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]', filterByAttackCooldown: filter });
    const ambiguous = new Set(dungeons.filter((d) => isNearBoundary(d.globalMs, nowMs)).map((d) => d.key));
    const expected = dungeons.filter((d) => !ambiguous.has(d.key) && matchesCooldownFilter(filter, d.globalMs, nowMs)).map((d) => d.key);
    const rows = rowsOf(result).filter((row) => !ambiguous.has(keyOf(row)));
    judge(
      ctx.section,
      `filterByAttackCooldown=${filter} on the fixture keeps exactly the matching dungeons`,
      [...statusProblems(result, 200), ...membershipProblems(rows, expected)],
      `${expected.length} dungeons whose global cooldown ${filter === '1' ? 'has ended' : `ends within ${SOON_SECONDS[filter as '2' | '3'] / 60} min`}`,
      `${rows.length} dungeons`,
    );
  }

  const unfiltered = dungeons.length;
  for (const value of ['0', '7', 'abc']) {
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]', filterByAttackCooldown: value });
    judge(
      ctx.section,
      `filterByAttackCooldown=${value} filters nothing`,
      [...statusProblems(result, 200), ...(result.body?.pagination?.total_items_count === unfiltered ? [] : [`total_items_count ${result.body?.pagination?.total_items_count}`])],
      `${unfiltered} dungeons, as without the filter`,
      `${unfiltered} dungeons`,
    );
  }
  for (const value of ['-1', '100000000']) {
    const result = await list(ctx, { page: 1, filterByAttackCooldown: value });
    judge(ctx.section, `filterByAttackCooldown=${value} is refused`, statusProblems(result, 400), '400', 'HTTP 400');
  }
}

async function pickPlayers(ctx: Context): Promise<{ heaviest?: Named; untouched?: Named }> {
  const [heaviest] = await ctx.db.query<Named>(
    `
      SELECT P.id, P.name FROM dungeon_player_cooldowns DPC JOIN players P ON P.id = DPC.player_id
      WHERE (SELECT count(*) FROM players Q WHERE lower(Q.name) = lower(P.name)) = 1
      GROUP BY P.id, P.name ORDER BY count(*) DESC, P.id LIMIT 1
    `,
    [],
    'player-with-most-cooldowns',
  );
  const [untouched] = await ctx.db.query<Named>(
    `
      SELECT P.id, P.name FROM players P
      WHERE NOT EXISTS (SELECT 1 FROM dungeon_player_cooldowns DPC WHERE DPC.player_id = P.id)
        AND (SELECT count(*) FROM players Q WHERE lower(Q.name) = lower(P.name)) = 1
      ORDER BY P.id LIMIT 1
    `,
    [],
    'player-without-cooldown',
  );
  return { heaviest, untouched };
}

async function checkPlayerCooldowns(ctx: Context): Promise<void> {
  const { heaviest, untouched } = await pickPlayers(ctx);
  const dungeons = truthOfKids(ctx, REALM_KIDS);

  for (const [player, who] of [
    [heaviest, 'a player who attacked many dungeons'],
    [untouched, 'a player who never attacked a dungeon'],
  ] as [Named | undefined, string][]) {
    if (!player) {
      ctx.section.skip(`${who}: effective cooldown is max(global, own)`, 'no such player in the fixture');
      continue;
    }
    const cooldowns = await readPlayerCooldowns(ctx.db, player.id);
    const nowMs = await databaseNowMs(ctx.db);
    const expected = expectedOf(ctx, dungeons, cooldowns);
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]', filterByPlayerName: player.name });
    const rows = rowsOf(result);
    judge(
      ctx.section,
      `${who}: filterByPlayerName lists every dungeon, it does not narrow`,
      [...statusProblems(result, 200), ...membershipProblems(rows, [...expected.keys()])],
      `the ${expected.size} dungeons of the unfiltered list`,
      `${rows.length} dungeons`,
    );
    judge(
      ctx.section,
      `${who}: effective cooldown is max(global, own) on every dungeon`,
      valueProblems(rows, expected, COOLDOWN_FIELDS),
      `${cooldowns.size} own cooldowns in dungeon_player_cooldowns; effective_cooldown_until = the later of the two, global when none`,
      `${rows.length} dungeons checked`,
    );
    judge(
      ctx.section,
      `${who}: the list is ordered by his own effective cooldown`,
      orderProblems(rows, [...expected.values()].sort(byDefaultOrder(nowMs)).map(keyOf)),
      'attackable for this player first, then his effective cooldown ascending, then the position',
      'order respected',
    );

    const loose = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]', filterByPlayerName: `  ${player.name.toUpperCase()}  ` });
    const cooldownOf = (row: any): string => `${keyOf(row)}@${row.effective_cooldown_until}`;
    judge(
      ctx.section,
      `${who}: the name matches regardless of case and surrounding spaces`,
      [...statusProblems(loose, 200), ...sequenceProblems(rowsOf(loose).map(cooldownOf), rows.map(cooldownOf))],
      `"  ${player.name.toUpperCase()}  " answers what "${player.name}" does`,
      'identical list',
    );
  }

  if (heaviest) {
    const cooldowns = await readPlayerCooldowns(ctx.db, heaviest.id);
    const nowMs = await databaseNowMs(ctx.db);
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]', filterByPlayerName: heaviest.name, filterByAttackCooldown: 1 });
    const ambiguous = new Set(dungeons.filter((d) => isNearBoundary(effectiveCooldownMs(d, cooldowns.get(d.key)), nowMs)).map((d) => d.key));
    const expected = dungeons.filter((d) => !ambiguous.has(d.key) && effectiveCooldownMs(d, cooldowns.get(d.key)) <= nowMs).map((d) => d.key);
    judge(
      ctx.section,
      'with a player, "attackable now" uses his own cooldown',
      [...statusProblems(result, 200), ...membershipProblems(rowsOf(result).filter((row) => !ambiguous.has(keyOf(row))), expected)],
      `${expected.length} dungeons whose max(global, own) cooldown has ended`,
      `${rowsOf(result).length} dungeons`,
    );
  }

  const unknown = await list(ctx, { page: 1, filterByKid: '[1,2,3]', filterByPlayerName: 'zz-no-such-player-zz' });
  judge(
    ctx.section,
    'an unknown filterByPlayerName answers an empty list',
    [...statusProblems(unknown, 200), ...(rowsOf(unknown).length === 0 && unknown.body?.pagination?.total_items_count === 0 ? [] : [`${rowsOf(unknown).length} rows, total ${unknown.body?.pagination?.total_items_count}`])],
    '200, no dungeon, total_items_count 0',
    'empty',
  );
  const tooLong = await list(ctx, { page: 1, filterByPlayerName: 'a'.repeat(41) });
  judge(ctx.section, 'a filterByPlayerName over 40 characters is refused', statusProblems(tooLong, 400), '400', 'HTTP 400');
}

async function checkPositionSort(ctx: Context): Promise<void> {
  const dungeons = truthOfKids(ctx, REALM_KIDS);
  for (const [x, y] of [
    [640, 640],
    [3, 200],
  ]) {
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]', positionX: x, positionY: y });
    const rows = rowsOf(result);
    const distances = new Map(dungeons.map((d) => [d.key, wrappedDistanceSquared(d.x, d.y, x, y)]));
    const expectedOrder = dungeons
      .map((d) => ({ kid: d.kid, position_x: d.x, position_y: d.y, key: d.key }))
      .sort((a, b) => distances.get(a.key)! - distances.get(b.key)! || byPosition(a, b))
      .map((d) => d.key);
    const wrongDistances = rows
      .filter((row) => row.distance !== displayedDistance(distances.get(keyOf(row)) ?? Number.NaN))
      .map((row) => `${keyOf(row)} distance ${row.distance}, expected ${displayedDistance(distances.get(keyOf(row)) ?? Number.NaN)}`);
    judge(
      ctx.section,
      `positionX=${x}&positionY=${y} sorts by distance, the x axis wrapping at 1287`,
      [...statusProblems(result, 200), ...membershipProblems(rows, expectedOrder), ...orderProblems(rows, expectedOrder), ...wrongDistances],
      'every dungeon, distance = sqrt(min(|dx|, 1287-|dx|)^2 + dy^2) rounded to 0.1, ascending, ties by position',
      `${rows.length} dungeons`,
    );
  }

  for (const [label, parameters] of [
    ['positionX without positionY is refused', { positionX: 640 }],
    ['positionY without positionX is refused', { positionY: 640 }],
    ['a negative position is refused', { positionX: -1, positionY: 640 }],
    ['a position past 1286 is refused', { positionX: 640, positionY: 1287 }],
    ['a position that is not a number is refused', { positionX: 'abc', positionY: 640 }],
  ] as [string, Record<string, string | number>][]) {
    const result = await list(ctx, { page: 1, ...parameters });
    judge(ctx.section, label, statusProblems(result, 400), '400', 'HTTP 400');
  }
  for (const [x, y] of [
    [0, 0],
    [1286, 1286],
  ]) {
    const result = await list(ctx, { page: 1, positionX: x, positionY: y });
    judge(ctx.section, `position ${x},${y} is on the map`, statusProblems(result, 200), '200', 'HTTP 200');
  }
}

interface RealmPlayer extends Named {
  castles: Map<number, [number, number]>;
}

async function realmPlayer(ctx: Context, label: string, condition: string): Promise<RealmPlayer | undefined> {
  const [row] = await ctx.db.query(
    `
      SELECT P.id, P.name, P.castles_realm FROM players P
      WHERE jsonb_typeof(P.castles_realm) = 'array'
        AND (SELECT count(*) FROM players Q WHERE lower(Q.name) = lower(P.name)) = 1
        AND ${condition}
      ORDER BY P.id LIMIT 1
    `,
    [],
    label,
  );
  if (!row) return undefined;
  const castles = new Map<number, [number, number]>();
  for (const [kid, x, y, type] of row.castles_realm as number[][]) {
    if (type === REALM_CASTLE_TYPE && !castles.has(kid)) castles.set(kid, [x, y]);
  }
  return { id: row.id, name: row.name, castles };
}

const hasRealmCastle = (kid: number): string =>
  `EXISTS (SELECT 1 FROM jsonb_array_elements(P.castles_realm) C WHERE (C->>0)::int = ${kid} AND (C->>3)::int = ${REALM_CASTLE_TYPE})`;

function nearPlayerExpectation(ctx: Context, player: RealmPlayer, kids: number[], keep: (d: DungeonTruth) => boolean = () => true) {
  const dungeons = truthOfKids(ctx, kids.filter((kid) => player.castles.has(kid))).filter(keep);
  const distances = new Map(dungeons.map((d) => [d.key, wrappedDistanceSquared(d.x, d.y, ...player.castles.get(d.kid)!)]));
  const order = dungeons
    .map((d) => ({ kid: d.kid, position_x: d.x, position_y: d.y, key: d.key }))
    .sort((a, b) => distances.get(a.key)! - distances.get(b.key)! || byPosition(a, b))
    .map((d) => d.key);
  return { order, distances };
}

function distanceProblems(rows: any[], distances: Map<string, number>): string[] {
  return rows
    .filter((row) => distances.has(keyOf(row)) && row.distance !== displayedDistance(distances.get(keyOf(row))!))
    .map((row) => `${keyOf(row)} distance ${row.distance}, expected ${displayedDistance(distances.get(keyOf(row))!)}`);
}

async function checkNearPlayer(ctx: Context): Promise<void> {
  const everywhere = await realmPlayer(ctx, 'player-in-three-kingdoms', [1, 2, 3].map(hasRealmCastle).join(' AND '));
  const notInGlacier = await realmPlayer(ctx, 'player-without-kingdom-2', `${hasRealmCastle(1)} AND ${hasRealmCastle(3)} AND NOT ${hasRealmCastle(2)}`);
  const notInSands = await realmPlayer(ctx, 'player-without-kingdom-1', `${hasRealmCastle(2)} AND NOT ${hasRealmCastle(1)}`);

  for (const [player, who] of [
    [everywhere, 'a player with a castle in each kingdom'],
    [notInGlacier, 'a player with no castle in kingdom 2'],
    [notInSands, 'a player with no castle in kingdom 1'],
  ] as [RealmPlayer | undefined, string][]) {
    const name = `nearPlayerName, ${who}: only his kingdoms, each sorted by distance to his castle there`;
    if (!player) {
      ctx.section.skip(name, 'no such player in the fixture');
      continue;
    }
    const { order, distances } = nearPlayerExpectation(ctx, player, REALM_KIDS);
    const result = await list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: '[1,2,3]', nearPlayerName: player.name });
    const rows = rowsOf(result);
    judge(
      ctx.section,
      name,
      [...statusProblems(result, 200), ...membershipProblems(rows, order), ...orderProblems(rows, order), ...distanceProblems(rows, distances)],
      `kingdoms ${[...player.castles.keys()].filter((kid) => REALM_KIDS.includes(kid)).join(', ')}; distance to the realm castle of the same kingdom, ascending`,
      `${rows.length} dungeons`,
    );
  }

  if (notInSands) {
    const result = await list(ctx, { page: 1, filterByKid: '[1]', nearPlayerName: notInSands.name });
    judge(
      ctx.section,
      'nearPlayerName with no castle in any requested kingdom answers an empty list',
      [...statusProblems(result, 200), ...(rowsOf(result).length === 0 ? [] : [`${rowsOf(result).length} rows`])],
      '200, no dungeon',
      'empty',
    );
  }

  if (everywhere) {
    const upper = await list(ctx, { page: 1, size: 20, filterByKid: '[1,2,3]', nearPlayerName: everywhere.name.toUpperCase() });
    const { order } = nearPlayerExpectation(ctx, everywhere, REALM_KIDS);
    judge(ctx.section, 'nearPlayerName matches regardless of case', [...statusProblems(upper, 200), ...orderProblems(rowsOf(upper), order.slice(0, 20))], 'the same first 20 dungeons', 'identical');

    const { heaviest } = await pickPlayers(ctx);
    if (heaviest) {
      const cooldowns = await readPlayerCooldowns(ctx.db, heaviest.id);
      const nowMs = await databaseNowMs(ctx.db);
      const attackable = (d: DungeonTruth): boolean => effectiveCooldownMs(d, cooldowns.get(d.key)) <= nowMs;
      const { order: expected, distances } = nearPlayerExpectation(ctx, everywhere, REALM_KIDS, attackable);
      const result = await list(ctx, {
        page: 1,
        size: WHOLE_LIST,
        filterByKid: '[1,2,3]',
        nearPlayerName: everywhere.name,
        filterByPlayerName: heaviest.name,
        filterByAttackCooldown: 1,
      });
      const rows = rowsOf(result);
      const expectedValues = expectedOf(ctx, truthOfKids(ctx, REALM_KIDS), cooldowns);
      judge(
        ctx.section,
        'nearPlayerName, filterByPlayerName and filterByAttackCooldown compose',
        [...statusProblems(result, 200), ...membershipProblems(rows, expected), ...orderProblems(rows, expected), ...distanceProblems(rows, distances), ...valueProblems(rows, expectedValues, COOLDOWN_FIELDS)],
        `the dungeons attackable now for ${heaviest.name}, sorted by distance to ${everywhere.name}`,
        `${rows.length} dungeons`,
      );
    }
  }

  const [castleless] = await ctx.db.query<Named>(
    `SELECT id, name FROM players P WHERE coalesce(jsonb_array_length(castles_realm), 0) = 0 AND (SELECT count(*) FROM players Q WHERE lower(Q.name) = lower(P.name)) = 1 ORDER BY id LIMIT 1`,
    [],
    'player-without-realm-castle',
  );
  for (const [label, name] of [
    ['an unknown nearPlayerName is refused', 'zz-no-such-player-zz'],
    ['a nearPlayerName over 60 characters is refused', 'a'.repeat(61)],
    ...(castleless ? [['nearPlayerName of a player with no realm castle is refused', castleless.name]] : []),
  ] as [string, string][]) {
    const result = await list(ctx, { page: 1, nearPlayerName: name });
    judge(ctx.section, label, statusProblems(result, 400), '400', 'HTTP 400');
  }
}

async function checkMeta(ctx: Context): Promise<void> {
  const [row] = await ctx.db.query(
    `SELECT floor(extract(epoch from updated_at) * 1000)::float8 AS ms FROM parameters WHERE identifier = 'dungeons_scan' LIMIT 1`,
    [],
    'dungeons-scan',
  );
  const result = await request({ path: '/dungeons/meta', headers: ctx.seeds.serverHeader() });
  const actual = result.body?.last_scan_at === null || result.body?.last_scan_at === undefined ? null : Date.parse(result.body.last_scan_at);
  const expected = row?.ms ?? null;
  judge(
    ctx.section,
    '/dungeons/meta reports the last scan',
    [...statusProblems(result, 200), ...(actual === expected ? [] : [`last_scan_at ${result.body?.last_scan_at}, expected ${expected === null ? null : new Date(expected).toISOString()}`])],
    "parameters.updated_at of 'dungeons_scan', null when there is none",
    String(result.body?.last_scan_at),
  );
}

async function checkUnsupportedServer(ctx: Context): Promise<void> {
  const unsupported = discoverServers().find((server) => server.key === ctx.seeds.unsupportedServer);
  if (!unsupported || unsupported.fortress) {
    ctx.section.skip('a server without dungeons is refused', 'no enabled server without the fortress feature');
    return;
  }
  for (const path of ['/dungeons?page=1', '/dungeons/meta']) {
    const result = await request({ path, headers: { 'gge-server': unsupported.key } });
    judge(ctx.section, `${path} on ${unsupported.key}, which has no dungeons, is refused`, statusProblems(result, 400), '400', 'HTTP 400');
  }
}

function playerHistory(id: string, lastDays?: number | string): Promise<HttpResult> {
  return request({ path: `/dungeons/player/${id}` + queryString({ lastDays }) });
}

function historyProblems(result: HttpResult, expected: { kid: number; x: number; y: number; attackedMs: number }[]): string[] {
  const rows: any[] = Array.isArray(result.body?.dungeons) ? result.body.dungeons : [];
  const problems = statusProblems(result, 200);
  const signature = (kid: unknown, x: unknown, y: unknown, ms: number): string => `${kid}/${x}/${y}@${ms}`;
  const actual = rows.map((row) => signature(row.kid, row.position_x, row.position_y, Date.parse(row.attacked_at))).sort();
  const wanted = expected.map((a) => signature(a.kid, a.x, a.y, a.attackedMs)).sort();
  if (actual.join() !== wanted.join()) problems.push(`${rows.length} attacks, expected ${expected.length}`);
  const descending = rows.every((row, index) => index === 0 || Date.parse(rows[index - 1].attacked_at) >= Date.parse(row.attacked_at));
  if (!descending) problems.push('not ordered by attacked_at descending');
  return problems;
}

async function checkPlayerHistory(ctx: Context): Promise<void> {
  const [range] = await ctx.db.query(
    `SELECT ceil(extract(epoch from (LOCALTIMESTAMP - min(attacked_at))) / 86400)::int AS oldest, floor(extract(epoch from (LOCALTIMESTAMP - percentile_disc(0.5) WITHIN GROUP (ORDER BY attacked_at))) / 86400)::int AS median FROM dungeons_history WHERE kid = ANY($1::smallint[])`,
    [REALM_KIDS],
    'history-range',
  );
  const attackers = await ctx.db.query<{ player_id: number }>(
    `SELECT DISTINCT player_id FROM dungeons_history WHERE kid = ANY($1::smallint[]) ORDER BY player_id`,
    [REALM_KIDS],
    'history-players',
  );
  if (attackers.length === 0) {
    ctx.section.skip('/dungeons/player matches the history of every attacker', 'no attack in the fixture');
    return;
  }

  const windows = [...new Set([365, Math.min(365, Math.max(1, range.median ?? 30)), 30])];
  for (const lastDays of windows) {
    const problems: string[] = [];
    await inParallel(attackers, async ({ player_id }) => {
      const expected = await readPlayerAttacksWithDungeonJoin(ctx.db, player_id, lastDays);
      const result = await playerHistory(`${player_id}${ctx.server.code}`, lastDays);
      for (const problem of historyProblems(result, expected)) problems.push(`player ${player_id}: ${problem}`);
    });
    judge(
      ctx.section,
      `/dungeons/player?lastDays=${lastDays} matches the joined history of all ${attackers.length} attackers`,
      problems,
      `the attacks of the last ${lastDays} days the pre-change query (joined on dungeons) returns, newest first${lastDays < (range.oldest ?? 0) ? ' - this window cuts through the fixture' : ''}`,
      `${attackers.length} players`,
    );
  }

  const sample = attackers[0].player_id;
  const withoutWindow = await playerHistory(`${sample}${ctx.server.code}`);
  judge(
    ctx.section,
    '/dungeons/player without lastDays covers 30 days',
    historyProblems(withoutWindow, await readPlayerAttacksWithDungeonJoin(ctx.db, sample, 30)),
    'the same attacks as lastDays=30',
    'identical',
  );

  const [quiet] = await ctx.db.query<{ id: number }>(
    `SELECT id FROM players P WHERE NOT EXISTS (SELECT 1 FROM dungeons_history DH WHERE DH.player_id = P.id) ORDER BY id LIMIT 1`,
    [],
    'player-without-attack',
  );
  if (quiet) {
    const result = await playerHistory(`${quiet.id}${ctx.server.code}`, 365);
    judge(ctx.section, '/dungeons/player of a player who never attacked is an empty list', historyProblems(result, []), '200, no attack', 'empty');
  }

  for (const [label, id, lastDays] of [
    ['an id that is not a number is refused', 'abc', undefined],
    ['an id with an unknown server code is refused', '12345999', undefined],
    ['lastDays=366 is refused', `${sample}${ctx.server.code}`, 366],
    ['lastDays=0 is refused', `${sample}${ctx.server.code}`, 0],
    ['a negative lastDays is refused', `${sample}${ctx.server.code}`, -5],
    ['a lastDays that is not a number is refused', `${sample}${ctx.server.code}`, 'abc'],
  ] as [string, string, number | string | undefined][]) {
    const result = await playerHistory(id, lastDays);
    judge(ctx.section, `/dungeons/player: ${label}`, statusProblems(result, 400), '400 - lastDays is documented as 1 to 365', 'HTTP 400');
  }
}

interface ScenarioView {
  label: string;
  player?: ScenarioPlayer;
}

function scenarioKey(name: string): string {
  const dungeon = scenarioDungeon(name);
  return keyOf({ kid: SCENARIO_KID, position_x: dungeon.x, position_y: dungeon.y });
}

async function scenarioList(ctx: Context, players: ScenarioPlayers, view: ScenarioView, filter?: string): Promise<HttpResult> {
  const name = view.player === undefined || view.player === 'ghost' ? undefined : players[view.player].name;
  return list(ctx, { page: 1, size: WHOLE_LIST, filterByKid: `[${SCENARIO_KID}]`, filterByPlayerName: name, filterByAttackCooldown: filter });
}

function scenarioMinutesNow(seeded: SeededScenario): number {
  return (Date.now() - seeded.startMs) / 60_000;
}

async function checkScenarioRows(ctx: Context, seeded: SeededScenario, truth: Map<string, DungeonTruth>): Promise<void> {
  const result = await scenarioList(ctx, seeded.players, { label: 'anonymous' });
  const rows = new Map(rowsOf(result).map((row) => [keyOf(row), normalizeDungeon(row)]));
  const { players } = seeded;
  const code = ctx.server.code;

  const expectRow = (label: string, name: string, wanted: Partial<ExpectedDungeon>, why: string): void => {
    const row = rows.get(scenarioKey(name));
    const problems = row
      ? Object.entries(wanted)
          .filter(([field, value]) => row[field as keyof ExpectedDungeon] !== value)
          .map(([field, value]) => `${field}: expected ${value}, got ${row[field as keyof ExpectedDungeon]}`)
      : [`${scenarioKey(name)} not listed`];
    judge(ctx.section, label, problems, why, 'as expected');
  };

  const truthOf = (name: string): DungeonTruth => truth.get(scenarioKey(name))!;
  expectRow(
    'a dungeon never attacked shows no attacker, no attack count and no free time',
    'never attacked',
    { player_id: null, player_name: null, total_attack_count: null, last_attack: null, available_duration_seconds: 0 },
    'player_id, player_name, total_attack_count and last_attack null, available_duration_seconds 0',
  );
  expectRow(
    'a dungeon attacked once names its attacker, counts 1 and has no free time',
    'attacked once, free in 2 min',
    { player_id: `${players.once.id}${code}`, player_name: players.once.name, total_attack_count: 1, last_attack: truthOf('attacked once, free in 2 min').lastAttackMs, available_duration_seconds: 0 },
    'a free time needs two attacks to be measured',
  );
  const many = truthOf('attacked four times, one recorded late');
  expectRow(
    'a dungeon attacked four times counts them all and names the latest attacker',
    'attacked four times, one recorded late',
    {
      player_id: `${players.heavy.id}${code}`,
      player_name: players.heavy.name,
      total_attack_count: 4,
      last_attack: many.lastAttackMs,
      available_duration_seconds: Math.round(4 * 86400 - 30 * 60 - 86400),
    },
    'last attack 30 min ago by the heavy attacker, the one before 4 days ago: free for 4d - 30min - 24h',
  );
  expectRow(
    'an attacker missing from players keeps his id and shows no name',
    'unknown attacker, free in 30 min',
    { player_id: `${players.ghost.id}${code}`, player_name: null, player_might: null, player_level: null, total_attack_count: 1 },
    'player_id is the attacker id, every profile field null',
  );
  judge(
    ctx.section,
    'every seeded dungeon matches its attack history',
    [
      ...statusProblems(result, 200),
      ...membershipProblems(rowsOf(result), [...truth.keys()]),
      ...valueProblems(rowsOf(result), expectedOf(ctx, [...truth.values()]), [...SUMMARY_FIELDS, ...ATTACKER_FIELDS, ...COOLDOWN_FIELDS]),
    ],
    `${SCENARIO.length} dungeons on kingdom ${SCENARIO_KID}`,
    `${rowsOf(result).length} dungeons`,
  );
}

async function checkScenarioCooldowns(ctx: Context, seeded: SeededScenario): Promise<void> {
  const views: ScenarioView[] = [
    { label: 'without a player' },
    { label: 'for a player who never attacked', player: 'never' },
    { label: 'for a player who attacked once', player: 'once' },
    { label: 'for a player who attacked many times', player: 'heavy' },
  ];
  for (const view of views) {
    const result = await scenarioList(ctx, seeded.players, view);
    const now = scenarioMinutesNow(seeded);
    const problems = statusProblems(result, 200);
    for (const row of rowsOf(result)) {
      const dungeon = SCENARIO.find((d) => keyOf({ kid: SCENARIO_KID, position_x: d.x, position_y: d.y }) === keyOf(row))!;
      const effective = (Date.parse(row.effective_cooldown_until) - seeded.startMs) / 60_000;
      const global = (Date.parse(row.global_available_at) - seeded.startMs) / 60_000;
      if (Math.abs(effective - effectiveAt(dungeon, view.player)) > 0.01) {
        problems.push(`${dungeon.name}: effective at ${effective.toFixed(1)} min, expected ${effectiveAt(dungeon, view.player)}`);
      }
      if (Math.abs(global - globalAt(dungeon)) > 0.01) problems.push(`${dungeon.name}: global at ${global.toFixed(1)} min, expected ${globalAt(dungeon)}`);
    }
    const order = [...SCENARIO]
      .sort((a, b) => {
        const ready = (d: typeof a): number => (effectiveAt(d, view.player) <= now ? 0 : 1);
        return ready(a) - ready(b) || effectiveAt(a, view.player) - effectiveAt(b, view.player) || a.x - b.x || a.y - b.y;
      })
      .map((d) => keyOf({ kid: SCENARIO_KID, position_x: d.x, position_y: d.y }));
    problems.push(...orderProblems(rowsOf(result), order));
    judge(
      ctx.section,
      `scenario ${view.label}: effective cooldowns and order`,
      problems,
      view.player === undefined
        ? 'effective = global cooldown everywhere'
        : `effective = max(global, own) where this player attacked, global elsewhere; attackable first, then the effective cooldown`,
      `${rowsOf(result).length} dungeons`,
    );

    for (const filter of ['1', '2', '3']) {
      const filtered = await scenarioList(ctx, seeded.players, view, filter);
      const at = scenarioMinutesNow(seeded);
      const expected = SCENARIO.filter((d) => matchesCooldownFilter(filter, effectiveAt(d, view.player) * 60_000, at * 60_000)).map((d) => d.name);
      const listed = rowsOf(filtered).map((row) => SCENARIO.find((d) => d.x === Number(row.position_x) && d.y === Number(row.position_y))?.name ?? keyOf(row));
      const missing = expected.filter((name) => !listed.includes(name)).map((name) => `"${name}" missing`);
      const extra = listed.filter((name) => !expected.includes(name)).map((name) => `"${name}" should not be listed`);
      judge(
        ctx.section,
        `scenario ${view.label}: filterByAttackCooldown=${filter}`,
        [...statusProblems(filtered, 200), ...missing, ...extra, ...(filtered.body?.pagination?.total_items_count === listed.length ? [] : [`total_items_count ${filtered.body?.pagination?.total_items_count} for ${listed.length} rows`])],
        expected.length === 0 ? 'no dungeon' : expected.join(', '),
        listed.join(', ') || 'none',
      );
    }
  }
}

async function checkScenarioPlayerHistory(ctx: Context, seeded: SeededScenario): Promise<void> {
  for (const player of ['heavy', 'once', 'never'] as const) {
    for (const lastDays of [365, 7]) {
      const attacks = SCENARIO.flatMap((d) => d.attacks.filter((a) => a.by === player && a.at >= -lastDays * 1440).map((a) => ({ kid: SCENARIO_KID, x: d.x, y: d.y, attackedMs: seeded.startMs + a.at * 60_000 })));
      const result = await playerHistory(`${seeded.players[player].id}${ctx.server.code}`, lastDays);
      const rows: any[] = (result.body?.dungeons ?? []).filter((row: any) => Number(row.kid) === SCENARIO_KID);
      const problems = statusProblems(result, 200);
      const signature = (a: { kid: number; x: number; y: number; attackedMs: number }): string => `${a.kid}/${a.x}/${a.y}@${Math.round(a.attackedMs / 1000)}`;
      const actual = rows.map((row) => signature({ kid: Number(row.kid), x: Number(row.position_x), y: Number(row.position_y), attackedMs: Date.parse(row.attacked_at) })).sort();
      if (actual.join() !== attacks.map(signature).sort().join()) problems.push(`${rows.length} attacks listed, expected ${attacks.length}`);
      if (!rows.every((row, index) => index === 0 || Date.parse(rows[index - 1].attacked_at) >= Date.parse(row.attacked_at))) problems.push('not newest first');
      judge(
        ctx.section,
        `scenario: /dungeons/player?lastDays=${lastDays} of the ${player === 'heavy' ? 'player who attacked many times' : player === 'once' ? 'player who attacked once' : 'player who never attacked'}`,
        problems,
        `${attacks.length} attacks, newest first, including the one recorded out of order`,
        `${rows.length} attacks`,
      );
    }
  }
}

async function runScenario(ctx: Context, cache: IsolatedCache | undefined): Promise<void> {
  const name = 'seeded scenario';
  if (!isLocalHost(fixtureHost())) {
    ctx.section.skip(name, `TEST_PG_HOST=${fixtureHost()} is not local - the scenario only ever writes to a local fixture`);
    return;
  }
  if (!cache) {
    ctx.section.skip(name, "the mocked backend's Redis is unreachable - answers cached before the seed would be served");
    return;
  }
  const excluded = ctx.seeds.playerId ? [Number(ctx.seeds.playerId.slice(0, -3))] : [];
  const players = await pickScenarioPlayers(ctx.db, excluded);
  if (!players) {
    ctx.section.skip(name, 'the fixture has no three players without dungeon history');
    return;
  }
  try {
    const seeded = await seedScenario(ctx.db, players);
    const truth = await readDungeonTruth(ctx.db, [SCENARIO_KID]);
    await cache.forgetPlayerHistories();
    const probe = await list(ctx, { page: 1, filterByKid: `[${SCENARIO_KID}]` });
    if (probe.body?.pagination?.total_items_count !== SCENARIO.length) {
      ctx.section.skip(name, `the API does not read ${ctx.db.name} on ${fixtureHost()}: it lists ${probe.body?.pagination?.total_items_count} seeded dungeons`);
      return;
    }
    discard();
    await checkScenarioRows(ctx, seeded, truth);
    await checkScenarioCooldowns(ctx, seeded);
    await checkScenarioPlayerHistory(ctx, seeded);
  } finally {
    await removeScenario(ctx.db);
  }
}

async function isolateCache(section: Section, server: string): Promise<{ cache: IsolatedCache; close(): Promise<void> } | undefined> {
  let cache: CacheClient;
  try {
    cache = await openMockedCache();
  } catch (error: any) {
    section.skip('answers are computed by the running code', `the mocked backend's Redis is unreachable (${error?.message ?? error}): cached answers may predate it`);
    return undefined;
  }
  const isolated = await isolateDungeonCache(cache, server);
  return {
    cache: isolated,
    close: async () => {
      await isolated.restore();
      await cache.quit();
    },
  };
}

export async function runDungeons(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('dungeons');
  const server = discoverServers().find((entry) => entry.key === seeds.server);
  if (!server || !server.fortress || !server.sqlDatabase) {
    section.skip('dungeons suite', `${seeds.server ?? 'no server'} does not serve dungeons on this channel`);
    return;
  }

  const db = openFixtureDatabase(server.sqlDatabase);
  let isolated: Awaited<ReturnType<typeof isolateCache>>;
  try {
    try {
      await db.query('SELECT 1', [], 'probe');
    } catch (error: any) {
      section.skip('dungeons suite', `${server.sqlDatabase} on ${fixtureHost()} is unreachable: ${error?.message ?? error}`);
      return;
    }
    if (isLocalHost(fixtureHost())) await removeScenario(db);
    isolated = await isolateCache(section, server.key);
    const ctx: Context = { section, seeds, server, db, truth: await readDungeonTruth(db, REALM_KIDS) };
    discard();

    const probe = await list(ctx, { page: 1, filterByKid: '[1,2,3]' });
    if (probe.body?.pagination?.total_items_count !== truthOfKids(ctx, REALM_KIDS).length) {
      section.skip(
        'dungeons suite',
        `the API lists ${probe.body?.pagination?.total_items_count} dungeons where ${db.name} on ${fixtureHost()} holds ${ctx.truth.size}: it does not read this database`,
      );
      return;
    }
    discard();

    await checkUnsupportedServer(ctx);
    await checkFullListing(ctx);
    await checkKingdomFilter(ctx);
    await checkPaging(ctx);
    await checkCooldownFilters(ctx);
    await checkPlayerCooldowns(ctx);
    await checkPositionSort(ctx);
    await checkNearPlayer(ctx);
    await checkMeta(ctx);
    await checkPlayerHistory(ctx);
    await runScenario(ctx, isolated?.cache);
  } finally {
    await isolated?.close();
    await db.close();
  }
}
