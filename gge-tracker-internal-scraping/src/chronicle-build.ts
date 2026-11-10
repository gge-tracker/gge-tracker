//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import axios from 'axios';
import { Pool } from 'pg';
import {
  ChronicleEntry,
  ChronicleWindow,
  EventKey,
  PlayerFeatures,
  RivalPick,
  WorldEvent,
  WorldEventRow,
  activityCalendar,
  buildEntries,
  chronicleServers,
  chronicleWindow,
  fullStoryHours,
  longestRun,
  pickRivals,
  playerTier,
  rankWorldEvent,
  serverTier,
  trackedDays,
} from './chronicle-model';
import {
  ALLIANCE_CHANGES_SQL,
  EVENT_TABLES,
  PLAYERS_SQL,
  activeDaysQuery,
  activeHoursQuery,
  eventDatesQuery,
  eventResultsQuery,
  eventRunStarts,
  firstReadingQuery,
  lootQuery,
  lootWeekStarts,
  worldEventSql,
  mightQuery,
  monthlyMightQuery,
} from './chronicle-queries';
import { appendFileSync } from 'node:fs';
import { ScrapingServer, readScrapingServers } from './servers-file';

type Row = Record<string, unknown>;

interface ChroniclePlayerRow {
  year: number;
  server: string;
  player_id: number;
  name: string;
  tier: string;
  persona: string;
  payload: string;
  built_at: number;
}

interface ChronicleServerRow {
  year: number;
  server: string;
  tier: string;
  tracked_days: number;
  data_from: number;
  data_until: number;
  players: number;
  full_players: number;
  built_at: number;
}

const PLAYERS_TABLE = 'ggetracker_global.year_chronicle';
const SERVERS_TABLE = 'ggetracker_global.year_chronicle_server';
const INSERT_BATCH = 5000;
const WORLD_EVENTS_SERVER = 'FR1';
// The event tables keep older labels for two servers
const WORLD_LABEL_ALIASES: [string, string][] = [
  ['ARAB', 'ARAB1'],
  ['LIVE', 'WORLD1'],
];
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 5000;

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
const READ_ONLY_SETTINGS = 'readonly=2&max_threads=2&max_memory_usage=6000000000';

async function withRetries<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * RETRY_DELAY_MS));
    }
  }
}

