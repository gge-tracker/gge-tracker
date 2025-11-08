import { formatInTimeZone, toDate } from 'date-fns-tz';
import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';

/**
 * Abstract class providing API endpoints for retrieving update histories related to players and alliances.
 *
 * This class implements the `ApiHelper` interface and exposes static methods to handle Express.js requests
 * for fetching updates about player alliance changes, player name changes, and alliance membership changes.
 *
 * @implements {ApiHelper}
 * @abstract
 */
export abstract class ApiUpdates implements ApiHelper {
  /**
   * Handles the HTTP request to retrieve player alliance update records for a specific alliance.
   *
   * This endpoint fetches updates where players have either joined or left the specified alliance,
   * returning details such as player information, alliance IDs, and timestamps. Results are cached
   * for performance optimization.
   *
   * @param request - The Express request object, expects `allianceId` as a route parameter.
   * @param response - The Express response object used to send the result or error.
   * @returns A Promise that resolves to void. Responds with a JSON object containing an array of player updates,
   *          or an error message with the appropriate HTTP status code.
   *
   * @remarks
   * - Validates the provided alliance ID.
   * - Utilizes Redis for caching responses.
   * - Queries the database for player alliance updates.
   * - Formats the `created_at` timestamp according to the application timezone.
   * - Handles and reports errors appropriately.
   */
  public static async getPlayersUpdatesByAlliance(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Parameter validation
       * --------------------------------- */
      const allianceId = ApiHelper.verifyIdWithCountryCode(request.params.allianceId);
      if (allianceId === false || allianceId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(allianceId);
      const code = ApiHelper.getCountryCode(String(allianceId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.AllianceNotFound });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${request['language']}`)) || '1';
      const cachedKey = request['language'] + `:${cacheVersion}:` + `updates:alliances:${allianceId}:players`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query
       * --------------------------------- */
      const query = `
        SELECT
          P.id AS player_id,
          P.name AS player_name,
          P.might_current,
          P.loot_current,
          P.level,
          P.legendary_level,
          U.old_alliance_id,
          U.new_alliance_id,
          U.created_at
        FROM
          player_alliance_update U
        LEFT JOIN
          players P ON U.player_id = P.id
        WHERE
          U.new_alliance_id = $1
        OR
          U.old_alliance_id = $2
        ORDER BY
          U.created_at DESC;
      `;

      /* ---------------------------------
       * Execute SQL Query
       * --------------------------------- */
      pool.query(
        query,
        [ApiHelper.removeCountryCode(allianceId), ApiHelper.removeCountryCode(allianceId)],
        (error, results) => {
          if (error) {
            response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
          } else {
            /* ---------------------------------
             *  Process results
             * --------------------------------- */
            const updates = results.rows.map((result: any) => {
              return {
                player_id: ApiHelper.addCountryCode(result.player_id, code),
                player_name: result.player_name,
                might_current: result.might_current,
                loot_current: result.loot_current,
                level: result.level,
                legendary_level: result.legendary_level,
                old_alliance_id: result.old_alliance_id ? ApiHelper.addCountryCode(result.old_alliance_id, code) : null,
                new_alliance_id: result.new_alliance_id ? ApiHelper.addCountryCode(result.new_alliance_id, code) : null,
                created_at: formatInTimeZone(
                  result.created_at,
                  ApiHelper.APPLICATION_TIMEZONE,
                  'yyyy-MM-dd HH:mm' + ':00',
                ),
              };
            });

            /* ---------------------------------
             *  Cache update and response
             * --------------------------------- */
            void ApiHelper.updateCache(cachedKey, { updates });
            response.status(ApiHelper.HTTP_OK).send({ updates });
          }
        },
      );
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getPlayersUpdatesByAlliance', request);
      return;
    }
  }

  /**
   * Handles the retrieval of player name update history for a given player ID.
   *
   * This endpoint validates the request parameters, checks for cached data,
   * queries the database for name update history if necessary, formats the results,
   * updates the cache, and sends the response.
   *
   * @param request - The Express request object, expected to contain a `playerId` parameter and a `language` property.
   * @param response - The Express response object used to send the result or error.
   *
   * @remarks
   * - Returns cached data if available.
   * - Queries the `player_name_update_history` table for name changes, ordered by creation date.
   * - Formats the date to the application's timezone.
   * - Updates the cache with the latest results.
   * - Returns HTTP 500 on internal errors.
   */
  public static async getNamesUpdates(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate request parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${request['language']}`)) || '1';
      const cachedKey = request['language'] + `:${cacheVersion}:` + `updates:${playerId}:names`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build and execute SQL query
       * --------------------------------- */
      const query = `
        SELECT
          created_at,
          old_name,
          new_name
        FROM
          player_name_update_history
        WHERE
          player_id = $1
        ORDER BY
          created_at DESC;
      `;

