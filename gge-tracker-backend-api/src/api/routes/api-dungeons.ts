import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { AuthorizedSpecialServersEnum } from '../enums/gge-tracker-special-servers.enums';
import { ApiHelper } from '../helper/api-helper';

/**
 * Provides API endpoints for retrieving dungeon data with various filters and sorting options
 */
export abstract class ApiDungeons implements ApiHelper {
  /**
   * Handles the retrieval of dungeon data with various filters, sorting, and pagination options
   *
   * This endpoint supports filtering dungeons by server, player, cooldown status, position, and other criteria
   * It also supports sorting by distance to a given player's castle and paginating the results
   *
   * @param request - Express request object, expected to contain query parameters for filtering and sorting:
   *   - `page`: (string) The page number for pagination (required, must be a positive integer)
   *   - `filterByKid`: (string) JSON array of filters types by kingdom ID to filter by (default: "[2]")
   *   - `filterByAttackCooldown`: (string) Filter by attack cooldown status ("1", "2", or "3")
   *   - `filterByPlayerName`: (string) Filter dungeons by player name (max 60 chars)
   *   - `positionX`, `positionY`: (string) Coordinates to sort dungeons by proximity
   *   - `nearPlayerName`: (string) Player name to sort dungeons by proximity to their castle
   *   - `size`: (string) Number of results per page (default: 15, max: 4000)
   * @param response - Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getDungeons(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Parse and validate input parameters
       * --------------------------------- */
      const page = ApiHelper.validatePageNumber(request.query.page);
      const filterByKid = ApiHelper.getParsedString(request.query.filterByKid, '[2]');
      if (!this.validateRequest(request, response, filterByKid)) return;

      const parameters_ = this.constructDungeonsInitialParameters(filterByKid, request);
      let { filtersKids, sortByPositionX, sortByPositionY } = parameters_;
      const { filterByAttackCooldown, filterByPlayerName, nearPlayerName, size } = parameters_;

      if (!this.validateDungeonQueryParams(response, filtersKids, filterByAttackCooldown, filterByPlayerName, size))
        return;

      /* ---------------------------------
       * Resolve nearPlayerName to castle
       * sort coordinates and filter kids
       * --------------------------------- */
      let customParameterValues: number[] = [];
      if (nearPlayerName) {
        const sortResult = await this.resolveNearPlayerSortPosition(request, response, nearPlayerName, filtersKids);
        if (sortResult === null) return;
        ({ sortByPositionX, sortByPositionY, filtersKids, customParameterValues } = sortResult);
      }
      if (filtersKids.length === 0) {
        response.status(ApiHelper.HTTP_OK).send(this.defaultResponseContent([], 1, 1, 0, 0));
        return;
      }

      /* ---------------------------------
       * Validate sort coordinates
       * --------------------------------- */
      const isSorted = this.resolveSortState(response, sortByPositionX, sortByPositionY);
      if (isSorted === null) return;

      const MAX_NUMBER = 4000;
      const viewPerPage = size === '0' ? MAX_NUMBER : size === null ? 15 : Number.parseInt(size);

      /* ---------------------------------
       * Resolve filterByPlayerName to a
       * player ID for personalised cooldown
       * --------------------------------- */
      const { playerId, notFound: playerNotFound } = filterByPlayerName
        ? await this.resolvePlayerIdByName(request['pg_pool'] as pg.Pool, filterByPlayerName, request)
        : { playerId: null, notFound: false };

      /* ---------------------------------
       * Count matching dungeons for pagination
       * --------------------------------- */
      const dungeonsCount = await this.countDungeons(
        request['pg_pool'] as pg.Pool,
        filtersKids,
        playerId,
        playerNotFound,
        filterByAttackCooldown,
        request,
      );
      const totalPages = Math.ceil(dungeonsCount / viewPerPage);
      if (page > totalPages) {
        response.status(ApiHelper.HTTP_OK).send(this.defaultResponseContent([], page, totalPages, dungeonsCount, 0));
        return;
      }

      /* ---------------------------------
       * Fetch the dungeons page
       * --------------------------------- */
      const { query, parameters } = this.buildDungeonsMainQuery({
        filtersKids,
        playerId,
        isSorted,
        nearPlayerName,
        sortByPositionX,
        sortByPositionY,
        customParameterValues,
        filterByAttackCooldown,
        viewPerPage,
        page,
      });
      const dungeonRows = await this.executePgQuery(
        request['pg_pool'] as pg.Pool,
        query,
        parameters,
        'getDungeons_mainQuery',
        request,
      );

