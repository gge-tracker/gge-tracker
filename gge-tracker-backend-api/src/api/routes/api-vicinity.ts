import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import {
  CastleType,
  KINGDOM_MAP_WIDTH,
  MapPoint,
  VICINITY_CASTLE_TYPES,
  VicinityCastle,
  nearestOrigin,
  roundDistance,
  vicinityCastlesOf,
} from '../helper/vicinity-geometry';
import { CastleIndex, IndexedCastle } from '../helper/vicinity-castle-index';
import { MIGHT_RULE, MightSignals, readMightSignals } from '../helper/vicinity-might';
import { ApiProfiles, ProfileContext } from './api-profiles';

interface Subject {
  id: number;
  name: string;
  allianceId: number | null;
  allianceName: string | null;
  origins: VicinityCastle[];
}

interface HonorActivity {
  gained: number;
  lost: number;
  changes: number;
}

interface Neighbour {
  id: number;
  row: any;
  castles: IndexedCastle[];
  nearest: IndexedCastle;
}

interface VicinityEvent {
  type: string;
  occurred_at: string;
  player_id: string | null;
  [field: string]: unknown;
}

function nearAnyOrigin(x: string, y: string): string {
  return `EXISTS (
    SELECT 1 FROM unnest($2::int[], $3::int[]) AS O(x, y)
    WHERE ABS(${y} - O.y) <= $4 AND LEAST(ABS(${x} - O.x), ${KINGDOM_MAP_WIDTH} - ABS(${x} - O.x)) <= $4
  )`;
}

function neighbourRowsQuery(firstSeen: string): string {
  return `SELECT P.id, P.name, P.alliance_id, A.name AS alliance_name, P.level, P.legendary_level, P.might_current,
      P.honor, P.remaining_peace_time, P.peace_disabled_at, P.is_ruin, ${firstSeen} AS first_seen_at
    FROM players P
    LEFT JOIN alliances A ON A.id = P.alliance_id
    WHERE P.id = ANY($1::int[])`;
}

export abstract class ApiVicinity implements ApiHelper {
  public static readonly DEFAULT_RADIUS = 30;
  public static readonly MIN_RADIUS = 5;
  public static readonly MAX_RADIUS = 50;
  public static readonly CACHE_TTL_SECONDS = 3600;

  private static readonly WINDOW = `NOW() - INTERVAL '${MIGHT_RULE.windowDays} days'`;
  private static readonly DAY_MS = 86_400_000;
  // A protection that still had over an hour to run when it vanished was given up, not expired
  private static readonly EARLY_END_MARGIN_MS = 3_600_000;