      /* ---------------------------------
       * Execute SQL Query
       * --------------------------------- */
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      if (!pool) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      pool.query(query, [ApiHelper.removeCountryCode(playerId)], (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          /* ---------------------------------
           * Map results to updates
           * --------------------------------- */
          const updates = results.rows.map((result: any) => {
            const utcDate = toDate(result['created_at']);
            const localDate = formatInTimeZone(utcDate, ApiHelper.APPLICATION_TIMEZONE, 'yyyy-MM-dd HH:mm' + ':00');
            return {
              date: localDate,
              old_player_name: result.old_name,
              new_player_name: result.new_name,
            };
          });

          /* ---------------------------------
           * Cache update and response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, { updates });
          response.status(ApiHelper.HTTP_OK).send({ updates });
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getNamesUpdates', request);
      return;
    }
  }

  /**
   * Handles the HTTP request to retrieve a player's alliance update history.
   *
   * This endpoint fetches all alliance changes for a given player, including the previous and new alliance names and IDs,
   * along with the timestamp of each change. Results are cached for performance. If cached data is available, it is returned immediately.
   * Otherwise, the data is fetched from the database, formatted, cached, and then returned.
   *
   * @param request - Express request object, expects `playerId` as a route parameter and `language` and `code` properties.
   * @param response - Express response object used to send the result or error.
   *
   * @returns Sends a JSON response with an array of alliance update objects, each containing:
   *   - `date`: The date and time of the update in application timezone.
   *   - `old_alliance_name`: Name of the previous alliance.
   *   - `old_alliance_id`: ID of the previous alliance (with country code).
   *   - `new_alliance_name`: Name of the new alliance.
   *   - `new_alliance_id`: ID of the new alliance (with country code).
   *
   * @throws 400 Bad Request if the player ID is invalid or the server/player ID is not found.
   * @throws 500 Internal Server Error if a database or internal error occurs.
   */
  public static async getAlliancesUpdates(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate Player ID
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Check Cache
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${request['language']}`)) || '1';
      const cachedKey = request['language'] + `:${cacheVersion}:` + `updates:${playerId}:alliances`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build SQL Query
       * --------------------------------- */
      const query = `
        SELECT
          P.created_at,
          A1.name AS old_alliance_name,
          A1.id AS old_alliance_id,
          A2.name AS new_alliance_name,
          A2.id AS new_alliance_id
        FROM
          player_alliance_update P
        LEFT JOIN
          alliances A1 ON A1.id = P.old_alliance_id
        LEFT JOIN
          alliances A2 ON A2.id = P.new_alliance_id
        WHERE
          P.player_id = $1
        ORDER BY
          P.created_at DESC;
      `;

      /* ---------------------------------
       * Prepare and Execute SQL Query
       * --------------------------------- */
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      if (!pool) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      pool.query(query, [ApiHelper.removeCountryCode(playerId)], (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          /* ---------------------------------
           * Map results to updates
           * --------------------------------- */
          const updates = results.rows.map((result: any) => {
            const utcDate = toDate(result['created_at']);
            const localDate = formatInTimeZone(utcDate, ApiHelper.APPLICATION_TIMEZONE, 'yyyy-MM-dd HH:mm' + ':00');
            return {
              date: localDate,
              old_alliance_name: result.old_alliance_name,
              old_alliance_id: ApiHelper.addCountryCode(result.old_alliance_id, request['code']),
              new_alliance_name: result.new_alliance_name,
              new_alliance_id: ApiHelper.addCountryCode(result.new_alliance_id, request['code']),
            };
          });

          /* ---------------------------------
           * Cache update and response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, { updates });
          response.status(ApiHelper.HTTP_OK).send({ updates });
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getNamesUpdates', request);
      return;
    }
  }
}
