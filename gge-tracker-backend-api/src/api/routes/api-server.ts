import * as express from 'express';
import { ApiHelper } from '../api-helper';
import * as pg from 'pg';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Abstract class providing API endpoints for server-side data retrieval and operations.
 *
 * @remarks
 * This class implements static methods to handle Express.js requests for various server-side resources,
 * including player movements, renames, and global statistics.

 * @abstract
 */
export abstract class ApiServer implements ApiHelper {
  /**
   * Handles the retrieval of paginated player castle movement history with optional filtering and search capabilities.
   *
   * This endpoint supports filtering by castle type, movement type, player name, alliance name, and alliance ID.
   * It also supports pagination and caches responses for improved performance.
   *
   * Query Parameters:
   * - `page` (string | number): The page number to retrieve (1-based). Must be a valid integer between 1 and 99,999,999.
   * - `castleType` (string | number, optional): Filter by castle type. If not provided or invalid, no filter is applied.
   * - `movementType` (string | number, optional): Filter by movement type (1 = "add", 2 = "remove", 3 = "move"). If not provided or invalid, no filter is applied.
   * - `search` (string, optional): Search input for player or alliance name, depending on `searchType`.
   * - `searchType` (string, optional): Type of search to perform. Must be either "player" or "alliance" if provided.
   * - `allianceId` (string, optional): Filter by alliance ID.
   *
   * Responses:
   * - `200 OK`: Returns a paginated list of movements and pagination metadata.
   * - `400 Bad Request`: Returned if any query parameter is invalid.
   * - `500 Internal Server Error`: Returned if a server or database error occurs.
   *
   * Caching:
   * - Responses are cached based on query parameters and language for improved performance.
   *
   * @param request - Express request object containing query parameters and context.
   * @param response - Express response object used to send the result.
   * @returns A Promise that resolves when the response is sent.
   */
  public static async getMovements(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const page = Number.parseInt(request.query.page as string);
      if (Number.isNaN(page) || page < 1 || page > ApiHelper.MAX_RESULT_PAGE) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid page number' });
        return;
      }
      const filterByCastleType = Number.isNaN(parseInt(request.query.castleType as string))
        ? -1
        : Number.parseInt(request.query.castleType as string);
      const filterByMovementType = Number.isNaN(parseInt(request.query.movementType as string))
        ? -1
        : Number.parseInt(request.query.movementType as string);
      const searchInputHash = request.query.search ? ApiHelper.hashValue(request.query.search as string) : 'no_search';
      const searchTypeHash = request.query.searchType
        ? ApiHelper.hashValue(request.query.searchType as string)
        : 'no_search';
      const viewPerPage = 10;
      const searchInput = request.query.search ? (request.query.search as string) : null;
      const searchType = request.query.searchType ? (request.query.searchType as string) : null;
      const allianceId = request.query.allianceId ? (request.query.allianceId as string) : null;
      const allianceIdHash = allianceId ? ApiHelper.hashValue(allianceId) : 'no_search';
      if (filterByMovementType !== -1 && (filterByMovementType < 1 || filterByMovementType > 3)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid movement type' });
        return;
      } else if (searchType !== 'player' && searchType !== 'alliance' && searchType !== null) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid search type' });
        return;
      } else if (searchInput && searchInput.length > 30) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid search input' });
        return;
      }

      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(request['language'] + '-server-movements')) || '1';
      const cachedKey =
        request['language'] +
        `-${cacheVersion}-server-movements-page-${page}-search-${searchInputHash}-type-${searchTypeHash}-castleType-${filterByCastleType}-movementType-${filterByMovementType}-allianceId-${allianceIdHash}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query filters
       * --------------------------------- */
      let paramIndex = 1;
      const conditions: string[] = [];
      const values: any[] = [];
      if (filterByCastleType !== -1) {
        conditions.push(`M.castle_type = $${paramIndex++}`);
        values.push(filterByCastleType);
      }
      if (filterByMovementType !== -1) {
        conditions.push(`M.movement_type = $${paramIndex++}`);
        const val = filterByMovementType === 1 ? 'add' : filterByMovementType === 2 ? 'remove' : 'move';
        values.push(val);
      }
      if (searchType && searchType === 'player' && searchInput) {
        conditions.push(`P.name = $${paramIndex++}`);
        values.push(searchInput);
      }
      if (allianceId) {
        conditions.push(`A.id = $${paramIndex++}`);
        values.push(ApiHelper.removeCountryCode(Number(allianceId)));
      } else if (searchType && searchType === 'alliance' && searchInput) {
        conditions.push(`A.name = $${paramIndex++}`);
        values.push(searchInput);
      }

      /* ---------------------------------
       * Get movements count for pagination
       * --------------------------------- */
      let movementsCount = 0;
      let countQuery = `
        SELECT
          COUNT(*) AS movements_count
        FROM
          player_castle_movements_history M
        LEFT JOIN
          players P ON M.player_id = P.id
        LEFT JOIN
          alliances A ON P.alliance_id = A.id
        `;
      if (conditions.length > 0) {
        countQuery += ` WHERE ` + conditions.join(' AND ');
      }

      /* ---------------------------------
       * Execute count query
       * --------------------------------- */
      await new Promise((resolve, reject) => {
        (request['pg_pool'] as pg.Pool).query(countQuery, values, (error, results) => {
          if (error) {
            reject(error);
          } else {
            movementsCount = results.rows[0]['movements_count'];
            resolve(null);
          }
        });
      });
      const totalPages = Math.ceil(movementsCount / viewPerPage);
      if (page > totalPages) {
        const responseContent = {
          movements: [],
          pagination: {
            current_page: page,
            total_pages: totalPages,
            current_items_count: 0,
            total_items_count: movementsCount,
          },
        };
        void ApiHelper.updateCache(cachedKey, responseContent);
        response.status(ApiHelper.HTTP_OK).send(responseContent);
        return;
      }
      values.push(viewPerPage, (page - 1) * viewPerPage);

      /* ---------------------------------
       * Build main query
       * --------------------------------- */
      let query = `
        SELECT
          P.name AS player_name,
          P.might_current AS player_might,
          P.level AS player_level,
          P.legendary_level AS player_legendary_level,
          A.name AS alliance_name,
          M.movement_type,
          M.castle_type,
          M.position_x_old,
          M.position_y_old,
          M.position_x_new,
          M.position_y_new,
          M.created_at
        FROM
          player_castle_movements_history M
        LEFT JOIN
          players P ON M.player_id = P.id
        LEFT JOIN
          alliances A ON P.alliance_id = A.id
        `;
      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }
      query += ` ORDER BY M.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++};`;

      /* ---------------------------------
       * Execute main query
       * --------------------------------- */
      (request['pg_pool'] as pg.Pool).query(query, values, (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          /* ---------------------------------
           * Process results
           * --------------------------------- */
          const movements = results.rows.map((result: any) => {
            return {
              player_name: result.player_name,
              player_might: result.player_might,
              player_level: result.player_level,
              player_legendary_level: result.player_legendary_level,
              alliance_name: result.alliance_name,
              movement_type: result.movement_type,
              castle_type: result.castle_type,
              position_x_old: result.position_x_old,
              position_y_old: result.position_y_old,
              position_x_new: result.position_x_new,
              position_y_new: result.position_y_new,
              created_at: formatInTimeZone(
                result.created_at,
                ApiHelper.APPLICATION_TIMEZONE,
                'yyyy-MM-dd HH:mm' + ':00',
              ),
            };
          });
          const responseContent = {
            movements,
            pagination: {
              current_page: page,
              total_pages: totalPages,
              current_items_count: movements.length,
              total_items_count: movementsCount,
            },
          };
          /* ---------------------------------
           * Cache response and send to client
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, responseContent);
          response.status(ApiHelper.HTTP_OK).send(responseContent);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getMovements', request);
      return;
    }
  }

  /**
   * Handles the retrieval of player or alliance rename history with pagination, filtering, and caching.
   *
   * This endpoint supports searching by player or alliance name, filtering by alliance ID, and toggling between player and alliance rename history.
   * It validates query parameters, constructs dynamic SQL queries based on filters, and utilizes Redis caching for performance.
   * The response includes paginated rename records and pagination metadata.
   *
   * @param request - Express request object, expects the following query parameters:
   *   - `page` (string | number): The page number for pagination (required, must be >= 1).
   *   - `search` (string, optional): Search input for player or alliance name.
   *   - `searchType` (string, optional): Type of search, either "player" or "alliance".
   *   - `allianceId` (string, optional): Filter by alliance ID.
   *   - `showType` (string, optional): "players" or "alliances" to toggle between player or alliance rename history (default: "players").
   * @param response - Express response object used to send the result or error.
   *
   * @returns {Promise<void>} Sends a JSON response with the following structure:
   *   - `renames`: Array of rename records (fields depend on showType).
   *   - `pagination`: Object containing `current_page`, `total_pages`, `current_items_count`, and `total_items_count`.
   *
   * @throws 400 Bad Request if query parameters are invalid.
   * @throws 500 Internal Server Error if a database or server error occurs.
   */
  public static async getRenames(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const page = Number.parseInt(request.query.page as string);
      if (Number.isNaN(page) || page < 1 || page > ApiHelper.MAX_RESULT_PAGE) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid page number' });
        return;
      }
      const searchInputHash = request.query.search ? ApiHelper.hashValue(request.query.search as string) : 'no_search';
      const searchTypeHash = request.query.searchType
        ? ApiHelper.hashValue(request.query.searchType as string)
        : 'no_search';
      const allianceId = request.query.allianceId ? (request.query.allianceId as string) : null;
      const viewPerPage = 15;
      const searchInput = ApiHelper.verifySearch(request.query.search ? (request.query.search as string) : null);
      const searchType = request.query.searchType ? (request.query.searchType as string) : null;
      if (searchType !== 'player' && searchType !== 'alliance' && searchType !== null) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid search type' });
        return;
      } else if (searchInput && searchInput.length > 30) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid search input' });
        return;
      }
      if (allianceId && allianceId.length > 20) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid alliance ID' });
        return;
      }
      const showType = request.query.showType ? (request.query.showType as string) : 'players';
      if (showType !== 'players' && showType !== 'alliances') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid show type' });
        return;
      }
      let mainTableName: string;
      if (showType === 'players') {
        mainTableName = 'player_name_update_history';
      } else {
        mainTableName = 'alliance_update_history';
      }

      /* ---------------------------------
       * Build cache key
       * --------------------------------- */
      const cachedKey =
        request['language'] +
        `server-renames-page-${page}-search-${searchInputHash}-type-${searchTypeHash}-showType-${showType}-allianceId-${allianceId}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query filters
       * --------------------------------- */
      let paramIndex = 1;
      const conditions: string[] = [];
      const values: any[] = [];
      if (searchType && searchType === 'player' && searchInput) {
        if (showType === 'players') {
          conditions.push(`LOWER(R.old_name) = $${paramIndex++} OR LOWER(R.new_name) = $${paramIndex++}`);
          values.push(searchInput.trim().toLowerCase());
          values.push(searchInput.trim().toLowerCase());
        }
      }
      if (searchType && searchType === 'alliance' && searchInput) {
        if (showType === 'players') {
          conditions.push(`LOWER(A.name) = $${paramIndex++}`);
          values.push(searchInput.trim().toLowerCase());
        } else {
          conditions.push(`LOWER(R.old_name) = $${paramIndex++} OR LOWER(R.new_name) = $${paramIndex++}`);
          values.push(searchInput.trim().toLowerCase());
          values.push(searchInput.trim().toLowerCase());
        }
      }
      if (allianceId) {
        if (showType === 'players') {
          conditions.push(`A.id = $${paramIndex++}`);
          values.push(ApiHelper.removeCountryCode(Number(allianceId)));
        } else {
          conditions.push(`R.alliance_id = $${paramIndex++}`);
          values.push(ApiHelper.removeCountryCode(Number(allianceId)));
        }
      }

      /* ---------------------------------
       * Build main query
       * --------------------------------- */
      let renamesCount: number | string = 0;
      let countQuery = `
        SELECT
          COUNT(*) AS renames_count
        FROM
          ${mainTableName} R
        `;
      if (showType === 'players') {
        countQuery += `
          LEFT JOIN
            players P ON R.player_id = P.id
          LEFT JOIN
            alliances A ON P.alliance_id = A.id
        `;
      }
      if (conditions.length > 0) {
        countQuery += ` WHERE ` + conditions.join(' AND ');
      }

      /* ---------------------------------
       * Execute count query
       * --------------------------------- */
      await new Promise((resolve, reject) => {
        (request['pg_pool'] as pg.Pool).query(countQuery, values, (error, results) => {
          if (error) {
            reject(error);
          } else {
            renamesCount = Number.parseInt(results.rows[0]['renames_count']);
            resolve(null);
          }
        });
      });
      values.push(viewPerPage, (page - 1) * viewPerPage);
      const totalPages = Math.ceil(renamesCount / viewPerPage);
      if (page > totalPages) {
        const responseContent = {
          renames: [],
          pagination: {
            current_page: page,
            total_pages: totalPages,
            current_items_count: 0,
            total_items_count: renamesCount,
          },
        };
        void ApiHelper.updateCache(cachedKey, responseContent);
        response.status(ApiHelper.HTTP_OK).send(responseContent);
        return;
      }

      /* ---------------------------------
       * Execute main query
       * --------------------------------- */
      let query = '';
      if (showType === 'players') {
        query = `
          SELECT
            R.created_at,
            P.name AS player_name,
            A.name AS alliance_name,
            P.might_current AS player_might,
            R.old_name,
            R.new_name
          FROM
            player_name_update_history R
          LEFT JOIN
            players P ON R.player_id = P.id
          LEFT JOIN
            alliances A ON P.alliance_id = A.id
        `;
      } else {
        query = `
          SELECT
            R.created_at,
            R.old_name,
            R.new_name
          FROM
            alliance_update_history R
        `;
      }
      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }
      query += ` ORDER BY R.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++};`;

      /* ---------------------------------
       * Execute query
       * --------------------------------- */
      (request['pg_pool'] as pg.Pool).query(query, values, (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
          /* ---------------------------------
           * Process results
           * --------------------------------- */
          const renames = results.rows.map((result: any) => {
            return {
              date: formatInTimeZone(result.created_at, ApiHelper.APPLICATION_TIMEZONE, 'yyyy-MM-dd HH:mm' + ':00'),
              player_name: result.player_name,
              player_might: result.player_might,
              alliance_name: result.alliance_name,
              old_player_name: result.old_name,
              new_player_name: result.new_name,
            };
          });
          const responseContent = {
            renames,
            pagination: {
              current_page: page,
              total_pages: totalPages,
              current_items_count: renames.length,
              total_items_count: renamesCount,
            },
          };

          /* ---------------------------------
           * Cache update and response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, responseContent);
          response.status(ApiHelper.HTTP_OK).send(responseContent);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getRenames', request);
      return;
    }
  }

  /**
   * Handles the retrieval of global server statistics.
   *
   * This method attempts to fetch cached statistics data based on the request's language.
   * If the data is not cached, it queries the `server_statistics` table from the database,
   * processes and formats the results, updates the cache, and sends the response.
   *
   * The statistics include various aggregated metrics such as average might, loot, honor,
   * player and alliance counts, event participation rates, and top event performers.
   * Some fields are parsed from stringified JSON objects stored in the database.
   *
   * @param request - The Express request object, expected to have `language` and `pg_pool` properties.
   * @param response - The Express response object used to send the result or error.
   * @returns A promise that resolves when the response is sent.
   *
   * @throws Sends HTTP 500 with an error message if the database query fails or an unexpected error occurs.
   */
  public static async getStatistics(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const cachedKey = request['language'] + 'server-global-statistics';
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Execute query
       * --------------------------------- */
      const query = `
        SELECT
          *
        FROM
          server_statistics
        `;
      (request['pg_pool'] as pg.Pool).query(query, async (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
          return;
        } else {
          /* ---------------------------------
           * Process results
           * --------------------------------- */
          const res = results.rows.map((result: any) => {
            const rate = result.events_participation_rate
              ? result.events_participation_rate
                  .replace(/([{,])(\s*)(\w+)(\s*):/g, '$1"$3":')
                  .replace(/(\w+):/g, '"$1":')
                  .replace(/(\d+):/g, '"$1":')
              : '{}';
            const eventsTop3Names = result.events_top_3_names
              ? result.events_top_3_names
                  .replace(/([{,])(\s*)(\w+)(\s*):/g, '$1"$3":')
                  .replace(/(\w+):/g, '"$1":')
                  .replace(/(\d+):/g, '"$1":')
              : '{}';

            return {
              id: Number(result.id),
              avg_might: result.avg_might,
              avg_loot: result.avg_loot,
              avg_honor: result.avg_honor,
              avg_level: result.avg_level,
              max_might: Number(result.max_might),
              max_might_player_id: Number(result.max_might_player_id),
              max_loot_player_id: Number(result.max_loot_player_id),
              max_loot: Number(result.max_loot),
              players_count: Number(result.players_count),
              alliance_count: Number(result.alliance_count),
              players_in_peace: Number(result.players_in_peace),
              players_who_changed_alliance: Number(result.players_who_changed_alliance),
              players_who_changed_name: Number(result.players_who_changed_name),
              total_might: Number(result.total_might),
              total_loot: Number(result.total_loot),
              total_honor: Number(result.total_honor),
              variation_might: Number(result.variation_might),
              variation_loot: Number(result.variation_loot),
              variation_honor: Number(result.variation_honor),
              alliances_changed_name: Number(result.alliances_changed_name),
              events_count: Number(result.events_count),
              events_top_3_names: eventsTop3Names ? JSON.parse(eventsTop3Names) : {},
              events_participation_rate: rate ? JSON.parse(rate) : {},
              event_nomad_points: Number(result.event_nomad_points),
              event_war_realms_points: Number(result.event_war_realms_points),
              event_bloodcrow_points: Number(result.event_bloodcrow_points),
              event_samurai_points: Number(result.event_samurai_points),
              event_berimond_invasion_points: result.event_berimond_invasion_points
                ? Number(result.event_berimond_invasion_points)
                : null,
              event_berimond_kingdom_points: Number(result.event_berimond_kingdom_points),
              event_nomad_players: Number(result.event_nomad_players),
              event_berimond_invasion_players: result.event_berimond_invasion_players
                ? Number(result.event_berimond_invasion_players)
                : null,
              event_berimond_kingdom_players: Number(result.event_berimond_kingdom_players),
              event_bloodcrow_players: Number(result.event_bloodcrow_players),
              event_samurai_players: Number(result.event_samurai_players),
              event_war_realms_players: Number(result.event_war_realms_players),
              created_at: formatInTimeZone(
                result.created_at,
                ApiHelper.APPLICATION_TIMEZONE,
                'yyyy-MM-dd HH:mm' + ':00',
              ),
            };
          });

          /* ---------------------------------
           * Cache update and response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, res);
          response.status(ApiHelper.HTTP_OK).send(res);
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStatistics', request);
      return;
    }
  }
}
