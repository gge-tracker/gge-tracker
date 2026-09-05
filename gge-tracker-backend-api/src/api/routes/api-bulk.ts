import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';

interface BulkSubject {
  table: string;
  columns: string;
  collection: 'players' | 'alliances';
  map: (row: any, code: string) => Record<string, unknown>;
}

export abstract class ApiBulk implements ApiHelper {
  public static readonly MAX_IDS = 500;

  private static readonly RECOMMENDED_POLL_INTERVAL_SECONDS = 300;
  private static readonly CACHE_TTL_SECONDS = 3600;

  private static readonly SUBJECTS: Record<string, BulkSubject> = {
    players: {
      table: 'players',
      collection: 'players',
      columns: `P.id, P.name, P.alliance_id, A.name AS alliance_name, P.alliance_rank,
        P.might_current, P.might_all_time, P.loot_current, P.loot_all_time,
        P.honor, P.max_honor, P.highest_fame, P.current_fame,
        P.level, P.legendary_level, P.peace_disabled_at, P.updated_at, P.castles`,
      map: (row, code) => ({
        player_id: ApiHelper.addCountryCode(row.id, code),
        player_name: row.name,
        alliance_id: ApiHelper.addCountryCode(row.alliance_id, code),
        alliance_name: row.alliance_name,
        alliance_rank: row.alliance_rank,
        might_current: Number(row.might_current),
        might_all_time: Number(row.might_all_time),
        loot_current: Number(row.loot_current),
        loot_all_time: Number(row.loot_all_time),
        honor: Number(row.honor),
        max_honor: Number(row.max_honor),
        highest_fame: Number(row.highest_fame),
        current_fame: Number(row.current_fame),
        level: Number(row.level),
        legendary_level: Number(row.legendary_level),
        peace_disabled_at: row.peace_disabled_at,
        castles: row.castles,
        updated_at: new Date(row.updated_at).toISOString(),
      }),
    },
    alliances: {
      table: 'alliances',
      collection: 'alliances',
      columns: `A.id, A.name, A.language, A.description, A.is_island_king,
        A.is_searching_alliance, A.auto_join_enabled,
        COUNT(P.id) AS player_count,
        COUNT(P.id) FILTER (WHERE P.loot_current > 0) AS active_player_count,
        COALESCE(SUM(P.might_current), 0) AS might_current,
        COALESCE(SUM(P.loot_current), 0) AS loot_current,
        COALESCE(SUM(P.current_fame), 0) AS current_fame`,
      map: (row, code) => ({
        alliance_id: ApiHelper.addCountryCode(row.id, code),
        alliance_name: row.name,
        language: row.language,
        description: row.description,
        is_island_king: row.is_island_king,
        is_searching_players: row.is_searching_alliance,
        auto_join_enabled: row.auto_join_enabled,
        player_count: Number(row.player_count),
        active_player_count: Number(row.active_player_count),
        might_current: Number(row.might_current),
        loot_current: Number(row.loot_current),
        current_fame: Number(row.current_fame),
      }),
    },
  };

  public static async getPlayersBulk(request: express.Request, response: express.Response): Promise<void> {
    await this.serve(request, response, 'players');
  }

  public static async getAlliancesBulk(request: express.Request, response: express.Response): Promise<void> {
    await this.serve(request, response, 'alliances');
  }

