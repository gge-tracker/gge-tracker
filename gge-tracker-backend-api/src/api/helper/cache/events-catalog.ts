import * as pg from 'pg';
import { ApiHelper } from '../api-helper';

export interface EventCatalogEntry {
  event_num: number;
  player_count: string;
  type: string;
  collect_date: string;
}

interface EventRow {
  event_num: number;
  collect_date: Date;
  type: string;
}

interface EventCountRow {
  event_num: number;
  type: string;
  player_count: string;
}

const RANKING_TABLES: Record<string, string> = {
  outer_realms: 'outer_realms_ranking',
  beyond_the_horizon: 'beyond_the_horizon_ranking',
};

const PLAYER_COUNTS_HASH_KEY = 'events:list:player-counts';

/**
 * Keeps the whole event list in the process
 */
export abstract class EventsCatalogCache {
  private static readonly FRESHNESS_FLOOR_MS = 60 * 1000;
  private static readonly FILLING_WINDOW_MS = 24 * 60 * 60 * 1000;

  private static entries: EventCatalogEntry[] | null = null;
  private static checkedAt = 0;
  private static refreshing: Promise<EventCatalogEntry[] | null> | null = null;
  private static readonly settledCounts = new Map<string, string>();

  public static async current(eventPgDbpool: pg.Pool): Promise<EventCatalogEntry[] | null> {
    const entries = EventsCatalogCache.entries;
    if (entries && Date.now() - EventsCatalogCache.checkedAt < EventsCatalogCache.FRESHNESS_FLOOR_MS) return entries;

    const refresh = EventsCatalogCache.refresh(eventPgDbpool);
    return entries ?? refresh;
  }

  private static refresh(eventPgDbpool: pg.Pool): Promise<EventCatalogEntry[] | null> {
    EventsCatalogCache.refreshing ??= EventsCatalogCache.build(eventPgDbpool)
      .catch((error) => {
        ApiHelper.logError(error, 'EventsCatalogCache.refresh', null);
        return EventsCatalogCache.entries;
      })
      .finally(() => {
        EventsCatalogCache.refreshing = null;
      });
    return EventsCatalogCache.refreshing;
  }

  private static async build(eventPgDbpool: pg.Pool): Promise<EventCatalogEntry[]> {
    const events = await EventsCatalogCache.readEvents(eventPgDbpool);
    const playerCounts = await EventsCatalogCache.resolvePlayerCounts(eventPgDbpool, events);

    const entries = events
      .map((event) => ({
        event_num: event.event_num,
        player_count: playerCounts.get(EventsCatalogCache.countKey(event)) ?? '0',
        type: event.type,
        collect_date: new Date(event.collect_date).toISOString(),
      }))
      .sort(EventsCatalogCache.byCollectDateDesc);

    EventsCatalogCache.entries = entries;
    EventsCatalogCache.checkedAt = Date.now();
    return entries;
  }

  private static byCollectDateDesc(left: EventCatalogEntry, right: EventCatalogEntry): number {
    if (left.collect_date !== right.collect_date) return left.collect_date < right.collect_date ? 1 : -1;
    if (left.type !== right.type) return left.type < right.type ? -1 : 1;
    return right.event_num - left.event_num;
  }

  private static async readEvents(eventPgDbpool: pg.Pool): Promise<EventRow[]> {
    const results = await eventPgDbpool.query<EventRow>(`
      SELECT event_num, collect_date, 'outer_realms' AS type FROM outer_realms_event
      UNION ALL
      SELECT event_num, collect_date, 'beyond_the_horizon' AS type FROM beyond_the_horizon_event
    `);
    return results.rows;
  }

  private static async resolvePlayerCounts(eventPgDbpool: pg.Pool, events: EventRow[]): Promise<Map<string, string>> {
    const stillFilling = EventsCatalogCache.eventsStillFilling(events);
    const settled = events.filter((event) => !stillFilling.includes(event));

    await EventsCatalogCache.readStoredCounts(
      settled.filter((event) => !EventsCatalogCache.settledCounts.has(EventsCatalogCache.countKey(event))),
    );
    const uncounted = settled.filter(
      (event) => !EventsCatalogCache.settledCounts.has(EventsCatalogCache.countKey(event)),
    );

    const counted = await EventsCatalogCache.countPlayers(eventPgDbpool, [...uncounted, ...stillFilling]);
    uncounted.forEach((event) => {
      const key = EventsCatalogCache.countKey(event);
      EventsCatalogCache.settledCounts.set(key, counted.get(key) ?? '0');
    });
    await EventsCatalogCache.storeCounts(uncounted);

    const resolved = new Map(EventsCatalogCache.settledCounts);
    stillFilling.forEach((event) => {
      const key = EventsCatalogCache.countKey(event);
      resolved.set(key, counted.get(key) ?? '0');
    });
    return resolved;
  }

  private static eventsStillFilling(events: EventRow[]): EventRow[] {
    const newest = new Map<string, EventRow>();
    events.forEach((event) => {
      const known = newest.get(event.type);
      if (!known || event.event_num > known.event_num) newest.set(event.type, event);
    });
    const openedAfter = Date.now() - EventsCatalogCache.FILLING_WINDOW_MS;
    return [...newest.values()].filter((event) => new Date(event.collect_date).getTime() > openedAfter);
  }

  private static async readStoredCounts(events: EventRow[]): Promise<void> {
    if (events.length === 0) return;
    const keys = events.map((event) => EventsCatalogCache.countKey(event));
    const stored = await ApiHelper.redisClient.hmGet(PLAYER_COUNTS_HASH_KEY, keys).catch(() => [] as (string | null)[]);
    keys.forEach((key, index) => {
      const value = stored[index];
      if (value !== null && value !== undefined) EventsCatalogCache.settledCounts.set(key, value);
    });
  }

  private static async storeCounts(events: EventRow[]): Promise<void> {
    if (events.length === 0) return;
    const fields: Record<string, string> = {};
    events.forEach((event) => {
      const key = EventsCatalogCache.countKey(event);
      fields[key] = EventsCatalogCache.settledCounts.get(key) ?? '0';
    });
    await ApiHelper.redisClient.hSet(PLAYER_COUNTS_HASH_KEY, fields).catch(() => 0);
  }

  private static async countPlayers(eventPgDbpool: pg.Pool, events: EventRow[]): Promise<Map<string, string>> {
    const parts: string[] = [];
    const values: number[][] = [];
    Object.entries(RANKING_TABLES).forEach(([type, table]) => {
      const eventNums = events.filter((event) => event.type === type).map((event) => event.event_num);
      if (eventNums.length === 0) return;
      values.push(eventNums);
      parts.push(`
        SELECT event_num, '${type}' AS type, COUNT(*)::text AS player_count
        FROM ${table}
        WHERE event_num = ANY($${values.length}::int[])
        GROUP BY event_num
      `);
    });
    if (parts.length === 0) return new Map();

    const results = await eventPgDbpool.query<EventCountRow>(parts.join(' UNION ALL '), values);
    return new Map(results.rows.map((row) => [`${row.type}:${row.event_num}`, row.player_count]));
  }

  private static countKey(event: EventRow): string {
    return `${event.type}:${event.event_num}`;
  }
}
