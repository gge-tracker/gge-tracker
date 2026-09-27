import * as express from 'express';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { ApiProfiles, ProfileContext } from './api-profiles';
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  ShareCard,
  ShareCardRenderer,
  ShareCardStat,
} from '../services/share-card-renderer';

type ShareSubject = 'player' | 'alliance';

interface SharePreview {
  found: boolean;
  path: string;
  title: string;
  description: string;
  imageAlt: string;
  card: ShareCard;
  cacheKey: string;
  dataVersion: string | null;
}

interface MightTrend {
  delta: number;
  days: number;
}

export abstract class ApiSeo implements ApiHelper {
  public static readonly HEAD_MAX_AGE_SECONDS = 900;
  public static readonly CARD_MAX_AGE_SECONDS = 3600;

  private static readonly PREVIEW_TTL_SECONDS = 3600;
  private static readonly CARD_TTL_SECONDS = 2 * 3600;
  private static readonly GENERIC_CARD_TTL_SECONDS = 24 * 3600;
  private static readonly SITE_NAME = 'GGE Tracker';
  private static readonly GENERIC_TITLE = 'GGE Tracker - Advanced Stats for Goodgame Empire';
  private static readonly GENERIC_DESCRIPTION =
    'Community analytics tool for Goodgame Empire. Visualize your castles, explore interactive maps, track alliances, dungeons, and analyze event statistics.';

  public static async getPlayerHead(request: express.Request, response: express.Response): Promise<void> {
    await this.sendHead(request, response, 'player', request.params.playerId);
  }

  public static async getAllianceHead(request: express.Request, response: express.Response): Promise<void> {
    await this.sendHead(request, response, 'alliance', request.params.allianceId);
  }

  public static async getPlayerCard(request: express.Request, response: express.Response): Promise<void> {
    await this.sendCard(request, response, 'player', request.params.playerId);
  }

  public static async getAllianceCard(request: express.Request, response: express.Response): Promise<void> {
    await this.sendCard(request, response, 'alliance', request.params.allianceId);
  }

