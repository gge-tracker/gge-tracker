import * as express from 'express';
import * as pg from 'pg';
import { GgeTrackerSqlBaseNameEnum } from '../enums/gge-tracker-sql-base-name.enums';
import { ApiHelper } from '../helper/api-helper';

interface ParameterRow {
  identifier: string;
  value: number | null;
  updated_at: Date;
}

interface StatisticsRow {
  players_count: string | number | null;
  alliance_count: string | number | null;
  created_at: Date;
}

interface CollectionState {
  steps: { name: string; completed_at: string; completed_in_last_fill: boolean }[];
  last_update: { [identifier: string]: string };
  update_in_progress: boolean;
  last_fill_completed_at: string | null;
  last_fill_duration_seconds: number | null;
}

interface DatasetState {
  dataset: { players: number | null; alliances: number | null; snapshot_at: string } | null;
  fill_interval_seconds: number;
}

interface StatusCore {
  server: string;
  server_code: string;
  zone: string;
  platform: string;
  discord_member_count?: number;
  data_version: string;
  weekly_reset_offset_hours: number | null;
  collection: CollectionState;
  dataset: DatasetState;
}

/**
 * Abstract class providing API status and server information endpoints
 *
 * @remarks
 * This class implements methods to handle API status checks and server list retrievals
 * It is intended to be used as a base class for API route handlers
 */
export abstract class ApiStatus implements ApiHelper {
  private static readonly CACHE_KEY_PREFIX = 'api_status:v2:';
  private static readonly CACHE_TTL_SECONDS = 60;
  private static readonly LAST_DURATION_KEY_PREFIX = 'api_status:last-duration:';
  private static readonly LAST_DURATION_TTL_SECONDS = 7 * 24 * 3600;
  private static readonly DISCORD_INVITE_CODE = 'eb6WSHQqYh';
  private static readonly DISCORD_CACHE_KEY = 'discord_invite';
  private static readonly DISCORD_CACHE_TTL_SECONDS = 3600;

  private static readonly FILL_STEPS: readonly string[] = [
    'loot',
    'war_realms',
    'samurai',
    'berimond_invasion',
    'berimond_kingdom',
    'bloodcrow',
    'nomad',
    'might',
  ];

  private static readonly NOMINAL_FILL_INTERVAL_SECONDS = 3600;
  private static readonly MIN_FILL_INTERVAL_SECONDS = 900;
  private static readonly MAX_FILL_INTERVAL_SECONDS = 6 * 3600;
  private static readonly FILL_HISTORY_SAMPLE = 5;
  private static readonly STALE_FILL_MULTIPLIER = 2;
  private static readonly RECOMMENDED_POLL_INTERVAL_SECONDS = 300;
  private static readonly POLL_FLOOR_SECONDS = 30;
  private static readonly MS_PER_HOUR = 3_600_000;
  private static readonly HOURS_PER_WEEK = 168;

  private static readonly POLLING_INSTRUCTIONS =
    'Send the ETag response header back as If-None-Match. A 304 means data.version has not moved and nothing was ' +
    'collected since your last call. Poll again after polling.poll_after rather than on a fixed schedule: the ' +
    'collection duration varies from one run to the next.';

  /**
   * Handles the API status endpoint
   *
   * @param request - The Express request object, expected to carry `pg_pool`, `language` and `code`
   * @param response - The Express response object used to send the status data or error information
   * @returns A Promise that resolves when the response has been sent
   */
  public static async getStatus(request: express.Request, response: express.Response): Promise<void> {
    try {
      const core = await this.readCore(request);
      const etag = this.buildEtag(core);
      this.applyCachingHeaders(response, core, etag);
      if (this.isNotModified(request, etag)) {
        response.status(304).end();
        return;
      }
      response.status(ApiHelper.HTTP_OK).send(this.buildPayload(core, new Date(), etag));
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStatus', request);
    }
  }