async function clickhouse(query: string): Promise<Row[]> {
  const { data } = await withRetries(() =>
    axios.post(`${CLICKHOUSE_URL}/?${READ_ONLY_SETTINGS}`, `${query} FORMAT JSONEachRow`, {
      auth: { username: process.env.CLICKHOUSE_USER ?? '', password: process.env.CLICKHOUSE_PASSWORD ?? '' },
      headers: { 'Content-Type': 'text/plain' },
      responseType: 'text',
      transformResponse: (body) => body,
      timeout: 600_000,
      maxContentLength: Infinity,
    }),
  );
  return String(data ?? '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
}

function toPlayerRow(entry: ChronicleEntry, year: number, server: string, builtAt: number): ChroniclePlayerRow {
  return {
    year,
    server,
    player_id: entry.id,
    name: entry.name,
    tier: entry.tier,
    persona: entry.persona ?? '',
    payload: JSON.stringify(entry),
    built_at: builtAt,
  };
}

function toServerRow(run: {
  window: ChronicleWindow;
  server: string;
  tier: string;
  days: number;
  firstMs: number;
  builtAt: number;
  players: number;
  fullPlayers: number;
}): ChronicleServerRow {
  return {
    year: run.window.year,
    server: run.server,
    tier: run.tier,
    tracked_days: run.days,
    data_from: Math.floor(Math.max(run.firstMs, run.window.fromMs) / 1000),
    data_until: Math.floor(run.window.untilMs / 1000),
    players: run.players,
    full_players: run.fullPlayers,
    built_at: run.builtAt,
  };
}

function toWeeklySeries(weeks: [number, number][], count: number): number[] {
  const series = new Array<number>(count).fill(0);
  for (const [week, peak] of weeks) {
    if (week >= 1 && week <= count) series[week - 1] = Number(peak);
  }
  return series;
}

function blankFeatures(id: number): PlayerFeatures {
  return {
    id,
    name: '',
    allianceId: null,
    allianceName: null,
    allianceChanges: 0,
    hours: 0,
    mightStart: 0,
    mightEnd: 0,
    mightPeak: 0,
    mightLow: 0,
    bestDay: null,
    bestDayGain: 0,
    peakDay: null,
    lootTotal: 0,
    bestWeekLoot: 0,
    bestWeekStart: null,
    weeklyLoot: [],
    activeDays: 0,
    longestStreak: 0,
    calendar: '',
    hourly: new Array(24).fill(0),
    allianceHistory: [],
    monthly: [],
    gloryCurrent: 0,
    gloryHighest: 0,
    world: {},
    firstDay: null,
    events: {},
  };
}

class FeatureTable {
  private readonly rows = new Map<number, PlayerFeatures>();

  public at(playerId: unknown): PlayerFeatures {
    const id = Number(playerId);
    let features = this.rows.get(id);
    if (!features) {
      features = blankFeatures(id);
      this.rows.set(id, features);
    }
    return features;
  }

  public find(playerId: number): PlayerFeatures | undefined {
    return this.rows.get(playerId);
  }

  public tracked(): PlayerFeatures[] {
    return [...this.rows.values()].filter((features) => features.hours > 0 && features.name !== '');
  }
}

async function readHistories(table: FeatureTable, server: ScrapingServer, window: ChronicleWindow): Promise<void> {
  const database = server.olap;
  const timezone = server.lootReset?.timezone ?? 'UTC';

  for (const row of await clickhouse(mightQuery(database, window, timezone))) {
    Object.assign(table.at(row.player_id), {
      hours: Number(row.hours),
      mightStart: Number(row.might_start),
      mightEnd: Number(row.might_end),
      mightPeak: Number(row.might_peak),
      mightLow: Number(row.might_low),
      bestDay: row.best_day ? String(row.best_day) : null,
      bestDayGain: Number(row.best_day_gain),
      peakDay: row.peak_day ? String(row.peak_day) : null,
      firstDay: row.first_day ? String(row.first_day) : null,
    });
  }

  if (server.lootReset) {
    const weekCount = lootWeekStarts(window, server.lootReset).length;
    for (const row of await clickhouse(lootQuery(database, window, server.lootReset))) {
      Object.assign(table.at(row.player_id), {
        lootTotal: Number(row.loot_total),
        bestWeekLoot: Number(row.best_week_loot),
        bestWeekStart: String(row.best_week_start),
        weeklyLoot: toWeeklySeries(row.weeks as [number, number][], weekCount),
      });
    }
  }

  for (const row of await clickhouse(activeDaysQuery(database, window, timezone))) {
    const calendar = activityCalendar(row.days as string[], window);
    Object.assign(table.at(row.player_id), {
      calendar,
      activeDays: calendar.split('1').length - 1,
      longestStreak: longestRun(calendar),
    });
  }

  for (const row of await clickhouse(activeHoursQuery(database, window, timezone))) {
    const [hours, counts] = row.hours as [number[], number[]];
    const hourly = table.at(row.player_id).hourly;
    hours.forEach((hour, index) => (hourly[hour] = Number(counts[index])));
  }
}

async function readEvents(table: FeatureTable, server: ScrapingServer, window: ChronicleWindow): Promise<void> {
  const dates = new Map(
    (await clickhouse(eventDatesQuery(server.olap, window))).map((row) => [
      String(row.table_name),
      (row.hours as (number | string)[]).map(Number),
    ]),
  );
  for (const [event, tableName] of Object.entries(EVENT_TABLES) as [EventKey, string][]) {
    const runStarts = eventRunStarts(dates.get(tableName) ?? []);
    if (runStarts.length === 0) continue;
    for (const row of await clickhouse(eventResultsQuery(server.olap, tableName, window, runStarts))) {
      table.at(row.player_id).events[event] = {
        runs: Number(row.runs),
        bestRank: Number(row.best_rank),
        podiums: Number(row.podiums),
      };
    }
  }
}

async function readIdentities(table: FeatureTable, server: ScrapingServer, window: ChronicleWindow): Promise<void> {
  const pool = new Pool({
    host: process.env.PG_HOST || 'postgres-container',
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: server.sql,
    port: 5432,
    max: 1,
    options: '-c default_transaction_read_only=on',
  });
  try {
    for (const row of (await pool.query(PLAYERS_SQL)).rows) {
      const features = table.find(Number(row.id));
      if (!features) continue;
      features.name = String(row.name);
      features.allianceId = row.alliance_id === null ? null : Number(row.alliance_id);
      features.allianceName = row.alliance_name ?? null;
      features.gloryCurrent = Number(row.current_fame ?? 0);
      features.gloryHighest = Number(row.highest_fame ?? 0);
    }
    const changes = await pool.query(ALLIANCE_CHANGES_SQL, [window.fromMs / 1000, window.untilMs / 1000]);
    for (const row of changes.rows) {
      const features = table.find(Number(row.player_id));
      if (!features) continue;
      features.allianceChanges += 1;
      features.allianceHistory.push({
        from: row.old_alliance_name ?? null,
        to: row.new_alliance_name ?? null,
        at: new Date(row.created_at).toISOString().slice(0, 10),
      });
    }
  } finally {
    await pool.end();
  }
}

function countBy<T>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[String(value)] = (counts[String(value)] ?? 0) + 1;
  return counts;
}

