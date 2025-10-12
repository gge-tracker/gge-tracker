import * as express from 'express';
import { ApiHelper } from '../api-helper';
import * as pg from 'pg';
import { formatInTimeZone, toDate } from 'date-fns-tz';

/**
 * Abstract class providing API endpoints for player-related operations.
 *
 * This class implements methods to handle HTTP requests for retrieving player data,
 * including paginated player lists with filtering and sorting, fetching player details
 * by name, and retrieving top players by player ID. It utilizes caching for performance
 * and supports various query parameters for flexible data retrieval.
 *
 * @implements {ApiHelper}
 * @abstract
 */
export abstract class ApiPlayers implements ApiHelper {
  /**
   * Handles the retrieval of players with advanced filtering, sorting, and pagination.
   *
   * This endpoint supports multiple query parameters for filtering players by alliance, honor, might, loot, level,
   * legendary level, alliance membership, protection status, ban status, inactivity, and distance from a specific player.
   * It also supports sorting by various fields and paginates the results.
   *
   * Query Parameters:
   * - `page`: The page number for pagination (default: 1).
   * - `orderBy`: The field to order by (default: "player_name"). Allowed values: "player_name", "loot_current", "loot_all_time", "might_current", "might_all_time", "honor", "level", "highest_fame", "current_fame", "remaining_relocation_time", "distance".
   * - `orderType`: The order direction, either "ASC" or "DESC" (default: "ASC").
   * - `alliance`: Filter by alliance name.
   * - `minHonor`, `maxHonor`: Minimum and maximum honor values.
   * - `minMight`, `maxMight`: Minimum and maximum might values.
   * - `minLoot`, `maxLoot`: Minimum and maximum loot values.
   * - `minLevel`, `maxLevel`: Minimum and maximum player level, in the format "level/legendaryLevel".
   * - `allianceFilter`: Filter by alliance membership (0: no alliance, 1: has alliance).
   * - `protectionFilter`: Filter by protection status (0: not protected, 1: protected).
   * - `banFilter`: Filter by ban status (0: not banned, 1: banned).
   * - `inactiveFilter`: Filter by activity (0: inactive, 1: active).
   * - `playerNameForDistance`: Player name to calculate distance from (required if ordering by distance).
   *
   * Caches results based on query parameters for performance.
   *
   * @param request - Express request object, expects query parameters for filtering, sorting, and pagination.
   * @param response - Express response object, sends paginated and filtered player data or error messages.
   * @returns A Promise that resolves when the response is sent.
   */
  public static async getPlayers(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      let page = Number.parseInt(request.query.page as string) || 1;
      let orderBy = (request.query.orderBy as string) || 'player_name';
      let orderType = (request.query.orderType as string) || 'ASC';
      let filterByAlliance = (request.query.alliance as string) || '';
      let minHonor = Number.parseInt(request.query.minHonor as string);
      let maxHonor = Number.parseInt(request.query.maxHonor as string);
      let minMight = Number.parseInt(request.query.minMight as string);
      let maxMight = Number.parseInt(request.query.maxMight as string);
      let minLoot = Number.parseInt(request.query.minLoot as string);
      let maxLoot = Number.parseInt(request.query.maxLoot as string);
      let minLevelArray = String(request.query.minLevel)?.split('/');
      let minLevel = Number.parseInt(minLevelArray[0]);
      let minLegendaryLevel = Number.parseInt(minLevelArray[1]);
      let maxLevelArray = String(request.query.maxLevel)?.split('/');
      let maxLevel = Number.parseInt(maxLevelArray[0]);
      let maxLegendaryLevel = Number.parseInt(maxLevelArray[1]);
      let allianceFilter = Number.parseInt(request.query.allianceFilter as string);
      let protectionFilter = Number.parseInt(request.query.protectionFilter as string);
      let banFilter = Number.parseInt(request.query.banFilter as string);
      let inactiveFilter = Number.parseInt(request.query.inactiveFilter as string);
      let playerNameForDistance = (request.query.playerNameForDistance as string) || '';
      page = page < 1 || page > ApiHelper.MAX_RESULT_PAGE ? 1 : page;
      const orderByValues = [
        'player_name',
        'loot_current',
        'loot_all_time',
        'might_current',
        'might_all_time',
        'honor',
        'level',
        'highest_fame',
        'current_fame',
        'remaining_relocation_time',
        'distance',
      ];
      if (!orderByValues.includes(orderBy)) {
        orderBy = 'player_name';
      }
      if (orderType !== 'ASC' && orderType !== 'DESC') {
        orderType = 'ASC';
      }
      minHonor = minHonor < 0 || Number.isNaN(minHonor) || minHonor > ApiHelper.MAX_RESULT_PAGE ? -1 : minHonor;
      maxHonor = maxHonor < 0 || Number.isNaN(maxHonor) || maxHonor > ApiHelper.MAX_RESULT_PAGE ? -1 : maxHonor;
      minMight = minMight < 0 || Number.isNaN(minMight) || minMight > ApiHelper.MAX_RESULT_PAGE ? -1 : minMight;
      maxMight = maxMight < 0 || Number.isNaN(maxMight) || maxMight > ApiHelper.MAX_RESULT_PAGE ? -1 : maxMight;
      minLoot = minLoot < 0 || Number.isNaN(minLoot) || minLoot > ApiHelper.MAX_RESULT_PAGE ? -1 : minLoot;
      maxLoot = maxLoot < 0 || Number.isNaN(maxLoot) || maxLoot > ApiHelper.MAX_RESULT_PAGE ? -1 : maxLoot;
      minLevel = minLevel < 0 || Number.isNaN(minLevel) || minLevel > 1000 ? -1 : minLevel;
      minLegendaryLevel =
        minLegendaryLevel < 0 || Number.isNaN(minLegendaryLevel) || minLegendaryLevel > 1000 ? -1 : minLegendaryLevel;
      maxLevel = maxLevel < 0 || Number.isNaN(maxLevel) || maxLevel > 1000 ? -1 : maxLevel;
      maxLegendaryLevel =
        maxLegendaryLevel < 0 || Number.isNaN(maxLegendaryLevel) || maxLegendaryLevel > 1000 ? -1 : maxLegendaryLevel;
      allianceFilter =
        Number.isNaN(allianceFilter) || (allianceFilter !== 0 && allianceFilter !== 1) ? -1 : allianceFilter;
      protectionFilter =
        Number.isNaN(protectionFilter) || (protectionFilter !== 0 && protectionFilter !== 1) ? -1 : protectionFilter;
      banFilter = Number.isNaN(banFilter) || (banFilter !== 0 && banFilter !== 1) ? -1 : banFilter;
      inactiveFilter =
        Number.isNaN(inactiveFilter) || (inactiveFilter !== 0 && inactiveFilter !== 1) ? -1 : inactiveFilter;
      if (playerNameForDistance && playerNameForDistance.length > 40) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
        return;
      }
      playerNameForDistance = playerNameForDistance.trim().toLowerCase();
      const encodedPlayerNameForDistance = encodeURIComponent(playerNameForDistance);
      const encodedAlliance = encodeURIComponent(filterByAlliance);

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cachedKey =
        request['language'] +
        `players-page-${page}-orderBy-${orderBy}-orderType-${orderType}-alliance-${encodedAlliance}-minHonor-${minHonor}-maxHonor-${maxHonor}-minMight-${minMight}-maxMight-${maxMight}-minLoot-${minLoot}-maxLoot-${maxLoot}-minLevel-${minLevel}-${minLegendaryLevel}-maxLevel-${maxLevel}-${maxLegendaryLevel}-allianceFilter-${allianceFilter}-protectionFilter-${protectionFilter}-banFilter-${banFilter}-inactiveFilter-${inactiveFilter}-playerNameForDistance-${encodedPlayerNameForDistance}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query
       * --------------------------------- */
      let totalPages = 0;
      let playerCount = 0;
      let countQuery: string;
      let parameterIndex = 1;
      let query: string = `
        SELECT
          P.id AS player_id,
          P.name AS player_name,
          A.name AS alliance_name,
          A.id AS alliance_id,
          P.might_current,
          P.might_all_time,
          P.loot_current,
          P.loot_all_time,
          P.honor,
          P.max_honor,
          P.highest_fame,
          P.current_fame,
          P.remaining_relocation_time,
          P.peace_disabled_at,
          P.updated_at,
          P.level,
          P.legendary_level`;
      const playerNameDistanceFilterActive = playerNameForDistance && playerNameForDistance !== '';

      /* ---------------------------------
       * Distance calculation
       * --------------------------------- */
      if (playerNameDistanceFilterActive) {
        query += `,
          (
            POWER(
              LEAST(
                ABS(CAST(MC.castle_x AS INTEGER) - $${parameterIndex++}),
                1287 - ABS(CAST(MC.castle_x AS INTEGER) - $${parameterIndex++})
              ),
              2
              ) +
              POWER(
              ABS(CAST(MC.castle_y AS INTEGER) - $${parameterIndex++}),
              2
            )
          ) AS calculated_distance`;
      }
      query += `
        FROM
            players P
        LEFT JOIN
            alliances A ON P.alliance_id = A.id
        `;

      if (playerNameDistanceFilterActive) {
        query += `
          LEFT JOIN LATERAL (
          SELECT
            (castle_elem->>0)::int AS castle_x,
            (castle_elem->>1)::int AS castle_y,
            (castle_elem->>2)::int AS is_main
          FROM jsonb_array_elements(P.castles) AS castle_elem
          WHERE (castle_elem->>2)::int = 1
          LIMIT 1
          ) AS MC ON true
        `;
      }

      /* ---------------------------------
       * Filter results
       * --------------------------------- */
      const otherParameters: (string | number)[] = [];
      const filters: string[] = [];
      if (filterByAlliance && filterByAlliance !== '') {
        filters.push(`A.name = $${parameterIndex++}`);
        otherParameters.push(filterByAlliance);
      }
      if (minHonor >= 0 && !Number.isNaN(minHonor)) {
        filters.push(`P.honor >= $${parameterIndex++}`);
        otherParameters.push(minHonor);
      }
      if (maxHonor >= 0 && !Number.isNaN(maxHonor)) {
        filters.push(`P.honor <= $${parameterIndex++}`);
        otherParameters.push(maxHonor);
      }
      if (minMight >= 0 && !Number.isNaN(minMight)) {
        filters.push(`P.might_current >= $${parameterIndex++}`);
        otherParameters.push(minMight);
      }
      if (maxMight >= 0 && !Number.isNaN(maxMight)) {
        filters.push(`P.might_current <= $${parameterIndex++}`);
        otherParameters.push(maxMight);
      }
      if (minLoot >= 0 && !Number.isNaN(minLoot)) {
        filters.push(`P.loot_current >= $${parameterIndex++}`);
        otherParameters.push(minLoot);
      }
      if (maxLoot >= 0 && !Number.isNaN(maxLoot)) {
        filters.push(`P.loot_current <= $${parameterIndex++}`);
        otherParameters.push(maxLoot);
      }
      if (minLevel >= 0 && !Number.isNaN(minLevel)) {
        filters.push(`P.level >= $${parameterIndex++}`);
        otherParameters.push(minLevel);
      }
      if (minLegendaryLevel >= 0 && !Number.isNaN(minLegendaryLevel)) {
        filters.push(`P.legendary_level >= $${parameterIndex++}`);
        otherParameters.push(minLegendaryLevel);
      }
      if (maxLevel >= 0 && !Number.isNaN(maxLevel)) {
        filters.push(`P.level <= $${parameterIndex++}`);
        otherParameters.push(maxLevel);
      }
      if (maxLegendaryLevel >= 0 && !Number.isNaN(maxLegendaryLevel)) {
        filters.push(`P.legendary_level <= $${parameterIndex++}`);
        otherParameters.push(maxLegendaryLevel);
      }
      if (allianceFilter === 0) {
        filters.push(`P.alliance_id IS NULL`);
      } else if (allianceFilter === 1) {
        filters.push(`P.alliance_id IS NOT NULL`);
      }
      if (protectionFilter === 0) {
        if (banFilter !== 1) filters.push(`(P.peace_disabled_at IS NULL OR P.peace_disabled_at <= NOW())`);
      } else if (protectionFilter === 1) {
        filters.push(`P.peace_disabled_at IS NOT NULL AND P.peace_disabled_at > NOW()`);
      }
      if (banFilter === 0) {
        filters.push(`(P.peace_disabled_at IS NULL OR P.peace_disabled_at <= NOW() + INTERVAL '63 days')`);
      } else if (banFilter === 1) {
        filters.push(`P.peace_disabled_at > NOW() + INTERVAL '63 days'`);
      }
      if (inactiveFilter === 1) {
        filters.push(`(P.castles IS NOT NULL AND jsonb_array_length(P.castles) > 0)`);
      } else if (inactiveFilter === 0) {
        filters.push(`(P.castles IS NULL OR jsonb_array_length(P.castles) = 0)`);
      }
      if (filters.length > 0) {
        query += `WHERE ${filters.join(' AND ')} \n    `;
      }
      const parameters: any[] = [
        ...otherParameters,
        ApiHelper.PAGINATION_LIMIT,
        (page - 1) * ApiHelper.PAGINATION_LIMIT,
      ];

      /* ---------------------------------
       * Execute count query (pagination)
       * --------------------------------- */
      countQuery = `SELECT COUNT(P.id) AS player_count FROM players P LEFT JOIN alliances A ON P.alliance_id = A.id `;
      if (filters.length > 0) {
        countQuery += `WHERE ${filters.join(' AND ')} \n    `;
        if (playerNameDistanceFilterActive) {
          // Tricky part, we need to re-index the $ parameters for the count query
          countQuery = countQuery.replaceAll(/\$(\d+)/g, (match, p1) => {
            return `$${Number.parseInt(p1) - 3}`;
          });
        }
      }
      /* ---------------------------------
       * Query count results
       * --------------------------------- */
      await new Promise((resolve, reject) => {
        (request['pg_pool'] as pg.Pool).query(countQuery, otherParameters, (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getPlayers_countQuery', request);
            reject(new Error('An error occurred. Please try again later.'));
          } else {
            playerCount = results.rows[0]['player_count'];
            totalPages = Math.ceil(playerCount / ApiHelper.PAGINATION_LIMIT);
            if (page > totalPages) {
              page = totalPages;
            }
            resolve(null);
          }
        });
      });

      /* ---------------------------------
       * Finalize query
       * --------------------------------- */
      if (orderBy === 'distance') {
        if (playerNameForDistance && playerNameForDistance !== '') {
          query += `ORDER BY calculated_distance ${orderType}`;
        } else {
          response
            .status(ApiHelper.HTTP_BAD_REQUEST)
            .send({ error: 'Player name for distance is required when ordering by distance' });
          return;
        }
      } else {
        query += `ORDER BY ${orderBy} ${orderType}`;
        if (orderBy === 'level') query += `, legendary_level ${orderType}`;
      }
      query += ` LIMIT $${parameterIndex++} OFFSET $${parameterIndex++}`;
      // Performance issue
      const sqlDuration = Date.now();
      let playerX = null;
      let playerY = null;
      if (playerNameForDistance && playerNameForDistance !== '') {
        parameterIndex = 1;
        const playerQuery = `SELECT castles FROM players WHERE LOWER(name) = $${parameterIndex++} LIMIT 1`;
        const playerResults: any[] = await new Promise((resolve, reject) => {
          (request['pg_pool'] as pg.Pool).query(playerQuery, [playerNameForDistance], (error, results) => {
            if (error) {
              ApiHelper.logError(error, 'getPlayer_castles_query', request);
              reject(new Error('An error occurred. Please try again later.'));
            } else {
              resolve(results.rows);
            }
          });
        });
        if (playerResults.length === 0) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
          return;
        }
        const playerKid = playerResults[0].castles ?? [];
        const selectedKid = playerKid.filter((kid: any) => kid[2] === 1);
        if (selectedKid && selectedKid.length > 0) {
          playerX = selectedKid[0][0];
          playerY = selectedKid[0][1];
        }
        parameters.unshift(playerX, playerX, playerY);
      }

      /* ---------------------------------
       * Execute final query
       * --------------------------------- */
      (request['pg_pool'] as pg.Pool).query(query, parameters, (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          const pagination = {
            current_page: page,
            total_pages: totalPages,
            current_items_count: results.rowCount,
            total_items_count: playerCount,
          };
          const sqlDurationEnd = Date.now();
          const durationMs = sqlDurationEnd - sqlDuration;

          /* ---------------------------------
           * Format results
           * --------------------------------- */
          const responseContent = {
            duration: durationMs / 1000 + 's',
            pagination,
            players: results.rows.map((result: any) => {
              return {
                player_id: ApiHelper.addCountryCode(result.player_id, request['code']),
                player_name: result.player_name,
                alliance_name: result.alliance_name,
                alliance_id: ApiHelper.addCountryCode(result.alliance_id, request['code']),
                might_current: result.might_current,
                might_all_time: result.might_all_time,
                loot_current: result.loot_current,
                loot_all_time: result.loot_all_time,
                honor: result.honor,
                max_honor: result.max_honor,
                highest_fame: result.highest_fame,
                current_fame: result.current_fame,
                remaining_relocation_time: result.remaining_relocation_time,
                peace_disabled_at: result.peace_disabled_at,
                updated_at: formatInTimeZone(result.updated_at, ApiHelper.APPLICATION_TIMEZONE, 'yyyy-MM-dd HH:mm'),
                level: result.level,
                legendary_level: result.legendary_level,
                calculated_distance:
                  result.calculated_distance === undefined
                    ? null
                    : Number.parseFloat(Math.sqrt(result.calculated_distance).toFixed(1)),
              };
            }),
          };

          /* ---------------------------------
           * Update cache
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, responseContent);
          response.status(ApiHelper.HTTP_OK).send(responseContent);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getPlayers', request);
      return;
    }
  }

  /**
   * Handles the retrieval of player information by player name.
   *
   * This method validates the provided player name, checks for cached results,
   * and queries the database for player details if not cached. The result is
   * cached for future requests and returned to the client. If the player is not
   * found, an appropriate error message is returned.
   *
   * @param request - The Express request object, expected to contain the player name in `params.playerName`,
   *                  a Redis client in `ApiHelper.redisClient`, a PostgreSQL pool in `request["pg_pool"]`,
   *                  and a language code in `request["language"]`.
   * @param response - The Express response object used to send the result or error message.
   * @returns A Promise that resolves when the response has been sent.
   *
   * @remarks
   * - Responds with HTTP 400 if the username is invalid.
   * - Responds with HTTP 200 and an error message if the player is not found.
   * - Responds with HTTP 500 if a database or internal error occurs.
   * - Caches successful responses for improved performance.
   */
  public static async getPlayersByPlayerName(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerName = ApiHelper.verifySearch(request.params.playerName);
      if (playerName === false || playerName === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid username' });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const encodedPlayerName = encodeURIComponent(playerName);
      const cacheKey = request['language'] + `players:${encodedPlayerName}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query
       * --------------------------------- */
      let parameterIndex = 1;
      const query: string = `
        SELECT
          P.id AS player_id,
          P.name AS player_name,
          A.name AS alliance_name,
          A.id AS alliance_id,
          P.might_current,
          P.might_all_time,
          P.loot_current,
          P.loot_all_time,
          P.honor,
          P.max_honor,
          P.peace_disabled_at,
          P.updated_at,
          P.level,
          P.legendary_level,
          P.highest_fame,
          P.current_fame
        FROM
          players P
        LEFT JOIN
          alliances A ON P.alliance_id = A.id
        WHERE
          LOWER(P.name) = $${parameterIndex++}
        LIMIT 1;
      `;

