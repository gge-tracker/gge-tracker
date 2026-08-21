import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { NodeClickHouseClient } from '@clickhouse/client/dist/client';

interface PlayerStatisticsOptions {
  events: string[] | null;
  since: number | null;
  limit: number | null;
  dedup: boolean;
}

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
   * The two histories that are sampled continuously rather than run as events
   */
  private static readonly CONTINUOUS_TABLES = new Set(['player_might_history', 'player_loot_history']);

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
       * Optional response trimming
       * --------------------------------- */
      const eventTables = ApiHelper.ggeTrackerManager.getOlapEventTables();
      const requestedEvents = ApiHelper.getParsedString(request.query.events)
        ?.split(',')
        .map((event) => event.trim())
        .filter((event) => event.length > 0);
      if (requestedEvents?.some((event) => !eventTables.includes(event))) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventName });
        return;
      }
      const parsedLimit = Number.parseInt(String(request.query.limit ?? ''), 10);
      const rowLimit = Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : null;

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const language = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(allianceId);
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${language}`)) || '1';
      const cachedKey = `statistics:alliances:${language}:${cacheVersion}:${allianceId}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response
          .status(ApiHelper.HTTP_OK)
          .send(this.trimAllianceStatistics(JSON.parse(cachedData), requestedEvents, rowLimit));
        return;
      }

      /* ---------------------------------
       * Database query
       * --------------------------------- */
      try {
        const { diffs, points } = await this.getPlayersEventsStatisticsFromAllianceId(allianceId);
        const data = {
          diffs,
          points,
          timezoneOffset: ApiHelper.ggeTrackerManager.getTimezoneOffsetByCode(
            ApiHelper.getCountryCode(String(allianceId)) || '',
          ),
        };
        void ApiHelper.updateCache(cachedKey, data);
        response.status(ApiHelper.HTTP_OK).send(this.trimAllianceStatistics(data, requestedEvents, rowLimit));
      } catch (error) {
        console.error('Error executing queries:', error);
        response
          .status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR)
          .send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
      }
    } catch (error) {
      console.error('Error executing query:', error);
      response
        .status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR)
        .send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
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
       * Optional response narrowing
       * --------------------------------- */
      const options = this.parsePlayerStatisticsOptions(request);
      if ('error' in options) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: options.error });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const language = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(playerId);
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${language}`)) || '1';
      const cacheKey = `statistics:players:${language}:${cacheVersion}:${playerId}${this.buildFetchCacheSuffix(options)}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(this.trimPlayerStatistics(JSON.parse(cachedData), options));
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
       * Glory points cache key
       * --------------------------------- */
      const code100GloryPoints = await this.getTop100GloryPoints(language, cacheVersion, code);

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
        const requestedTables = options.events ?? ApiHelper.ggeTrackerManager.getOlapEventTables();
        const olapDatabaseName = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(Number(playerId));
        const { diffs, points } = await this.getPlayerEventStatistics(
          playerId,
          olapDatabaseName,
          options.since ?? undefined,
          requestedTables,
        );
        const timezoneOffset = ApiHelper.ggeTrackerManager.getTimezoneOffsetByCode(
          ApiHelper.getCountryCode(String(playerId)) || '',
        );
        const data = {
          diffs,
          player_name: playerName,
          alliance_name: allianceName,
          alliance_id: allianceId,
          points,
          glory_points_100: code100GloryPoints,
          timezone_offset: timezoneOffset,
        };
        void ApiHelper.updateCache(cacheKey, data);
        response.status(ApiHelper.HTTP_OK).send(this.trimPlayerStatistics(data, options));
        return;
      } catch {
        response
          .status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR)
          .send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
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
   * Handles the HTTP request to retrieve a headline summary of a player's event statistics
   *
   * @param request The Express request object, expected to contain `playerId` in the route parameters
   * @param response The Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getStatisticsSummaryByPlayerId(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPoolFromRequestId(playerId);
      const code = ApiHelper.getCountryCode(String(playerId));
      if (!pool || !code) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const language = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(playerId);
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${language}`)) || '1';
      const cacheKey = `statistics:players:${language}:${cacheVersion}:${playerId}:summary`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Resolve the player and their alliance
       * --------------------------------- */
      const query = `
        SELECT
          players.name AS player_name,
          alliances.name AS alliance_name,
          alliances.id AS alliance_id
        FROM players LEFT JOIN alliances
        ON players.alliance_id = alliances.id
        WHERE players.id = $1`;
      const player: any = await new Promise((resolve, reject) => {
        pool.query(query, [ApiHelper.removeCountryCode(playerId)], (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getStatisticsSummaryByPlayerId_query', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows[0]);
          }
        });
      });
      if (!player?.player_name) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }

      /* ---------------------------------
       * Aggregate every event table
       * --------------------------------- */
      const olapDatabaseName = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(Number(playerId));
      const [events, code100GloryPoints] = await Promise.all([
        this.getPlayerEventSummary(playerId, olapDatabaseName),
        this.getTop100GloryPoints(language, cacheVersion, code),
      ]);
      const data = {
        player_name: player.player_name,
        alliance_name: player.alliance_name,
        alliance_id: ApiHelper.addCountryCode(player.alliance_id, code),
        events,
        glory_points_100: code100GloryPoints,
        timezone_offset: ApiHelper.ggeTrackerManager.getTimezoneOffsetByCode(code),
      };
      void ApiHelper.updateCache(cacheKey, data);
      response.status(ApiHelper.HTTP_OK).send(data);
      return;
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStatisticsSummaryByPlayerId', request);
      return;
    }
  }

  /**
   * Handles the HTTP request to retrieve one row per run of an event, with the score the player
   * finished it on
   *
   * @param request - The Express request object, expected to contain `playerId` and `eventName`
   * @param response - The Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getEventOccurrencesByPlayerId(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (playerId === false || playerId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const eventName = request.params.eventName;
      if (
        !ApiHelper.ggeTrackerManager.getOlapEventTables().includes(eventName) ||
        this.CONTINUOUS_TABLES.has(eventName)
      ) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventName });
        return;
      }
      const olapDatabaseName = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(Number(playerId));
      if (!olapDatabaseName) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const language = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(playerId);
      const cacheVersion = (await ApiHelper.redisClient.get(`fill-version:${language}`)) || '1';
      const cacheKey = `statistics:players:${language}:${cacheVersion}:${playerId}:occurrences:${eventName}`;
      const cachedData = await ApiHelper.redisClient.get(cacheKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Group the event dates into runs
       * --------------------------------- */
      const occurrences = await this.getPlayerEventOccurrences(playerId, olapDatabaseName, eventName);
      const data = { event: eventName, occurrences };
      void ApiHelper.updateCache(cacheKey, data);
      response.status(ApiHelper.HTTP_OK).send(data);
      return;
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getEventOccurrencesByPlayerId', request);
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
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
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
        WITH fame_ranked AS (
          SELECT
            id,
            RANK() OVER (ORDER BY current_fame DESC) AS player_current_fame_rank
          FROM players
          WHERE castles <> '[]'
        )
        SELECT
          players.name AS player_name,
          alliances.name AS alliance_name,
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
          players.player_rank,
          players.updated_at,
          fr.player_current_fame_rank
        FROM (
          SELECT
            players.*,
            RANK() OVER (ORDER BY players.might_current DESC) AS player_rank
          FROM players
        ) AS players
        LEFT JOIN fame_ranked fr ON fr.id = players.id
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
        player_name: serverData['player_name'],
        alliance_name: serverData['alliance_name'],
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
        updated_at: new Date(serverData['updated_at']).toISOString(),
        server_rank: serverData['player_rank'] || 0,
        global_rank: globalData['global_rank'],
        player_current_fame_rank: serverData['player_current_fame_rank'],
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
      const queries = ApiHelper.ggeTrackerManager.getOlapEventTables().map(async (table) => {
        try {
          const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(allianceId);
          if (!database) {
            throw new Error(RouteErrorMessagesEnum.GenericInternalServerError);
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
        } catch (error) {
          throw new Error(error.message);
        }
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
      return { diffs, points: this.orderByTable(points, ApiHelper.ggeTrackerManager.getOlapEventTables()) };
    } catch {
      return { error: RouteErrorMessagesEnum.GenericInternalServerError };
    }
  }

  /**
   * Narrows an alliance statistics payload to the event tables and row count the caller asked for
   *
   * A populated alliance returns several hundred kilobytes of point rows, which is more than a
   * documentation UI or an exploratory client can render. Both `events` and `limit` are optional:
   * when neither is supplied the payload is returned untouched, so existing consumers are unaffected
   *
   * The trimming is applied on the way out rather than in the query, so the Redis entry always holds
   * the complete payload and a trimmed request never displaces a full one in the cache
   *
   * `diffs` is left whole: it reports the time every table actually took to query, which does not
   * change because the caller asked for fewer of them
   *
   * @param data - The full statistics payload, either freshly queried or read back from the cache
   * @param events - The event tables to keep, or undefined to keep them all
   * @param limit - The maximum number of rows to keep per event table, or null to keep them all
   * @returns The payload with `points` narrowed accordingly
   */
  private static trimAllianceStatistics(data: any, events: string[] | undefined, limit: number | null): any {
    if (!events?.length && limit === null) return data;
    const points: any = {};
    for (const [table, rows] of Object.entries(data?.points ?? {})) {
      if (events?.length && !events.includes(table)) continue;
      points[table] = limit === null || !Array.isArray(rows) ? rows : rows.slice(0, limit);
    }
    return { ...data, points };
  }

  /**
   * Reads the optional narrowing parameters of the player statistics route
   *
   * @param request The Express request carrying the query string
   * @returns The parsed options, or an object holding the error message to answer with a 400
   */
  private static parsePlayerStatisticsOptions(request: express.Request): PlayerStatisticsOptions | { error: string } {
    /* ---------------------------------
     * events: the tables to query
     * --------------------------------- */
    const eventTables = ApiHelper.ggeTrackerManager.getOlapEventTables();
    const requestedEvents = ApiHelper.getParsedString(request.query.events)
      ?.split(',')
      .map((event) => event.trim())
      .filter((event) => event.length > 0);
    if (requestedEvents?.some((event) => !eventTables.includes(event))) {
      return { error: RouteErrorMessagesEnum.InvalidEventName };
    }
    const events = requestedEvents?.length ? [...new Set(requestedEvents)].sort() : null;

    /* ---------------------------------
     * since: how many days back to query
     * --------------------------------- */
    let since: number | null = null;
    const rawSince = ApiHelper.getParsedString(request.query.since);
    if (rawSince !== null) {
      if (!/^\d+$/.test(rawSince)) {
        return { error: RouteErrorMessagesEnum.InvalidDuration };
      }
      since = Number.parseInt(rawSince, 10);
      // The ceiling is five years
      if (since < 1 || since > 1825) {
        return { error: RouteErrorMessagesEnum.InvalidDuration };
      }
    }

    /* ---------------------------------
     * limit and dedup: presentation only
     * --------------------------------- */
    const parsedLimit = Number.parseInt(String(request.query.limit ?? ''), 10);
    const limit = Number.isInteger(parsedLimit) && parsedLimit >= 0 ? parsedLimit : null;
    const rawDedup = ApiHelper.getParsedString(request.query.dedup);
    const dedup = rawDedup === '1' || rawDedup === 'true';

    return { events, since, limit, dedup };
  }

  /**
   * Builds the cache key suffix that distinguishes one fetched window from another
   *
   * @param options The parsed query options
   * @returns The suffix to append to the cache key, empty when nothing was narrowed
   */
  private static buildFetchCacheSuffix(options: PlayerStatisticsOptions): string {
    const parts: string[] = [];
    if (options.events) parts.push(`e=${options.events.join('+')}`);
    if (options.since !== null) parts.push(`d=${options.since}`);
    return parts.length > 0 ? `:${parts.join(':')}` : '';
  }

  /**
   * Narrows a player statistics payload to the rows the caller asked to be given
   *
   * @param data The full statistics payload, freshly queried or read back from the cache
   * @param options The parsed query options
   * @returns The payload with `points` narrowed accordingly
   */
  private static trimPlayerStatistics(data: any, options: PlayerStatisticsOptions): any {
    if (!options.dedup && options.limit === null) return data;
    const points: any = {};
    for (const [table, rows] of Object.entries(data?.points ?? {})) {
      if (!Array.isArray(rows)) {
        points[table] = rows;
        continue;
      }
      let kept = rows;
      if (options.dedup) {
        kept = this.CONTINUOUS_TABLES.has(table) ? this.dropFlatRuns(kept) : this.dropUnplayedEvents(kept);
      }
      points[table] = options.limit === null ? kept : kept.slice(Math.max(0, kept.length - options.limit));
    }
    return { ...data, points };
  }

  /**
   * Drops the interior of every flat run, keeping the point that enters it and the point that leaves
   *
   * @param rows The point rows of one table, in chronological order
   * @returns The rows with the redundant interior points removed
   */
  private static dropFlatRuns(rows: any[]): any[] {
    if (rows.length <= 2) return rows;
    return rows.filter((row, index) => {
      if (index === 0 || index === rows.length - 1) return true;
      return !(rows[index - 1].point === row.point && rows[index + 1].point === row.point);
    });
  }

  /**
   * Drops the event occurrences the player did not take part in, and the zeroes that lead into the
   * ones they did
   *
   * @param rows The point rows of one event table, in chronological order
   * @returns The rows with unplayed occurrences and redundant leading zeroes removed
   */
  private static dropUnplayedEvents(rows: any[]): any[] {
    const EVENT_GAP_MS = 24 * 60 * 60 * 1000;
    const kept: any[] = [];
    let occurrence: any[] = [];
    const flush = (): void => {
      if (occurrence.length === 0) return;
      const firstScored = occurrence.findIndex((row) => Number(row.point) > 0);
      if (firstScored !== -1) {
        kept.push(...occurrence.slice(Math.max(0, firstScored - 1)));
      }
      occurrence = [];
    };
    for (const row of rows) {
      const previous = occurrence.at(-1);
      if (previous && new Date(row.date).getTime() - new Date(previous.date).getTime() > EVENT_GAP_MS) {
        flush();
      }
      occurrence.push(row);
    }
    flush();
    return kept;
  }

  /**
   * Groups an event's dates into runs and reports what the player finished each one on
   *
   * @param playerId The player, with their country code still attached
   * @param olapDatabase The OLAP database holding this server's history
   * @param eventTable The event table to group
   * @returns One entry per run, oldest first
   */
  private static async getPlayerEventOccurrences(
    playerId: number,
    olapDatabase: string,
    eventTable: string,
  ): Promise<Array<{ started_at: string; ended_at: string; point: number }>> {
    const clickhouseClient: NodeClickHouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    const query = `
      SELECT
        min(created_at) AS started_at,
        max(created_at) AS ended_at,
        toUInt64(argMax(point, created_at)) AS point
      FROM (
        SELECT
          created_at,
          point,
          sum(is_new_occurrence) OVER (ORDER BY created_at ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
            AS occurrence
        FROM (
          SELECT
            ed.created_at AS created_at,
            COALESCE(pe.point, 0) AS point,
            if(
              dateDiff('second', lagInFrame(ed.created_at, 1, ed.created_at) OVER (ORDER BY ed.created_at ASC), ed.created_at) > 86400,
              1,
              0
            ) AS is_new_occurrence
          FROM ${olapDatabase}.event_dates AS ed
          LEFT JOIN ${olapDatabase}.${eventTable} AS pe
            ON ed.created_at = pe.created_at AND pe.player_id = {playerId:UInt32}
          WHERE ed.table_name = {eventTable:String}
        )
      )
      GROUP BY occurrence
      ORDER BY started_at ASC
    `;
    const clickhouseQuery = await clickhouseClient.query({
      query,
      query_params: { playerId: ApiHelper.removeCountryCode(playerId), eventTable },
    });
    const result = await clickhouseQuery.json();
    return result.data.map((row: any) => ({
      started_at: new Date(row.started_at).toISOString(),
      ended_at: new Date(row.ended_at).toISOString(),
      point: Number(row.point),
    }));
  }

  /**
   * Aggregates each event table down to the handful of numbers a player card displays
   *
   * @param playerId The player, with their country code still attached
   * @param olapDatabase The OLAP database holding this server's history
   * @returns A map of event table to its summary
   */
  private static async getPlayerEventSummary(playerId: number, olapDatabase: string): Promise<any> {
    const clickhouseClient: NodeClickHouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    const tables = ApiHelper.ggeTrackerManager.getOlapEventTables();
    const summaries = await Promise.all(
      tables.map(async (table) => {
        const query = `
          SELECT
            count() AS row_count,
            toUInt64(countIf(created_at >= now() - INTERVAL 7 DAY)) AS row_count_7d,
            min(created_at) AS first_date,
            max(created_at) AS last_date,
            toUInt64(argMax(point, created_at)) AS last_point,
            toUInt64(max(point)) AS max_point,
            argMax(created_at, point) AS max_point_date,
            toUInt64(maxIf(point, created_at >= now() - INTERVAL 7 DAY)) AS max_point_7d,
            toInt64(argMaxIf(point, created_at, created_at >= now() - INTERVAL 7 DAY)) -
              toInt64(argMinIf(point, created_at, created_at >= now() - INTERVAL 7 DAY)) AS point_gain_7d
          FROM ${olapDatabase}.${table}
          WHERE player_id = {playerId:UInt32}
        `;
        const clickhouseQuery = await clickhouseClient.query({
          query,
          query_params: { playerId: ApiHelper.removeCountryCode(playerId) },
        });
        const result = await clickhouseQuery.json();
        const row: any = result.data[0];
        const rowCount = Number(row?.row_count ?? 0);
        if (rowCount === 0) {
          return [
            table,
            {
              row_count: 0,
              row_count_7d: 0,
              first_date: null,
              last_date: null,
              last_point: null,
              max_point: null,
              max_point_date: null,
              max_point_7d: null,
              point_gain_7d: null,
            },
          ];
        }
        return [
          table,
          {
            row_count: rowCount,
            row_count_7d: Number(row.row_count_7d ?? 0),
            first_date: new Date(row.first_date).toISOString(),
            last_date: new Date(row.last_date).toISOString(),
            last_point: Number(row.last_point),
            max_point: Number(row.max_point),
            max_point_date: new Date(row.max_point_date).toISOString(),
            max_point_7d: Number(row.row_count_7d ?? 0) > 0 ? Number(row.max_point_7d) : null,
            point_gain_7d: Number(row.row_count_7d ?? 0) > 0 ? Number(row.point_gain_7d) : null,
          },
        ];
      }),
    );
    return Object.fromEntries(summaries);
  }

  /**
   * Returns the fame milestones of a server's top 100, reading through the cache
   *
   * @param language The server name, used to scope the cache entry
   * @param cacheVersion The current fill version of that server
   * @param code The 3-char server code to rank
   * @returns The fame value at ranks 1, 10, 50 and 100
   */
  private static async getTop100GloryPoints(
    language: string,
    cacheVersion: string,
    code: string,
  ): Promise<Array<{ top: number; point: number }>> {
    const cacheKey = `leaderboard:glory:${language}:${cacheVersion}:top100:${code}`;
    const cached = await ApiHelper.redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    const gloryPoints = await this.getTop100GloryPointsByCountryCode(code);
    void ApiHelper.updateCache(cacheKey, gloryPoints, 4000);
    return gloryPoints;
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
    } catch {
      return { error: RouteErrorMessagesEnum.GenericInternalServerError };
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
      const queries = eventTables.map(async (table) => {
        dates_start[table] = new Date();
        try {
          const database = olapDatabase;
          if (!database) {
            throw new Error(RouteErrorMessagesEnum.GenericInternalServerError);
          }
          if (table === 'player_might_history' || table === 'player_loot_history') {
            // Special handling for tables without event_dates. They will return only actual entries
            const query = `
              SELECT
                created_at,
                point
              FROM ${database}.${table}
              WHERE player_id = {playerId:UInt32}
              ${createdAtDiffLimitQueryOlap}
              ORDER BY created_at ASC
            `;
            const clickhouseQuery = await clickhouseClient.query({
              query,
              query_params: {
                playerId: ApiHelper.removeCountryCode(playerId),
              },
            });
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
                ON ed.created_at = pe.created_at AND pe.player_id = {playerId:UInt32}
              WHERE
                ed.table_name = '${table}'
              ${createdAtDiffLimitQueryOlap}
              ORDER BY
                ed.created_at
            `;
            const clickhouseQuery = await clickhouseClient.query({
              query,
              query_params: {
                playerId: ApiHelper.removeCountryCode(playerId),
              },
            });
            const result = await clickhouseQuery.json();
            points[table] = result.data.map((row: any) => {
              return {
                date: new Date(row.created_at).toISOString(),
                point: row.point,
              };
            });
          }
          dates_stop[table] = new Date();
        } catch (error) {
          throw new Error(error?.message || String(error));
        }
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
      return { diffs, points: this.orderByTable(points, eventTables) };
    } catch {
      return { error: RouteErrorMessagesEnum.GenericInternalServerError };
    }
  }

  /**
   * Rebuilds a per-table map in the order the tables are declared rather than the order their
   * queries happened to finish in
   *
   * @param points The per-table map as the parallel queries filled it
   * @param tables The event tables, in their declared order
   * @returns The same entries, keyed in declared order
   */
  private static orderByTable(points: Record<string, any>, tables: string[]): Record<string, any> {
    const ordered: Record<string, any> = {};
    for (const table of tables) {
      if (table in points) ordered[table] = points[table];
    }
    return ordered;
  }

  /**
   * Retrieves the top 100 players by glory points for a specific country code
   * It returns only the entries for ranks 1, 10, 50, and 100 (for special glory milestones)
   * @param countryCode - The country code to filter players by
   * @returns A promise that resolves to an array of objects containing the rank and current fame of the top players
   */
  private static async getTop100GloryPointsByCountryCode(
    countryCode: string,
  ): Promise<Array<{ top: number; point: number }>> {
    try {
      const serverName = ApiHelper.ggeTrackerManager.getServerNameFromCode(countryCode);
      const pool = ApiHelper.ggeTrackerManager.getPgSqlPool(serverName);
      if (!pool) {
        throw new Error('Invalid global database connection');
      }
      const query = `
        SELECT
          current_fame
        FROM players
        ORDER BY current_fame DESC
        LIMIT 100;
      `;
      const result: any[] = await new Promise((resolve, reject) => {
        pool.query(query, (error, results) => {
          if (error) {
            reject(new Error(error.message));
          } else {
            resolve(results.rows);
          }
        });
      });
      return result
        .map((row, index) => ({ top: index + 1, point: row.current_fame }))
        .filter((entry) => [1, 10, 50, 100].includes(entry.top));
    } catch (error) {
      ApiHelper.logError(error, 'getTop100GloryPointsByCountryCode', null);
      return [];
    }
  }
}
