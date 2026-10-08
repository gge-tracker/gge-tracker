import * as express from 'express';
import * as crypto from 'node:crypto';
import * as pg from 'pg';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { EventTypes } from '../enums/event-types.enums';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { EventPodium, EventPodiumCard, PodiumEntry, PodiumTrackedStats } from '../services/event-podium-card';
import { ShareCardRenderer } from '../services/share-card-renderer';
import { ApiProfiles } from './api-profiles';
import { ApiSeo } from './api-seo';

interface PodiumEvent {
  name: string;
  tablePrefix: string;
}

interface PodiumSnapshot {
  podium: EventPodium;
  frozen: boolean;
}

interface PodiumRow {
  player_id: number | null;
  server: string;
  player_name: string;
  alliance_name: string | null;
  point: string;
  level: number | null;
  legendary_level: number | null;
}

const UNDEFINED_TABLE = '42P01';

export abstract class ApiEventPodium implements ApiHelper {
  private static readonly FROZEN_CARD_MAX_AGE_SECONDS = 7 * 24 * 3600;
  private static readonly PODIUM_SIZE = 3;
  private static readonly EVENTS: Record<string, PodiumEvent> = {
    [EventTypes.OUTER_REALMS]: { name: 'Outer Realms', tablePrefix: 'outer_realms' },
    [EventTypes.BEYOND_THE_HORIZON]: { name: 'Beyond the Horizon', tablePrefix: 'beyond_the_horizon' },
  };

  public static async getCard(
    request: express.Request,
    response: express.Response,
    eventPgDbpool: pg.Pool,
  ): Promise<void> {
    try {
      const eventType = String(request.params.eventType);
      const event = Object.hasOwn(this.EVENTS, eventType) ? this.EVENTS[eventType] : null;
      if (!event) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventType });
        return;
      }
      const eventNumber = /^\d{1,6}$/.test(String(request.params.eventNumber)) ? Number(request.params.eventNumber) : 0;
      if (eventNumber < 1) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventId });
        return;
      }
      const snapshot = await this.snapshot(eventPgDbpool, eventType, event, eventNumber);
      if (!snapshot) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.EventNotFound });
        return;
      }
      const html = EventPodiumCard.toHtml(snapshot.podium, ApiSeo.displayUrl(snapshot.podium.path));
      const key = `seo:podium:${crypto.createHash('sha1').update(html).digest('hex').slice(0, 20)}`;
      if (
        HttpCache.handleConditional(request, response, {
          etag: HttpCache.etagFromCacheKey(key),
          dataVersion: null,
          maxAgeSeconds: snapshot.frozen ? this.FROZEN_CARD_MAX_AGE_SECONDS : HttpCache.DEFAULT_MAX_AGE_SECONDS,
        })
      ) {
        return;
      }
      await ApiSeo.sendCachedCard(request, response, key, () => ShareCardRenderer.renderHtml(key, html));
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getEventPodiumCard', request);
    }
  }

  private static async snapshot(
    pool: pg.Pool,
    eventType: string,
    event: PodiumEvent,
    eventNumber: number,
  ): Promise<PodiumSnapshot | null> {
    const stored = await this.readFrozen(pool, eventType, eventNumber);
    if (stored) return { podium: stored, frozen: true };
    const computed = await this.compute(pool, eventType, event, eventNumber);
    if (!computed) return null;
    if (!computed.complete) return { podium: computed.podium, frozen: false };
    const frozen = await this.freeze(pool, eventType, eventNumber, computed.podium);
    return frozen ? { podium: frozen, frozen: true } : { podium: computed.podium, frozen: false };
  }

  private static async readFrozen(pool: pg.Pool, eventType: string, eventNumber: number): Promise<EventPodium | null> {
    try {
      const result = await pool.query<{ podium: EventPodium }>(
        'SELECT podium FROM event_podium WHERE event_type = $1 AND event_num = $2',
        [eventType, eventNumber],
      );
      return result.rows[0]?.podium ?? null;
    } catch (error) {
      if ((error as { code?: string })?.code === UNDEFINED_TABLE) return null;
      throw error;
    }
  }

  private static async freeze(
    pool: pg.Pool,
    eventType: string,
    eventNumber: number,
    podium: EventPodium,
  ): Promise<EventPodium | null> {
    try {
      await pool.query(
        `INSERT INTO event_podium (event_type, event_num, podium) VALUES ($1, $2, $3)
        ON CONFLICT (event_type, event_num) DO NOTHING`,
        [eventType, eventNumber, JSON.stringify(podium)],
      );
      return await this.readFrozen(pool, eventType, eventNumber);
    } catch (error) {
      if ((error as { code?: string })?.code === UNDEFINED_TABLE) return null;
      throw error;
    }
  }

  private static async compute(
    pool: pg.Pool,
    eventType: string,
    event: PodiumEvent,
    eventNumber: number,
  ): Promise<{ podium: EventPodium; complete: boolean } | null> {
    const [top, totals, header] = await Promise.all([
      pool.query<PodiumRow>(
        `SELECT player_id, server, player_name, alliance_name, point, level, legendary_level
        FROM ${event.tablePrefix}_ranking
        WHERE event_num = $1
        ORDER BY point DESC, rank
        LIMIT $2`,
        [eventNumber, this.PODIUM_SIZE],
      ),
      pool.query<{ players: string; servers: string }>(
        `SELECT COUNT(*) AS players, COUNT(DISTINCT server) AS servers
        FROM ${event.tablePrefix}_ranking
        WHERE event_num = $1`,
        [eventNumber],
      ),
      pool.query<{ collect_date: Date | null }>(
        `SELECT collect_date FROM ${event.tablePrefix}_event WHERE event_num = $1`,
        [eventNumber],
      ),
    ]);
    if (top.rows.length === 0) return null;

    const lookups = await Promise.all(top.rows.map((row, index) => this.entry(row, index + 1)));
    const entries = lookups.map((lookup) => lookup.entry);
    const podium: EventPodium = {
      eventName: event.name,
      eventNumber,
      collectedAt: header.rows[0]?.collect_date?.toISOString() ?? null,
      playerCount: Number(totals.rows[0]?.players ?? 0),
      serverCount: Number(totals.rows[0]?.servers ?? 0),
      path: `/events/${eventType}/${eventNumber}`,
      entries,
    };
    return { podium, complete: lookups.every((lookup) => lookup.complete) };
  }

  private static async entry(row: PodiumRow, rank: number): Promise<{ entry: PodiumEntry; complete: boolean }> {
    let complete = true;
    const tracked = await this.tracked(row).catch((error: unknown): null => {
      complete = false;
      ApiHelper.logError(error, 'getEventPodiumCard');
      return null;
    });
    const entry: PodiumEntry = {
      rank,
      name: row.player_name,
      server: row.server,
      alliance: row.alliance_name,
      points: Number(row.point),
      level: Number(row.level ?? 0),
      legendaryLevel: Number(row.legendary_level ?? 0),
      tracked,
    };
    return { entry, complete };
  }

  private static async tracked(row: PodiumRow): Promise<PodiumTrackedStats | null> {
    if (!row.player_id) return null;
    const code = ApiHelper.ggeTrackerManager.getOuterServer(row.server as GgeTrackerServersEnum)?.code;
    if (!code) return null;
    const context = ApiProfiles.contextFor(Number(`${row.player_id}${code}`), new Set());
    if (!context) return null;
    const player = await ApiProfiles.readPlayer(context);
    if (!player) return null;
    const rank = await ApiProfiles.readPlayerRank(context, player);
    return { might: Number(player.identity.might_current), mightRank: Number(rank.might_current) };
  }
}