      /* ---------------------------------
       * Map rows to response shape
       * --------------------------------- */
      const dungeons = this.mapDungeonRows(dungeonRows, request['code']);
      response
        .status(ApiHelper.HTTP_OK)
        .send(this.defaultResponseContent(dungeons, page, totalPages, dungeonsCount, dungeons.length));
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getDungeons', request);
    }
  }

  public static async getDungeonsByPlayer(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(String(request.params.playerId));
      const lastDays = ApiHelper.validatePageNumber(request.query.lastDays, 30);
      if (!playerId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      } else if (lastDays < 1 || lastDays > 365) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidLastDaysParameter });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cacheKey = `dungeons:player:${playerId}:lastDays:${lastDays}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build and execute query
       * --------------------------------- */
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      const code = ApiHelper.getCountryCode(String(playerId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const query = `
        SELECT
          D.kid,
          D.position_x,
          D.position_y,
          DH.attacked_at
        FROM dungeons_history DH
        JOIN dungeons D
          ON D.kid = DH.kid
          AND D.position_x = DH.position_x
          AND D.position_y = DH.position_y
        WHERE DH.player_id = $1
          AND DH.attacked_at >= NOW() - INTERVAL '${lastDays} days'
        ORDER BY DH.attacked_at DESC
      `;

      const dungeonRows = await this.executePgQuery(
        pool,
        query,
        [ApiHelper.removeCountryCode(playerId)],
        'getDungeonsByPlayer',
        request,
      );

      const dungeons = dungeonRows.map((result: any) => ({
        kid: result.kid,
        position_x: result.position_x,
        position_y: result.position_y,
        attacked_at: result.attacked_at,
      }));
      await ApiHelper.updateCache(cacheKey, { dungeons }, 3600);
      response.status(ApiHelper.HTTP_OK).send({ dungeons });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getDungeonsByPlayer', request);
    }
  }

  /**
   * Validates inline constraints on dungeon query parameters after initial parsing
   * Sends the appropriate error response and returns false on the first failing check
   */
  private static validateDungeonQueryParams(
    response: express.Response,
    filtersKids: number[],
    filterByAttackCooldown: string | null,
    filterByPlayerName: string | null,
    size: string | null,
  ): boolean {
    for (const kid of filtersKids) {
      if (Number(kid) < 0 || Number(kid) > 9) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidKingdomId });
        return false;
      }
    }
    if (filtersKids.length === 0) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send(this.defaultResponseContent([], 1, 1, 0, 0));
      return false;
    }
    if ((filterByAttackCooldown && Number(filterByAttackCooldown) < 0) || Number(filterByAttackCooldown) > 99_999_999) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAttackCooldown });
      return false;
    }
    if (filterByPlayerName && ApiHelper.isInvalidInput(ApiHelper.validateSearchAndSanitize(filterByPlayerName))) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
      return false;
    }
    if (size !== null && size.length > 30) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
      return false;
    }
    return true;
  }

  /**
   * Looks up the castle sort position for a given player name
   * Sets `sortByPositionX/Y` to the kid-1 castle coords and narrows `filtersKids`
   * to only kingdoms where the player has a main castle
   *
   * Returns `null` and sends an error response if the player is not found or has no castles
   */
  private static async resolveNearPlayerSortPosition(
    request: express.Request,
    response: express.Response,
    nearPlayerName: string,
    filtersKids: number[],
  ): Promise<{
    sortByPositionX: string | null;
    sortByPositionY: string | null;
    filtersKids: number[];
    customParameterValues: number[];
  } | null> {
    if (nearPlayerName.length > 60) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
      return null;
    }

    const playerRows = await this.executePgQuery(
      request['pg_pool'] as pg.Pool,
      `SELECT castles_realm FROM players WHERE LOWER(name) = $1 LIMIT 1`,
      [nearPlayerName.trim().toLowerCase()],
      'getDungeons_nearPlayerName',
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

    const sortJsonPositionKid1 = target.castles_realm.find((c) => c[3] === 12 && c[0] === 1);
    const sortJsonPositionKid2 = target.castles_realm.find((c) => c[3] === 12 && c[0] === 2);
    const sortJsonPositionKid3 = target.castles_realm.find((c) => c[3] === 12 && c[0] === 3);

    const sortPositionKid1 =
      sortJsonPositionKid1?.length === 4 ? [sortJsonPositionKid1[1], sortJsonPositionKid1[2]] : null;
    const sortPositionKid2 =
      sortJsonPositionKid2?.length === 4 ? [sortJsonPositionKid2[1], sortJsonPositionKid2[2]] : null;
    const sortPositionKid3 =
      sortJsonPositionKid3?.length === 4 ? [sortJsonPositionKid3[1], sortJsonPositionKid3[2]] : null;

    const resolvedKids = filtersKids.filter((kid) =>
      target.castles_realm.some((castle) => castle[0] === kid && castle[3] === 12),
    );

    // Parameters for distance calculation across the three possible kingdoms (kid 1, 2, 3)
    const s1 = sortPositionKid1 ?? [0, 0];
    const s2 = sortPositionKid2 ?? [0, 0];
    const s3 = sortPositionKid3 ?? [0, 0];

    return {
      sortByPositionX: sortPositionKid1 ? String(sortPositionKid1[0]) : null,
      sortByPositionY: sortPositionKid1 ? String(sortPositionKid1[1]) : null,
      filtersKids: resolvedKids,
      customParameterValues: [s1[0], s1[0], s1[1], s2[0], s2[0], s2[1], s3[0], s3[0], s3[1]],
    };
  }

  /**
   * Validates sort coordinates and determines whether results should be distance-sorted
   *
   * @returns `true` if sorting is active, `false` if no sort coordinates were provided,
   *          or `null` if the coordinates are invalid (error response already sent)
   */
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

  /**
   * Looks up a player's numeric ID by name
   * The ID is used to personalise the effective cooldown expression via `dungeon_player_cooldowns`,
   * not to filter dungeons by owner
   */
  private static async resolvePlayerIdByName(
    pool: pg.Pool,
    playerName: string,
    request: express.Request,
  ): Promise<{ playerId: number | null; notFound: boolean }> {
    const rows = await this.executePgQuery(
      pool,
      `SELECT id FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1`,
      [playerName.trim()],
      'getDungeons_resolvePlayerByName',
      request,
    );
    if (rows.length === 0) return { playerId: null, notFound: true };
    return { playerId: rows[0].id, notFound: false };
  }

  /**
   * Builds the WHERE conditions for the attack cooldown filter
   *
   * filterByAttackCooldown values:
   *   1 = dungeons attackable now (cooldown expired)
   *   2 = attackable within the next 5 minutes
   *   3 = attackable within the next 60 minutes
   */
  private static buildCooldownConditions(cooldownExpr: string, filterByAttackCooldown: string | null): string[] {
    if (!filterByAttackCooldown) return [];
    switch (filterByAttackCooldown) {
      case '1': {
        return [`(${cooldownExpr} <= NOW())`];
      }
      case '2': {
        return [`(${cooldownExpr} > NOW())`, `EXTRACT(EPOCH FROM (${cooldownExpr} - NOW())) <= 300`];
      }
      case '3': {
        return [`(${cooldownExpr} > NOW())`, `EXTRACT(EPOCH FROM (${cooldownExpr} - NOW())) <= 3600`];
      }
      default: {
        return [];
      }
    }
  }

  /**
   * Builds and executes the COUNT query used for pagination
   * When `playerNotFound` is true, forces an empty result
   */
  private static async countDungeons(
    pool: pg.Pool,
    filtersKids: number[],
    playerId: number | null,
    playerNotFound: boolean,
    filterByAttackCooldown: string | null,
    request: express.Request,
  ): Promise<number> {
    const parameters: any[] = [];
    const parameter = (v: any): string => {
      parameters.push(v);
      return `$${parameters.length}`;
    };

    let cooldownExpr = `D.global_available_at`;
    let playerJoinSql = '';
    if (playerId !== null) {
      const playerIdPlaceholder = parameter(playerId);
      playerJoinSql = `
        LEFT JOIN dungeon_player_cooldowns DPC
          ON D.kid = DPC.kid
          AND D.position_x = DPC.position_x
          AND D.position_y = DPC.position_y
          AND DPC.player_id = ${playerIdPlaceholder}
      `;
      // When a player context is provided, the effective cooldown is the greater of
      // the global dungeon cooldown and the player-specific available_at
      cooldownExpr = `GREATEST(D.global_available_at, DPC.available_at)`;
    }

    const conditions: string[] = [`D.kid IN (${filtersKids.map((k) => parameter(k)).join(', ')})`];
    if (playerNotFound) {
      // Player name was provided but not found: force empty result
      conditions.push('1 = 0');
    }
    conditions.push(...this.buildCooldownConditions(cooldownExpr, filterByAttackCooldown));

    let query = `SELECT COUNT(*) AS dungeons_count FROM dungeons D${playerJoinSql}`;
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    const rows = await this.executePgQuery(pool, query, parameters, 'getDungeons_countQuery', request);
    return Number.parseInt(rows[0]['dungeons_count'], 10);
  }

  /**
   * Builds the main SELECT query for fetching a page of dungeons
   *
   * Distance params must be declared first in the parameter list because they appear
   * in SELECT, which determines the $N offset for all subsequent params
   */
  private static buildDungeonsMainQuery(options: {
    filtersKids: number[];
    playerId: number | null;
    isSorted: boolean;
    nearPlayerName: string | null;
    sortByPositionX: string | null;
    sortByPositionY: string | null;
    customParameterValues: number[];
    filterByAttackCooldown: string | null;
    viewPerPage: number;
    page: number;
  }): { query: string; parameters: any[] } {
    const {
      filtersKids,
      playerId,
      isSorted,
      nearPlayerName,
      sortByPositionX,
      sortByPositionY,
      customParameterValues,
      filterByAttackCooldown,
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
     * --------------------------------- */
    let distanceSelectSql = '';
    if (isSorted) {
      if (nearPlayerName) {
        const startIndex = parameters.length + 1;
        const { sql } = this.getCalculatedDistanceSql(startIndex);
        distanceSelectSql = `, ${sql}`;
        customParameterValues.forEach((v) => parameters.push(v));
      } else {
        const px = Number.parseInt(sortByPositionX);
        const py = Number.parseInt(sortByPositionY);
        const p1 = parameter(px);
        const p2 = parameter(px);
        const p3 = parameter(py);
        distanceSelectSql = `, (
          POWER(LEAST(ABS(D.position_x::int - ${p1}), 1287 - ABS(D.position_x::int - ${p2})), 2) +
          POWER(ABS(D.position_y::int - ${p3}), 2)
        ) AS calculated_distance`;
      }
    }

    /* ---------------------------------
     * Player-specific cooldown
     * --------------------------------- */
    let cooldownExpr = `D.global_available_at`;
    let playerJoinSql = '';
    if (playerId !== null) {
      const playerIdPlaceholder = parameter(playerId);
      playerJoinSql = `
        LEFT JOIN dungeon_player_cooldowns DPC
          ON D.kid = DPC.kid
          AND D.position_x = DPC.position_x
          AND D.position_y = DPC.position_y
          AND DPC.player_id = ${playerIdPlaceholder}
      `;
      cooldownExpr = `GREATEST(D.global_available_at, DPC.available_at)`;
    }

    const conditions: string[] = [
      `D.kid IN (${filtersKids.map((k) => parameter(k)).join(', ')})`,
      ...this.buildCooldownConditions(cooldownExpr, filterByAttackCooldown),
    ];

    let query = `
      SELECT
        D.kid,
        D.position_x,
        D.position_y,
        D.global_available_at,
        DH.last_attack,
        DH.total_attack_count,
        DH.player_id,
        DH.seconds_between_last_two_attacks,
        P.id,
        P.name,
        P.might_current AS player_might,
        P.level AS player_level,
        P.legendary_level AS player_legendary_level,
        ${cooldownExpr} AS effective_cooldown_until
        ${distanceSelectSql}
      FROM dungeons D
      LEFT JOIN (
        SELECT
          kid,
          position_x,
          position_y,
          MAX(attacked_at) AS last_attack,
          COUNT(*) AS total_attack_count,
          (ARRAY_AGG(player_id ORDER BY attacked_at DESC))[1] AS player_id,
          (
            ARRAY_AGG(attacked_at ORDER BY attacked_at DESC)
          )[2] AS previous_attack,
          EXTRACT(
            EPOCH FROM (
              MAX(attacked_at)
              -
              (
                ARRAY_AGG(attacked_at ORDER BY attacked_at DESC)
              )[2]
            )
          ) AS seconds_between_last_two_attacks
        FROM dungeons_history
        GROUP BY kid, position_x, position_y
      ) DH
      ON
        DH.kid = D.kid
        AND DH.position_x = D.position_x
        AND DH.position_y = D.position_y
      LEFT JOIN players P
      ON P.id = DH.player_id
      ${playerJoinSql}
    `;

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    if (isSorted) {
      query += ` ORDER BY calculated_distance ASC`;
    } else {
      // Default: attackable now first, then by shortest remaining cooldown
      query += `
        ORDER BY
          ${cooldownExpr} <= NOW() DESC,
          ${cooldownExpr} ASC
      `;
    }

    query += ` LIMIT ${parameter(viewPerPage)} OFFSET ${parameter((page - 1) * viewPerPage)}`;
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

  private static mapDungeonRows(rows: any[], code: string): any[] {
    return rows.map((result) => ({
      kid: result.kid,
      position_x: result.position_x,
      position_y: result.position_y,
      player_id: result.player_id ? ApiHelper.addCountryCode(result.player_id, code) : null,
      player_name: result.name,
      player_might: result.player_might,
      player_level: result.player_level,
      player_legendary_level: result.player_legendary_level,
      total_attack_count: result.total_attack_count,
      available_duration_seconds: this.calculateAvailableDuration(result.seconds_between_last_two_attacks),
      global_available_at: result.global_available_at,
      effective_cooldown_until: result.effective_cooldown_until,
      last_attack: result.last_attack,
      distance:
        result.calculated_distance === undefined
          ? null
          : Number.parseFloat(Math.sqrt(result.calculated_distance).toFixed(1)),
    }));
  }

  private static calculateAvailableDuration(secondsBetweenAttacks: number | null): number {
    if (secondsBetweenAttacks === null) return 0;
    const cooldown = 24 * 3600;
    const availableIn = secondsBetweenAttacks - cooldown;
    return Math.round(Math.max(availableIn, 0));
  }

  /**
   * Validates the incoming request for dungeon-related operations, ensuring that
   * the specified server is authorized and that any provided filters are correctly formatted
   *
   * @param request - The Express request object containing the language information
   * @param response - The Express response object used to send error responses
   * @param filterByKid - Optional string parameter that should contain a JSON array of kingdom IDs
   * @returns `true` if the request is valid, `false` otherwise. When `false`, an error response is sent automatically
   */
  private static validateRequest(request: express.Request, response: express.Response, filterByKid?: string): boolean {
    try {
      const authorizedServers = Object.values(AuthorizedSpecialServersEnum);
      if (!authorizedServers.includes(request['language'])) {
        response
          .status(ApiHelper.HTTP_BAD_REQUEST)
          .send({ error: 'Invalid server. Currently, only ' + authorizedServers.join(', ') + ' are supported.' });
        return false;
      }
      if (filterByKid && !Array.isArray(JSON.parse(filterByKid))) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid kid' });
        return false;
      }
      return true;
    } catch {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid parameters' });
      return false;
    }
  }

  /**
   * Creates a standardized response object containing dungeons data and pagination information
   *
   * @param dungeons - Array of dungeon objects to include in the response. Defaults to empty array if falsy
   * @param currentPage - The current page number in the pagination. Defaults to 1 if falsy
   * @param totalPages - The total number of pages available. Defaults to 1 if falsy
   * @param totalItemsCount - The total count of items across all pages. Defaults to 0 if falsy
   * @param currentItemsCount - The count of items in the current page. Defaults to 0 if falsy
   * @returns An object containing the dungeons array and pagination metadata with current page, total pages, and item counts
   */
  private static defaultResponseContent(
    dungeons: any[],
    currentPage: number,
    totalPages: number,
    totalItemsCount: number,
    currentItemsCount: number,
  ): {
    dungeons: any[];
    pagination: {
      current_page: number;
      total_pages: number;
      current_items_count: number;
      total_items_count: number;
    };
  } {
    return {
      dungeons: dungeons || [],
      pagination: {
        current_page: currentPage || 1,
        total_pages: totalPages || 1,
        current_items_count: currentItemsCount || 0,
        total_items_count: totalItemsCount || 0,
      },
    };
  }

  /**
   * Get the SQL query for calculating the distance between dungeons
   * This SQL snippet calculates the distance considering the kingdom (kid)
   * and wrapping around the map edges
   * The map width is considered to be 1287 units for wrapping calculations
   * If a kid does not have a castle, it assigns a large distance (999999)
   * to effectively exclude it
   *
   * @upgrade Improvement note: This calculation shall be improved in the future
   * @returns The SQL query string
   */
  private static getCalculatedDistanceSql(startIndex: number): { sql: string; paramCount: number } {
    const index = startIndex;
    const sql = `
      LEAST(
        CASE WHEN D.kid = 1 THEN
          POWER(LEAST(ABS(D.position_x::int - $${index}),     1287 - ABS(D.position_x::int - $${index + 1})), 2) +
          POWER(ABS(D.position_y::int - $${index + 2}), 2)
        ELSE 999999 END,
        CASE WHEN D.kid = 2 THEN
          POWER(LEAST(ABS(D.position_x::int - $${index + 3}), 1287 - ABS(D.position_x::int - $${index + 4})), 2) +
          POWER(ABS(D.position_y::int - $${index + 5}), 2)
        ELSE 999999 END,
        CASE WHEN D.kid = 3 THEN
          POWER(LEAST(ABS(D.position_x::int - $${index + 6}), 1287 - ABS(D.position_x::int - $${index + 7})), 2) +
          POWER(ABS(D.position_y::int - $${index + 8}), 2)
        ELSE 999999 END
      ) AS calculated_distance
    `;
    return { sql, paramCount: 9 };
  }

  /**
   * Constructs and parses the initial parameters for dungeon filtering and sorting from the request
   *
   * @param filterByKid - A JSON string representing an array of filter Kingdom IDs (kids)
   * @param request - The Express request object containing query parameters for filtering and sorting
   * @returns An object containing:
   * - `filtersKids`: Array of filter Kingdom IDs parsed from `filterByKid`
   * - `filterByAttackCooldown`: The attack cooldown filter value from the query, or `null`
   * - `filterByPlayerName`: The player name filter value from the query, or `null`
   * - `sortByPositionX`: The X position sort value from the query, or `null`
   * - `sortByPositionY`: The Y position sort value from the query, or `null`
   * - `nearPlayerName`: The nearby player name filter value from the query, or `null`
   * - `sizeValue`: The numeric value of the `size` query parameter
   * - `size`: The string representation of `sizeValue` if valid, otherwise `null`
   */
  private static constructDungeonsInitialParameters(
    filterByKid: string,
    request: express.Request,
  ): {
    filtersKids: any[];
    filterByAttackCooldown: string | null;
    filterByPlayerName: string | null;
    sortByPositionX: string | null;
    sortByPositionY: string | null;
    nearPlayerName: string | null;
    sizeValue: number;
    size: string | null;
  } {
    const filtersKids = JSON.parse(filterByKid);
    for (let index = 0; index < filtersKids.length; index++) {
      if (Number.isNaN(Number(filtersKids[index]))) {
        filtersKids.splice(index, 1);
        index--;
      } else if (Number(filtersKids[index]) < 0 || Number(filtersKids[index]) > 9) {
        filtersKids.splice(index, 1);
        index--;
      } else {
        filtersKids[index] = Number(filtersKids[index]);
      }
    }
    const filterByAttackCooldown = request.query.filterByAttackCooldown
      ? String(request.query.filterByAttackCooldown)
      : null;
    const filterByPlayerName = ApiHelper.getParsedString(request.query.filterByPlayerName, null);
    const sortByPositionX = ApiHelper.getParsedString(request.query.positionX, null);
    const sortByPositionY = ApiHelper.getParsedString(request.query.positionY, null);
    const nearPlayerName = ApiHelper.getParsedString(request.query.nearPlayerName, null);
    const sizeValue = Number(request.query.size);
    const size = !Number.isNaN(sizeValue) && sizeValue > 0 ? String(sizeValue) : null;
    return {
      filtersKids,
      filterByAttackCooldown,
      filterByPlayerName,
      sortByPositionX,
      sortByPositionY,
      nearPlayerName,
      sizeValue,
      size,
    };
  }
}
