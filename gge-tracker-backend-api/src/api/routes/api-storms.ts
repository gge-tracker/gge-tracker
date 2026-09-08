import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { AuthorizedSpecialServersEnum } from '../enums/gge-tracker-special-servers.enums';
import { ApiHelper } from '../helper/api-helper';
import { CachedResponse } from '../helper/cache/cached-response';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';
import { PaginationCount } from '../helper/cache/pagination-count';
import { toQueryText } from '../helper/parse-query';

/**
 * Provides API endpoints for the Storm Islands live map: storm forts and resource isles
 */
export abstract class ApiStorms implements ApiHelper {
  private static readonly LIVE_CACHE_TTL_SECONDS = 20;
  private static readonly SCAN_CACHE_TTL_SECONDS = 900;
  private static readonly META_CACHE_TTL_SECONDS = 30;

  private static readonly STORM_KID = 4;
  private static readonly MAX_VICTORIES = 10;
  private static readonly DEFAULT_PAGE_SIZE = 15;
  private static readonly MAX_PAGE_SIZE = 4000;
  /** Isle states, mirrors storm_isles.state */
  private static readonly ISLE_STATE_FREE = 0;
  private static readonly ISLE_STATE_OCCUPIED = 1;
  private static readonly ISLE_STATE_RESPAWNING = 2;

  private static readonly ORDER_TIEBREAK = 'S.position_x ASC, S.position_y ASC';
  private static readonly ALLOWED_ORDER_BY_FORTS = new Set(['distance', 'availability', 'attacksLeft', 'position']);
  private static readonly ALLOWED_ORDER_BY_ISLES = new Set(['distance', 'availability', 'position']);

  /**
   * Handles the retrieval of storm forts with filtering, distance sorting and pagination
   *
   * @param request Express request object, expected to contain query parameters:
   *   `page`: (string) The page number for pagination (required, must be a positive integer)
   *   `filterByAvailability`: (string) "1" attackable now, "2" within 5 minutes, "3" within 1 hour
   *   `minAttacksLeft`: (string) Only forts with at least this many attacks remaining (0-10)
   *   `positionX`, `positionY`: (string) Coordinates to sort forts by proximity
   *   `nearPlayerName`: (string) Player whose Storm Islands castle is used as the sort origin
   *   `maxDistance`: (string) Only forts within this many tiles of the sort origin
   *   `size`: (string) Number of results per page (default: 15, max: 4000)
   * @param response Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getStormForts(request: express.Request, response: express.Response): Promise<void> {
    try {
      const page = ApiHelper.validatePageNumber(request.query.page);
      if (!this.validateRequest(request, response)) return;

      const parameters_ = this.constructStormInitialParameters(request);
      const { filterByAvailability, nearPlayerName, size, maxDistance } = parameters_;
      let { sortByPositionX, sortByPositionY } = parameters_;
      const minAttacksLeft = ApiHelper.getParsedString(request.query.minAttacksLeft, null);
      const { orderBy, orderDescending } = this.parseOrdering(request, this.ALLOWED_ORDER_BY_FORTS);
      const isleIds = this.parseIsleIds(request.query.filterByIsleIds);

      if (!this.validateStormQueryParams(response, size, maxDistance, nearPlayerName)) return;
      if (minAttacksLeft !== null && !this.isValidAttacksLeft(minAttacksLeft)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      }
      if (isleIds === false) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cacheKey = this.buildCacheKey(request, 'forts', await this.scanVersion(request));
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      /* ---------------------------------
       * Resolve nearPlayerName to the
       * player's Storm Islands castle
       * --------------------------------- */
      if (nearPlayerName) {
        const sortResult = await this.resolveNearPlayerSortPosition(request, response, nearPlayerName);
        if (sortResult === null) return;
        ({ sortByPositionX, sortByPositionY } = sortResult);
      }

      const isSorted = this.resolveSortState(response, sortByPositionX, sortByPositionY);
      if (isSorted === null) return;

