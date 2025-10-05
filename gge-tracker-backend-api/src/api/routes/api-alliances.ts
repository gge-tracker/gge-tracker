import * as express from 'express';
import * as pg from 'pg';
import { ApiHelper } from '../api-helper';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Abstract class providing API endpoints for alliance-related operations.
 *
 * This class implements the `ApiHelper` interface and exposes static methods
 * to handle HTTP requests for alliance data, including:
 *
 * - Fetching detailed information about an alliance by its ID, with optional player distance calculation.
 * - Retrieving summarized alliance statistics by alliance name.
 * - Listing alliances with pagination, sorting, and caching support.
 *
 * @abstract
 */
export abstract class ApiAlliances implements ApiHelper {
  /**
   * Handles the request to retrieve alliance information by alliance ID, including player statistics and optional distance calculation.
   *
   * @param request - The Express request object. Expects `allianceId` as a route parameter and optionally `playerNameForDistance` as a query parameter.
   * @param response - The Express response object used to send the result or error.
   * @returns A Promise that resolves when the response is sent.
   *
   * @remarks
   * - Validates the provided alliance ID and optional player name.
   * - If `playerNameForDistance` is provided, calculates the distance from the specified player to each player in the alliance.
   * - Retrieves alliance and player data from the database, formats the results, and caches the response.
   * - Responds with appropriate HTTP status codes for errors such as invalid input or not found resources.
   *
   * @throws Sends a 500 response if an unexpected error occurs during processing.
   */
  public static async getAllianceByAllianceId(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const allianceId = ApiHelper.getVerifiedId(request.params.allianceId);
      if (allianceId === false || allianceId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid alliance id' });
        return;
      }
      let playerNameForDistance = request.query.playerNameForDistance
        ? (request.query.playerNameForDistance as string)
        : '';
      if (playerNameForDistance && playerNameForDistance.length > 40) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
        return;
      }
      /* ---------------------------------
       * Resolve the database pool and country code
       * --------------------------------- */
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(allianceId);
      const code = ApiHelper.getCountryCode(String(allianceId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'Alliance not found' });
        return;
      }
      /* ---------------------------------
       * Normalize and prepare cache key
       * --------------------------------- */
      playerNameForDistance = playerNameForDistance.trim().toLowerCase();
      const encodedAllianceId = encodeURIComponent(allianceId);
      const encodedPlayerNameForDistance = encodeURIComponent(playerNameForDistance);
      const cachedKey = request['language'] + `alliances:${encodedAllianceId}:${encodedPlayerNameForDistance}`;
      /* ---------------------------------
       * Execute queries and process results
       * --------------------------------- */
      let playerX = null;
      let playerY = null;
      if (playerNameForDistance) {
        // If player name is provided, get player's main castle coordinates
        let paramIndex = 1;
        const playerQuery = `SELECT castles FROM players WHERE LOWER(name) = $${paramIndex++} LIMIT 1`;
        const playerResults: any[] = await new Promise((resolve, reject) => {
          pool.query(playerQuery, [playerNameForDistance], (error, results) => {
            if (error) reject(error);
            else resolve(results.rows);
          });
        });
        if (playerResults.length === 0) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
          return;
        }
        const playerKid = playerResults[0].castles ?? '[]';
        const playerKidParsed = playerKid;
        const selectedKid = playerKidParsed.filter((kid: any) => kid[2] === 1);
        // Get main castle coordinates
        if (selectedKid && selectedKid.length > 0) {
          playerX = selectedKid[0][0];
          playerY = selectedKid[0][1];
        }
      }
      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      /* ---------------------------------
       * Build and execute main query
       * --------------------------------- */
      const query = this.getAllianceByAllianceIdSQLQuery();
      const parameters = [playerX, playerX, playerY, ApiHelper.removeCountryCode(allianceId)];
      pool.query(query, parameters, async (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: 'An exception occurred' });
          return;
        } else {
          if (!results || results.rowCount === 0) {
            // HTTP 200 to avoid leaking valid IDs. This needs to be handled in the frontend.
            response.status(ApiHelper.HTTP_OK).send({ error: 'Alliance not found' });
            return;
          }
          /* ---------------------------------
           * Process and format results
           * --------------------------------- */
          const allianceStatistics = results.rows.map((result: any) => {
            return {
              player_id: ApiHelper.addCountryCode(result.player_id, code),
              player_name: result.player_name,
              might_current: Number(result.might_current),
              might_all_time: Number(result.might_all_time),
              loot_current: Number(result.loot_current),
              loot_all_time: Number(result.loot_all_time),
              current_fame: Number(result.current_fame),
              highest_fame: Number(result.highest_fame),
              calculated_distance:
                result.calculated_distance !== null
                  ? parseFloat(Math.sqrt(result.calculated_distance).toFixed(1))
                  : null,
              honor: Number(result.honor),
              max_honor: Number(result.max_honor),
              peace_disabled_at: result.peace_disabled_at,
              updated_at: formatInTimeZone(
                result.updated_at,
                ApiHelper.APPLICATION_TIMEZONE,
                'yyyy-MM-dd HH:mm' + ':00',
              ),
              level: Number(result.level),
              legendary_level: Number(result.legendary_level),
            };
          });
          const result = {
            alliance_name: results.rows[0].alliance_name,
            players: allianceStatistics,
          };
          void ApiHelper.updateCache(cachedKey, result);
          response.status(ApiHelper.HTTP_OK).send(result);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAllianceByAllianceId', request);
      return;
    }
  }

  /**
   * Handles the retrieval of alliance information by alliance name.
   *
   * This static method processes an HTTP request to fetch aggregated alliance data,
   * including might, loot, fame, and player count, based on the provided alliance name.
   * The alliance name is validated, normalized, and used to query the database.
   * Results are cached using Redis for improved performance.
   *
   * @param request - The Express request object, expected to contain the alliance name in `params.allianceName`,
   *                  and additional properties such as `language`, `pg_pool`, and `code`.
   * @param response - The Express response object used to send the result or error.
   * @returns A Promise that resolves when the response is sent.
   *
   * @remarks
   * - Returns a 400 status code if the alliance name is invalid.
   * - Returns a 200 status code with the alliance data if found, or an error message if not found.
   * - Returns a 500 status code if an exception occurs during processing.
   */
  public static async getAllianceByAllianceName(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and normalize alliance name
       * --------------------------------- */
      let allianceName = ApiHelper.verifySearch(request.params.allianceName);
      if (!allianceName || allianceName.length > 50) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid alliance name' });
        return;
      }
      allianceName = allianceName.trim().toLowerCase();
      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const encodedAllianceName = encodeURIComponent(allianceName);
      // This is a protected endpoint, so we can assume pg_pool and code are always set
      const cacheKey = request['language'] + `alliances:${encodedAllianceName}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      /* ---------------------------------
       * Build and execute SQL query
       * --------------------------------- */
      let paramIndex = 1;
      const query: string = `
        SELECT
            A.id AS alliance_id,
            A.name AS alliance_name,
            SUM(P.might_current) AS might_current,
            SUM(P.might_all_time) AS might_all_time,
            SUM(P.loot_current) AS loot_current,
            SUM(P.loot_all_time) AS loot_all_time,
            SUM(P.current_fame) AS current_fame,
            SUM(P.highest_fame) AS highest_fame,
            COUNT(P.id) AS player_count
        FROM
            alliances A
        LEFT JOIN
            players P ON A.id = P.alliance_id
        WHERE
            LOWER(A.name) = $${paramIndex++}
        GROUP BY
            A.id
        LIMIT 1;
        `;
      /* ---------------------------------
       * Process query results
       * --------------------------------- */
      (request['pg_pool'] as pg.Pool).query(query, [allianceName], async (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: 'An exception occurred' });
        } else {
          if (!results.rowCount || results.rowCount === 0) {
            response.status(ApiHelper.HTTP_OK).send({ error: 'Alliance not found' });
            return;
          }
          /* ---------------------------------
           * Format and send response
           * --------------------------------- */
          const result = results.rows[0] ?? {};
          const mappedResult = {
            alliance_id: ApiHelper.addCountryCode(result.alliance_id, request['code']),
            alliance_name: result.alliance_name,
            might_current: result.might_current,
            might_all_time: result.might_all_time,
            loot_current: result.loot_current,
            loot_all_time: result.loot_all_time,
            current_fame: result.current_fame,
            highest_fame: result.highest_fame,
            player_count: result.player_count,
          };
          void ApiHelper.updateCache(cacheKey, mappedResult);
          response.status(ApiHelper.HTTP_OK).send(mappedResult);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAllianceByAllianceName', request);
      return;
    }
  }

  public static async getAlliances(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and normalize query parameters
       * --------------------------------- */
      let page = parseInt(request.query.page as string) || 1;
      let orderBy = (request.query.orderBy as string) || 'alliance_name';
      let orderType = (request.query.orderType as string) || 'ASC';
      page = page < 1 || page > ApiHelper.MAX_RESULT_PAGE ? 1 : page;
      const orderByValues: string[] = [
        'alliance_name',
        'loot_current',
        'loot_all_time',
        'might_current',
        'might_all_time',
        'player_count',
        'current_fame',
        'highest_fame',
      ];
      if (!orderByValues.includes(orderBy)) {
        orderBy = 'alliance_name';
      }
      if (orderType !== 'ASC' && orderType !== 'DESC') {
        orderType = 'ASC';
      }
      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const cachedKey = request['language'] + `alliances-page-${page}-orderBy-${orderBy}-orderType-${orderType}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      /* ---------------------------------
       * Count total alliances for pagination
       * --------------------------------- */
      let totalPages = 0;
      let allianceCount = 0;
      const countQuery = `
        SELECT
            COUNT(id) AS alliance_count
        FROM
            alliances
        WHERE
            (SELECT COUNT(id) FROM players WHERE alliance_id = alliances.id AND castles IS NOT NULL) > 0`;
      const promiseCountQuery = new Promise((resolve, reject) => {
        (request['pg_pool'] as pg.Pool).query(countQuery, (error, results) => {
          if (error) {
            reject(error);
          } else {
            allianceCount = results.rows[0]['alliance_count'];
            totalPages = Math.ceil(allianceCount / ApiHelper.PAGINATION_LIMIT);
            if (page > totalPages) {
              page = totalPages;
            }
            resolve(null);
          }
        });
      });
      await promiseCountQuery;
      /* ---------------------------------
       * Fetch paginated alliance data
       * --------------------------------- */
      let paramIndex = 1;
      const query = `
        SELECT
            A.id AS alliance_id,
            A.name AS alliance_name,
            SUM(P.might_current) AS might_current,
            SUM(P.might_all_time) AS might_all_time,
            SUM(P.loot_current) AS loot_current,
            SUM(P.loot_all_time) AS loot_all_time,
            SUM(P.current_fame) AS current_fame,
            SUM(P.highest_fame) AS highest_fame,
            COUNT(P.id) AS player_count
        FROM
            alliances A
        LEFT JOIN
            players P ON A.id = P.alliance_id
        WHERE P.castles IS NOT NULL AND jsonb_array_length(P.castles) > 0
        GROUP BY
            A.id
        HAVING
            COUNT(P.id) > 0
        ORDER BY ${orderBy} ${orderType}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;
      const sqlDuration = Date.now();
      (request['pg_pool'] as pg.Pool).query(
        query,
        [ApiHelper.PAGINATION_LIMIT, (page - 1) * ApiHelper.PAGINATION_LIMIT],
        (error, results) => {
          if (error) {
            response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
            return;
          } else {
            /* ---------------------------------
             * Format and send response
             * --------------------------------- */
            const pagination = {
              current_page: page,
              total_pages: totalPages,
              current_items_count: results.rowCount,
              total_items_count: allianceCount,
            };
            const sqlDurationEnd = Date.now();
            const durationMs = sqlDurationEnd - sqlDuration;
            const responseContent = {
              duration: durationMs / 1000 + 's',
              pagination,
              alliances: results.rows.map((result: any) => {
                return {
                  alliance_id: ApiHelper.addCountryCode(result.alliance_id, request['code']),
                  alliance_name: result.alliance_name,
                  might_current: result.might_current,
                  might_all_time: result.might_all_time,
                  loot_current: result.loot_current,
                  loot_all_time: result.loot_all_time,
                  current_fame: result.current_fame,
                  highest_fame: result.highest_fame,
                  player_count: result.player_count,
                };
              }),
            };
            void ApiHelper.updateCache(cachedKey, responseContent);
            response.status(ApiHelper.HTTP_OK).send(responseContent);
            return;
          }
        },
      );
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAlliances', request);
      return;
    }
  }

  /**
   * Generates a SQL query string to retrieve detailed information about an alliance and its players
   * by the specified alliance ID. The query returns alliance and player details, including player
   * statistics, fame, honor, and calculated distance from a given coordinate. The distance is computed
   * based on the player's main castle coordinates and provided parameters, considering map wrapping.
   *
   * @returns {string} The SQL query string for fetching alliance and player data by alliance ID.
   *
   * @remarks
   * - The query expects four parameters in order: target_x, map_width, target_y, and alliance_id.
   * - The calculated distance uses the LEAST function to account for map wrapping on the x-axis.
   * - Only players with at least one castle are included in the results.
   * - Results are ordered by the player's current might in descending order.
   */
  private static getAllianceByAllianceIdSQLQuery(): string {
    let paramIndex = 1;
    return `
      SELECT
        A.name AS alliance_name,
        P.id AS player_id,
        P.name AS player_name,
        A.name AS alliance_name,
        A.id AS alliance_id,
        P.might_current,
        P.might_all_time,
        P.loot_current,
        P.loot_all_time,
        P.honor,
        P.current_fame,
        P.highest_fame,
        P.max_honor,
        P.peace_disabled_at,
        P.updated_at,
        P.level,
        P.legendary_level,
        (
          POWER(
          LEAST(
              ABS(CAST(MC.castle_x AS INTEGER) - $${paramIndex++}),
              1287 - ABS(CAST(MC.castle_x AS INTEGER) - $${paramIndex++})
          ),
          2
          ) +
          POWER(
          ABS(CAST(MC.castle_y AS INTEGER) - $${paramIndex++}),
          2
          )
        ) AS calculated_distance
      FROM
        alliances A
      LEFT JOIN
        players P ON A.id = P.alliance_id
      LEFT JOIN LATERAL (
          SELECT
            (castle_elem->>0)::int AS castle_x,
            (castle_elem->>1)::int AS castle_y,
            (castle_elem->>2)::int AS is_main
        FROM jsonb_array_elements(P.castles) AS castle_elem
        WHERE (castle_elem->>2)::int = 1
        LIMIT 1
        ) AS MC ON true
      WHERE
        A.id = $${paramIndex++}
      AND
        P.castles IS NOT NULL AND jsonb_array_length(P.castles) > 0
      ORDER BY
        P.might_current DESC;
      `;
  }
}