  /**
   * Handles the retrieval of all server names
   *
   * This method first attempts to fetch the list of server names from a Redis cache
   * If the data is found in the cache, it is returned immediately
   * Otherwise, it retrieves the server names from the GGE Tracker Manager, caches the result for 24 hours,
   * and then returns the list to the client
   *
   * @param request - The Express request object
   * @param response - The Express response object
   * @returns A promise that resolves when the response is sent
   *
   * @remarks
   * Responds with HTTP 200 and the list of server names on success
   * Responds with HTTP 500 and an error message if an error occurs
   */
  public static async getServers(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Check Redis cache for server names
       * --------------------------------- */
      const cachedKey = 'all_servers';
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Fetch server names and cache the result
       * --------------------------------- */
      const servers = ApiHelper.ggeTrackerManager.getAllServerNames();
      await ApiHelper.redisClient.setEx(cachedKey, 86_400, JSON.stringify(servers));
      response.status(ApiHelper.HTTP_OK).send(servers);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getServers', request);
    }
  }

  /**
   * The fill counter is part of the cache key, so a completed collection invalidates the entry the
   * moment it lands rather than at the end of the TTL, a client watching that counter would
   * otherwise learn about new data up to a minute late. The TTL still bounds everything that moves
   * without a new fill, the collection starting being the one that matters
   * @param request
   */
  private static async readCore(request: express.Request): Promise<StatusCore> {
    const code = request['code'] as string;
    const language = request['language'] as string;
    const dataVersion = await ApiHelper.getCacheVersion(ApiHelper.redisClient, language);
    const cachedKey = `${this.CACHE_KEY_PREFIX}${code}:${dataVersion}`;
    const cachedData = await ApiHelper.redisClient.get(cachedKey);
    if (cachedData) {
      return JSON.parse(cachedData) as StatusCore;
    }
    const core = await this.buildCore(request, dataVersion);
    await ApiHelper.updateCache(cachedKey, core, this.CACHE_TTL_SECONDS);
    return core;
  }

  private static async buildCore(request: express.Request, dataVersion: string): Promise<StatusCore> {
    const pool = request['pg_pool'] as pg.Pool;
    const language = request['language'] as string;
    const code = request['code'] as string;
    const server = ApiHelper.ggeTrackerManager.get(language);
    const [collection, dataset, discordMemberCount] = await Promise.all([
      this.readCollectionState(pool, code),
      this.readDatasetState(pool),
      this.readDiscordMemberCount(),
    ]);
    return {
      server: language,
      server_code: code,
      zone: server?.zone ?? '',
      platform: this.resolvePlatform(server?.databases?.olap),
      discord_member_count: discordMemberCount,
      data_version: dataVersion,
      weekly_reset_offset_hours: ApiHelper.ggeTrackerManager.getServerResetOffsetByCode(code),
      collection,
      dataset,
    };
  }

  /**
   * Reads the `parameters` table, which the scraper rewrites as it advances
   * @param pool
   * @param code
   */
  private static async readCollectionState(pool: pg.Pool, code: string): Promise<CollectionState> {
    const { rows } = await pool.query<ParameterRow>('SELECT identifier, value, updated_at FROM parameters');
    const byIdentifier = new Map(rows.map((row) => [row.identifier, row]));
    const stepRows = this.FILL_STEPS.map((name) => byIdentifier.get(name)).filter(
      (row): row is ParameterRow => row !== undefined,
    );

    const lastUpdate: { [identifier: string]: string } = {};
    for (const row of [...stepRows].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )) {
      lastUpdate[row.identifier] = new Date(row.updated_at).toISOString();
    }

    const durationRow = byIdentifier.get('duration');
    const lastFillCompletedAt = durationRow
      ? new Date(durationRow.updated_at).toISOString()
      : (lastUpdate['might'] ?? null);

    return {
      steps: stepRows.map((row) => ({
        name: row.identifier,
        completed_at: new Date(row.updated_at).toISOString(),
        completed_in_last_fill: row.value !== null,
      })),
      last_update: lastUpdate,
      update_in_progress: this.isUpdating(byIdentifier, lastUpdate),
      last_fill_completed_at: lastFillCompletedAt,
      last_fill_duration_seconds: await this.resolveFillDuration(durationRow, code),
    };
  }

  private static isUpdating(
    byIdentifier: Map<string, ParameterRow>,
    lastUpdate: { [identifier: string]: string },
  ): boolean {
    const flag = byIdentifier.get('is_currently_updating');
    if (flag) {
      return flag.value === null || flag.value === 1;
    }
    const loot = lastUpdate['loot'] ? new Date(lastUpdate['loot']).getTime() : 0;
    const might = lastUpdate['might'] ? new Date(lastUpdate['might']).getTime() : 0;
    return might < loot;
  }

  private static async resolveFillDuration(
    durationRow: ParameterRow | undefined,
    code: string,
  ): Promise<number | null> {
    const mirrorKey = this.LAST_DURATION_KEY_PREFIX + code;
    if (durationRow?.value != null) {
      await ApiHelper.updateCache(mirrorKey, durationRow.value, this.LAST_DURATION_TTL_SECONDS, true);
      return durationRow.value;
    }
    const mirrored = await ApiHelper.redisClient.get(mirrorKey).catch(() => null);
    return mirrored === null ? null : Number(mirrored);
  }

  private static async readDatasetState(pool: pg.Pool): Promise<DatasetState> {
    try {
      const { rows } = await pool.query<StatisticsRow>(
        `SELECT players_count, alliance_count, created_at
        FROM server_statistics
        ORDER BY id DESC
        LIMIT ${this.FILL_HISTORY_SAMPLE}`,
      );
      if (rows.length === 0) {
        return { dataset: null, fill_interval_seconds: this.NOMINAL_FILL_INTERVAL_SECONDS };
      }
      return {
        dataset: {
          players: rows[0].players_count === null ? null : Number(rows[0].players_count),
          alliances: rows[0].alliance_count === null ? null : Number(rows[0].alliance_count),
          snapshot_at: new Date(rows[0].created_at).toISOString(),
        },
        fill_interval_seconds: this.measureFillInterval(rows),
      };
    } catch {
      return { dataset: null, fill_interval_seconds: this.NOMINAL_FILL_INTERVAL_SECONDS };
    }
  }

  private static measureFillInterval(rows: StatisticsRow[]): number {
    const gaps: number[] = [];
    for (let index = 0; index < rows.length - 1; index++) {
      const gap = (new Date(rows[index].created_at).getTime() - new Date(rows[index + 1].created_at).getTime()) / 1000;
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length === 0) return this.NOMINAL_FILL_INTERVAL_SECONDS;
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median < this.MIN_FILL_INTERVAL_SECONDS || median > this.MAX_FILL_INTERVAL_SECONDS) {
      return this.NOMINAL_FILL_INTERVAL_SECONDS;
    }
    return Math.round(median / 60) * 60;
  }

  private static async readDiscordMemberCount(): Promise<number | undefined> {
    try {
      const cachedDiscordData = await ApiHelper.redisClient.get(this.DISCORD_CACHE_KEY);
      if (cachedDiscordData) {
        return JSON.parse(cachedDiscordData).approximate_member_count || 0;
      }
      const requestUrl = `https://discord.com/api/v9/invites/${this.DISCORD_INVITE_CODE}?with_counts=true&with_expiration=true`;
      const discordResponse: Response = await ApiHelper.fetchWithFallback(requestUrl);
      if (discordResponse.status !== ApiHelper.HTTP_OK) return undefined;
      const discordData = await discordResponse.json();
      await ApiHelper.updateCache(this.DISCORD_CACHE_KEY, discordData, this.DISCORD_CACHE_TTL_SECONDS);
      return discordData.approximate_member_count || 0;
    } catch {
      return undefined;
    }
  }

  private static resolvePlatform(olapDatabase: string | undefined): string {
    if (olapDatabase?.startsWith(GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME)) return 'E4K';
    if (olapDatabase?.startsWith(GgeTrackerSqlBaseNameEnum.BASE_OLAP_SPECIAL_SERVER_NAME)) return 'PARTNER';
    return 'EP';
  }

  private static buildPayload(core: StatusCore, now: Date, etag: string): object {
    const collection = core.collection;
    const dataset = core.dataset;
    const completedAt = collection.last_fill_completed_at ? new Date(collection.last_fill_completed_at) : null;
    const schedule = this.estimateSchedule(now, completedAt, collection, dataset.fill_interval_seconds);
    const ageSeconds = completedAt ? Math.max(0, Math.round((now.getTime() - completedAt.getTime()) / 1000)) : null;
    return {
      server: core.server,
      server_code: core.server_code,
      zone: core.zone,
      platform: core.platform,
      website_url: 'https://gge-tracker.com',
      api_url: 'https://api.gge-tracker.com',
      documentation_url: 'https://api.gge-tracker.com/api/v1/docs',
      discord_url: 'https://discord.gg/' + this.DISCORD_INVITE_CODE,
      discord_member_count: core.discord_member_count,
      version: ApiHelper.API_VERSION,
      release_version: ApiHelper.API_VERSION_RELEASE_DATE,
      generated_at: now.toISOString(),
      last_update: collection.last_update,
      update_in_progress: collection.update_in_progress,
      data: {
        version: Number(core.data_version),
        state: collection.update_in_progress ? 'updating' : 'idle',
        age_seconds: ageSeconds,
        stale: ageSeconds !== null && ageSeconds > this.STALE_FILL_MULTIPLIER * dataset.fill_interval_seconds,
        last_fill_started_at: schedule.last_fill_started_at,
        last_fill_completed_at: collection.last_fill_completed_at,
        last_fill_duration_seconds: collection.last_fill_duration_seconds,
        fill_interval_seconds: dataset.fill_interval_seconds,
        next_fill_estimated_at: schedule.next_fill_estimated_at,
        next_data_estimated_at: schedule.next_data_estimated_at,
        steps: collection.steps,
      },
      dataset: dataset.dataset,
      weekly_loot_reset: this.buildWeeklyReset(core.weekly_reset_offset_hours, now),
      polling: {
        recommended_interval_seconds: this.RECOMMENDED_POLL_INTERVAL_SECONDS,
        poll_after: schedule.next_data_estimated_at,
        cache_ttl_seconds: this.CACHE_TTL_SECONDS,
        etag,
        instructions: this.POLLING_INSTRUCTIONS,
      },
      rate_limit: {
        requests: ApiHelper.RATE_LIMIT_POINTS,
        window_seconds: ApiHelper.RATE_LIMIT_DURATION_SECONDS,
        applies_to_this_route: false,
      },
    };
  }

  private static estimateSchedule(
    now: Date,
    completedAt: Date | null,
    collection: CollectionState,
    intervalSeconds: number,
  ): {
    last_fill_started_at: string | null;
    next_fill_estimated_at: string | null;
    next_data_estimated_at: string | null;
  } {
    if (!completedAt) {
      return { last_fill_started_at: null, next_fill_estimated_at: null, next_data_estimated_at: null };
    }
    const durationMs = (collection.last_fill_duration_seconds ?? 0) * 1000;
    const intervalMs = intervalSeconds * 1000;
    const startedMs = completedAt.getTime() - durationMs;
    const cycles = Math.floor((now.getTime() - startedMs) / intervalMs) + 1;
    const nextStartMs = startedMs + Math.max(0, cycles) * intervalMs;
    const nextDataMs = collection.update_in_progress
      ? Math.max(nextStartMs - intervalMs + durationMs, now.getTime() + this.POLL_FLOOR_SECONDS * 1000)
      : nextStartMs + durationMs;
    return {
      last_fill_started_at: collection.last_fill_duration_seconds === null ? null : new Date(startedMs).toISOString(),
      next_fill_estimated_at: new Date(nextStartMs).toISOString(),
      next_data_estimated_at: new Date(nextDataMs).toISOString(),
    };
  }

  private static buildWeeklyReset(offsetHours: number | null, now: Date): object | null {
    if (offsetHours === null) return null;
    const last = this.weekResetInstant(now, offsetHours);
    const next = new Date(last.getTime() + this.HOURS_PER_WEEK * this.MS_PER_HOUR);
    return {
      offset_hours: offsetHours,
      last_reset_at: last.toISOString(),
      next_reset_at: next.toISOString(),
      seconds_until_next_reset: Math.round((next.getTime() - now.getTime()) / 1000),
    };
  }

  private static weekResetInstant(date: Date, offsetHours: number): Date {
    const monday = new Date(date);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    const candidate = monday.getTime() + (offsetHours - 1) * this.MS_PER_HOUR;
    const week = this.HOURS_PER_WEEK * this.MS_PER_HOUR;
    return new Date(candidate + Math.floor((date.getTime() - candidate) / week) * week);
  }

  private static buildEtag(core: StatusCore): string {
    const state = core.collection.update_in_progress ? 'updating' : 'idle';
    return `W/"${core.server_code}-${core.data_version}-${state}-${ApiHelper.API_VERSION}"`;
  }

  private static isNotModified(request: express.Request, etag: string): boolean {
    const header = request.headers['if-none-match'];
    if (!header) return false;
    const expected = this.normaliseTag(etag);
    return header.split(',').some((candidate) => candidate.trim() === '*' || this.normaliseTag(candidate) === expected);
  }

  private static normaliseTag(value: string): string {
    return value.trim().replaceAll('\\', '').replace(/^W\//, '');
  }

  private static applyCachingHeaders(response: express.Response, core: StatusCore, etag: string): void {
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', `public, max-age=${this.CACHE_TTL_SECONDS}`);
    response.setHeader('X-Data-Version', core.data_version);
    if (core.collection.last_fill_completed_at) {
      response.setHeader('Last-Modified', new Date(core.collection.last_fill_completed_at).toUTCString());
    }
  }
}