  private static async sendHead(
    request: express.Request,
    response: express.Response,
    subject: ShareSubject,
    rawId: unknown,
  ): Promise<void> {
    try {
      const preview = await this.preview(subject, rawId);
      const etag = HttpCache.etagFromCacheKey(`seo-head:${preview.cacheKey}:${this.siteUrl()}:${this.apiUrl()}`);
      if (
        HttpCache.handleConditional(request, response, {
          etag,
          dataVersion: preview.dataVersion,
          maxAgeSeconds: this.HEAD_MAX_AGE_SECONDS,
        })
      ) {
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.status(ApiHelper.HTTP_OK).send(this.toHeadDocument(preview));
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getSeoHead', request);
    }
  }

  private static async sendCard(
    request: express.Request,
    response: express.Response,
    subject: ShareSubject,
    rawId: unknown,
  ): Promise<void> {
    try {
      const preview = await this.preview(subject, rawId);
      const key = `seo:card:${preview.cacheKey}`;
      if (
        HttpCache.handleConditional(request, response, {
          etag: HttpCache.etagFromCacheKey(key),
          dataVersion: preview.dataVersion,
          maxAgeSeconds: this.CARD_MAX_AGE_SECONDS,
        })
      ) {
        return;
      }
      const image = await this.cardImage(key, preview);
      response.setHeader('Content-Type', 'image/png');
      response.setHeader('Content-Length', String(image.length));
      response.status(ApiHelper.HTTP_OK).end(image);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getSeoCard', request);
    }
  }

  private static async cardImage(key: string, preview: SharePreview): Promise<Buffer> {
    const cached = await ApiHelper.redisClient.get(key).catch((): null => null);
    if (cached) return Buffer.from(cached, 'base64');
    const image = await ShareCardRenderer.render(key, preview.card);
    const ttl = preview.found ? this.CARD_TTL_SECONDS : this.GENERIC_CARD_TTL_SECONDS;
    void ApiHelper.updateCache(key, image.toString('base64'), ttl, true);
    return image;
  }

  private static async preview(subject: ShareSubject, rawId: unknown): Promise<SharePreview> {
    const id = ApiHelper.verifyIdWithCountryCode(rawId);
    const context = id === false ? null : ApiProfiles.contextFor(id, new Set());
    if (!context) return this.genericPreview();

    const dataVersion = await ApiHelper.getCacheVersion(ApiHelper.redisClient, context.server);
    const cacheKey = `${subject}:${context.server}:${dataVersion}:${context.id}`;
    const cached = await ApiHelper.redisClient.get(`seo:preview:${cacheKey}`).catch((): null => null);
    if (cached) {
      const stored = JSON.parse(cached) as SharePreview | { missing: true };
      return 'missing' in stored ? this.genericPreview() : stored;
    }

    const preview =
      subject === 'player'
        ? await this.playerPreview(context, cacheKey, dataVersion)
        : await this.alliancePreview(context, cacheKey, dataVersion);
    void ApiHelper.updateCache(`seo:preview:${cacheKey}`, preview ?? { missing: true }, this.PREVIEW_TTL_SECONDS);
    return preview ?? this.genericPreview();
  }

  private static async playerPreview(
    context: ProfileContext,
    cacheKey: string,
    dataVersion: string,
  ): Promise<SharePreview | null> {
    const player = await ApiProfiles.readPlayer(context);
    if (!player) return null;
    const identity = player.identity;
    const [rank, trend] = await Promise.all([
      ApiProfiles.readPlayerRank(context, player),
      this.readMightTrend(context).catch((): null => null),
    ]);
    const server = this.serverLabel(context);
    const name = String(identity.player_name);
    const allianceName = identity.alliance_name ? String(identity.alliance_name) : null;
    const might = Number(identity.might_current);
    const mightRank = Number(rank.might_current);
    const rankedPlayers = Number(rank.ranked_players);
    const level = Number(identity.level);
    const legendaryLevel = Number(identity.legendary_level);
    const path = `/player/${context.id}`;

    const levelText = legendaryLevel > 0 ? `legendary level ${legendaryLevel}` : `level ${level}`;
    const allianceText = allianceName ? ` of ${allianceName}` : '';
    const description =
      `${name}${allianceText} on ${server}: ${this.compact(might)} might, ranked #${this.grouped(mightRank)} ` +
      `of ${this.grouped(rankedPlayers)} players, ${levelText}. Might history, castles and alliance moves on GGE Tracker.`;

    const stats: ShareCardStat[] = [
      {
        label: 'Might',
        value: this.compact(might),
        ...(trend ? this.trendDetail(trend) : {}),
      },
      {
        label: 'Might rank',
        value: `#${this.grouped(mightRank)}`,
        detail: `of ${this.grouped(rankedPlayers)} players`,
      },
      legendaryLevel > 0
        ? { label: 'Level', value: String(legendaryLevel), detail: 'Legendary' }
        : { label: 'Level', value: String(level) },
    ];
    return {
      found: true,
      path,
      title: `${name}${allianceName ? ` (${allianceName})` : ''} · ${server} · ${this.SITE_NAME}`,
      description,
      imageAlt: `${name}, ${this.compact(might)} might, rank #${this.grouped(mightRank)} on ${server}`,
      card: {
        kind: 'Player',
        title: name,
        subtitle: allianceName ?? 'No alliance',
        server,
        stats,
        footer: this.displayUrl(path),
      },
      cacheKey,
      dataVersion,
    };
  }

  private static async alliancePreview(
    context: ProfileContext,
    cacheKey: string,
    dataVersion: string,
  ): Promise<SharePreview | null> {
    const alliance = await ApiProfiles.readAlliance(context);
    if (!alliance) return null;
    const rank = await ApiProfiles.readAllianceRank(context);
    const server = this.serverLabel(context);
    const name = String(alliance.identity.alliance_name);
    const members = Number(alliance.statistics.player_count);
    const activeMembers = Number(alliance.statistics.active_player_count);
    const might = Number(alliance.statistics.might_current);
    const averageLevel = Number(alliance.statistics.average_level);
    const mightRank = rank.might_current === null ? null : Number(rank.might_current);
    const rankedAlliances = Number(rank.ranked_alliances);
    const path = `/alliance/${context.id}`;

    const rankText =
      mightRank === null ? 'unranked' : `ranked #${this.grouped(mightRank)} of ${this.grouped(rankedAlliances)}`;
    const description =
      `${name} on ${server}: ${this.grouped(members)} members, ${this.compact(might)} might, ${rankText}. ` +
      `Members, joins and departures, castles and rankings on GGE Tracker.`;

    return {
      found: true,
      path,
      title: `${name} · ${server} alliance · ${this.SITE_NAME}`,
      description,
      imageAlt: `${name}, ${this.grouped(members)} members, ${this.compact(might)} might on ${server}`,
      card: {
        kind: 'Alliance',
        title: name,
        subtitle: `${this.grouped(members)} members · ${this.grouped(activeMembers)} looting this week`,
        server,
        stats: [
          { label: 'Might', value: this.compact(might) },
          mightRank === null
            ? { label: 'Might rank', value: '-', detail: 'Unranked' }
            : {
                label: 'Might rank',
                value: `#${this.grouped(mightRank)}`,
                detail: `of ${this.grouped(rankedAlliances)} alliances`,
              },
          { label: 'Average level', value: averageLevel.toFixed(0) },
        ],
        footer: this.displayUrl(path),
      },
      cacheKey,
      dataVersion,
    };
  }

  private static genericPreview(): SharePreview {
    return {
      found: false,
      path: '/',
      title: this.GENERIC_TITLE,
      description: this.GENERIC_DESCRIPTION,
      imageAlt: this.GENERIC_TITLE,
      card: {
        kind: 'Goodgame Empire statistics',
        title: 'GGE Tracker',
        subtitle: 'Players, alliances, castles and events on every server',
        server: null,
        stats: [
          { label: 'Rankings', value: 'Live' },
          { label: 'Servers', value: String(ApiHelper.ggeTrackerManager.getActivatedServerValues().length) },
          { label: 'Price', value: 'Free' },
        ],
        footer: this.displayUrl('/'),
      },
      cacheKey: 'generic:v1',
      dataVersion: null,
    };
  }

  /** Measured from the player's own last reading, so a player who stopped being collected still gets a trend */
  private static async readMightTrend(context: ProfileContext): Promise<MightTrend | null> {
    const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromCode(context.code);
    if (!database) return null;
    const clickhouse = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    const result = await clickhouse.query({
      query: `
        SELECT
          argMax(point, created_at) AS latest,
          argMin(point, created_at) AS earliest,
          dateDiff('hour', min(created_at), max(created_at)) AS span_hours
        FROM ${database}.player_might_history
        WHERE player_id = {playerId:UInt64}
          AND created_at >= (
            SELECT max(created_at) FROM ${database}.player_might_history WHERE player_id = {playerId:UInt64}
          ) - INTERVAL 7 DAY`,
      query_params: { playerId: context.localId },
      format: 'JSONEachRow',
    });
    const [row] = await result.json<{ latest: string; earliest: string; span_hours: string }>();
    const spanHours = Number(row?.span_hours ?? 0);
    if (!row || spanHours < 24) return null;
    return { delta: Number(row.latest) - Number(row.earliest), days: Math.min(7, Math.round(spanHours / 24)) };
  }

  private static trendDetail(trend: MightTrend): Pick<ShareCardStat, 'detail' | 'trend'> {
    const sign = trend.delta > 0 ? '+' : trend.delta < 0 ? '-' : '';
    return {
      detail: `${sign}${this.compact(Math.abs(trend.delta))} in ${trend.days}d`,
      trend: trend.delta > 0 ? 'up' : trend.delta < 0 ? 'down' : 'flat',
    };
  }

  private static toHeadDocument(preview: SharePreview): string {
    const escape = ShareCardRenderer.escape.bind(ShareCardRenderer);
    const canonical = `${this.siteUrl()}${preview.path}`;
    const image = preview.found
      ? `${this.apiUrl()}/assets/og${preview.path}.png?v=${encodeURIComponent(preview.dataVersion ?? '')}`
      : `${this.apiUrl()}/assets/og/player/0.png`;
    const meta: [string, string, string][] = [
      ['name', 'description', preview.description],
      ['name', 'robots', preview.found ? 'index, follow' : 'noindex, follow'],
      ['name', 'theme-color', '#060d1f'],
      ['property', 'og:site_name', this.SITE_NAME],
      ['property', 'og:type', preview.found ? 'profile' : 'website'],
      ['property', 'og:locale', 'en_US'],
      ['property', 'og:title', preview.title],
      ['property', 'og:description', preview.description],
      ['property', 'og:url', canonical],
      ['property', 'og:image', image],
      ['property', 'og:image:type', 'image/png'],
      ['property', 'og:image:width', String(SHARE_CARD_WIDTH)],
      ['property', 'og:image:height', String(SHARE_CARD_HEIGHT)],
      ['property', 'og:image:alt', preview.imageAlt],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', preview.title],
      ['name', 'twitter:description', preview.description],
      ['name', 'twitter:image', image],
      ['name', 'twitter:image:alt', preview.imageAlt],
    ];
    const tags = meta
      .map(([attribute, key, content]) => `<meta ${attribute}="${key}" content="${escape(content)}">`)
      .join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(preview.title)}</title>
<link rel="canonical" href="${escape(canonical)}">
${tags}
</head>
<body>
<main>
<h1>${escape(preview.card.title)}</h1>
<p>${escape(preview.description)}</p>
<p><a href="${escape(canonical)}">Open on ${this.SITE_NAME}</a></p>
</main>
</body>
</html>
`;
  }

  private static serverLabel(context: ProfileContext): string {
    return ApiHelper.ggeTrackerManager.getServerByCode(context.code)?.outer_name ?? context.server;
  }

  private static siteUrl(): string {
    return (process.env.SITE_URL || 'https://gge-tracker.com').replace(/\/+$/, '');
  }

  private static apiUrl(): string {
    return `${(process.env.BACKEND_API_URI || 'https://api.gge-tracker.com').replace(/\/+$/, '')}/api/v1`;
  }

  private static displayUrl(path: string): string {
    return `${this.siteUrl().replace(/^https?:\/\//, '')}${path === '/' ? '' : path}`;
  }

  private static compact(value: number): string {
    const units: [number, string][] = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];
    for (const [threshold, suffix] of units) {
      if (Math.abs(value) >= threshold) {
        const scaled = value / threshold;
        return `${scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : 1)}${suffix}`;
      }
    }
    return String(Math.round(value));
  }

  private static grouped(value: number): string {
    return value.toLocaleString('en-US');
  }
}
