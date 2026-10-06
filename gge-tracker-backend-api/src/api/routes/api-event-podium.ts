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

interface PodiumRow {
  player_id: number | null;
  server: string;
  player_name: string;
  alliance_name: string | null;
  point: string;
  level: number | null;
  legendary_level: number | null;
}

export abstract class ApiEventPodium implements ApiHelper {
  private static readonly PODIUM_TTL_SECONDS = 3600;
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
      const podium = await this.podium(eventPgDbpool, eventType, event, eventNumber);
      if (!podium) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.EventNotFound });
        return;
      }
      const html = EventPodiumCard.toHtml(podium, ApiSeo.displayUrl(podium.path));
      const key = `seo:podium:${crypto.createHash('sha1').update(html).digest('hex').slice(0, 20)}`;
      if (
        HttpCache.handleConditional(request, response, {
          etag: HttpCache.etagFromCacheKey(key),
          dataVersion: null,
          maxAgeSeconds: ApiSeo.CARD_MAX_AGE_SECONDS,
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

  private static async podium(
    pool: pg.Pool,
    eventType: string,
    event: PodiumEvent,
    eventNumber: number,
  ): Promise<EventPodium | null> {
    const cacheKey = `seo:podium-data:${eventType}:${eventNumber}`;
    const cached = await ApiHelper.redisClient.get(cacheKey).catch((): null => null);
    if (cached) return JSON.parse(cached) as EventPodium;

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

    const entries = await Promise.all(top.rows.map((row, index) => this.entry(row, index + 1)));
    const podium: EventPodium = {
      eventName: event.name,
      eventNumber,
      collectedAt: header.rows[0]?.collect_date?.toISOString() ?? null,
      playerCount: Number(totals.rows[0]?.players ?? 0),
      serverCount: Number(totals.rows[0]?.servers ?? 0),
      path: `/events/${eventType}/${eventNumber}`,
      entries,
    };
    void ApiHelper.updateCache(cacheKey, podium, this.PODIUM_TTL_SECONDS);
    return podium;
  }

  private static async entry(row: PodiumRow, rank: number): Promise<PodiumEntry> {
    return {
      rank,
      name: row.player_name,
      server: row.server,
      alliance: row.alliance_name,
      points: Number(row.point),
      level: Number(row.level ?? 0),
      legendaryLevel: Number(row.legendary_level ?? 0),
      tracked: await this.tracked(row).catch((): null => null),
    };
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
