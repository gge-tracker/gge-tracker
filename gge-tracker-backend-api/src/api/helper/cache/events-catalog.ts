import * as pg from 'pg';
import { ApiHelper } from '../api-helper';
import { EventGame, EventGames } from '../event-game';
import { EventVariants, VariantEventType } from '../event-variants';

export interface EventCatalogEntry {
  event_num: number;
  player_count: string;
  type: string;
  collect_date: string;
  variant: string | null;
}

interface EventRow {
  event_num: number;
  collect_date: Date;
  type: string;
  setting_id: string | null;
  scoring: string | null;
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

/**
 * Keeps the whole event list of each game in the process
 */
export class EventsCatalogCache {
  private static readonly FRESHNESS_FLOOR_MS = 60 * 1000;
  private static readonly FILLING_WINDOW_MS = 24 * 60 * 60 * 1000;
  private static readonly catalogs = new Map<EventGame, EventsCatalogCache>();

  private entries: EventCatalogEntry[] | null = null;
  private checkedAt = 0;
  private refreshing: Promise<EventCatalogEntry[] | null> | null = null;
  private readonly settledCounts = new Map<string, string>();
  private readonly playerCountsHashKey: string;

  private constructor(game: EventGame) {
    this.playerCountsHashKey = `events:list:player-counts${EventGames.keySuffix(game)}`;
  }

  public static of(game: EventGame): EventsCatalogCache {
    let catalog = EventsCatalogCache.catalogs.get(game);
    if (!catalog) {
      catalog = new EventsCatalogCache(game);
      EventsCatalogCache.catalogs.set(game, catalog);
    }
    return catalog;
  }

  private static byCollectDateDesc(left: EventCatalogEntry, right: EventCatalogEntry): number {
    if (left.collect_date !== right.collect_date) return left.collect_date < right.collect_date ? 1 : -1;
    if (left.type !== right.type) return left.type < right.type ? -1 : 1;
    return right.event_num - left.event_num;
  }

  private static async readEvents(eventPgDbpool: pg.Pool): Promise<EventRow[]> {
    const results = await eventPgDbpool.query<EventRow>(`
      SELECT event_num, collect_date, 'outer_realms' AS type,
        to_jsonb(e) ->> 'setting_id' AS setting_id, to_jsonb(e) ->> 'scoring' AS scoring
      FROM outer_realms_event e
      UNION ALL
      SELECT event_num, collect_date, 'beyond_the_horizon' AS type,
        to_jsonb(e) ->> 'setting_id' AS setting_id, to_jsonb(e) ->> 'scoring' AS scoring
      FROM beyond_the_horizon_event e
    `);
    return results.rows;
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

  public async current(eventPgDbpool: pg.Pool): Promise<EventCatalogEntry[] | null> {
    const entries = this.entries;
    if (entries && Date.now() - this.checkedAt < EventsCatalogCache.FRESHNESS_FLOOR_MS) return entries;

    const refresh = this.refresh(eventPgDbpool);
    return entries ?? refresh;
  }

  private refresh(eventPgDbpool: pg.Pool): Promise<EventCatalogEntry[] | null> {
    this.refreshing ??= this.build(eventPgDbpool)
      .catch((error) => {
        ApiHelper.logError(error, 'EventsCatalogCache.refresh', null);
        return this.entries;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private async build(eventPgDbpool: pg.Pool): Promise<EventCatalogEntry[]> {
    const events = await EventsCatalogCache.readEvents(eventPgDbpool);
    const playerCounts = await this.resolvePlayerCounts(eventPgDbpool, events);

    const variants = await Promise.all(
      events.map((event) => EventVariants.resolve(event.type as VariantEventType, event.setting_id, event.scoring)),
    );
    const entries = events
      .map((event, index) => ({
        event_num: event.event_num,
        player_count: playerCounts.get(EventsCatalogCache.countKey(event)) ?? '0',
        type: event.type,
        collect_date: new Date(event.collect_date).toISOString(),
        variant: variants[index],
      }))
      .sort(EventsCatalogCache.byCollectDateDesc);

    this.entries = entries;
    this.checkedAt = Date.now();
    return entries;
  }

  private async resolvePlayerCounts(eventPgDbpool: pg.Pool, events: EventRow[]): Promise<Map<string, string>> {
    const stillFilling = EventsCatalogCache.eventsStillFilling(events);
    const settled = events.filter((event) => !stillFilling.includes(event));

    await this.readStoredCounts(settled.filter((event) => !this.settledCounts.has(EventsCatalogCache.countKey(event))));
    const uncounted = settled.filter((event) => !this.settledCounts.has(EventsCatalogCache.countKey(event)));

    const counted = await EventsCatalogCache.countPlayers(eventPgDbpool, [...uncounted, ...stillFilling]);
    uncounted.forEach((event) => {
      const key = EventsCatalogCache.countKey(event);
      this.settledCounts.set(key, counted.get(key) ?? '0');
    });
    await this.storeCounts(uncounted);

    const resolved = new Map(this.settledCounts);
    stillFilling.forEach((event) => {
      const key = EventsCatalogCache.countKey(event);
      resolved.set(key, counted.get(key) ?? '0');
    });
    return resolved;
  }

  private async readStoredCounts(events: EventRow[]): Promise<void> {
    if (events.length === 0) return;
    const keys = events.map((event) => EventsCatalogCache.countKey(event));
    const stored = await ApiHelper.redisClient
      .hmGet(this.playerCountsHashKey, keys)
      .catch(() => [] as (string | null)[]);
    keys.forEach((key, index) => {
      const value = stored[index];
      if (value !== null && value !== undefined) this.settledCounts.set(key, value);
    });
  }

  private async storeCounts(events: EventRow[]): Promise<void> {
    if (events.length === 0) return;
    const fields: Record<string, string> = {};
    events.forEach((event) => {
      const key = EventsCatalogCache.countKey(event);
      fields[key] = this.settledCounts.get(key) ?? '0';
    });
    await ApiHelper.redisClient.hSet(this.playerCountsHashKey, fields).catch(() => 0);
  }
}
