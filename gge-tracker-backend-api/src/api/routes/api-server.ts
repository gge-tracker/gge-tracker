import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { ApiInvalidInputType } from '../types/parameter.types';
import { QueryFilterBuilder } from '../helper/filters/impl/query-filter-builder';
import { parseQuery, querySchema } from '../helper/parse-query';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';

/**
 * Abstract class providing API endpoints for server-side data retrieval and operations
 *
 * @remarks
 * This class implements static methods to handle Express.js requests for various server-side resources,
 * including player movements, renames, and global statistics

 * @abstract
 */
export abstract class ApiServer implements ApiHelper {
  /**
   * Handles the retrieval of paginated player castle movement history with optional filtering and search capabilities
   *
   * This endpoint supports filtering by castle type, movement type, player name, alliance name, and alliance ID
   * It also supports pagination and caches responses for improved performance
   *
   * Query Parameters:
   * - `page` (string | number): The page number to retrieve (1-based). Must be a valid integer between 1 and 99,999,999
   * - `castleType` (string | number, optional): Filter by castle type. If not provided or invalid, no filter is applied
   * - `movementType` (string | number, optional): Filter by movement type (1 = "add", 2 = "remove", 3 = "move"). If not provided or invalid, no filter is applied
   * - `search` (string, optional): Search input for player or alliance name, depending on `searchType`
   * - `searchType` (string, optional): Type of search to perform. Must be either "player" or "alliance" if provided
   * - `allianceId` (string, optional): Filter by alliance ID
   *
   * Responses:
   * - `200 OK`: Returns a paginated list of movements and pagination metadata
   * - `400 Bad Request`: Returned if any query parameter is invalid
   * - `500 Internal Server Error`: Returned if a server or database error occurs
   *
   * Caching:
   * - Responses are cached based on query parameters and language for improved performance
   *
   * @param request - Express request object containing query parameters and context
   * @param response - Express response object used to send the result
   * @returns A Promise that resolves when the response is sent
   */
  public static async getMovements(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const {
        page,
        castleType,
        movementType,
        searchType,
        search,
        allianceId,
        minHonor,
        maxHonor,
        minMight,
        maxMight,
        minLoot,
        maxLoot,
        minLevel,
        maxLevel,
        minFame,
        maxFame,
        castleCountMin,
        castleCountMax,
        allianceFilter,
        protectionFilter,
        banFilter,
        inactiveFilter,
        allianceRankFilter,
      } = parseQuery(request.query, querySchema({ maxBigValue: ApiHelper.MAX_BIG_VALUE }));

      const viewPerPage = 10;

      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const cacheVersion = await ApiHelper.getCacheVersion(ApiHelper.redisClient, request['language']);
      const cacheKey = new CacheKeyBuilder(request['language'])
        .with(cacheVersion)
        .with('movements')
        .withParams({
          page,
          minHonor,
          maxHonor,
          minMight,
          maxMight,
          minLoot,
          maxLoot,
          minLevel: minLevel ? minLevel.join('/') : undefined,
          maxLevel: maxLevel ? maxLevel.join('/') : undefined,
          minFame,
          maxFame,
          castleCountMin,
          castleCountMax,
          allianceFilter,
          protectionFilter,
          banFilter,
          inactiveFilter,
          allianceRankFilter: Array.isArray(allianceRankFilter) ? allianceRankFilter.join('-') : undefined,
          castleType,
          movementType,
          searchType,
          search,
          allianceId,
        })
        .build();
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      /* ---------------------------------
       * Build query filters
       * --------------------------------- */
      const qb = new QueryFilterBuilder();

      qb.movement().castleType(castleType).movementType(movementType);

      qb.player()
        .name(search, searchType)
        .honor(minHonor, maxHonor)
        .might(minMight, maxMight)
        .loot(minLoot, maxLoot)
        .level(minLevel[0], maxLevel[0])
        .legendaryLevel(minLevel[1], maxLevel[1])
        .fame(minFame, maxFame)
        .activity(inactiveFilter);

      qb.castle().count(castleCountMin, castleCountMax);

      qb.alliance()
        .byIdOrName(allianceId, search, searchType)
        .presence(allianceFilter)
        .excludeRanks(allianceRankFilter);

      qb.protection().status(protectionFilter, banFilter).ban(banFilter);

      const { where, values } = qb.build();

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
      if (where.length > 0) {
        countQuery += ` ${where}`;
      }

      /* ---------------------------------
       * Execute count query
       * --------------------------------- */
      await new Promise((resolve, reject) => {
        (request['pg_pool'] as pg.Pool).query(countQuery, values, (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getMovements_countQuery', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
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
        void ApiHelper.updateCache(cacheKey, responseContent);
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
      if (where.length > 0) {
        query += ` ${where}`;
      }
      let parameterIndex = qb.getLastParameterIndex();
      query += ` ORDER BY M.created_at DESC LIMIT $${parameterIndex++} OFFSET $${parameterIndex++};`;

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
              created_at: new Date(result.created_at).toISOString(),
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
          void ApiHelper.updateCache(cacheKey, responseContent);
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
   * Handles the retrieval of player or alliance rename history with pagination, filtering, and caching
   *
   * This endpoint supports searching by player or alliance name, filtering by alliance ID, and toggling between player and alliance rename history
   * It validates query parameters, constructs dynamic SQL queries based on filters, and utilizes Redis caching for performance
   * The response includes paginated rename records and pagination metadata
   *
   * @param request - Express request object, expects the following query parameters:
   *   - `page` (string | number): The page number for pagination (required, must be >= 1)
   *   - `search` (string, optional): Search input for player or alliance name
   *   - `searchType` (string, optional): Type of search, either "player" or "alliance"
   *   - `allianceId` (string, optional): Filter by alliance ID
   *   - `showType` (string, optional): "players" or "alliances" to toggle between player or alliance rename history (default: "players")
   * @param response - Express response object used to send the result or error
   *
   * @returns {Promise<void>} Sends a JSON response with the following structure:
   *   - `renames`: Array of rename records (fields depend on showType)
   *   - `pagination`: Object containing `current_page`, `total_pages`, `current_items_count`, and `total_items_count`
   *
   * @throws 400 Bad Request if query parameters are invalid
   * @throws 500 Internal Server Error if a database or server error occurs
   */
  public static async getRenames(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const page = ApiHelper.validatePageNumber(request.query.page);
      const viewPerPage = 15;
      const allianceId = ApiHelper.verifyIdWithCountryCode(request.query.allianceId);
      const searchInput = ApiHelper.validateSearchAndSanitize(request.query.search);
      const searchType = ApiHelper.getParsedString(request.query.searchType);
      const showType = ApiHelper.getParsedString(request.query.showType, 'players');
      if (searchType !== 'player' && searchType !== 'alliance' && searchType !== null) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      } else if (showType !== 'players' && showType !== 'alliances') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      } else if (searchInput === ApiInvalidInputType) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      } else if (request.query.allianceId && !allianceId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }
      const searchInputHash = request.query.search ? ApiHelper.hashValue(String(request.query.search)) : 'no_search';
      const searchTypeHash = request.query.searchType
        ? ApiHelper.hashValue(String(request.query.searchType))
        : 'no_search';
      let mainTableName: string;
      mainTableName = showType === 'players' ? 'player_name_update_history' : 'alliance_update_history';

      /* ---------------------------------
       * Build cache key
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${request['language']}`)) || '1';
      const cachedKey =
        request['language'] +
        `:${cacheVersion}:` +
        `server-renames-page-${page}-search-${searchInputHash}-type-${searchTypeHash}-showType-${showType}-allianceId-${allianceId}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query filters
       * --------------------------------- */
      let parameterIndex = 1;
      const conditions: string[] = [];
      const values: any[] = [];
      if (searchType && searchType === 'player' && ApiHelper.isValidInput(searchInput) && showType === 'players') {
        conditions.push(`LOWER(R.old_name) = $${parameterIndex++} OR LOWER(R.new_name) = $${parameterIndex++}`);
        values.push(searchInput, searchInput);
      }
      if (searchType && searchType === 'alliance' && ApiHelper.isValidInput(searchInput)) {
        if (showType === 'players') {
          conditions.push(`LOWER(A.name) = $${parameterIndex++}`);
          values.push(searchInput);
        } else {
          conditions.push(`LOWER(R.old_name) = $${parameterIndex++} OR LOWER(R.new_name) = $${parameterIndex++}`);
          values.push(searchInput, searchInput);
        }
      }
      if (allianceId) {
        if (showType === 'players') {
          conditions.push(`A.id = $${parameterIndex++}`);
          values.push(ApiHelper.removeCountryCode(Number(allianceId)));
        } else {
          conditions.push(`R.alliance_id = $${parameterIndex++}`);
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
            ApiHelper.logError(error, 'getRenames_countQuery', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
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
      query =
        showType === 'players'
          ? `
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
        `
          : `
          SELECT
            R.created_at,
            R.old_name,
            R.new_name
          FROM
            alliance_update_history R
        `;
      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }
      query += ` ORDER BY R.created_at DESC LIMIT $${parameterIndex++} OFFSET $${parameterIndex++};`;

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
              date: new Date(result.created_at).toISOString(),
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
   * Handles the retrieval of global server statistics
   *
   * This method attempts to fetch cached statistics data based on the request's language
   * If the data is not cached, it queries the `server_statistics` table from the database,
   * processes and formats the results, updates the cache, and sends the response
   *
   * The statistics include various aggregated metrics such as average might, loot, honor,
   * player and alliance counts, event participation rates, and top event performers
   * Some fields are parsed from stringified JSON objects stored in the database
   *
   * @param request - The Express request object, expected to have `language` and `pg_pool` properties
   * @param response - The Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   *
   * @throws Sends HTTP 500 with an error message if the database query fails or an unexpected error occurs
   */
  public static async getStatistics(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Check cache
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${request['language']}`)) || '1';
      const cachedKey = request['language'] + `:${cacheVersion}:` + 'server-global-statistics';
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
        WHERE
          created_at >= NOW() - INTERVAL '7 DAY'
        `;
      (request['pg_pool'] as pg.Pool).query(query, async (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
          return;
        } else {
          /* ---------------------------------
           * Process results
           * --------------------------------- */
          const prepareResponse = results.rows.map((result: any) => {
            const rate = result.events_participation_rate
              ? result.events_participation_rate
                  .replaceAll(/([,{])(\s*)(\w+)(\s*):/g, '$1"$3":')
                  .replaceAll(/(\w+):/g, '"$1":')
                  .replaceAll(/(\d+):/g, '"$1":')
              : '{}';
            const eventsTop3Names = result.events_top_3_names
              ? result.events_top_3_names
                  .replaceAll(/([,{])(\s*)(\w+)(\s*):/g, '$1"$3":')
                  .replaceAll(/(\w+):/g, '"$1":')
                  .replaceAll(/(\d+):/g, '"$1":')
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
              created_at: new Date(result.created_at).toISOString(),
            };
          });

          /* ---------------------------------
           * Cache update and response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, prepareResponse);
          response.status(ApiHelper.HTTP_OK).send(prepareResponse);
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