function summarize(server: ScrapingServer, days: number, entries: ChronicleEntry[], startedAt: number): string {
  const full = entries.filter((entry) => entry.tier === 'full');
  return JSON.stringify({
    event: 'chronicle_dry_run',
    server: server.server,
    trackedDays: days,
    tier: serverTier(days),
    players: entries.length,
    fullPlayers: full.length,
    personas: countBy(full.map((entry) => entry.persona)),
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

async function readMonthly(
  players: PlayerFeatures[],
  server: ScrapingServer,
  window: ChronicleWindow,
): Promise<number[]> {
  const rows = await clickhouse(monthlyMightQuery(server.olap, window, server.lootReset?.timezone ?? 'UTC'));
  const months = [...new Set(rows.map((row) => Number(row.month)))].sort((a, b) => a - b);
  const position = new Map(months.map((month, index) => [month, index]));
  const byId = new Map(players.map((player) => [player.id, player]));
  for (const player of players) player.monthly = new Array(months.length).fill(null);
  for (const row of rows) {
    const player = byId.get(Number(row.player_id));
    if (player) player.monthly[position.get(Number(row.month))!] = Number(row.might);
  }
  return months;
}

function monthlySnapshots(players: PlayerFeatures[], months: number[]): Map<number, number>[] {
  return months.map((_, column) => {
    const snapshot = new Map<number, number>();
    for (const player of players) {
      const might = player.monthly[column];
      if (might !== null && might !== undefined) snapshot.set(player.id, might);
    }
    return snapshot;
  });
}

interface ChronicleSink {
  players(rows: ChroniclePlayerRow[]): Promise<void>;
  server(row: ChronicleServerRow): Promise<void>;
}

const dryRun: ChronicleSink = { players: async () => {}, server: async () => {} };

function fileSink(prefix: string): ChronicleSink {
  const write = (name: string, rows: object[]): void =>
    appendFileSync(`${prefix}-${name}.ndjson`, rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
  return {
    players: async (rows) => write('players', rows),
    server: async (row) => write('servers', [row]),
  };
}

async function insert(table: string, rows: object[]): Promise<void> {
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  await axios.post(`${CLICKHOUSE_URL}/?query=${encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`)}`, body, {
    auth: { username: process.env.CLICKHOUSE_USER ?? '', password: process.env.CLICKHOUSE_PASSWORD ?? '' },
    headers: { 'Content-Type': 'text/plain' },
    timeout: 300_000,
    maxBodyLength: Infinity,
  });
}

const clickhouseSink: ChronicleSink = {
  players: async (rows) => {
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      await insert(PLAYERS_TABLE, rows.slice(start, start + INSERT_BATCH));
    }
  },
  server: (row) => insert(SERVERS_TABLE, [row]),
};

// Players go first: a server only becomes visible through its row, written once all of them are stored
interface WorldTables {
  outerRealms: Map<string, Map<number, WorldEvent>>;
  horizon: Map<string, Map<number, WorldEvent>>;
  servers: number;
}

function serverLabels(servers: ScrapingServer[]): Map<string, string> {
  const labels = new Map(WORLD_LABEL_ALIASES);
  for (const server of servers) {
    for (const label of [server.name, server.server, server.outerName]) {
      if (label) labels.set(label, server.server);
    }
  }
  return labels;
}

async function readWorldEvents(servers: ScrapingServer[], window: ChronicleWindow): Promise<WorldTables> {
  const home = servers.find((server) => server.server === WORLD_EVENTS_SERVER);
  if (!home) return { outerRealms: new Map(), horizon: new Map(), servers: 0 };
  const pool = new Pool({
    host: process.env.PG_HOST || 'postgres-container',
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: home.sql,
    port: 5432,
    max: 1,
    options: '-c default_transaction_read_only=on',
  });
  const labels = serverLabels(servers);
  const read = async (ranking: string, events: string): Promise<WorldEventRow[]> => {
    const parameters = [window.fromMs / 1000, window.untilMs / 1000];
    const { rows } = await withRetries(() => pool.query(worldEventSql(ranking, events), parameters));
    return rows.flatMap((row) => {
      const server = labels.get(String(row.server));
      if (!server) return [];
      return [
        {
          server,
          playerId: Number(row.player_id),
          events: Number(row.events),
          bestRank: Number(row.best_rank),
          bestPoint: Number(row.best_point),
          months: (row.months as number[]).map(Number),
          ranks: (row.ranks as number[]).map(Number),
        },
      ];
    });
  };
  try {
    const outerRows = await read('outer_realms_ranking', 'outer_realms_event');
    const horizonRows = await read('beyond_the_horizon_ranking', 'beyond_the_horizon_event');
    return {
      outerRealms: rankWorldEvent(outerRows),
      horizon: rankWorldEvent(horizonRows),
      servers: new Set([...outerRows, ...horizonRows].map((row) => row.server)).size,
    };
  } finally {
    await pool.end();
  }
}

function attachWorldEvents(players: PlayerFeatures[], server: string, tables: WorldTables): void {
  for (const player of players) {
    const outerRealms = tables.outerRealms.get(server)?.get(player.id);
    const horizon = tables.horizon.get(server)?.get(player.id);
    player.world = { ...(outerRealms ? { outerRealms } : {}), ...(horizon ? { horizon } : {}) };
  }
}

async function runServer(
  server: ScrapingServer,
  window: ChronicleWindow,
  sink: ChronicleSink,
  world: WorldTables,
  playerId: number | null,
): Promise<void> {
  const startedAt = Date.now();
  const builtAt = Math.floor(startedAt / 1000);
  const [{ first }] = await clickhouse(firstReadingQuery(server.olap));
  const firstMs = Number(first) * 1000;
  const days = trackedDays(firstMs, window);
  const tier = serverTier(days);
  const serverRow = (players: number, fullPlayers: number): ChronicleServerRow =>
    toServerRow({ window, server: server.server, tier, days, firstMs, builtAt, players, fullPlayers });

  if (tier === 'too-recent') {
    await sink.server(serverRow(0, 0));
    console.log(JSON.stringify({ event: 'chronicle_dry_run', server: server.server, trackedDays: days, tier }));
    return;
  }

  const table = new FeatureTable();
  await readHistories(table, server, window);
  await readEvents(table, server, window);
  await readIdentities(table, server, window);
  const players = table.tracked();
  attachWorldEvents(players, server.server, world);
  const months = await readMonthly(players, server, window);
  const full = players.filter((player) => playerTier(player, fullStoryHours(days)) === 'full');
  const rivals = tier === 'full' ? pickRivals(full, monthlySnapshots(full, months)) : new Map<number, RivalPick>();
  const entries = buildEntries(players, { window, months, rivals, worldServers: world.servers, trackedDays: days });

  await sink.players(entries.map((entry) => toPlayerRow(entry, window.year, server.server, builtAt)));
  await sink.server(serverRow(entries.length, entries.filter((entry) => entry.tier === 'full').length));
  console.log(summarize(server, days, entries, startedAt));
  if (playerId !== null) {
    console.log(JSON.stringify(entries.find((entry) => entry.id === playerId) ?? null, null, 2));
  }
}

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1];
}

function chooseSink(): ChronicleSink {
  if (process.argv.includes('--apply')) return clickhouseSink;
  const out = argument('out');
  return out ? fileSink(out) : dryRun;
}

async function main(): Promise<void> {
  const until = argument('until');
  const window = chronicleWindow(Number(argument('year') ?? 2026), until ? Date.parse(until) : undefined);
  const wanted = argument('server')?.split(',');
  const player = argument('player');
  const sink = chooseSink();
  const allServers = chronicleServers(readScrapingServers());
  const servers = allServers.filter((server) => !wanted || wanted.includes(server.server));
  const world = await readWorldEvents(allServers, window);
  const failed: string[] = [];
  for (const server of servers) {
    try {
      await runServer(server, window, sink, world, player ? Number(player) : null);
    } catch (error) {
      failed.push(server.server);
      console.error(JSON.stringify({ event: 'chronicle_server_failed', server: server.server, reason: String(error) }));
    }
  }
  if (failed.length > 0) throw new Error(`${failed.length} servers failed: ${failed.join(', ')}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'chronicle_failed', reason: String(error?.response?.data ?? error) }));
    process.exit(1);
  });
}