      const viewPerPage = this.resolvePageSize(size);

      const { query, parameters } = this.buildStormFortsMainQuery({
        filterByAvailability,
        minAttacksLeft,
        isleIds,
        orderBy,
        orderDescending,
        isSorted,
        sortByPositionX,
        sortByPositionY,
        maxDistance,
        viewPerPage,
        page,
      });

      const fortsTtl = this.isClockDependentFortView(filterByAvailability, orderBy, isSorted)
        ? this.LIVE_CACHE_TTL_SECONDS
        : this.SCAN_CACHE_TTL_SECONDS;
      const countTtl = filterByAvailability === null ? this.SCAN_CACHE_TTL_SECONDS : this.LIVE_CACHE_TTL_SECONDS;
      const countCacheKey = this.buildCountCacheKey(request, 'forts', await this.scanVersion(request), {
        filterByAvailability,
        minAttacksLeft,
        isleIds: isleIds === null ? null : isleIds.join(','),
        maxDistance,
        sortByPositionX,
        sortByPositionY,
      });
      const [fortsCount, rows] = await Promise.all([
        PaginationCount.resolve(
          countCacheKey,
          () =>
            this.countStormObjects(request['pg_pool'] as pg.Pool, {
              table: 'storm_forts',
              conditions: this.buildFortConditions(filterByAvailability, minAttacksLeft, isleIds),
              isSorted,
              sortByPositionX,
              sortByPositionY,
              maxDistance,
              context: 'getStormForts_countQuery',
              request,
            }),
          countTtl,
        ),
        this.executePgQuery(request['pg_pool'] as pg.Pool, query, parameters, 'getStormForts_mainQuery', request),
      ]);
      const totalPages = Math.ceil(fortsCount / viewPerPage);

