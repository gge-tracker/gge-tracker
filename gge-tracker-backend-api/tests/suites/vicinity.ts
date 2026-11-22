import { Report, Section } from '../lib/report';
import { Seeds } from '../lib/bootstrap';
import { HttpResult, request } from '../lib/http';
import { discard } from '../lib/journal';
import { ServerEntry, discoverServers } from '../lib/servers-source';
import { FixtureDatabase, fixtureHost, isLocalHost, openFixtureDatabase } from '../lib/postgres';
import { CacheClient, openMockedCache } from '../lib/redis';
import { localTarget } from '../lib/clickhouse';
import {
  PLAYERS,
  ScenarioName,
  mightAt,
  removeMight,
  removeScenario,
  seedMight,
  seedScenario,
} from '../lib/vicinity-scenario';

const HOUR_MS = 3_600_000;
const TIME_TOLERANCE_MS = 120_000;

interface ExpectedEvent {
  type: string;
  by: ScenarioName;
  hoursAgo: number;
  fields?: Record<string, unknown>;
}

// Distances worked out by hand from the scenario's coordinates, the x axis wrapping at 1287
const EVENTS_WITHIN_30: ExpectedEvent[] = [
  { type: 'protection_ended', by: 'foe', hoursAgo: 1, fields: { ended_early: true, distance: 17.1, origin: 0 } },
  { type: 'player_renamed', by: 'ally', hoursAgo: 2, fields: { old_name: 'Vicinity_old_name', distance: 10, is_ally: true } },
  { type: 'might_spike', by: 'mighty', hoursAgo: 2, fields: { change: mightAt(2) - mightAt(3), distance: 30, origin: 1 } },
  { type: 'might_spike', by: 'mighty', hoursAgo: 3, fields: { change: mightAt(3) - mightAt(4), typical_hourly_change: 10_000 } },
  { type: 'alliance_changed', by: 'foe', hoursAgo: 3, fields: { left_my_alliance: true, joined_my_alliance: false } },
  { type: 'player_appeared', by: 'newbie', hoursAgo: 4, fields: { new_account: true, distance: 25 } },
  { type: 'protection_started', by: 'newbie', hoursAgo: 4 },
  { type: 'castle_captured', by: 'raider', hoursAgo: 5, fields: { castle_type: 4, distance: 10.2, origin: 1, position: { x: 12, y: 1500 } } },
  { type: 'castle_relocated', by: 'mover', hoursAgo: 6, fields: { distance: 22.4, previous_distance: 590.1, origin: 0 } },
  { type: 'castle_relocated', by: 'leaver', hoursAgo: 8, fields: { distance: 597, previous_distance: 15, previous_origin: 0 } },
  { type: 'ruin_started', by: 'ruined', hoursAgo: 10, fields: { distance: 20, origin: 0 } },
  { type: 'protection_ended', by: 'old', hoursAgo: 20, fields: { ended_early: false, distance: 7.1 } },
];

const EVENTS_FROM_30_TO_50: ExpectedEvent[] = [
  { type: 'alliance_changed', by: 'far', hoursAgo: 2, fields: { distance: 45, joined_my_alliance: false } },
  { type: 'castle_founded', by: 'outsider', hoursAgo: 7, fields: { distance: 31, origin: 1, position: { x: 10, y: 1521 } } },
];

const NEIGHBOURS_WITHIN_30: [ScenarioName, number][] = [
  ['old', 7.1],
  ['ally', 10],
  ['raider', 10.2],
  ['foe', 17.1],
  ['ruined', 20],
  ['mover', 22.4],
  ['newbie', 25],
  ['mighty', 30],
];

const NEIGHBOURS_FROM_30_TO_50: [ScenarioName, number][] = [
  ['outsider', 31],
  ['far', 45],
];

interface Context {
  section: Section;
  server: ServerEntry;
  db: FixtureDatabase;
  mightSeeded: boolean;
}

function idOf(ctx: Context, name: ScenarioName): string {
  return `${PLAYERS[name].id}${ctx.server.code}`;
}

function vicinity(ctx: Context, name: ScenarioName | string, query = '', headers?: Record<string, string>): Promise<HttpResult> {
  const id = name in PLAYERS ? idOf(ctx, name as ScenarioName) : name;
  return request({ path: `/players/${id}/vicinity${query}`, headers });
}

function judge(section: Section, name: string, problems: string[], expected: string): void {
  const shown = problems.slice(0, 8).join('; ');
  section.expect(name, {
    ok: problems.length === 0,
    detail: problems.length === 0 ? expected : shown,
    expected,
    actual: problems.length === 0 ? expected : shown,
  });
}

function sameValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function eventProblems(ctx: Context, events: any[], expected: ExpectedEvent[], startedAt: number): string[] {
  const problems: string[] = [];
  const wanted = expected.filter((event) => ctx.mightSeeded || event.type !== 'might_spike');
  const actual = events.filter((event) => ctx.mightSeeded || event.type !== 'might_spike');
  if (actual.length !== wanted.length) {
    problems.push(`${actual.length} events, expected ${wanted.length}: ${actual.map((event) => `${event.type}/${event.player_name}`).join(', ')}`);
  }
  const remaining = [...actual];
  for (const event of wanted) {
    const at = startedAt - event.hoursAgo * HOUR_MS;
    const index = remaining.findIndex(
      (candidate) =>
        candidate.type === event.type &&
        candidate.player_id === idOf(ctx, event.by) &&
        Math.abs(Date.parse(candidate.occurred_at) - at) <= TIME_TOLERANCE_MS,
    );
    if (index === -1) {
      problems.push(`missing ${event.type} of ${event.by} ${event.hoursAgo}h ago`);
      continue;
    }
    const [found] = remaining.splice(index, 1);
    for (const [field, value] of Object.entries(event.fields ?? {})) {
      if (!sameValue(found[field], value)) problems.push(`${event.type} of ${event.by}: ${field} ${JSON.stringify(found[field])}, expected ${JSON.stringify(value)}`);
    }
  }
  const order = actual.map((event) => event.occurred_at);
  if (order.some((at, index) => index > 0 && at > order[index - 1])) problems.push('events are not newest first');
  return problems;
}

function neighbourProblems(ctx: Context, neighbours: any[], expected: [ScenarioName, number][]): string[] {
  const actual = neighbours.map((neighbour) => `${neighbour.player_id}@${neighbour.distance}`);
  const wanted = [...expected].sort((a, b) => a[1] - b[1]).map(([name, distance]) => `${idOf(ctx, name)}@${distance}`);
  return sameValue(actual, wanted) ? [] : [`got ${actual.join(', ')}; expected ${wanted.join(', ')}`];
}

function neighbour(ctx: Context, body: any, name: ScenarioName): any {
  return (body?.neighbours ?? []).find((entry: any) => entry.player_id === idOf(ctx, name));
}

async function checkWithin30(ctx: Context): Promise<void> {
  const startedAt = Date.now();
  const result = await vicinity(ctx, 'me');
  const body = result.body ?? {};
  judge(ctx.section, 'vicinity: answers 200 with a 30 tile radius by default', result.status === 200 && body.radius === 30 ? [] : [`HTTP ${result.status}, radius ${body.radius}`], '200, radius 30');
  judge(
    ctx.section,
    'vicinity: measures from the main castle and outposts only',
    sameValue(body.origins, [
      { origin: 0, castle_type: 1, x: 10, y: 1450 },
      { origin: 1, castle_type: 4, x: 10, y: 1490 },
    ])
      ? []
      : [`origins ${JSON.stringify(body.origins)}`],
    'main castle then outpost, the monument left out',
  );
  judge(
    ctx.section,
    'vicinity: lists exactly the players with a castle inside the radius, nearest first',
    neighbourProblems(ctx, body.neighbours ?? [], NEIGHBOURS_WITHIN_30),
    'the eight scenario neighbours, across the map edge and on the boundary, monuments and towers never counting',
  );
  judge(
    ctx.section,
    'vicinity: reports exactly the events of the last 7 days within the radius',
    eventProblems(ctx, body.events ?? [], EVENTS_WITHIN_30, startedAt),
    'every scenario event once, none older than 7 days, none of my own, none about monuments',
  );
  checkNeighbourDetails(ctx, body);
}

function checkNeighbourDetails(ctx: Context, body: any): void {
  const problems: string[] = [];
  const expect = (name: ScenarioName, field: string, value: unknown): void => {
    const found = neighbour(ctx, body, name);
    if (!found) problems.push(`${name} not listed`);
    else if (!sameValue(found[field], value)) problems.push(`${name}.${field} ${JSON.stringify(found[field])}, expected ${JSON.stringify(value)}`);
  };
  expect('foe', 'honor_24h', { gained: 40, lost: 0, changes: 1 });
  expect('foe', 'honor_7d', { gained: 40, lost: 10, changes: 2 });
  expect('foe', 'is_ally', false);
  expect('ally', 'is_ally', true);
  expect('newbie', 'in_protection', true);
  expect('old', 'in_protection', false);
  expect('ruined', 'is_ruin', true);
  expect('raider', 'castles', [{ x: 12, y: 1500, castle_type: 4, distance: 10.2, origin: 1 }]);
  if (ctx.mightSeeded) {
    expect('mighty', 'might_change_24h', mightAt(0) - mightAt(23));
    expect('mighty', 'might_change_7d', mightAt(0) - mightAt(167));
  }
  judge(ctx.section, 'vicinity: neighbour honor, protection, ruin and might match the seeded history', problems, 'every seeded value read back');
}

