import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';

interface ProfileContext {
  id: number;
  localId: number;
  code: string;
  server: string;
  pool: pg.Pool;
  sections: Set<string>;
}

export abstract class ApiProfiles implements ApiHelper {
  public static readonly PLAYER_SECTIONS = ['castles', 'rank', 'names', 'alliances', 'movements'];
  public static readonly ALLIANCE_SECTIONS = ['members', 'castles', 'names', 'descriptions', 'member_changes'];
  public static readonly CACHE_TTL_SECONDS = 3600;

  private static readonly HISTORY_LIMIT = 50;

  public static async getPlayerProfile(request: express.Request, response: express.Response): Promise<void> {
    const context = await this.resolve(request, response, 'player', this.PLAYER_SECTIONS);
    if (!context) return;
    try {
      const cached = await this.serveFromCache(request, response, context, 'player');
      if (cached) return;

      const player = await this.readPlayer(context);
      if (!player) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }

      const [rank, names, alliances, movements] = await Promise.all([
        this.when(context.sections.has('rank'), () => this.readPlayerRank(context, player)),
        this.when(context.sections.has('names'), () => this.readPlayerNames(context)),
        this.when(context.sections.has('alliances'), () => this.readPlayerAlliances(context)),
        this.when(context.sections.has('movements'), () => this.readPlayerMovements(context)),
      ]);

      const profile = {
        ...this.serverIdentity(context),
        player: player.identity,
        castles: context.sections.has('castles') ? player.castles : undefined,
        rank,
        name_history: names,
        alliance_history: alliances,
        castle_movements: movements,
      };
      await this.sendProfile(request, response, context, 'player', profile);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getPlayerProfile', request);
    }
  }

  public static async getAllianceProfile(request: express.Request, response: express.Response): Promise<void> {
    const context = await this.resolve(request, response, 'alliance', this.ALLIANCE_SECTIONS);
    if (!context) return;
    try {
      const cached = await this.serveFromCache(request, response, context, 'alliance');
      if (cached) return;

      const alliance = await this.readAlliance(context);
      if (!alliance) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.AllianceNotFound });
        return;
      }

      const [members, names, descriptions, memberChanges] = await Promise.all([
        this.when(context.sections.has('members') || context.sections.has('castles'), () =>
          this.readAllianceMembers(context),
        ),
        this.when(context.sections.has('names'), () => this.readAllianceNames(context)),
        this.when(context.sections.has('descriptions'), () => this.readAllianceDescriptions(context)),
        this.when(context.sections.has('member_changes'), () => this.readAllianceMemberChanges(context)),
      ]);

      const profile = {
        ...this.serverIdentity(context),
        alliance: alliance.identity,
        statistics: alliance.statistics,
        members: context.sections.has('members') ? members?.map((member) => member.identity) : undefined,
        castles: context.sections.has('castles') ? members?.flatMap((member) => member.castles) : undefined,
        name_history: names,
        description_history: descriptions,
        member_changes: memberChanges,
      };
      await this.sendProfile(request, response, context, 'alliance', profile);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAllianceProfile', request);
    }
  }

  private static async resolve(
    request: express.Request,
    response: express.Response,
    subject: 'player' | 'alliance',
    allowedSections: string[],
  ): Promise<ProfileContext | null> {
    const invalidId =
      subject === 'player' ? RouteErrorMessagesEnum.InvalidPlayerId : RouteErrorMessagesEnum.InvalidAllianceId;
    const rawId = subject === 'player' ? request.params.playerId : request.params.allianceId;
    const id = ApiHelper.verifyIdWithCountryCode(rawId);
    if (id === false) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: invalidId });
      return null;
    }
    const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(id);
    const code = ApiHelper.getCountryCode(String(id));
    const server = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(id);
    if (!pool || !code || !server) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: invalidId });
      return null;
    }
    const sections = this.parseSections(request, allowedSections);
    if ('error' in sections) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: sections.error });
      return null;
    }
    return {
      id,
      localId: Number(ApiHelper.removeCountryCode(String(id))),
      code,
      server,
      pool,
      sections: sections.sections,
    };
  }

  private static async when<T>(wanted: boolean, read: () => Promise<T>): Promise<T | undefined> {
    if (!wanted) return;
    return read();
  }

  private static parseSections(
    request: express.Request,
    allowed: string[],
  ): { sections: Set<string> } | { error: string } {
    const raw = ApiHelper.getParsedString(request.query.include);
    if (raw === null) return { sections: new Set(allowed) };
    if (raw === 'none') return { sections: new Set() };
    const requested = raw.split(',').map((section) => section.trim());
    if (requested.some((section) => !allowed.includes(section))) {
      return { error: `${RouteErrorMessagesEnum.InvalidIncludeSection}. Allowed: ${allowed.join(', ')}, none` };
    }
    return { sections: new Set(requested) };
  }

  private static serverIdentity(context: ProfileContext): Record<string, unknown> {
    const server = ApiHelper.ggeTrackerManager.getServerByCode(context.code);
    return {
      server: context.server,
      server_code: context.code,
      server_name: server?.outer_name ?? null,
      zone: server?.zone ?? null,
      weekly_reset_offset_hours: ApiHelper.ggeTrackerManager.getServerResetOffsetByCode(context.code),
      generated_at: new Date().toISOString(),
    };
  }

  private static cacheKey(context: ProfileContext, subject: string, dataVersion: string): string {
    const sections = [...context.sections].sort().join('.');
    return `profile:${subject}:${context.server}:${dataVersion}:${context.id}:${sections || 'none'}`;
  }

  private static async serveFromCache(
    request: express.Request,
    response: express.Response,
    context: ProfileContext,
    subject: string,
  ): Promise<boolean> {
    const dataVersion = await ApiHelper.getCacheVersion(ApiHelper.redisClient, context.server);
    const key = this.cacheKey(context, subject, dataVersion);
    if (
      HttpCache.handleConditional(request, response, {
        etag: HttpCache.etagFromCacheKey(key),
        dataVersion,
        maxAgeSeconds: this.CACHE_TTL_SECONDS,
      })
    ) {
      return true;
    }
    const cached = await ApiHelper.redisClient.get(key);
    if (!cached) return false;
    response.status(ApiHelper.HTTP_OK).send(JSON.parse(cached));
    return true;
  }

  private static async sendProfile(
    request: express.Request,
    response: express.Response,
    context: ProfileContext,
    subject: string,
    profile: Record<string, unknown>,
  ): Promise<void> {
    const dataVersion = await ApiHelper.getCacheVersion(ApiHelper.redisClient, context.server);
    void ApiHelper.updateCache(this.cacheKey(context, subject, dataVersion), profile, this.CACHE_TTL_SECONDS);
    response.status(ApiHelper.HTTP_OK).send(profile);
  }

  private static async readPlayer(
    context: ProfileContext,
  ): Promise<{ identity: Record<string, unknown>; castles: Record<string, unknown>[] } | null> {
    const query = `
      SELECT P.id, P.name, P.alliance_id, A.name AS alliance_name, P.alliance_rank,
        P.might_current, P.might_all_time, P.loot_current, P.loot_all_time,
        P.honor, P.max_honor, P.highest_fame, P.current_fame,
        P.level, P.legendary_level, P.remaining_relocation_time,
        P.peace_disabled_at, P.updated_at, P.castles, P.castles_realm
      FROM players P
      LEFT JOIN alliances A ON P.alliance_id = A.id
      WHERE P.id = $1`;
    const results = await context.pool.query(query, [context.localId]);
    const row = results.rows[0];
    if (!row) return null;
    return {
      identity: {
        player_id: ApiHelper.addCountryCode(row.id, context.code),
        player_name: row.name,
        alliance_id: ApiHelper.addCountryCode(row.alliance_id, context.code),
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
        remaining_relocation_time: Number(row.remaining_relocation_time),
        peace_disabled_at: row.peace_disabled_at,
        updated_at: new Date(row.updated_at).toISOString(),
      },
      castles: this.flattenCastles(row.castles, row.castles_realm),
    };
  }

  private static flattenCastles(castles: unknown, castlesRealm: unknown): Record<string, unknown>[] {
    const flattened: Record<string, unknown>[] = [];
    for (const castle of Array.isArray(castles) ? castles : []) {
      flattened.push({
        kingdom_id: 0,
        position_x: castle[0],
        position_y: castle[1],
        castle_type: castle[2],
        is_main: castle[2] === 1,
      });
    }
    for (const castle of Array.isArray(castlesRealm) ? castlesRealm : []) {
      flattened.push({
        kingdom_id: castle[0],
        position_x: castle[1],
        position_y: castle[2],
        castle_type: castle[3],
        is_main: false,
      });
    }
    return flattened;
  }

  /**
   * Ranked against players who still hold a castle. An account without one is deleted, and
   * counting it would shift every rank below it
   */
  private static async readPlayerRank(
    context: ProfileContext,
    player: { identity: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE might_current > $1) + 1 AS might_current,
        COUNT(*) FILTER (WHERE loot_current > $2) + 1 AS loot_current,
        COUNT(*) FILTER (WHERE honor > $3) + 1 AS honor,
        COUNT(*) FILTER (WHERE current_fame > $4) + 1 AS current_fame,
        COUNT(*) AS ranked_players
      FROM players
      WHERE castles IS NOT NULL AND jsonb_array_length(castles) > 0`;
    const results = await context.pool.query(query, [
      player.identity.might_current,
      player.identity.loot_current,
      player.identity.honor,
      player.identity.current_fame,
    ]);
    const row = results.rows[0];
    return {
      might_current: Number(row.might_current),
      loot_current: Number(row.loot_current),
      honor: Number(row.honor),
      current_fame: Number(row.current_fame),
      ranked_players: Number(row.ranked_players),
    };
  }

  private static async readPlayerNames(context: ProfileContext): Promise<Record<string, unknown>[]> {
    const query = `
      SELECT old_name, new_name, created_at
      FROM player_name_update_history
      WHERE player_id = $1
      ORDER BY created_at DESC
      LIMIT ${this.HISTORY_LIMIT}`;
    const results = await context.pool.query(query, [context.localId]);
    return results.rows.map((row: any) => ({
      old_name: row.old_name,
      new_name: row.new_name,
      occurred_at: new Date(row.created_at).toISOString(),
    }));
  }

  private static async readPlayerAlliances(context: ProfileContext): Promise<Record<string, unknown>[]> {
    const query = `
      SELECT old_alliance_id, new_alliance_id, old_alliance_name, new_alliance_name, created_at
      FROM player_alliance_update
      WHERE player_id = $1
      ORDER BY created_at DESC
      LIMIT ${this.HISTORY_LIMIT}`;
    const results = await context.pool.query(query, [context.localId]);
    return results.rows.map((row: any) => ({
      old_alliance_id: ApiHelper.addCountryCode(row.old_alliance_id, context.code),
      new_alliance_id: ApiHelper.addCountryCode(row.new_alliance_id, context.code),
      old_alliance_name: row.old_alliance_name,
      new_alliance_name: row.new_alliance_name,
      occurred_at: new Date(row.created_at).toISOString(),
    }));
  }

  private static async readPlayerMovements(context: ProfileContext): Promise<Record<string, unknown>[]> {
    const query = `
      SELECT castle_type, movement_type, position_x_old, position_y_old, position_x_new, position_y_new, created_at
      FROM player_castle_movements_history
      WHERE player_id = $1
      ORDER BY created_at DESC
      LIMIT ${this.HISTORY_LIMIT}`;
    const results = await context.pool.query(query, [context.localId]);
    return results.rows.map((row: any) => ({
      castle_type: row.castle_type,
      movement_type: row.movement_type,
      position_old: row.position_x_old === null ? null : { x: row.position_x_old, y: row.position_y_old },
      position_new: row.position_x_new === null ? null : { x: row.position_x_new, y: row.position_y_new },
      occurred_at: new Date(row.created_at).toISOString(),
    }));
  }

  private static async readAlliance(
    context: ProfileContext,
  ): Promise<{ identity: Record<string, unknown>; statistics: Record<string, unknown> } | null> {
    const query = `
      SELECT A.id, A.name, A.language, A.description, A.is_island_king,
        A.is_searching_alliance, A.auto_join_enabled,
        COUNT(P.id) AS player_count,
        COUNT(P.id) FILTER (WHERE P.loot_current > 0) AS active_player_count,
        COALESCE(SUM(P.might_current), 0) AS might_current,
        COALESCE(SUM(P.might_all_time), 0) AS might_all_time,
        COALESCE(SUM(P.loot_current), 0) AS loot_current,
        COALESCE(SUM(P.loot_all_time), 0) AS loot_all_time,
        COALESCE(SUM(P.current_fame), 0) AS current_fame,
        COALESCE(SUM(P.highest_fame), 0) AS highest_fame,
        COALESCE(ROUND(AVG(P.level), 2), 0) AS average_level
      FROM alliances A
      LEFT JOIN players P ON A.id = P.alliance_id
      WHERE A.id = $1
      GROUP BY A.id`;
    const results = await context.pool.query(query, [context.localId]);
    const row = results.rows[0];
    if (!row) return null;
    return {
      identity: {
        alliance_id: ApiHelper.addCountryCode(row.id, context.code),
        alliance_name: row.name,
        language: row.language,
        description: row.description,
        is_island_king: row.is_island_king,
        is_searching_players: row.is_searching_alliance,
        auto_join_enabled: row.auto_join_enabled,
      },
      statistics: {
        player_count: Number(row.player_count),
        active_player_count: Number(row.active_player_count),
        might_current: Number(row.might_current),
        might_all_time: Number(row.might_all_time),
        loot_current: Number(row.loot_current),
        loot_all_time: Number(row.loot_all_time),
        current_fame: Number(row.current_fame),
        highest_fame: Number(row.highest_fame),
        average_level: Number(row.average_level),
      },
    };
  }

  private static async readAllianceMembers(
    context: ProfileContext,
  ): Promise<{ identity: Record<string, unknown>; castles: Record<string, unknown>[] }[]> {
    const query = `
      SELECT id, name, alliance_rank, might_current, might_all_time, loot_current, loot_all_time,
        honor, max_honor, highest_fame, current_fame, level, legendary_level,
        peace_disabled_at, updated_at, castles, castles_realm
      FROM players
      WHERE alliance_id = $1
      ORDER BY might_current DESC, id ASC`;
    const results = await context.pool.query(query, [context.localId]);
    return results.rows.map((row: any) => ({
      identity: {
        player_id: ApiHelper.addCountryCode(row.id, context.code),
        player_name: row.name,
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
        updated_at: new Date(row.updated_at).toISOString(),
      },
      castles: this.flattenCastles(row.castles, row.castles_realm).map((castle) => ({
        player_id: ApiHelper.addCountryCode(row.id, context.code),
        player_name: row.name,
        ...castle,
      })),
    }));
  }

  private static async readAllianceNames(context: ProfileContext): Promise<Record<string, unknown>[]> {
    const query = `
      SELECT old_name, new_name, created_at
      FROM alliance_update_history
      WHERE alliance_id = $1
      ORDER BY created_at DESC
      LIMIT ${this.HISTORY_LIMIT}`;
    const results = await context.pool.query(query, [context.localId]);
    return results.rows.map((row: any) => ({
      old_name: row.old_name,
      new_name: row.new_name,
      occurred_at: new Date(row.created_at).toISOString(),
    }));
  }

  private static async readAllianceDescriptions(context: ProfileContext): Promise<Record<string, unknown>[]> {
    const query = `
      SELECT old_description, new_description, created_at
      FROM alliance_description_history
      WHERE alliance_id = $1
      ORDER BY created_at DESC
      LIMIT ${this.HISTORY_LIMIT}`;
    const results = await context.pool.query(query, [context.localId]);
    return results.rows.map((row: any) => ({
      old_description: row.old_description,
      new_description: row.new_description,
      occurred_at: new Date(row.created_at).toISOString(),
    }));
  }

  private static async readAllianceMemberChanges(context: ProfileContext): Promise<Record<string, unknown>[]> {
    const query = `
      SELECT U.player_id, P.name AS player_name, U.old_alliance_id, U.new_alliance_id,
        U.old_alliance_name, U.new_alliance_name, U.created_at
      FROM player_alliance_update U
      LEFT JOIN players P ON P.id = U.player_id
      WHERE U.old_alliance_id = $1 OR U.new_alliance_id = $1
      ORDER BY U.created_at DESC
      LIMIT ${this.HISTORY_LIMIT}`;
    const results = await context.pool.query(query, [context.localId]);
    return results.rows.map((row: any) => ({
      player_id: ApiHelper.addCountryCode(row.player_id, context.code),
      player_name: row.player_name,
      direction: Number(row.new_alliance_id) === context.localId ? 'joined' : 'left',
      old_alliance_id: ApiHelper.addCountryCode(row.old_alliance_id, context.code),
      new_alliance_id: ApiHelper.addCountryCode(row.new_alliance_id, context.code),
      old_alliance_name: row.old_alliance_name,
      new_alliance_name: row.new_alliance_name,
      occurred_at: new Date(row.created_at).toISOString(),
    }));
  }
}
