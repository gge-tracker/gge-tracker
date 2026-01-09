import { formatInTimeZone, toDate } from 'date-fns-tz';
import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { NodeClickHouseClient } from '@clickhouse/client/dist/client';

/**
 * Abstract class providing API endpoints and helper methods for retrieving and processing
 * player and alliance statistics in the Empire Rankings backend
 *
 * This class exposes static methods to handle Express.js requests for various statistics,
 * including:
 * - Retrieving statistics by alliance ID or player ID
 * - Fetching statistics for a player filtered by event name and duration
 * - Getting pulsed (aggregated) statistics for an alliance
 * - Fetching ranking information for a player
 *
 * All methods are designed to be used as Express route handlers and include error handling,
 * input validation, and caching logic
 *
 * @implements {ApiHelper}
 * @abstract
 */
export abstract class ApiStatistics implements ApiHelper {
  /**
   * Handles the HTTP request to retrieve statistics for a specific alliance by its ID
   *
   * This method performs the following steps:
   * 1. Validates the provided alliance ID from the request parameters
   * 2. Checks if the statistics data for the alliance is available in the Redis cache
   *    - If cached data is found, it is returned immediately
   * 3. If not cached, fetches the statistics from the database using `getPlayersEventsStatisticsFromAllianceId`
   *    - The result includes `diffs` and `points` objects
   *    - The fetched data is then cached for future requests
   * 4. Handles and logs any errors that occur during the process, returning appropriate HTTP error responses
   *
   * @param request - The Express request object, expected to contain `allianceId` in the route parameters
   * @param response - The Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getStatisticsByAllianceId(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const allianceId = ApiHelper.verifyIdWithCountryCode(request.params.allianceId);
      if (allianceId === false || allianceId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cachedKey = `statistics:alliances:${allianceId}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Database query
       * --------------------------------- */
      try {
        const { diffs, points } = await this.getPlayersEventsStatisticsFromAllianceId(allianceId);
        const data = { diffs, points };
        void ApiHelper.updateCache(cachedKey, data);
        response.status(ApiHelper.HTTP_OK).send(data);
      } catch (error) {
        console.error('Error executing queries:', error);
        response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
      }
    } catch (error) {
      console.error('Error executing query:', error);
      response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
    }
  }

  /**
   * Handles the HTTP request to retrieve statistics for a specific player by their ID
   *
   * This method performs the following steps:
   * 1. Validates the provided player ID from the request parameters
   * 2. Checks for cached statistics data in Redis and returns it if available
   * 3. Queries the database to fetch the player's name and alliance information
   * 4. If the player is found, retrieves event statistics and points for the player
   * 5. Updates the cache with the latest statistics data
   * 6. Sends the statistics data as a JSON response to the client
   *
   * Returns appropriate HTTP status codes and error messages for invalid input,
   * missing players, or internal errors
   *
   * @param request - The Express request object containing the player ID parameter
   * @param response - The Express response object used to send the result or error
   * @returns A Promise that resolves when the response is sent
   */
  public static async getStatisticsByPlayerId(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cacheKey = `statistics:players:${playerId}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Build query
       * --------------------------------- */
      let parameterIndex = 1;
      const query = `
        SELECT
            players.name AS player_name,
            alliances.name AS alliance_name,
            alliances.id AS alliance_id
        FROM players LEFT JOIN alliances
        ON players.alliance_id = alliances.id
        WHERE players.id = $${parameterIndex++} `;
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      const code = ApiHelper.getCountryCode(String(playerId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Execute database query
       * --------------------------------- */
      const data: any = await new Promise((resolve, reject) => {
        pool.query(query, [ApiHelper.removeCountryCode(playerId)], (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getStatisticsByPlayerId_query', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows[0]);
          }
        });
      });
      const playerName = data?.player_name;
      const allianceName = data?.alliance_name;
      const allianceId = ApiHelper.addCountryCode(data?.alliance_id, code);
      if (!playerName) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }

      try {
        let basicTables = ApiHelper.ggeTrackerManager.getOlapEventTables();
        const olapDatabaseName = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(Number(playerId));
        const { diffs, points } = await this.getPlayerEventStatistics(
          playerId,
          olapDatabaseName,
          undefined,
          basicTables,
        );
        const data = { diffs, player_name: playerName, alliance_name: allianceName, alliance_id: allianceId, points };
        void ApiHelper.updateCache(cacheKey, data);
        response.status(ApiHelper.HTTP_OK).send(data);
        return;
      } catch (error) {
        response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
        return;
      }
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStatisticsByPlayerId', request);
      return;
    }
  }

  /**
   * Handles an HTTP request to retrieve player statistics for a specific event and duration
   *
   * This endpoint validates the player ID, event name, and duration parameters from the request,
   * checks for cached results, and queries the database for player and alliance information
   * If the player exists, it fetches event statistics and returns them to the client,
   * updating the cache as necessary
   *
   * @param request - The Express request object, expected to contain `playerId`, `eventName`, and `duration` as route parameters
   * @param response - The Express response object used to send the result or error
   * @returns A Promise that resolves when the response has been sent
   *
   * @remarks
   * - Returns HTTP 400 for invalid parameters
   * - Returns HTTP 404 if the player is not found
   * - Returns HTTP 200 with the statistics data on success
   * - Returns HTTP 500 for internal server errors
   */
  public static async getStatisticsByPlayerIdAndEventNameAndDuration(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Player ID validation
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const eventName = request.params.eventName;
      if (!ApiHelper.ggeTrackerManager.getOlapEventTables().includes(eventName)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventName });
        return;
      }
      const duration = Number.parseInt(request.params.duration);
      if (Number.isNaN(duration) || duration < 0 || duration > 365) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidDuration });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cacheKey = `statistics:players:${playerId}:${eventName}:${duration}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      let parameterIndex = 1;

      /* ---------------------------------
       * Build query
       * --------------------------------- */
      const query = `
        SELECT
          players.name AS player_name,
          alliances.name AS alliance_name,
          alliances.id AS alliance_id
        FROM players LEFT JOIN alliances
        ON players.alliance_id = alliances.id
        WHERE players.id = $${parameterIndex++} `;
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      const code = ApiHelper.getCountryCode(String(playerId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Execute database query
       * --------------------------------- */
      const data: any = await new Promise((resolve, reject) => {
        pool.query(query, [ApiHelper.removeCountryCode(playerId)], (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getStatisticsByPlayerIdAndEventNameAndDuration_query', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows[0]);
          }
        });
      });
      const playerName = data?.player_name;
      const allianceName = data?.alliance_name;
      const allianceId = ApiHelper.addCountryCode(data?.alliance_id, code);
      if (playerName === undefined || playerName === null) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }
      try {
        const olapDatabaseName = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(Number(playerId));
        const { diffs, points } = await this.getPlayerEventStatistics(playerId, olapDatabaseName, duration, eventName);
        const data = { diffs, player_name: playerName, alliance_name: allianceName, alliance_id: allianceId, points };
        void ApiHelper.updateCache(cacheKey, data);
        response.status(ApiHelper.HTTP_OK).send(data);
      } catch (error) {
        const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
        response.status(code).send({ error: message });
        ApiHelper.logError(error, 'getStatisticsByPlayerIdAndEventNameAndDuration', request);
        return;
      }
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStatisticsByPlayerIdAndEventNameAndDuration', request);
      return;
    }
  }

  /**
   * Handles the HTTP request to retrieve pulsed statistics for a specific alliance by its ID
   *
   * This method performs the following steps:
   * 1. Validates the provided alliance ID from the request parameters
   * 2. Checks for cached statistics data in Redis using a generated cache key
   * 3. If cached data exists, returns it immediately
   * 4. If not cached, retrieves the appropriate PostgreSQL pool and country code for the alliance
   * 5. Fetches the alliance's pulse data from the database
   * 6. Updates the cache with the newly fetched data
   * 7. Sends the statistics data as the HTTP response
   * 8. Handles and logs any errors, returning an appropriate HTTP error response
   *
   * @param request - The Express request object containing the alliance ID parameter
   * @param response - The Express response object used to send the result or error
   * @returns A Promise that resolves when the response is sent
   */
  public static async getPulsedStatisticsByAllianceId(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Parameter validation
       * --------------------------------- */
      const allianceId = ApiHelper.verifyIdWithCountryCode(request.params.allianceId);
      if (allianceId === false || allianceId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cacheKey = `statistics:alliances:${allianceId}:pulse`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        // response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        // return;
      }

      /* ---------------------------------
       * Database connection
       * --------------------------------- */
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(allianceId);
      const code = ApiHelper.getCountryCode(String(allianceId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }

      /* ---------------------------------
       * Retrieve data
       * --------------------------------- */
      const data = await this.getAlliancePulseData(
        allianceId,
        pool,
        ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(allianceId),
        code,
      );

      /* ---------------------------------
       * Cache update and response
       * --------------------------------- */
      void ApiHelper.updateCache(cacheKey, data);
      response.status(ApiHelper.HTTP_OK).send(data);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getPulsedStatisticsByAllianceId', request);
      return;
    }
  }

  /**
   * Handles the HTTP request to retrieve ranking statistics for a player by their ID
   *
   * This endpoint performs the following steps:
   * 1. Validates the provided player ID
   * 2. Checks for cached ranking data in Redis and returns it if available
   * 3. Determines the server and country code associated with the player ID
   * 4. Executes SQL queries to fetch the player's server-specific and global ranking data
   * 5. Combines and formats the retrieved data, updates the cache, and sends the response
   *
   * @param request - Express request object containing the player ID in `request.params.playerId`
   * @param response - Express response object used to send the result or error
   * @returns Sends a JSON response with the player's ranking data or an error message
   *
   * @remarks
   * - Returns HTTP 200 with player ranking data on success
   * - Returns HTTP 400 if the player ID or server is invalid
   * - Returns HTTP 404 if the player is not found
   * - Returns HTTP 500 if an internal server error occurs
   */
  public static async getRankingByPlayerId(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Parameter validation
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const cacheKey = `statistics:ranking:players:${playerId}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      let parameterIndex = 1;

      /* ---------------------------------
       * Server and country code extraction
       * --------------------------------- */
      const server = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(playerId);
      const code = ApiHelper.getCountryCode(String(playerId));
      if (!server || !code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * SQL queries
       * --------------------------------- */
      const query_internal_rank = `
        SELECT
          players.id AS player_id,
          players.might_current,
          players.might_all_time,
          players.current_fame,
          players.highest_fame,
          players.peace_disabled_at,
          players.loot_current,
          players.loot_all_time,
          players.level,
          players.legendary_level,
          players.honor,
          players.max_honor,
          players.castles,
          players.castles_realm,
          players.player_rank
        FROM (
          SELECT
          players.*,
          RANK() OVER (ORDER BY players.might_current DESC) AS player_rank
          FROM players
        ) AS players
        LEFT JOIN alliances ON players.alliance_id = alliances.id
        WHERE players.id = $${parameterIndex++}
        LIMIT 1;
      `;
      const query_global_rank = `
        SELECT
          global_rank
        FROM global_ranking
        WHERE id = $1
        AND region = $2
        LIMIT 1;
      `;

      /* ---------------------------------
       * Execute queries
       * --------------------------------- */
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      const globalPool = ApiHelper.ggeTrackerManager.getGlobalPgSqlPool();
      if (!pool || !globalPool) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const p1 = new Promise((resolve, reject) => {
        pool.query(query_internal_rank, [ApiHelper.removeCountryCode(playerId)], (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getRankingByPlayerId_query', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows[0]);
          }
        });
      });
      let region = server.trim().toLowerCase();
      if (region.startsWith('partner_')) {
        region = region.slice(8);
        region = region.replaceAll(/([A-Za-z])(\d)/g, '$1_$2');
      }
      const p2 = new Promise((resolve, reject) => {
        globalPool.query(query_global_rank, [ApiHelper.removeCountryCode(playerId), region], (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getRankingByPlayerId_query', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows[0]);
          }
        });
      });
      const [serverData, globalData] = await Promise.all([p1, p2]);
      if (!serverData || !globalData) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }

      /* ---------------------------------
       * Data formatting
       * --------------------------------- */
      const data = {
        player_id: ApiHelper.addCountryCode(serverData['player_id'], code),
        server,
        might_current: serverData['might_current'],
        might_all_time: serverData['might_all_time'],
        current_fame: serverData['current_fame'],
        highest_fame: serverData['highest_fame'],
        peace_disabled_at: serverData['peace_disabled_at'],
        loot_current: serverData['loot_current'],
        loot_all_time: serverData['loot_all_time'],
        level: serverData['level'],
        legendary_level: serverData['legendary_level'],
        honor: serverData['honor'],
        max_honor: serverData['max_honor'],
        castles: serverData['castles'],
        castles_realm: serverData['castles_realm'],
        server_rank: serverData['player_rank'] || 0,
        global_rank: globalData['global_rank'],
      };

      /* ---------------------------------
       * Cache update and response
       * --------------------------------- */
      void ApiHelper.updateCache(cacheKey, data);
      response.status(ApiHelper.HTTP_OK).send(data);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getRankingByPlayerId', request);
      return;
    }
  }

  /**
   * Retrieves event statistics for all players belonging to a specific alliance
   *
   * This method performs the following steps:
   * 1. Extracts the real alliance ID and country code from the provided alliance ID
   * 2. Queries the PostgreSQL database to obtain all player IDs associated with the alliance
   * 3. For each OLAP event table, queries the ClickHouse database to fetch event points for the retrieved player IDs
   * 4. Formats the event data, including player IDs (with country code), event dates (in application timezone), and points
   * 5. Measures and returns the execution time (in seconds) for each OLAP event table query
   *
   * @param allianceId - The alliance ID (may include a country code prefix)
   * @returns A promise that resolves to an object containing:
   *   - `diffs`: An object mapping each OLAP event table to the query execution time in seconds
   *   - `points`: An object mapping each OLAP event table to an array of player event statistics
   *   - `error`: An error message if the operation fails or the alliance is invalid
   */
  private static async getPlayersEventsStatisticsFromAllianceId(allianceId: number): Promise<any> {
    try {
      /* ---------------------------------
       * Database connection and player IDs retrieval
       * --------------------------------- */
      let parameterIndex = 1;
      const sqlQueryIds = `SELECT id FROM players WHERE alliance_id = $${parameterIndex++}`;
      const realAllianceId = ApiHelper.removeCountryCode(allianceId);
      const code = ApiHelper.getCountryCode(String(allianceId));
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(allianceId);
      if (!pool || !realAllianceId) {
        return { error: RouteErrorMessagesEnum.InvalidAllianceId };
      }
      const sqlQueryIdsParameters = [realAllianceId];
      const sqlQueryIdsResult: any[] | undefined = await new Promise((resolve, reject) => {
        pool.query(sqlQueryIds, sqlQueryIdsParameters, (error, results) => {
          if (error) {
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows);
          }
        });
      });
      if (!sqlQueryIdsResult) {
        return { error: RouteErrorMessagesEnum.AllianceNotFound };
      }
      let dates_start: any = {};
      let dates_stop: any = {};
      const points: any = {};
      const ids = sqlQueryIdsResult.map((result: any) => result.id);

      /* ---------------------------------
       * Event statistics retrieval
       * --------------------------------- */
      const clickhouseClient: NodeClickHouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const queries = ApiHelper.ggeTrackerManager.getOlapEventTables().map((table) => {
        return new Promise(async (resolve, reject) => {
          try {
            const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(allianceId);
            if (!database) {
              reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
              return;
            }
            dates_start[table] = new Date();

            /* ---------------------------------
             * Build and execute query
             * --------------------------------- */
            let limit = 0;
            switch (table) {
              case 'player_might_history': {
                limit = 10;
                break;
              }
              case 'player_loot_history': {
                limit = 21;
                break;
              }
              default: {
                limit = 30;
              }
            }
            const query = `
              SELECT
              player_id,
              created_at AS first_entry,
              point
              FROM ${database}.${table}
              WHERE player_id IN (${ids.map((id) => `'${id}'`).join(',')})
              AND created_at >= now() - INTERVAL ${limit} DAY
              ORDER BY created_at DESC
            `;
            const clickhouseResult = await clickhouseClient.query({ query });
            const result = await clickhouseResult.json();
            points[table] = result.data.map((row: any) => {
              return {
                player_id: ApiHelper.addCountryCode(row.player_id, code),
                date: new Date(row.first_entry).toISOString(),
                point: row.point,
              };
            });
            dates_stop[table] = new Date();
            resolve(null);
          } catch (error) {
            reject(new Error(error.message));
          }
        });
      });

      /* ---------------------------------
       * Await all queries and calculate execution times
       * --------------------------------- */
      await Promise.all(queries);
      const diffs: any = {};
      for (const table of ApiHelper.ggeTrackerManager.getOlapEventTables()) {
        const diff = dates_stop[table].getTime() - dates_start[table].getTime();
        diffs[table] = diff / 1000;
      }
      return { diffs, points };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Retrieves various statistical pulse data for a given alliance, including might per hour, daily average might change,
   * intra-day might variation, and top might gains/losses over 24 hours and 7 days
   *
   * This method performs the following steps:
   * 1. Fetches all player IDs belonging to the specified alliance
   * 2. Calculates time ranges for the last 7 days and last 24 hours
   * 3. Executes multiple ClickHouse queries in parallel to gather:
   *    - Hourly might sums over the last 7 days
   *    - Average daily might change per player
   *    - Average intra-day might volatility
   *    - Top 5 players by might gain and loss over 24 hours and 7 days
   * 4. Formats and returns the aggregated results
   *
   * @param allianceId - The ID of the alliance to retrieve data for
   * @param pgPool - The PostgreSQL connection pool for fetching player IDs
   * @param olapDatabase - The name of the OLAP database (ClickHouse) to query
   * @param serverCode - The server code used for formatting player IDs
   * @returns An object containing alliance pulse statistics, or an error object if the operation fails
   */
  private static async getAlliancePulseData(
    allianceId: number,
    pgPool: pg.Pool,
    olapDatabase: string,
    serverCode: string,
  ): Promise<any> {
    const database_ = pgPool;
    const database = olapDatabase;
    try {
      /* ---------------------------------
       * Retrieve player IDs for the alliance
       * --------------------------------- */
      let parameterIndex = 1;
      const sqlQueryIds = `SELECT id FROM players WHERE alliance_id = $${parameterIndex++}`;
      const sqlQueryIdsParameters = [ApiHelper.removeCountryCode(allianceId)];
      const players: any[] = await new Promise((resolve, reject) => {
        database_.query(sqlQueryIds, sqlQueryIdsParameters, (error, results) => {
          if (error) reject(new Error(error.message));
          else resolve(results.rows);
        });
      });
      if (players.length === 0) return { error: 'No players found' };
      const ids = players.map((p) => p.id);
      const idList = ids.join(',');

      /* ---------------------------------
       * Time range calculations
       * --------------------------------- */
      const now = new Date();
      const fromDate7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fromDate24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fromDateString7d = fromDate7d.toISOString().slice(0, 19).replace('T', ' ');
      const fromDateString24h = fromDate24h.toISOString().slice(0, 19).replace('T', ' ');
      const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const fromDateString = fromDate.toISOString().slice(0, 10); // 'YYYY-MM-DD'
      const toDateString = yesterday.toISOString().slice(0, 10); // 'YYYY-MM-DD'

      /* ---------------------------------
       * Build queries
       * --------------------------------- */
      // [#1] Might per hour
      const mightHourlyQuery = `
        SELECT toStartOfHour(created_at) AS hour, sum(point) AS total
        FROM ${database}.player_might_history
        WHERE player_id IN (${idList}) AND created_at >= '${fromDateString7d}'
        GROUP BY hour
        ORDER BY hour
      `;
      // [#2] Might daily average change
      const mightDailyAvgChangeQuery = `
        SELECT day, avg(diff) AS avg_diff
        FROM (
          SELECT toDate(created_at) AS day, player_id, argMax(point, created_at) - argMin(point, created_at) AS diff
          FROM ${database}.player_might_history
          WHERE player_id IN (${idList})
          AND toDate(created_at) BETWEEN '${fromDateString}' AND '${toDateString}'
          GROUP BY day, player_id
        )
        GROUP BY day
        ORDER BY day
      `;

      // [#3] Volatile might (intra-day variation)
      const volatileQuery = `
        SELECT
          day,
          avg(max_point - min_point) AS avg_daily_internal_variation
        FROM (
          SELECT
            toDate(created_at) AS day,
            player_id,
            max(point) AS max_point,
            min(point) AS min_point
          FROM ${database}.player_might_history
          WHERE player_id IN (${idList})
            AND toDate(created_at) BETWEEN '${fromDateString}' AND '${toDateString}'
          GROUP BY day, player_id
        ) AS sub
        GROUP BY day
        ORDER BY day ASC
      `;

      // [#4] Top 5 might gain 24h
      const topMightQuery24h = `
        SELECT
          player_id,
          argMax(point, created_at) - argMin(point, created_at) AS diff,
          argMax(point, created_at) AS current
        FROM ${database}.player_might_history
        WHERE player_id IN (${idList}) AND created_at >= '${fromDateString24h}'
        GROUP BY player_id
        ORDER BY diff DESC
        LIMIT 5
        `;

      // [#5] Top 5 might gain 7d
      const topMightQuery7d = `
        SELECT
          player_id,
          argMax(point, created_at) - argMin(point, created_at) AS diff,
          argMax(point, created_at) AS current
        FROM ${database}.player_might_history
        WHERE player_id IN (${idList}) AND created_at >= '${fromDateString7d}'
        GROUP BY player_id
        ORDER BY diff DESC
        LIMIT 5
      `;

      // [#6] Top 5 might loss 24h
      const topMightLossQuery24h = `
        SELECT
          player_id,
          argMax(point, created_at) - argMin(point, created_at) AS diff,
          argMax(point, created_at) AS current
        FROM ${database}.player_might_history
        WHERE player_id IN (${idList}) AND created_at >= '${fromDateString24h}'
        GROUP BY player_id
        HAVING diff < 0
        ORDER BY diff ASC
        LIMIT 5
      `;

      // [#7] Top 5 might loss 7d
      const topMightLossQuery7d = `
        SELECT
          player_id,
          argMax(point, created_at) - argMin(point, created_at) AS diff,
          argMax(point, created_at) AS current
        FROM ${database}.player_might_history
        WHERE player_id IN (${idList}) AND created_at >= '${fromDateString7d}'
        GROUP BY player_id
        HAVING diff < 0
        ORDER BY diff ASC
        LIMIT 5
      `;

      /* ---------------------------------
       * Execute queries in parallel
       * --------------------------------- */
      const clickhouseClient: NodeClickHouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const [
        mightHourlyResult,
        mightAvgResult,
        topMight24hResult,
        topMight7dResult,
        topMightLoss24hResult,
        topMightLoss7dResult,
        volatileMightResult,
      ] = await Promise.all([
        clickhouseClient.query({ query: mightHourlyQuery }),
        clickhouseClient.query({ query: mightDailyAvgChangeQuery }),
        clickhouseClient.query({ query: topMightQuery24h }),
        clickhouseClient.query({ query: topMightQuery7d }),
        clickhouseClient.query({ query: topMightLossQuery24h }),
        clickhouseClient.query({ query: topMightLossQuery7d }),
        clickhouseClient.query({ query: volatileQuery }),
      ]);

      const [mightHourly, mightAvg, topMight24h, topMight7d, topMightLoss24h, topMightLoss7d, volatileMight] =
        await Promise.all([
          mightHourlyResult.json(),
          mightAvgResult.json(),
          topMight24hResult.json(),
          topMight7dResult.json(),
          topMightLoss24hResult.json(),
          topMightLoss7dResult.json(),
          volatileMightResult.json(),
        ]);

      /* ---------------------------------
       * Format query results
       * --------------------------------- */
      const formatHourly = mightHourly.data.map((row) => ({
        date: new Date((row as { hour: string }).hour).toISOString(),
        point: (row as { total: number }).total,
      }));
      const formatAvgChange = mightAvg.data.map((row: { day: string; avg_diff: number }) => ({
        date: row.day,
        avg_diff: row.avg_diff,
      }));
      const formatVolatile = volatileMight.data.map((row: { day: string; avg_daily_internal_variation: number }) => ({
        date: row.day,
        avg_diff: row.avg_daily_internal_variation,
      }));
      const topMightResult24h = topMight24h.data.map((row: { player_id: number; diff: number; current: number }) => ({
        player_id: ApiHelper.addCountryCode(String(row.player_id), serverCode),
        diff: row.diff,
        current: row.current,
      }));
      const topMightResult7d = topMight7d.data.map((row: { player_id: number; diff: number; current: number }) => ({
        player_id: ApiHelper.addCountryCode(String(row.player_id), serverCode),
        diff: row.diff,
        current: row.current,
      }));
      const topMightLossResul24h = topMightLoss24h.data.map(
        (row: { player_id: number; diff: number; current: number }) => ({
          player_id: ApiHelper.addCountryCode(String(row.player_id), serverCode),
          diff: row.diff,
          current: row.current,
        }),
      );
      const topMightLossResult7d = topMightLoss7d.data.map(
        (row: { player_id: number; diff: number; current: number }) => ({
          player_id: ApiHelper.addCountryCode(String(row.player_id), serverCode),
          diff: row.diff,
          current: row.current,
        }),
      );

      /* ---------------------------------
       * Return formatted results
       * --------------------------------- */
      return {
        might_per_hour: formatHourly,
        daily_avg_might_change: formatAvgChange,
        might_intra_variation: formatVolatile,
        top_might_gain_24h: topMightResult24h,
        top_might_gain_7d: topMightResult7d,
        top_might_loss_24h: topMightLossResul24h,
        top_might_loss_7d: topMightLossResult7d,
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Retrieves event statistics for a specific player from one or more OLAP event tables
   *
   * This method queries the specified OLAP database for event data related to the given player,
   * optionally filtering by a time interval. It supports multiple event tables and aggregates
   * the results, returning both the queried points and timing information for each table
   *
   * @param playerId - The unique identifier of the player whose statistics are to be retrieved
   * @param olapDb - The name of the OLAP database to query
   * @param createdAtDiffLimit - (Optional) The number of days to look back from the current date for event data
   * @param eventTables - (Optional) The event table(s) to query. Can be a string or an array of strings
   *                      Defaults to the result of `ApiHelper.ggeTrackerManager.getOlapEventTables()`
   * @returns A promise that resolves to an object containing:
   *   - `diffs`: An object mapping each table to the time taken (in seconds) to execute its query
   *   - `points`: An object mapping each table to an array of point data, each with a date and point value
   *   - `error`: (If an error occurs) An object containing the error message
   *
   * @throws Will log and return an error object if any query fails
   */
  private static async getPlayerEventStatistics(
    playerId: number,
    olapDatabase: string,
    createdAtDiffLimit?: number,
    eventTables: string | string[] = ApiHelper.ggeTrackerManager.getOlapEventTables(),
  ): Promise<any> {
    try {
      /* ---------------------------------
       * Initialize query timing and point data structures
       * --------------------------------- */
      if (typeof eventTables === 'string') {
        eventTables = [eventTables];
      }
      let dates_start: any = {};
      let dates_stop: any = {};
      const points: any = {};
      const createdAtDiffLimitQueryOlap = createdAtDiffLimit
        ? `AND created_at >= now() - INTERVAL ${createdAtDiffLimit} DAY`
        : '';

      /* ---------------------------------
       * Execute queries for each event table
       * --------------------------------- */
      const clickhouseClient: NodeClickHouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const queries = eventTables.map((table) => {
        return new Promise(async (resolve, reject) => {
          dates_start[table] = new Date();
          try {
            const database = olapDatabase;
            if (!database) {
              reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
              return;
            }
            dates_start[table] = new Date();
            if (table === 'player_might_history' || table === 'player_loot_history') {
              // Special handling for tables without event_dates. They will return only actual entries
              const query = `
                SELECT
                  created_at,
                  point
                FROM ${database}.${table}
                WHERE player_id = ${ApiHelper.removeCountryCode(playerId)}
                ${createdAtDiffLimitQueryOlap}
                ORDER BY created_at ASC
              `;
              const clickhouseQuery = await clickhouseClient.query({ query });
              const result = await clickhouseQuery.json();
              points[table] = result.data.map((row: any) => {
                return {
                  date: new Date(row.created_at).toISOString(),
                  point: row.point,
                };
              });
            } else {
              // Standard handling for tables with event_dates
              const query = `
                SELECT
                  ed.created_at,
                  COALESCE(pe.point, 0) AS point
                FROM
                  ${database}.event_dates AS ed
                LEFT JOIN ${database}.${table} AS pe
                  ON ed.created_at = pe.created_at AND pe.player_id = ${ApiHelper.removeCountryCode(playerId)}
                WHERE
                  ed.table_name = '${table}'
                ${createdAtDiffLimitQueryOlap}
                ORDER BY
                  ed.created_at
              `;
              const clickhouseQuery = await clickhouseClient.query({ query });
              const result = await clickhouseQuery.json();
              points[table] = result.data.map((row: any) => {
                return {
                  date: new Date(row.created_at).toISOString(),
                  point: row.point,
                };
              });
            }
            dates_stop[table] = new Date();
            resolve(null);
          } catch (error) {
            reject(new Error(error.message));
          }
        });
      });

      /* ---------------------------------
       * Await all queries and calculate execution times
       * --------------------------------- */
      await Promise.all(queries);
      const diffs: any = {};
      for (const table of eventTables) {
        const diff = dates_stop[table].getTime() - dates_start[table].getTime();
        diffs[table] = diff / 1000;
      }
      return { diffs, points };
    } catch (error) {
      return { error: error.message };
    }
  }
}