      /* ---------------------------------
       * Execute query
       * --------------------------------- */
      (request['pg_pool'] as pg.Pool).query(query, [playerName], async (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: 'An exception occurred' });
          return;
        } else {
          if (!results.rows || results.rows.length === 0) {
            // Trick: we return 200 for frontend compatibility, but with an error message
            response.status(ApiHelper.HTTP_OK).send({ error: 'Player not found' });
            return;
          }

          /* ---------------------------------
           * Format results
           * --------------------------------- */
          const result = results.rows[0] ?? {};
          const resultMapped = {
            player_id: ApiHelper.addCountryCode(result.player_id, request['code']),
            player_name: result.player_name,
            alliance_name: result.alliance_name,
            alliance_id: ApiHelper.addCountryCode(result.alliance_id, request['code']),
            might_current: result.might_current,
            might_all_time: result.might_all_time,
            loot_current: result.loot_current,
            loot_all_time: result.loot_all_time,
            honor: result.honor,
            max_honor: result.max_honor,
            peace_disabled_at: result.peace_disabled_at,
            updated_at: formatInTimeZone(result.updated_at, ApiHelper.APPLICATION_TIMEZONE, 'yyyy-MM-dd HH:mm'),
            level: result.level,
            legendary_level: result.legendary_level,
            highest_fame: result.highest_fame,
            current_fame: result.current_fame,
          };

          /* ---------------------------------
           * Update cache
           * --------------------------------- */
          void ApiHelper.updateCache(cacheKey, resultMapped);
          response.status(ApiHelper.HTTP_OK).send(resultMapped);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getPlayersByPlayerName', request);
      return;
    }
  }

  /**
   * Handles the API request to retrieve the top players associated with a given player ID.
   *
   * This method performs the following steps:
   * 1. Validates the provided player ID from the request parameters.
   * 2. Attempts to retrieve cached results for the top players; if found, returns the cached data.
   * 3. Determines the appropriate PostgreSQL pool and country code based on the player ID.
   * 4. Executes a SQL query to fetch records from the `server_statistics` table where the `events_top_3_names`
   *    JSONB column contains the country code.
   * 5. Formats the results, converting the `created_at` timestamp to the application's timezone.
   * 6. Caches the response and sends the formatted data to the client.
   *
   * @param request - The Express request object, containing the player ID in the route parameters.
   * @param response - The Express response object used to send the result or error.
   * @returns A Promise that resolves when the response is sent.
   *
   * @throws 400 Bad Request if the player ID or server is invalid.
   * @throws 500 Internal Server Error if a database or unexpected error occurs.
   */
  public static async getTopPlayersByPlayerId(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerId = ApiHelper.getVerifiedId(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid user id' });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cachedKey = `top-player:${playerId}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query
       * --------------------------------- */
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      const code = ApiHelper.getCountryCode(String(playerId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid server or player ID' });
        return;
      }
      const query = `
        SELECT
          created_at,
          events_top_3_names
        FROM
          server_statistics
        WHERE
          events_top_3_names IS NOT NULL
        AND
          events_top_3_names::jsonb ? $1;
      `;

      /* ---------------------------------
       * Execute query
       * --------------------------------- */
      pool.query(query, [code], (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
          return;
        } else {
          const topPlayers = results.rows.map((result: any) => {
            const utcDate = toDate(result['created_at']);
            const localDate = formatInTimeZone(utcDate, ApiHelper.APPLICATION_TIMEZONE, 'yyyy-MM-dd HH:mm' + ':00');
            return {
              date: localDate,
              top_players: result.events_top_3_names,
            };
          });

          /* ---------------------------------
           * Update cache and respond
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, { topPlayers });
          response.status(ApiHelper.HTTP_OK).send({ topPlayers });
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getTopPlayersByPlayerId', request);
      return;
    }
  }
}