  private static async serve(
    request: express.Request,
    response: express.Response,
    subjectName: 'players' | 'alliances',
  ): Promise<void> {
    try {
      const ids = this.parseIds(request.body);
      if ('error' in ids) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: ids.error });
        return;
      }
      const grouped = this.groupByServer(ids.ids);
      if (grouped.size === 0) {
        const invalid =
          subjectName === 'players' ? RouteErrorMessagesEnum.InvalidPlayerId : RouteErrorMessagesEnum.InvalidAllianceId;
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: invalid });
        return;
      }

      const codes = [...grouped.keys()].sort();
      const servers = codes.map((code) => ApiHelper.ggeTrackerManager.getServerNameFromCode(code) ?? code);
      const versions = await Promise.all(codes.map((code) => this.dataVersionForCode(code)));
      const cacheKey = `bulk:${subjectName}:${codes.map((code, index) => `${code}-${versions[index]}`).join('.')}:${ids.ids.join(',')}`;
      if (
        HttpCache.handleConditional(request, response, {
          etag: HttpCache.etagFromCacheKey(cacheKey),
          maxAgeSeconds: this.RECOMMENDED_POLL_INTERVAL_SECONDS,
        })
      ) {
        return;
      }

      const cached = await ApiHelper.redisClient.get(cacheKey);
      const perServer = cached
        ? []
        : await Promise.all([...grouped].map(([code, localIds]) => this.readServer(subjectName, code, localIds)));
      const rows: Record<string, unknown>[] = cached ? JSON.parse(cached) : perServer.flat();
      if (!cached) void ApiHelper.updateCache(cacheKey, rows, this.CACHE_TTL_SECONDS);

      const idKey = subjectName === 'players' ? 'player_id' : 'alliance_id';
      const found = new Set(rows.map((row) => String(row[idKey])));
      response.status(ApiHelper.HTTP_OK).send({
        generated_at: new Date().toISOString(),
        requested: ids.ids.length,
        resolved: rows.length,
        servers,
        missing: ids.ids.filter((id) => !found.has(String(id))),
        polling: {
          recommended_interval_seconds: this.RECOMMENDED_POLL_INTERVAL_SECONDS,
          instructions:
            'Send the ETag response header back as If-None-Match. A 304 means none of these ' +
            'subjects changed. GET / reports the exact instant the next collection is expected.',
        },
        [this.SUBJECTS[subjectName].collection]: rows,
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, `getBulk:${subjectName}`, request);
    }
  }

  private static async readServer(
    subjectName: 'players' | 'alliances',
    code: string,
    localIds: number[],
  ): Promise<Record<string, unknown>[]> {
    const server = ApiHelper.ggeTrackerManager.getServerNameFromCode(code);
    const pool = server ? ApiHelper.ggeTrackerManager.getPgSqlPool(server) : null;
    if (!pool) return [];
    const subject = this.SUBJECTS[subjectName];
    const query =
      subjectName === 'players'
        ? `SELECT ${subject.columns}
          FROM players P LEFT JOIN alliances A ON P.alliance_id = A.id
          WHERE P.id = ANY($1::bigint[])`
        : `SELECT ${subject.columns}
          FROM alliances A LEFT JOIN players P ON A.id = P.alliance_id
          WHERE A.id = ANY($1::bigint[])
          GROUP BY A.id`;
    const results = await pool.query(query, [localIds]);
    return results.rows.map((row: any) => subject.map(row, code));
  }

  private static async dataVersionForCode(code: string): Promise<string> {
    const server = ApiHelper.ggeTrackerManager.getServerNameFromCode(code);
    return server ? ApiHelper.getCacheVersion(ApiHelper.redisClient, server) : '1';
  }

  private static groupByServer(ids: string[]): Map<string, number[]> {
    const grouped = new Map<string, number[]>();
    for (const id of ids) {
      const code = ApiHelper.getCountryCode(id);
      if (!ApiHelper.ggeTrackerManager.isValidCode(code)) continue;
      const localId = Number(ApiHelper.removeCountryCode(id));
      if (!Number.isSafeInteger(localId) || localId <= 0) continue;
      const bucket = grouped.get(code);
      if (bucket) bucket.push(localId);
      else grouped.set(code, [localId]);
    }
    return grouped;
  }

  private static parseIds(body: unknown): { ids: string[] } | { error: string } {
    const raw = Array.isArray(body) ? body : (body as { ids?: unknown })?.ids;
    if (!Array.isArray(raw) || raw.length === 0) return { error: RouteErrorMessagesEnum.InvalidIdList };
    if (raw.length > this.MAX_IDS) {
      return { error: `${RouteErrorMessagesEnum.TooManyIds}: the maximum is ${this.MAX_IDS}` };
    }
    const ids: string[] = [];
    for (const entry of raw) {
      if (ApiHelper.verifyIdWithCountryCode(entry) === false) continue;
      ids.push(String(entry).trim());
    }
    if (ids.length === 0) return { error: RouteErrorMessagesEnum.InvalidIdList };
    // Sorted so two callers asking for the same set share a cache entry and an ETag
    return { ids: [...new Set(ids)].sort() };
  }
}