  public static async getPlayerVicinity(request: express.Request, response: express.Response): Promise<void> {
    const id = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
    const context = id === false ? null : ApiProfiles.contextFor(id, new Set());
    if (!context) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
      return;
    }
    const radius = this.parseRadius(request.query.radius);
    if (radius === null) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidVicinityRadius });
      return;
    }
    try {
      const dataVersion = await ApiHelper.getCacheVersion(ApiHelper.redisClient, context.server);
      const key = `vicinity:${context.server}:${dataVersion}:${context.id}:${radius}`;
      const caching = { etag: HttpCache.etagFromCacheKey(key), dataVersion, maxAgeSeconds: this.CACHE_TTL_SECONDS };
      if (HttpCache.handleConditional(request, response, caching)) return;
      const cached = await ApiHelper.redisClient.get(key);
      if (cached) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cached));
        return;
      }

      const subject = await this.readSubject(context);
      if (!subject) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }
      const vicinity = await this.buildVicinity(context, subject, radius, dataVersion);
      void ApiHelper.updateCache(key, vicinity, this.CACHE_TTL_SECONDS);
      response.status(ApiHelper.HTTP_OK).send(vicinity);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getPlayerVicinity', request);
    }
  }

  private static parseRadius(raw: unknown): number | null {
    if (raw === undefined || raw === '') return this.DEFAULT_RADIUS;
    if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw)) return null;
    const radius = Number(raw);
    return radius >= this.MIN_RADIUS && radius <= this.MAX_RADIUS ? radius : null;
  }

  private static async buildVicinity(
    context: ProfileContext,
    subject: Subject,
    radius: number,
    dataVersion: string,
  ): Promise<Record<string, unknown>> {
    const now = Date.now();
    const origins = subject.origins;
    const [neighbours, movementRows] = await Promise.all([
      this.readNeighbours(context, subject, radius, dataVersion),
      this.readMovements(context, subject, radius),
    ]);
    const ids = neighbours.map((neighbour) => neighbour.id);
    const [allianceRows, renameRows, stateRows, might] = await Promise.all([
      this.readHistory(context, 'player_alliance_update', ids),
      this.readHistory(context, 'player_name_update_history', ids),
      this.readHistory(context, 'player_state_history', ids),
      this.readMight(context, ids),
    ]);

    const byId = new Map(neighbours.map((neighbour) => [neighbour.id, neighbour]));
    const honor = this.honorActivity(stateRows, now);
    const events: VicinityEvent[] = [
      ...this.movementEvents(context, subject, movementRows, radius),
      ...this.appearanceEvents(context, subject, neighbours, now),
      ...this.allianceEvents(context, subject, allianceRows, byId),
      ...this.renameEvents(context, subject, renameRows, byId),
      ...this.stateEvents(context, subject, stateRows, byId),
      ...this.mightEvents(context, subject, might, byId),
    ].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

    return {
      server: context.server,
      server_code: context.code,
      generated_at: new Date(now).toISOString(),
      since: new Date(now - MIGHT_RULE.windowDays * this.DAY_MS).toISOString(),
      radius,
      might_available: might !== null,
      player: {
        player_id: ApiHelper.addCountryCode(String(subject.id), context.code),
        player_name: subject.name,
        alliance_id: ApiHelper.addCountryCode(subject.allianceId as any, context.code),
        alliance_name: subject.allianceName,
      },
      origins: origins.map((origin, index) => ({
        origin: index,
        castle_type: origin.castle_type,
        x: origin.x,
        y: origin.y,
      })),
      neighbours: neighbours
        .map((neighbour) => this.neighbourView(context, subject, neighbour, honor, might))
        .sort((a, b) => (a.distance as number) - (b.distance as number)),
      events,
    };
  }

  private static async readSubject(context: ProfileContext): Promise<Subject | null> {
    const results = await context.pool.query(
      `SELECT P.id, P.name, P.alliance_id, A.name AS alliance_name, P.castles
        FROM players P LEFT JOIN alliances A ON A.id = P.alliance_id
        WHERE P.id = $1`,
      [context.localId],
    );
    const row = results.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      name: row.name,
      allianceId: row.alliance_id === null ? null : Number(row.alliance_id),
      allianceName: row.alliance_name ?? null,
      origins: vicinityCastlesOf(row.castles),
    };
  }

  private static async readNeighbours(
    context: ProfileContext,
    subject: Subject,
    radius: number,
    dataVersion: string,
  ): Promise<Neighbour[]> {
    if (subject.origins.length === 0) return [];
    const index = await CastleIndex.of(context.server, dataVersion, context.pool);
    const castlesById = index.near(subject.origins, radius, subject.id);
    if (castlesById.size === 0) return [];
    const rows = await this.readNeighbourRows(context, [...castlesById.keys()]);
    return rows
      .filter((row) => castlesById.has(Number(row.id)))
      .map((row) => {
        const castles = castlesById.get(Number(row.id))!;
        return { id: Number(row.id), row, castles, nearest: castles[0] };
      });
  }

  private static async readNeighbourRows(context: ProfileContext, ids: number[]): Promise<any[]> {
    try {
      const results = await context.pool.query(neighbourRowsQuery('P.first_seen_at'), [ids]);
      return results.rows;
    } catch (error: any) {
      if (error?.code !== '42703') throw error;
      const results = await context.pool.query(neighbourRowsQuery('NULL::timestamp'), [ids]);
      return results.rows;
    }
  }

  private static async readMovements(context: ProfileContext, subject: Subject, radius: number): Promise<any[]> {
    if (subject.origins.length === 0) return [];
    const results = await context.pool.query(
      `SELECT M.castle_type, M.movement_type, M.position_x_old, M.position_y_old, M.position_x_new, M.position_y_new,
          M.previous_owner_id, M.created_at, M.player_id,
          P.name AS player_name, P.alliance_id, A.name AS alliance_name,
          O.name AS previous_owner_name, O.alliance_id AS previous_owner_alliance_id, OA.name AS previous_owner_alliance_name
        FROM player_castle_movements_history M
        LEFT JOIN players P ON P.id = M.player_id
        LEFT JOIN alliances A ON A.id = P.alliance_id
        LEFT JOIN players O ON O.id = M.previous_owner_id
        LEFT JOIN alliances OA ON OA.id = O.alliance_id
        WHERE M.created_at >= ${this.WINDOW}
          AND M.player_id <> $1
          AND M.castle_type = ANY($5::int[])
          AND (${nearAnyOrigin('M.position_x_new', 'M.position_y_new')} OR ${nearAnyOrigin('M.position_x_old', 'M.position_y_old')})
        ORDER BY M.created_at DESC, M.id DESC`,
      [
        subject.id,
        subject.origins.map((origin) => origin.x),
        subject.origins.map((origin) => origin.y),
        radius,
        VICINITY_CASTLE_TYPES,
      ],
    );
    return results.rows;
  }

  private static async readHistory(
    context: ProfileContext,
    table: 'player_alliance_update' | 'player_name_update_history' | 'player_state_history',
    ids: number[],
  ): Promise<any[]> {
    if (ids.length === 0) return [];
    try {
      const results = await context.pool.query(
        `SELECT * FROM ${table} WHERE player_id = ANY($1::int[]) AND created_at >= ${this.WINDOW} ORDER BY created_at DESC, id DESC`,
        [ids],
      );
      return results.rows;
    } catch (error: any) {
      if (error?.code === '42P01' && table === 'player_state_history') return [];
      throw error;
    }
  }

  private static async readMight(context: ProfileContext, ids: number[]): Promise<MightSignals | null> {
    const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(context.id);
    if (!database) return null;
    try {
      const client = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      return await readMightSignals(client, database, ids);
    } catch (error) {
      ApiHelper.logError(error, 'getPlayerVicinity_might');
      return null;
    }
  }

  private static movementEvents(
    context: ProfileContext,
    subject: Subject,
    rows: any[],
    radius: number,
  ): VicinityEvent[] {
    const events: VicinityEvent[] = [];
    for (const row of rows) {
      const fromPoint = this.point(row.position_x_old, row.position_y_old);
      const toPoint = this.point(row.position_x_new, row.position_y_new);
      const fromNearest = fromPoint ? nearestOrigin(fromPoint, subject.origins) : null;
      const toNearest = toPoint ? nearestOrigin(toPoint, subject.origins) : null;
      const closest = [fromNearest, toNearest]
        .filter((nearest) => nearest !== null)
        .sort((a, b) => a.distance - b.distance)[0];
      if (!closest || closest.distance > radius) continue;
      const type = this.movementType(row);
      if (!type) continue;
      const base = {
        type,
        occurred_at: new Date(row.created_at).toISOString(),
        ...this.who(context, subject, row.player_id, row.player_name, row.alliance_id, row.alliance_name),
        castle_type: Number(row.castle_type),
      };
      if (type === 'castle_relocated') {
        events.push({
          ...base,
          position: toPoint,
          distance: toNearest ? roundDistance(toNearest.distance) : null,
          origin: toNearest?.origin ?? null,
          previous_position: fromPoint,
          previous_distance: fromNearest ? roundDistance(fromNearest.distance) : null,
          previous_origin: fromNearest?.origin ?? null,
        });
        continue;
      }
      const position = type === 'castle_vanished' ? fromPoint : toPoint;
      const nearest = type === 'castle_vanished' ? fromNearest : toNearest;
      if (!position || !nearest || nearest.distance > radius) continue;
      events.push({
        ...base,
        position,
        distance: roundDistance(nearest.distance),
        origin: nearest.origin,
        ...(type === 'castle_captured' ? { previous_owner: this.previousOwner(context, subject, row) } : {}),
      });
    }
    return events;
  }

  private static movementType(row: any): string | null {
    const castleType = Number(row.castle_type);
    if (row.movement_type === 'move') return castleType === CastleType.MAIN ? 'castle_relocated' : null;
    if (row.movement_type === 'remove') return castleType === CastleType.MAIN ? 'castle_vanished' : null;
    if (row.movement_type !== 'add') return null;
    if (castleType === CastleType.MAIN) return 'player_appeared';
    return row.previous_owner_id === null ? 'castle_founded' : 'castle_captured';
  }

  private static previousOwner(context: ProfileContext, subject: Subject, row: any): Record<string, unknown> {
    return {
      player_id: ApiHelper.addCountryCode(row.previous_owner_id, context.code),
      player_name: row.previous_owner_name ?? null,
      alliance_id: ApiHelper.addCountryCode(row.previous_owner_alliance_id, context.code),
      alliance_name: row.previous_owner_alliance_name ?? null,
      is_me: Number(row.previous_owner_id) === subject.id,
      is_ally: this.isAlly(subject, row.previous_owner_alliance_id) && Number(row.previous_owner_id) !== subject.id,
    };
  }

  private static appearanceEvents(
    context: ProfileContext,
    subject: Subject,
    neighbours: Neighbour[],
    now: number,
  ): VicinityEvent[] {
    const since = now - MIGHT_RULE.windowDays * this.DAY_MS;
    return neighbours
      .filter((neighbour) => neighbour.row.first_seen_at && new Date(neighbour.row.first_seen_at).getTime() >= since)
      .map((neighbour) => ({
        type: 'player_appeared',
        occurred_at: new Date(neighbour.row.first_seen_at).toISOString(),
        player_id: ApiHelper.addCountryCode(String(neighbour.id), context.code),
        new_account: true,
        ...this.located(context, subject, neighbour),
      }));
  }

  private static allianceEvents(
    context: ProfileContext,
    subject: Subject,
    rows: any[],
    byId: Map<number, Neighbour>,
  ): VicinityEvent[] {
    return rows.map((row) => ({
      type: 'alliance_changed',
      occurred_at: new Date(row.created_at).toISOString(),
      player_id: ApiHelper.addCountryCode(row.player_id, context.code),
      old_alliance_id: ApiHelper.addCountryCode(row.old_alliance_id, context.code),
      old_alliance_name: row.old_alliance_name ?? null,
      new_alliance_id: ApiHelper.addCountryCode(row.new_alliance_id, context.code),
      new_alliance_name: row.new_alliance_name ?? null,
      joined_my_alliance: subject.allianceId !== null && Number(row.new_alliance_id) === subject.allianceId,
      left_my_alliance: subject.allianceId !== null && Number(row.old_alliance_id) === subject.allianceId,
      ...this.located(context, subject, byId.get(Number(row.player_id))!),
    }));
  }

  private static renameEvents(
    context: ProfileContext,
    subject: Subject,
    rows: any[],
    byId: Map<number, Neighbour>,
  ): VicinityEvent[] {
    return rows.map((row) => ({
      type: 'player_renamed',
      occurred_at: new Date(row.created_at).toISOString(),
      player_id: ApiHelper.addCountryCode(row.player_id, context.code),
      old_name: row.old_name,
      new_name: row.new_name,
      ...this.located(context, subject, byId.get(Number(row.player_id))!),
    }));
  }

  private static stateEvents(
    context: ProfileContext,
    subject: Subject,
    rows: any[],
    byId: Map<number, Neighbour>,
  ): VicinityEvent[] {
    const events: VicinityEvent[] = [];
    for (const row of rows) {
      const base = {
        occurred_at: new Date(row.created_at).toISOString(),
        player_id: ApiHelper.addCountryCode(row.player_id, context.code),
        ...this.located(context, subject, byId.get(Number(row.player_id))!),
      };
      if (!row.peace_old && row.peace_new) {
        events.push({ type: 'protection_started', ...base, protected_until: this.isoOrNull(row.peace_until_new) });
      }
      if (row.peace_old && !row.peace_new) {
        const scheduled = row.peace_until_old ? new Date(row.peace_until_old).getTime() : null;
        events.push({
          type: 'protection_ended',
          ...base,
          scheduled_end: this.isoOrNull(row.peace_until_old),
          ended_early: scheduled !== null && scheduled - new Date(row.created_at).getTime() > this.EARLY_END_MARGIN_MS,
        });
      }
      if (row.ruin_old !== row.ruin_new) {
        events.push({ type: row.ruin_new ? 'ruin_started' : 'ruin_ended', ...base });
      }
    }
    return events;
  }

  private static mightEvents(
    context: ProfileContext,
    subject: Subject,
    might: MightSignals | null,
    byId: Map<number, Neighbour>,
  ): VicinityEvent[] {
    if (!might) return [];
    return might.spikes
      .filter((spike) => byId.has(spike.playerId))
      .map((spike) => ({
        type: 'might_spike',
        occurred_at: spike.occurredAt,
        player_id: ApiHelper.addCountryCode(String(spike.playerId), context.code),
        change: spike.change,
        before: spike.before,
        typical_hourly_change: spike.typical,
        ...this.located(context, subject, byId.get(spike.playerId)!),
      }));
  }

  private static honorActivity(
    rows: any[],
    now: number,
  ): Map<number, { day: HonorActivity; week: HonorActivity; lastAt: string }> {
    const activity = new Map<number, { day: HonorActivity; week: HonorActivity; lastAt: string }>();
    const dayStart = now - this.DAY_MS;
    for (const row of rows) {
      if (row.honor_old === null || row.honor_new === null || row.honor_old === row.honor_new) continue;
      const playerId = Number(row.player_id);
      const at = new Date(row.created_at);
      const entry = activity.get(playerId) ?? {
        day: { gained: 0, lost: 0, changes: 0 },
        week: { gained: 0, lost: 0, changes: 0 },
        lastAt: at.toISOString(),
      };
      const change = Number(row.honor_new) - Number(row.honor_old);
      this.addHonor(entry.week, change);
      if (at.getTime() >= dayStart) this.addHonor(entry.day, change);
      if (at.toISOString() > entry.lastAt) entry.lastAt = at.toISOString();
      activity.set(playerId, entry);
    }
    return activity;
  }

  private static addHonor(activity: HonorActivity, change: number): void {
    activity.changes++;
    if (change > 0) activity.gained += change;
    else activity.lost -= change;
  }

  private static neighbourView(
    context: ProfileContext,
    subject: Subject,
    neighbour: Neighbour,
    honor: Map<number, { day: HonorActivity; week: HonorActivity; lastAt: string }>,
    might: MightSignals | null,
  ): Record<string, unknown> {
    const row = neighbour.row;
    const protectedUntil = this.isoOrNull(row.peace_disabled_at);
    const inProtection =
      Number(row.remaining_peace_time ?? 0) > 0 && (protectedUntil === null || Date.parse(protectedUntil) > Date.now());
    const trend = might?.trends.get(neighbour.id);
    const activity = honor.get(neighbour.id);
    const idle = { gained: 0, lost: 0, changes: 0 };
    return {
      player_id: ApiHelper.addCountryCode(String(neighbour.id), context.code),
      player_name: row.name,
      alliance_id: ApiHelper.addCountryCode(row.alliance_id, context.code),
      alliance_name: row.alliance_name ?? null,
      is_ally: this.isAlly(subject, row.alliance_id),
      level: Number(row.level ?? 0),
      legendary_level: Number(row.legendary_level ?? 0),
      might_current: Number(row.might_current ?? 0),
      might_change_24h: trend ? trend.change24h : null,
      might_change_7d: trend ? trend.change7d : null,
      honor: Number(row.honor ?? 0),
      honor_24h: activity?.day ?? idle,
      honor_7d: activity?.week ?? idle,
      last_honor_change_at: activity?.lastAt ?? null,
      in_protection: inProtection,
      protected_until: inProtection ? protectedUntil : null,
      is_ruin: row.is_ruin === true,
      first_seen_at: this.isoOrNull(row.first_seen_at),
      distance: neighbour.nearest.distance,
      origin: neighbour.nearest.origin,
      castles: neighbour.castles,
    };
  }

  private static located(context: ProfileContext, subject: Subject, neighbour: Neighbour): Record<string, unknown> {
    const row = neighbour.row;
    return {
      player_name: row.name,
      alliance_id: ApiHelper.addCountryCode(row.alliance_id, context.code),
      alliance_name: row.alliance_name ?? null,
      is_ally: this.isAlly(subject, row.alliance_id),
      castle_type: neighbour.nearest.castle_type,
      position: { x: neighbour.nearest.x, y: neighbour.nearest.y },
      distance: neighbour.nearest.distance,
      origin: neighbour.nearest.origin,
    };
  }

  private static who(
    context: ProfileContext,
    subject: Subject,
    playerId: unknown,
    playerName: string | null,
    allianceId: unknown,
    allianceName: string | null,
  ): { player_id: string | null; [field: string]: unknown } {
    return {
      player_id: ApiHelper.addCountryCode(playerId as any, context.code),
      player_name: playerName ?? null,
      alliance_id: ApiHelper.addCountryCode(allianceId as any, context.code),
      alliance_name: allianceName ?? null,
      is_ally: this.isAlly(subject, allianceId),
    };
  }

  private static isAlly(subject: Subject, allianceId: unknown): boolean {
    return subject.allianceId !== null && allianceId !== null && Number(allianceId) === subject.allianceId;
  }

  private static point(x: unknown, y: unknown): MapPoint | null {
    return x === null || y === null || x === undefined || y === undefined ? null : { x: Number(x), y: Number(y) };
  }

  private static isoOrNull(value: unknown): string | null {
    return value ? new Date(value as string).toISOString() : null;
  }
}