      const forts = this.mapFortRows(rows);
      const responseContent = this.defaultResponseContent('forts', forts, page, totalPages, fortsCount, forts.length);
      await CachedResponse.serve(response, cacheKey, responseContent, fortsTtl);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStormForts', request);
    }
  }

  /**
   * Handles the retrieval of storm resource isles with filtering, distance sorting and pagination
   *
   * @param request Express request object, expected to contain query parameters:
   *   `page`: (string) The page number for pagination (required, must be a positive integer)
   *   `filterByState`: (string) "1" free, "2" occupied, "3" respawning
   *   `filterByOccupierName`: (string) Only isles currently held by this player (max 60 chars)
   *   `positionX`, `positionY`: (string) Coordinates to sort isles by proximity
   *   `nearPlayerName`: (string) Player whose Storm Islands castle is used as the sort origin
   *   `maxDistance`: (string) Only isles within this many tiles of the sort origin
   *   `size`: (string) Number of results per page (default: 15, max: 4000)
   * @param response Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getStormIsles(request: express.Request, response: express.Response): Promise<void> {
    try {
      const page = ApiHelper.validatePageNumber(request.query.page);
      if (!this.validateRequest(request, response)) return;

      const parameters_ = this.constructStormInitialParameters(request);
      const { nearPlayerName, size, maxDistance } = parameters_;
      let { sortByPositionX, sortByPositionY } = parameters_;
      const filterByState = ApiHelper.getParsedString(request.query.filterByState, null);
      const filterByOccupierName = ApiHelper.getParsedString(request.query.filterByOccupierName, null);
      const { orderBy, orderDescending } = this.parseOrdering(request, this.ALLOWED_ORDER_BY_ISLES);
      const isleIds = this.parseIsleIds(request.query.filterByIsleIds);

      if (!this.validateStormQueryParams(response, size, maxDistance, nearPlayerName)) return;
      if (isleIds === false) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      }
      if (filterByOccupierName && ApiHelper.isInvalidInput(ApiHelper.validateSearchAndSanitize(filterByOccupierName))) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
        return;
      }

      const cacheKey = this.buildCacheKey(request, 'isles', await this.scanVersion(request));
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      if (nearPlayerName) {
        const sortResult = await this.resolveNearPlayerSortPosition(request, response, nearPlayerName);
        if (sortResult === null) return;
        ({ sortByPositionX, sortByPositionY } = sortResult);
      }

      const isSorted = this.resolveSortState(response, sortByPositionX, sortByPositionY);
      if (isSorted === null) return;

      const viewPerPage = this.resolvePageSize(size);

      /* ---------------------------------
       * Resolve the occupier filter to an id
       * --------------------------------- */
      const { playerId: occupierId, notFound: occupierNotFound } = filterByOccupierName
        ? await this.resolvePlayerIdByName(request['pg_pool'] as pg.Pool, filterByOccupierName, request)
        : { playerId: null, notFound: false };

      const { query, parameters } = this.buildStormIslesMainQuery({
        filterByState,
        occupierId,
        occupierNotFound,
        isleIds,
        orderBy,
        orderDescending,
        isSorted,
        sortByPositionX,
        sortByPositionY,
        maxDistance,
        viewPerPage,
        page,
      });

      const countCacheKey = this.buildCountCacheKey(request, 'isles', await this.scanVersion(request), {
        filterByState,
        occupier: occupierNotFound ? 'none' : occupierId,
        isleIds: isleIds === null ? null : isleIds.join(','),
        maxDistance,
        sortByPositionX,
        sortByPositionY,
      });
      const [islesCount, rows] = await Promise.all([
        PaginationCount.resolve(
          countCacheKey,
          () =>
            this.countStormObjects(request['pg_pool'] as pg.Pool, {
              table: 'storm_isles',
              conditions: this.buildIsleConditions(filterByState, occupierId, occupierNotFound, isleIds),
              isSorted,
              sortByPositionX,
              sortByPositionY,
              maxDistance,
              context: 'getStormIsles_countQuery',
              request,
            }),
          this.SCAN_CACHE_TTL_SECONDS,
        ),
        this.executePgQuery(request['pg_pool'] as pg.Pool, query, parameters, 'getStormIsles_mainQuery', request),
      ]);
      const totalPages = Math.ceil(islesCount / viewPerPage);

      const isles = this.mapIsleRows(rows, request['code']);
      const responseContent = this.defaultResponseContent('isles', isles, page, totalPages, islesCount, isles.length);
      await CachedResponse.serve(response, cacheKey, responseContent, this.SCAN_CACHE_TTL_SECONDS);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStormIsles', request);
    }
  }

  public static async getStormMeta(request: express.Request, response: express.Response): Promise<void> {
    try {
      if (!this.validateRequest(request, response)) return;

      const cacheKey = this.buildCacheKey(request, 'meta', await this.scanVersion(request));
      if (await CachedResponse.serveCached(response, cacheKey)) return;

      const rows = await this.executePgQuery(
        request['pg_pool'] as pg.Pool,
        `SELECT
            season_started_at,
            scan_radius,
            last_scan_at,
            (SELECT COUNT(*) FROM storm_forts) AS forts_count,
            (SELECT COUNT(*) FROM storm_isles) AS isles_count
          FROM storm_meta
          WHERE id = TRUE
          LIMIT 1`,
        [],
        'getStormMeta',
        request,
      );
      if (rows.length === 0) {
        response
          .status(ApiHelper.HTTP_OK)
          .send({ season_started_at: null, scan_radius: 0, last_scan_at: null, forts_count: 0, isles_count: 0 });
        return;
      }
      const responseContent = {
        season_started_at: rows[0].season_started_at,
        scan_radius: rows[0].scan_radius,
        last_scan_at: rows[0].last_scan_at,
        forts_count: Number.parseInt(rows[0].forts_count, 10),
        isles_count: Number.parseInt(rows[0].isles_count, 10),
      };
      await CachedResponse.serve(response, cacheKey, responseContent, this.META_CACHE_TTL_SECONDS);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStormMeta', request);
    }
  }

  /**
   * Builds the WHERE conditions for storm forts
   *
   * filterByAvailability values:
   *   1 = visible and attackable now
   *   2 = back on the map within the next 5 minutes
   *   3 = back on the map within the next 60 minutes
   */
  private static buildFortConditions(
    filterByAvailability: string | null,
    minAttacksLeft: string | null,
    isleIds: number[] | null,
  ): (parameter: (v: any) => string) => string[] {
    return (parameter) => {
      const conditions: string[] = [];
      const isleCondition = this.buildIsleIdsCondition(isleIds, parameter);
      if (isleCondition) conditions.push(isleCondition);
      switch (filterByAvailability) {
        case '1': {
          conditions.push('S.is_visible', '(S.available_at <= NOW())', `S.victory_count < ${this.MAX_VICTORIES}`);
          break;
        }
        case '2': {
          conditions.push('(S.available_at > NOW())', 'EXTRACT(EPOCH FROM (S.available_at - NOW())) <= 300');
          break;
        }
        case '3': {
          conditions.push('(S.available_at > NOW())', 'EXTRACT(EPOCH FROM (S.available_at - NOW())) <= 3600');
          break;
        }
      }
      if (minAttacksLeft !== null) {
        // attacks left = MAX_VICTORIES - victory_count
        conditions.push(`(${this.MAX_VICTORIES} - S.victory_count) >= ${parameter(Number(minAttacksLeft))}`);
      }
      return conditions;
    };
  }

  /**
   * Builds the WHERE conditions for resource isles
   *
   * filterByState values map to storm_isles.state: 1 = free (capturable now), 2 = occupied, 3 = harvested and waiting to respawn
   */
  private static buildIsleConditions(
    filterByState: string | null,
    occupierId: number | null,
    occupierNotFound: boolean,
    isleIds: number[] | null,
  ): (parameter: (v: any) => string) => string[] {
    return (parameter) => {
      const conditions: string[] = [];
      const isleCondition = this.buildIsleIdsCondition(isleIds, parameter);
      if (isleCondition) conditions.push(isleCondition);
      switch (filterByState) {
        case '1': {
          conditions.push(`S.state = ${this.ISLE_STATE_FREE}`);
          break;
        }
        case '2': {
          conditions.push(`S.state = ${this.ISLE_STATE_OCCUPIED}`);
          break;
        }
        case '3': {
          conditions.push(`S.state = ${this.ISLE_STATE_RESPAWNING}`);
          break;
        }
      }
      if (occupierNotFound) {
        conditions.push('1 = 0');
      } else if (occupierId !== null) {
        conditions.push(`S.occupier_id = ${parameter(occupierId)}`);
      }
      return conditions;
    };
  }

  /**
   * Restricts the result to a set of isle ids
   */
  private static buildIsleIdsCondition(isleIds: number[] | null, parameter: (v: any) => string): string | null {
    if (isleIds === null) return null;
    // An explicit but empty selection means nothing can match, unlike no filter at all
    if (isleIds.length === 0) return '1 = 0';
    return `S.isle_id IN (${isleIds.map((id) => parameter(id)).join(', ')})`;
  }

  /**
   * Parses and validates the `filterByIsleIds` query parameter
   *
   * @returns The requested ids, `null` when absent, or `false` when malformed
   */
  private static parseIsleIds(rawValue: unknown): number[] | null | false {
    if (rawValue === undefined || rawValue === null || rawValue === '') return null;
    const text = toQueryText(rawValue);
    if (text === undefined) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (!Array.isArray(parsed) || parsed.length > 50) return false;
    const ids: number[] = [];
    for (const entry of parsed) {
      const id = Number(entry);
      if (!Number.isInteger(id) || id < 0 || id > 9999) return false;
      ids.push(id);
    }
    return ids;
  }

  private static orderedBy(clause: string): string {
    return ` ORDER BY ${clause}, ${this.ORDER_TIEBREAK}`;
  }

  /**
   * Maps the requested sort to a SQL ORDER BY clause
   *
   * @param orderBy Requested sort key, `null` falls back to the most actionable first
   * @param descending Whether to reverse the natural direction of the sort
   * @param isSorted Whether a distance origin is available
   * @param defaultClause The "most actionable first" ordering of the table being queried
   */
  private static buildOrderByClause(
    orderBy: string | null,
    descending: boolean,
    isSorted: boolean,
    defaultClause: string,
  ): string {
    const direction = descending ? 'DESC' : 'ASC';
    switch (orderBy) {
      case 'distance': {
        return this.orderedBy(isSorted ? `calculated_distance ${direction}` : defaultClause);
      }
      case 'availability': {
        return this.orderedBy(`S.available_at ${direction}`);
      }
      case 'attacksLeft': {
        // attacks left is the inverse of victory_count, so the direction flips
        return this.orderedBy(`S.victory_count ${descending ? 'ASC' : 'DESC'}`);
      }
      case 'position': {
        return this.orderedBy(`S.position_x ${direction}, S.position_y ${direction}`);
      }
      default: {
        return this.orderedBy(isSorted ? 'calculated_distance ASC' : defaultClause);
      }
    }
  }

  private static getDistanceSql(px: string, py: string): string {
    return `(POWER(S.position_x::int - ${px}, 2) + POWER(S.position_y::int - ${py}, 2))`;
  }

  private static async countStormObjects(
    pool: pg.Pool,
    options: {
      table: string;
      conditions: (parameter: (v: any) => string) => string[];
      isSorted: boolean;
      sortByPositionX: string | null;
      sortByPositionY: string | null;
      maxDistance: string | null;
      context: string;
      request: express.Request;
    },
  ): Promise<number> {
    const { table, conditions, isSorted, sortByPositionX, sortByPositionY, maxDistance, context, request } = options;
    const parameters: any[] = [];
    const parameter = (v: any): string => {
      parameters.push(v);
      return `$${parameters.length}`;
    };

    const whereConditions = conditions(parameter);
    if (isSorted && maxDistance !== null) {
      const px = parameter(Number.parseInt(sortByPositionX));
      const py = parameter(Number.parseInt(sortByPositionY));
      whereConditions.push(`${this.getDistanceSql(px, py)} <= ${parameter(Number(maxDistance) ** 2)}`);
    }

    let query = `SELECT COUNT(*) AS objects_count FROM ${table} S`;
    if (whereConditions.length > 0) {
      query += ` WHERE ` + whereConditions.join(' AND ');
    }
    const rows = await this.executePgQuery(pool, query, parameters, context, request);
    return Number.parseInt(rows[0]['objects_count'], 10);
  }

  /**
   * Builds the main SELECT query for a page of storm forts
   */
  private static buildStormFortsMainQuery(options: {
    filterByAvailability: string | null;
    minAttacksLeft: string | null;
    isleIds: number[] | null;
    orderBy: string | null;
    orderDescending: boolean;
    isSorted: boolean;
    sortByPositionX: string | null;
    sortByPositionY: string | null;
    maxDistance: string | null;
    viewPerPage: number;
    page: number;
  }): { query: string; parameters: any[] } {
    const {
      filterByAvailability,
      minAttacksLeft,
      isleIds,
      orderBy,
      orderDescending,
      isSorted,
      sortByPositionX,
      sortByPositionY,
      maxDistance,
      viewPerPage,
      page,
    } = options;

    const parameters: any[] = [];
    const parameter = (v: any): string => {
      parameters.push(v);
      return `$${parameters.length}`;
    };

    /* ---------------------------------
     * Distance SELECT expression
     * Declared first because it appears in SELECT, which fixes the $N offsets
     * --------------------------------- */
    let distanceSelectSql = '';
    let distanceExpr: string | null = null;
    if (isSorted) {
      const px = parameter(Number.parseInt(sortByPositionX));
      const py = parameter(Number.parseInt(sortByPositionY));
      distanceExpr = this.getDistanceSql(px, py);
      distanceSelectSql = `, ${distanceExpr} AS calculated_distance`;
    }

    const conditions = this.buildFortConditions(filterByAvailability, minAttacksLeft, isleIds)(parameter);
    if (isSorted && maxDistance !== null && distanceExpr) {
      conditions.push(`${distanceExpr} <= ${parameter(Number(maxDistance) ** 2)}`);
    }

    let query = `
      SELECT
        S.position_x,
        S.position_y,
        S.isle_id,
        S.victory_count,
        S.is_visible,
        S.available_at,
        S.updated_at
        ${distanceSelectSql}
      FROM storm_forts S
    `;
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += this.buildOrderByClause(
      orderBy,
      orderDescending,
      isSorted,
      // Most actionable first: on the map and attackable, then by shortest wait
      '(S.is_visible AND S.available_at <= NOW()) DESC, S.available_at ASC',
    );
    query += ` LIMIT ${parameter(viewPerPage)} OFFSET ${parameter((page - 1) * viewPerPage)}`;
    return { query, parameters };
  }

  private static buildStormIslesMainQuery(options: {
    filterByState: string | null;
    occupierId: number | null;
    occupierNotFound: boolean;
    isleIds: number[] | null;
    orderBy: string | null;
    orderDescending: boolean;
    isSorted: boolean;
    sortByPositionX: string | null;
    sortByPositionY: string | null;
    maxDistance: string | null;
    viewPerPage: number;
    page: number;
  }): { query: string; parameters: any[] } {
    const {
      filterByState,
      occupierId,
      occupierNotFound,
      isleIds,
      orderBy,
      orderDescending,
      isSorted,
      sortByPositionX,
      sortByPositionY,
      maxDistance,
      viewPerPage,
      page,
    } = options;

    const parameters: any[] = [];
    const parameter = (v: any): string => {
      parameters.push(v);
      return `$${parameters.length}`;
    };

    let distanceSelectSql = '';
    let distanceExpr: string | null = null;
    if (isSorted) {
      const px = parameter(Number.parseInt(sortByPositionX));
      const py = parameter(Number.parseInt(sortByPositionY));
      distanceExpr = this.getDistanceSql(px, py);
      distanceSelectSql = `, ${distanceExpr} AS calculated_distance`;
    }

    const conditions = this.buildIsleConditions(filterByState, occupierId, occupierNotFound, isleIds)(parameter);
    if (isSorted && maxDistance !== null && distanceExpr) {
      conditions.push(`${distanceExpr} <= ${parameter(Number(maxDistance) ** 2)}`);
    }

    let page_ = `
      SELECT
        S.position_x,
        S.position_y,
        S.object_id,
        S.isle_id,
        S.occupier_id,
        S.state,
        S.available_at,
        S.updated_at
        ${distanceSelectSql}
      FROM storm_isles S
    `;
    if (conditions.length > 0) {
      page_ += ` WHERE ` + conditions.join(' AND ');
    }
    const orderByClause = this.buildOrderByClause(
      orderBy,
      orderDescending,
      isSorted,
      `(S.state = ${this.ISLE_STATE_FREE}) DESC, S.available_at ASC`,
    );
    page_ += orderByClause;
    page_ += ` LIMIT ${parameter(viewPerPage)} OFFSET ${parameter((page - 1) * viewPerPage)}`;

    const query = `
      SELECT
        S.*,
        P.name AS occupier_name,
        P.might_current AS occupier_might,
        P.level AS occupier_level,
        P.legendary_level AS occupier_legendary_level,
        A.name AS occupier_alliance_name
      FROM (${page_}) S
      LEFT JOIN players P ON P.id = S.occupier_id
      LEFT JOIN alliances A ON A.id = P.alliance_id
      ${orderByClause}
    `;
    return { query, parameters };
  }

  private static executePgQuery(
    pool: pg.Pool,
    query: string,
    parameters: any[],
    context: string,
    request: express.Request,
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      pool.query(query, parameters, (error, results) => {
        if (error) {
          ApiHelper.logError(error, context, request);
          reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
        } else {
          resolve(results.rows);
        }
      });
    });
  }

  private static mapFortRows(rows: any[]): any[] {
    return rows.map((result) => ({
      kid: this.STORM_KID,
      position_x: result.position_x,
      position_y: result.position_y,
      isle_id: result.isle_id,
      victory_count: result.victory_count,
      attacks_left: Math.max(this.MAX_VICTORIES - result.victory_count, 0),
      is_visible: result.is_visible,
      available_at: result.available_at,
      updated_at: result.updated_at,
      distance: this.toDistance(result.calculated_distance),
    }));
  }

  private static mapIsleRows(rows: any[], code: string): any[] {
    return rows.map((result) => ({
      kid: this.STORM_KID,
      position_x: result.position_x,
      position_y: result.position_y,
      object_id: result.object_id,
      isle_id: result.isle_id,
      state: result.state,
      occupier_id: result.occupier_id ? ApiHelper.addCountryCode(result.occupier_id, code) : null,
      occupier_name: result.occupier_name,
      occupier_might: result.occupier_might,
      occupier_level: result.occupier_level,
      occupier_legendary_level: result.occupier_legendary_level,
      occupier_alliance_name: result.occupier_alliance_name,
      available_at: result.available_at,
      updated_at: result.updated_at,
      distance: this.toDistance(result.calculated_distance),
    }));
  }

  private static toDistance(squaredDistance: number | undefined): number | null {
    if (squaredDistance === undefined || squaredDistance === null) return null;
    return Number.parseFloat(Math.sqrt(squaredDistance).toFixed(1));
  }

  private static async resolveNearPlayerSortPosition(
    request: express.Request,
    response: express.Response,
    nearPlayerName: string,
  ): Promise<{ sortByPositionX: string | null; sortByPositionY: string | null } | null> {
    const playerRows = await this.executePgQuery(
      request['pg_pool'] as pg.Pool,
      `SELECT castles_realm FROM players WHERE LOWER(name) = $1 LIMIT 1`,
      [nearPlayerName.trim().toLowerCase()],
      'getStorms_nearPlayerName',
      request,
    );
    if (playerRows.length === 0) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
      return null;
    }
    const target: { castles_realm: number[][] } = playerRows[0];
    if (!target.castles_realm || target.castles_realm.length === 0) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
      return null;
    }
    const stormCastle = target.castles_realm.find((c) => c.length === 4 && c[0] === this.STORM_KID && c[3] === 12);
    if (!stormCastle) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
      return null;
    }

    return { sortByPositionX: String(stormCastle[1]), sortByPositionY: String(stormCastle[2]) };
  }

  private static async resolvePlayerIdByName(
    pool: pg.Pool,
    playerName: string,
    request: express.Request,
  ): Promise<{ playerId: number | null; notFound: boolean }> {
    const rows = await this.executePgQuery(
      pool,
      `SELECT id FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [playerName.trim()],
      'getStorms_resolvePlayerByName',
      request,
    );
    if (rows.length === 0) return { playerId: null, notFound: true };
    return { playerId: rows[0].id, notFound: false };
  }

  private static resolveSortState(
    response: express.Response,
    sortByPositionX: string | null,
    sortByPositionY: string | null,
  ): boolean | null {
    if (sortByPositionX === null && sortByPositionY === null) return false;
    if (
      Number.isNaN(Number.parseInt(sortByPositionX)) ||
      Number.isNaN(Number.parseInt(sortByPositionY)) ||
      Number.parseInt(sortByPositionX) < 0 ||
      Number.parseInt(sortByPositionY) < 0 ||
      Number.parseInt(sortByPositionX) > 1286 ||
      Number.parseInt(sortByPositionY) > 1286
    ) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPosition });
      return null;
    }
    return true;
  }

  private static parseOrdering(
    request: express.Request,
    allowed: ReadonlySet<string>,
  ): { orderBy: string | null; orderDescending: boolean } {
    const rawOrderBy = ApiHelper.getParsedString(request.query.orderBy, null);
    const rawDirection = ApiHelper.getParsedString(request.query.orderDirection, null);
    return {
      orderBy: rawOrderBy && allowed.has(rawOrderBy) ? rawOrderBy : null,
      orderDescending: rawDirection?.toLowerCase() === 'desc',
    };
  }

  private static resolvePageSize(size: string | null): number {
    if (size === '0') return this.MAX_PAGE_SIZE;
    if (size === null) return this.DEFAULT_PAGE_SIZE;
    return Math.min(Number.parseInt(size), this.MAX_PAGE_SIZE);
  }

  private static isValidAttacksLeft(value: string): boolean {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= this.MAX_VICTORIES;
  }

  private static validateStormQueryParams(
    response: express.Response,
    size: string | null,
    maxDistance: string | null,
    nearPlayerName: string | null,
  ): boolean {
    if (size !== null && size.length > 30) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
      return false;
    }
    if (maxDistance !== null && (Number.isNaN(Number(maxDistance)) || Number(maxDistance) <= 0)) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
      return false;
    }
    if (nearPlayerName && nearPlayerName.length > 60) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
      return false;
    }
    return true;
  }

  /**
   * The scan round this server is currently answering from
   */
  private static async scanVersion(request: express.Request): Promise<string> {
    return (await ApiHelper.redisClient.get(`storm-version:${request['language']}`).catch(() => null)) ?? '0';
  }

  private static buildCountCacheKey(
    request: express.Request,
    route: string,
    version: string,
    filters: Record<string, string | number | null>,
  ): string {
    return new CacheKeyBuilder(request['language'])
      .with(version)
      .with('storms')
      .with(route)
      .with('count')
      .withParams(filters)
      .build();
  }

  private static buildCacheKey(request: express.Request, route: string, version: string): string {
    return new CacheKeyBuilder(request['language'])
      .with(version)
      .with('storms')
      .with(route)
      .withQuery(request.query)
      .build();
  }

  private static isClockDependentFortView(
    filterByAvailability: string | null,
    orderBy: string | null,
    isSorted: boolean,
  ): boolean {
    if (filterByAvailability !== null) return true;
    return !isSorted && (orderBy === null || orderBy === 'distance');
  }

  private static validateRequest(request: express.Request, response: express.Response): boolean {
    const authorizedServers = Object.values(AuthorizedSpecialServersEnum);
    if (!authorizedServers.includes(request['language'])) {
      response
        .status(ApiHelper.HTTP_BAD_REQUEST)
        .send({ error: 'Invalid server. Currently, only ' + authorizedServers.join(', ') + ' are supported.' });
      return false;
    }
    return true;
  }

  private static constructStormInitialParameters(request: express.Request): {
    filterByAvailability: string | null;
    sortByPositionX: string | null;
    sortByPositionY: string | null;
    nearPlayerName: string | null;
    maxDistance: string | null;
    size: string | null;
  } {
    const sizeValue = Number(request.query.size);
    return {
      filterByAvailability: request.query.filterByAvailability ? String(request.query.filterByAvailability) : null,
      sortByPositionX: ApiHelper.getParsedString(request.query.positionX, null),
      sortByPositionY: ApiHelper.getParsedString(request.query.positionY, null),
      nearPlayerName: ApiHelper.getParsedString(request.query.nearPlayerName, null),
      maxDistance: ApiHelper.getParsedString(request.query.maxDistance, null),
      size: !Number.isNaN(sizeValue) && sizeValue > 0 ? String(sizeValue) : null,
    };
  }

  private static defaultResponseContent(
    key: 'forts' | 'isles',
    items: any[],
    currentPage: number,
    totalPages: number,
    totalItemsCount: number,
    currentItemsCount: number,
  ): Record<string, any> {
    return {
      [key]: items || [],
      pagination: {
        current_page: currentPage || 1,
        total_pages: totalPages || 1,
        current_items_count: currentItemsCount || 0,
        total_items_count: totalItemsCount || 0,
      },
    };
  }
}