async function checkWithin50(ctx: Context): Promise<void> {
  const startedAt = Date.now();
  const result = await vicinity(ctx, 'me', '?radius=50');
  const body = result.body ?? {};
  judge(
    ctx.section,
    'vicinity: a wider radius adds exactly the players and events between the two',
    [
      ...neighbourProblems(ctx, body.neighbours ?? [], [...NEIGHBOURS_WITHIN_30, ...NEIGHBOURS_FROM_30_TO_50]),
      ...eventProblems(ctx, body.events ?? [], [...EVENTS_WITHIN_30, ...EVENTS_FROM_30_TO_50], startedAt),
    ],
    'radius 50 adds the outsider at 31 and the far player at 45',
  );
}

async function checkRefusals(ctx: Context): Promise<void> {
  const problems: string[] = [];
  for (const radius of ['4', '51', 'abc', '30.5', '-5']) {
    const result = await vicinity(ctx, 'me', `?radius=${radius}`);
    if (result.status !== 400 || result.body?.code !== 'INVALID_VICINITY_RADIUS') problems.push(`radius ${radius}: HTTP ${result.status} ${result.body?.code}`);
  }
  const unknown = await vicinity(ctx, `${99_000_999}${ctx.server.code}`);
  if (unknown.status !== 404) problems.push(`unknown player: HTTP ${unknown.status}`);
  const malformed = await vicinity(ctx, 'not-an-id');
  if (malformed.status !== 400) problems.push(`malformed id: HTTP ${malformed.status}`);
  judge(ctx.section, 'vicinity: refuses a radius outside 5-50, a malformed id and an unknown player', problems, '400 INVALID_VICINITY_RADIUS, 400, 404');

  const castleless = await vicinity(ctx, 'castleless');
  const body = castleless.body ?? {};
  judge(
    ctx.section,
    'vicinity: a player with no castle on the map gets an empty neighbourhood',
    castleless.status === 200 && sameValue([body.origins, body.neighbours, body.events], [[], [], []]) ? [] : [`HTTP ${castleless.status} ${castleless.raw.slice(0, 160)}`],
    '200 with no origins, neighbours or events',
  );
}

async function checkCaching(ctx: Context): Promise<void> {
  const first = await vicinity(ctx, 'me');
  const again = await vicinity(ctx, 'me');
  const etag = String(first.headers?.etag ?? '');
  const conditional = await vicinity(ctx, 'me', '', { 'If-None-Match': etag });
  const problems: string[] = [];
  if (!sameValue(first.body, again.body)) problems.push('a repeated request answered a different body');
  if (etag === '') problems.push('no ETag');
  if (conditional.status !== 304) problems.push(`If-None-Match answered ${conditional.status}`);
  judge(ctx.section, 'vicinity: a repeat is served from cache and a matching ETag answers 304', problems, 'same body, then 304');
}

async function isolateCache(cache: CacheClient, server: string): Promise<() => Promise<void>> {
  const versionKey = `fill-version:${server}`;
  const previous = await cache.get(versionKey);
  const harness = `harness-vicinity-${Date.now()}`;
  await cache.set(versionKey, harness);
  return async () => {
    if (previous === null) await cache.del(versionKey);
    else await cache.set(versionKey, previous);
    const keys = await cache.keys(`vicinity:${server}:${harness}:*`);
    if (keys.length > 0) await cache.del(keys);
  };
}

export async function runVicinity(report: Report, seeds: Seeds): Promise<void> {
  const section = report.section('vicinity');
  const server = discoverServers().find((entry) => entry.key === seeds.server);
  if (!server?.sqlDatabase) {
    section.skip('vicinity suite', `${seeds.server ?? 'no server'} has no database in the servers file`);
    return;
  }
  if (!isLocalHost(fixtureHost())) {
    section.skip('vicinity suite', `it seeds rows, and ${fixtureHost()} is not local`);
    return;
  }
  const db = openFixtureDatabase(server.sqlDatabase);
  const clickhouse = localTarget();
  let cache: CacheClient | undefined;
  let restore: (() => Promise<void>) | undefined;
  let mightSeeded = false;
  try {
    try {
      await db.query('SELECT 1 FROM player_state_history LIMIT 1', [], 'probe');
    } catch (error: any) {
      section.skip('vicinity suite', `${server.sqlDatabase} is unreachable or not migrated: ${error?.message ?? error}`);
      return;
    }
    cache = await openMockedCache();
    restore = await isolateCache(cache, server.key);
    await seedScenario(db);
    try {
      await seedMight(clickhouse, server.olapDatabase);
      mightSeeded = true;
    } catch (error: any) {
      section.skip('vicinity might spikes', `ClickHouse ${clickhouse.url} refused the scenario readings: ${error?.message ?? error}`);
    }
    discard();

    const ctx: Context = { section, server, db, mightSeeded };
    await checkWithin30(ctx);
    await checkWithin50(ctx);
    await checkRefusals(ctx);
    await checkCaching(ctx);
  } finally {
    await removeScenario(db).catch(() => undefined);
    if (mightSeeded) await removeMight(clickhouse, server.olapDatabase).catch(() => undefined);
    await restore?.().catch(() => undefined);
    await cache?.quit().catch(() => undefined);
    await db.close();
  }
}
