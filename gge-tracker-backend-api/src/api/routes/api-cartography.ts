import * as express from 'express';
import { ApiHelper } from '../api-helper';
import * as pg from 'pg';

/**
 * Provides API endpoints for retrieving cartography-related data about alliances and players.
 *
 * The `ApiCartography` abstract class implements the `ApiHelper` interface and exposes static methods
 * to handle HTTP requests for various cartography queries, including:
 *
 * - Retrieving cartography data by a specified size limit.
 * - Retrieving cartography data by alliance name.
 * - Retrieving cartography data by alliance ID.
 *
 * Each method handles request validation, caching via Redis, and querying a PostgreSQL database for the
 * relevant data. Results are formatted and returned as JSON responses.
 *
 * @see ApiHelper
 * @abstract
 */
export abstract class ApiCartography implements ApiHelper {
  /**
   * Handles the HTTP request to retrieve cartography data filtered by a specified size.
   *
   * This endpoint returns a list of players and their alliance information, ordered by the total might of their alliances.
   * The number of alliances returned can be limited by the `size` parameter in the request.
   *
   * - If `size` is not a valid number, less than -1, or greater than 9999999999, responds with HTTP 400.
   * - If `size` is negative, returns all alliances.
   * - If `size` is a valid positive integer, limits the result to that number of alliances.
   * - Results are cached using Redis for performance.
   *
   * @param request - Express request object, expects `params.size` as the size limit and `language` for cache key.
   * @param response - Express response object used to send the result or error.
   * @returns A Promise that resolves when the response is sent.
   *
   * @route GET /cartography/size/:size
   * @throws 400 - If the size parameter is invalid.
   * @throws 500 - If a database or internal error occurs.
   */
  public static async getCartographyBySize(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const nb = Number(request.params.size);
      if (Number.isNaN(nb) || nb < -1 || nb > ApiHelper.MAX_RESULT_PAGE) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid size' });
        return;
      }

      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${request['language']}`)) || '1';
      const cachedKey = request['language'] + `:${cacheVersion}:` + '/carto/size/' + nb;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Query database and format result
       * --------------------------------- */
      const regex = /^\d+$/;
      let limit = '';
      // Get the limit clause based on the size parameter. However, the query does not use it
      // with parameterized queries to avoid SQL injection,  so we validate it strictly here.
      // A more complex query with OFFSET would require a different approach.
      if (Number.isNaN(nb)) {
        limit = 'LIMIT 10';
      } else if (regex.test(nb.toString())) {
        limit = `LIMIT ${nb}`;
      } else {
        limit = 'LIMIT 10';
      }
      const query = `
        WITH ranked_alliances AS (
          SELECT
            alliance_id,
            SUM(might_current) AS total_might
          FROM players
          WHERE alliance_id IS NOT NULL
          GROUP BY alliance_id
          ORDER BY total_might DESC
          ${limit})
        SELECT
          P.name,
          P.castles AS castles,
          P.castles_realm AS castles_realm,
          P.might_current,
          A.id AS alliance_id,
          A.name AS alliance_name
        FROM players P
        INNER JOIN alliances A ON P.alliance_id = A.id
        INNER JOIN ranked_alliances RA ON P.alliance_id = RA.alliance_id
        ORDER BY RA.total_might DESC, A.name ASC, P.might_current DESC;
    `;
      (request['pg_pool'] as pg.Pool).query(query, (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          const rows = results.rows.map((row: any) => {
            return {
              name: row.name,
              castles: row.castles,
              castles_realm: row.castles_realm,
              might_current: row.might_current,
              alliance_id: ApiHelper.addCountryCode(row.alliance_id, request['code']),
              alliance_name: row.alliance_name,
            };
          });

          /* ---------------------------------
           * Update cache and send response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, rows);
          response.status(ApiHelper.HTTP_OK).send(rows);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCartographyByAllianceId', request);
      return;
    }
  }

  /**
   * Handles the retrieval of cartography data for players based on the provided alliance name.
   *
   * This endpoint supports two modes:
   * - Special frontend specific case: If the `allianceName` parameter is `"1"`, it returns players without an alliance who have castles.
   * - Otherwise, it returns players belonging to the specified alliance (case-insensitive) who have castles.
   *
   * The method performs the following steps:
   * 1. Validates the `allianceName` parameter length.
   * 2. Checks for cached results in Redis and returns them if available.
   * 3. Constructs and executes a SQL query to fetch player data based on the alliance name.
   * 4. Formats the results, updates the cache, and sends the response.
   *
   * @param request - Express request object, expects `params.allianceName`, `language`, `pg_pool`, and `code` properties.
   * @param response - Express response object used to send the result or error.
   * @returns A promise that resolves to void. Sends a JSON response with player cartography data or an error message.
   */
  public static async getCartographyByAllianceName(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const allianceName = request.params.allianceName;
      if (allianceName.length > 40) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid alliance name' });
        return;
      }
      const encodedAllianceName = encodeURIComponent(allianceName);

      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${request['language']}`)) || '1';
      const cachedKey = request['language'] + `:${cacheVersion}:` + '/carto/alliance-name/' + encodedAllianceName;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      /* ---------------------------------
       * Query database
       * --------------------------------- */
      let parameterIndex = 1;
      let query = '';
      if (allianceName === '1') {
        // Special case for frontend: get players without alliance but with castles
        query = `
          SELECT
              P.name,
              P.alliance_id AS alliance_id,
              castles,
              castles_realm,
              might_current
          FROM
              players P
          WHERE
              P.alliance_id IS NULL
          AND P.castles IS NOT NULL
          AND P.castles != '[]'
          ORDER BY
              castles DESC;
                `;
      } else {
        // Regular case: get players by alliance name (case insensitive)
        query = `
          SELECT
              P.name,
              A.id AS alliance_id,
              castles,
              castles_realm,
              might_current
          FROM
              players P
          INNER JOIN
              alliances A ON P.alliance_id = A.id
          WHERE
              LOWER(A.name) = LOWER($${parameterIndex++})
          AND P.castles IS NOT NULL
          AND P.castles != '[]'
          ORDER BY
              castles DESC;
      `;
      }
      const parameters = allianceName === '1' ? [] : [allianceName];
      (request['pg_pool'] as pg.Pool).query(query, parameters, (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          /* ---------------------------------
           * Format results
           * --------------------------------- */
          const formattedResults = results.rows.map((row: any) => {
            return {
              name: row.name,
              castles: row.castles,
              castles_realm: row.castles_realm,
              might_current: row.might_current,
              alliance_id: ApiHelper.addCountryCode(row.alliance_id, request['code']),
              alliance_name: allianceName,
            };
          });
          void ApiHelper.updateCache(cachedKey, formattedResults);
          response.status(ApiHelper.HTTP_OK).send(formattedResults);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCartographyByAllianceName', request);
      return;
    }
  }

  /**
   * Handles the HTTP request to retrieve cartography data for all players in a specific alliance by alliance ID.
   *
   * - Validates the provided alliance ID from the request parameters.
   * - Checks for cached results in Redis and returns them if available.
   * - Determines the appropriate country code and PostgreSQL pool for the alliance.
   * - Queries the database for player and alliance information, ordered by the number of castles.
   * - Formats and returns the results, updating the cache if necessary.
   * - Handles and responds to errors appropriately.
   *
   * @param request - The Express request object containing the alliance ID parameter.
   * @param response - The Express response object used to send the result or error.
   * @returns A Promise that resolves when the response has been sent.
   */
  public static async getCartographyByAllianceId(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const allianceId = ApiHelper.getVerifiedId(request.params.allianceId);
      if (allianceId === false || allianceId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid alliance id' });
        return;
      }

      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const cachedKey = '/carto/alliance-id/' + allianceId;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Check country code and get pg pool
       * --------------------------------- */
      const code = ApiHelper.getCountryCode(String(allianceId));
      const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(allianceId);
      if (!code || !pgPool) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid alliance id for this server' });
        return;
      }

      /* ---------------------------------
       * Query database
       * --------------------------------- */
      let parameterIndex = 1;
      const query = `
        SELECT
            P.name,
            P.castles,
            P.castles_realm,
            P.might_current,
            A.id AS alliance_id,
            A.name AS alliance_name
        FROM
            players P
        INNER JOIN
            alliances A ON P.alliance_id = A.id
        WHERE
            alliance_id = $${parameterIndex++}
        ORDER BY
            castles DESC;
        `;
      pgPool.query(query, [ApiHelper.removeCountryCode(allianceId)], (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          /* ---------------------------------
           * Format results
           * --------------------------------- */
          const formattedResults = results.rows.map((row: any) => {
            return {
              name: row.name,
              castles: row.castles,
              castles_realm: row.castles_realm,
              might_current: row.might_current,
              alliance_id: ApiHelper.addCountryCode(row.alliance_id, code),
              alliance_name: row.alliance_name,
            };
          });
          void ApiHelper.updateCache(cachedKey, formattedResults);
          response.status(ApiHelper.HTTP_OK).send(formattedResults);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCartographyByAllianceId', request);
      return;
    }
  }
}
