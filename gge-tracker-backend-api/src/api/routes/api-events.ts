import { formatInTimeZone } from 'date-fns-tz';
import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { EventTypes } from '../enums/event-types.enums';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { ApiHelper } from '../helper/api-helper';
import { ApiInvalidInputType } from '../types/parameter.types';

/**
 * Abstract class providing API endpoints for event-related data.
 *
 * The `ApiEvents` class implements the `ApiHelper` interface and exposes static methods to handle
 * HTTP requests for retrieving event lists, event player rankings, and detailed event statistics.
 *
 * @abstract
 * @implements {ApiHelper}
 */
export abstract class ApiEvents implements ApiHelper {
  /**
   * Retrieves a list of events from the database, combining results from both
   * "outer realms" and "beyond the horizon" event sources. Results are cached
   * in Redis for performance optimization. If cached data is available, it is
   * returned immediately; otherwise, the data is queried from the database,
   * formatted, cached, and then returned.
   *
   * @param request - The Express request object.
   * @param response - The Express response object.
   * @param eventPgDbpool - The PostgreSQL connection pool used for querying event data.
   * @returns A Promise that resolves when the response has been sent.
   */
  public static async getEvents(
    request: express.Request,
    response: express.Response,
    eventPgDbpool: pg.Pool,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cachedKey = `events:list`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Construct SQL Query
       * --------------------------------- */
      const query = `
        SELECT
          e.event_num,
          e.collect_date,
          COUNT(*) AS player_count,
          'outer_realms' AS type
        FROM outer_realms_event e
        INNER JOIN outer_realms_ranking r
          ON e.event_num = r.event_num
        GROUP BY e.event_num, e.collect_date
        UNION ALL
        SELECT
          e.event_num,
          e.collect_date,
          COUNT(*) AS player_count,
          'beyond_the_horizon' AS type
        FROM beyond_the_horizon_event e
        INNER JOIN beyond_the_horizon_ranking r
          ON e.event_num = r.event_num
        GROUP BY e.event_num, e.collect_date
        ORDER BY collect_date DESC;
      `;

      /* ---------------------------------
       * Query from DB
       * --------------------------------- */
      eventPgDbpool.query(query, (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
          return;
        } else {
          /* ---------------------------------
           * Format results
           * --------------------------------- */
          const events = results.rows.map((result: any) => ({
            event_num: result.event_num,
            player_count: result.player_count,
            type: result.type,
            collect_date: formatInTimeZone(
              result.collect_date,
              ApiHelper.APPLICATION_TIMEZONE,
              'yyyy-MM-dd HH:mm' + ':00',
            ),
          }));
          /* ---------------------------------
           * Update cache and send response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, { events }, 3600 * 3);
          response.status(ApiHelper.HTTP_OK).send({ events });
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getEvents', request);
      return;
    }
  }

  /**
   * Retrieves and returns grouped Grand Tournament event dates
   *
   * HTTP responses:
   * - 200 OK: returns a JSON object containing an array of events with their IDs and associated dates
   * - 500 Internal Server Error: on unexpected failures; the error is logged and a generic 500 message is returned
   *
   * Response structure:
   * - {
   *    events: Array<{ event_id: number, dates: string[] }>
   *   }
   *
   * @param request - Express request object
   * @param response - Express response object used to send the JSON result
   * @returns A Promise that resolves once an HTTP response has been sent
   */
  public static async getGrandTournamentEventDates(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`grand-tournament:event-dates:version`)) || '-1';
      const cachedKey = `grand-tournament:event-dates:v${cacheVersion}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Query from DB
       * --------------------------------- */
      const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
      const query = `
        SELECT
          event_id,
          ARRAY_AGG(DISTINCT date_trunc('hour', created_at) ORDER BY date_trunc('hour', created_at)) AS dates
        FROM grand_tournament
        GROUP BY event_id
        ORDER BY event_id ASC;
      `;
      const { rows } = await pgPool.query(query);
      if (rows.length === 0) {
        response.status(ApiHelper.HTTP_OK).json({ events: [] });
        return;
      }

      /* ---------------------------------
       * Process results
       * --------------------------------- */
      const result: { event_id: number; dates: string[] }[] = rows.map((row) => ({
        event_id: row.event_id,
        dates: row.dates.map((d: Date) => new Date(d).toISOString()),
      }));

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
      const cacheTtl = 60 * 60 * 6; // 6 hours
      void ApiHelper.updateCache(cachedKey, { events: result }, cacheTtl);
      response.status(ApiHelper.HTTP_OK).json({ events: result });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getGrandTournamentEventDates', request);
      return;
    }
  }

  /**
   * Retrieves and returns the grand tournament alliance analysis
   *
   * HTTP responses:
   * - 200 OK: returns a JSON object containing the alliance analysis data
   * - 400 Bad Request: if the alliance ID or event ID is invalid
   * - 500 Internal Server Error: on unexpected failures; the error is logged and a generic 500 message is returned
   *
   * Response structure:
   * - {
   *    analysis: Array<{ division: number, subdivision: number, rank: number, score: number, date: string }>
   *   }
   *
   * @param request - Express request object
   * @param response - Express response object used to send the JSON result
   * @returns A Promise that resolves once an HTTP response has been sent
   */
  public static async getGrandTournamentAllianceAnalysis(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate request
       * --------------------------------- */
      const allianceId = ApiHelper.verifyIdWithCountryCode(String(request.params.allianceId));
      const eventId = ApiHelper.validatePageNumber(request.params.eventId);
      if (allianceId === false || allianceId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }
      const realAllianceId = ApiHelper.removeCountryCode(allianceId);
      const countryCode = ApiHelper.getCountryCode(String(allianceId));
      const zone = ApiHelper.ggeTrackerManager.getZoneFromCode(countryCode);
      if (!zone) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceId });
        return;
      }
      let replacedZone = zone.replaceAll(new RegExp('EmpireEx_?', 'g'), '');
      if (replacedZone === '') {
        replacedZone = '1';
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`grand-tournament:event-dates:version`)) || '-1';
      const cachedKey = `grand-tournament:alliance-analysis:${allianceId}:v${cacheVersion}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Query from DB
       * --------------------------------- */
      const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
      const query = `
        SELECT
          server_id,
          division_id,
          subdivision_id,
          alliance_id,
          alliance_name,
          rank,
          score,
          created_at
        FROM grand_tournament
        WHERE alliance_id = $1
        AND server_id = $2
        AND event_id = $3
        ORDER BY created_at DESC;
      `;
      const { rows } = await pgPool.query(query, [realAllianceId, replacedZone, eventId]);
      if (rows.length === 0) {
        response.status(ApiHelper.HTTP_OK).send({ analysis: [], meta: { alliance_id: allianceId, server: zone } });
        return;
      }

      /* ---------------------------------
       * Map analysis data
       * --------------------------------- */
      const analysis = rows.map((row) => {
        const dateWithoutMinutes = new Date(row.created_at);
        return {
          division: row.division_id,
          subdivision: row.subdivision_id,
          rank: row.rank,
          score: Number(row.score),
          date: formatInTimeZone(dateWithoutMinutes, 'UTC', 'yyyy-MM-dd HH:00:00'),
        };
      });
      const serverObject = ApiHelper.ggeTrackerManager.getServerByZone(
        'EmpireEx' + (rows.at(0)?.server_id === 1 ? '' : '_' + rows.at(0)?.server_id),
      );
      const server = serverObject && 'outer_name' in serverObject ? serverObject.outer_name : 'Unknown';

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
      const cacheTtl = 60 * 60 * 6; // 6 hours
      const responseData = {
        analysis,
        meta: { alliance_id: allianceId, alliance_name: rows.at(0)?.alliance_name || null, server },
      };
      response.status(ApiHelper.HTTP_OK).send(responseData);
      void ApiHelper.updateCache(cachedKey, responseData, cacheTtl);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getGrandTournamentAllianceAnalysis', request);
      return;
    }
  }

  /**
   * Search and return paginated "Grand Tournament" alliance data filtered by alliance name and hour
   *
   * HTTP responses:
   * - 200 OK: returns cached or freshly fetched response object described above. If no matches, returns { total_items: 0, alliances: [] } (or the standardized response with empty alliances and pagination).
   * - 400 Bad Request: when `date` is invalid or `alliance_name` is empty or exceeds 50 characters. (Client error messages indicate required format for date.)
   * - 500 Internal Server Error: on unexpected failures; the error is logged and a generic 500 message is returned.
   *
   * @param request - express.Request containing query parameters: alliance_name, date, page
   * @param response - express.Response used to send the HTTP response
   * @returns Promise<void> — sends the HTTP response directly; does not throw for expected validation errors
   */
  public static async searchGrandTournamentDataByAllianceName(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate request parameters
       * --------------------------------- */
      const allianceName = ApiHelper.validateSearchAndSanitize(request.query.alliance_name);
      const date = this.validateDate(request.query.date) ? new Date(String(request.query.date)) : null;
      if (!date) {
        response
          .status(ApiHelper.HTTP_BAD_REQUEST)
          .send({ error: 'Invalid date format. Please use YYYY-MM-DDTHH:00:00.000Z.' });
        return;
      }
      const pagination_page = request.query.page ? Number.parseInt(String(request.query.page)) : 1;
      const maxAlliancesPerPage = 10;
      const offset = (pagination_page - 1) * maxAlliancesPerPage;
      if (ApiHelper.isInvalidInput(allianceName)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceName });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`grand-tournament:event-dates:version`)) || '-1';
      const cachedKey = `grand-tournament:search-alliance-name:${allianceName}:date:${date.toISOString()}:page:${pagination_page}:v${cacheVersion}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(cachedData);
        return;
      }

      /* ---------------------------------
       * Database query for total count
       * --------------------------------- */
      const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
      const baseParameters: (string | number | Date)[] = [date];
      const queryCount = `
        SELECT
          COUNT(*) AS total_items
        FROM grand_tournament
        WHERE ($1::timestamp IS NULL
          OR (created_at >= $1::timestamp AND created_at < $1::timestamp + interval '1 hour'))
          AND alliance_name ILIKE $2
      `;
      const { rows: countRows } = await pgPool.query(queryCount, [...baseParameters, `%${allianceName}%`]);
      const total_items = Number(countRows[0]?.total_items || 0);
      const total_pages = Math.ceil(total_items / maxAlliancesPerPage);
      if (total_items === 0) {
        response.status(ApiHelper.HTTP_OK).send({ total_items, alliances: [] });
        return;
      }

      /* ---------------------------------
       * Database query for alliances
       * --------------------------------- */
      const queryAlliances = `
        SELECT
          server_id,
          division_id,
          subdivision_id,
          alliance_id,
          alliance_name,
          rank,
          score,
          created_at
        FROM grand_tournament
        WHERE ($1::timestamp IS NULL
          OR (created_at >= $1::timestamp AND created_at < $1::timestamp + interval '1 hour'))
          AND alliance_name ILIKE $2
        ORDER BY created_at DESC, division_id DESC, score DESC, rank
        LIMIT $3 OFFSET $4;
      `;
      const { rows } = await pgPool.query(queryAlliances, [
        ...baseParameters,
        `%${allianceName}%`,
        maxAlliancesPerPage,
        offset,
      ]);

      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const alliances = rows.map((row) => {
        const serverObject = ApiHelper.ggeTrackerManager.getServerByZone(
          'EmpireEx' + (row.server_id === 1 ? '' : '_' + row.server_id),
        );
        const serverCode = serverObject && 'code' in serverObject ? serverObject.code : '999';
        return {
          alliance_id: Number.parseInt(row.alliance_id + serverCode) || null,
          alliance_name: row.alliance_name,
          server: serverObject?.outer_name || null,
          rank: row.rank,
          score: Number(row.score),
          division: row.division_id,
          subdivision: row.subdivision_id,
        };
      });

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
      const cacheTtl = 60 * 60 * 6; // 6 hours
      const responseData = {
        alliances,
        pagination: {
          current_page: pagination_page,
          total_pages,
          current_items_count: alliances.length,
          total_items_count: total_items,
        },
      };
      void ApiHelper.updateCache(cachedKey, responseData, cacheTtl);
      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'searchGrandTournamentDataByAllianceName', request);
      return;
    }
  }

  /**
   * Retrieves a paginated snapshot of "Grand Tournament" (Grand Tournament) alliances for a specific hour
   *
   * Query parameters
   * - date: required; ISO 8601 hour precision string (example: "2023-01-23T14:00:00.000Z"). If invalid, returns 400
   * - division_id: optional; integer 1..5. Defaults to 5. If out of range or not a number, returns 400
   * - subdivision_id: optional; integer 1..999_999. If out of range or not a number, returns 400
   * - page: optional; integer >= 1. Defaults to 1
   *
   * Response structure :
   * - {
   *     event: {
   *       division: { current_division: number, min_division: 1, max_division: 5 },
   *       subdivision: { current_subdivision: number | null, min_subdivision: 1, max_subdivision: number },
   *       alliances: Array<{
   *         alliance_id: number | null,    // computed by concatenating DB alliance_id with server code then parseInt
   *         alliance_name: string,
   *         server: string | null,         // server outer_name resolved by zone lookup
   *         rank: number,
   *         score: number,
   *         subdivision: number | null
   *       }>
   *     },
   *     pagination: {
   *       current_page: number,
   *       total_pages: number,
   *       current_items_count: number,
   *       total_items_count: number
   *     }
   *   }
   *
   * @param request - express.Request containing query parameters (date, division_id, subdivision_id, page)
   * @param response - express.Response used to send JSON responses and HTTP status codes
   * @returns Promise<void> - resolves after sending the HTTP response
   */
  public static async getGrandTournament(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate request parameters
       * --------------------------------- */
      const maxAlliancesPerPage = 10;
      const maxDivisionId = 5;
      const date = this.validateDate(request.query.date) ? new Date(String(request.query.date)) : null;
      if (!date) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidFlatDateFormat });
        return;
      }
      const division_id = ApiHelper.validatePageNumber(request.query.division_id, maxDivisionId + 1);
      const subdivision_id = ApiHelper.validatePageNumber(request.query.subdivision_id, -1);
      if (division_id > maxDivisionId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidDivisionId });
        return;
      } else if (subdivision_id < 1) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidSubdivisionId });
        return;
      }
      const pagination_page = request.query.page ? Number.parseInt(String(request.query.page)) : 1;

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cacheVersion = (await ApiHelper.redisClient.get(`grand-tournament:event-dates:version`)) || '-1';
      const cachedKey = `grand-tournament:division:${division_id}:subdivision:${subdivision_id || 'all'}:date:${date.toISOString()}:page:${pagination_page}:v${cacheVersion}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Query database
       * --------------------------------- */
      const offset = (pagination_page - 1) * maxAlliancesPerPage;
      const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
      const baseParameters: (string | number | Date)[] = [date, division_id];
      if (subdivision_id) baseParameters.push(subdivision_id);
      let index = 2;
      const queryAlliances = `
        SELECT
          server_id,
          division_id,
          subdivision_id,
          alliance_id,
          alliance_name,
          rank,
          score,
          created_at
        FROM grand_tournament
        WHERE ($1::timestamp IS NULL
          OR (created_at >= $1::timestamp AND created_at < $1::timestamp + interval '1 hour'))
          AND division_id = $${index++}
          ${subdivision_id ? `AND subdivision_id = $${index++}` : ''}
        ORDER BY created_at DESC, division_id DESC, ${subdivision_id ? 'subdivision_id, rank' : 'score DESC, rank'}
        LIMIT $${index++} OFFSET $${index++};
      `;

      index = 2;
      const queryStats = `
        SELECT
          COUNT(*) AS total_items,
          MAX(subdivision_id) AS max_subdivision_id
        FROM grand_tournament
        WHERE ($1::timestamp IS NULL
              OR (created_at >= $1::timestamp AND created_at < $1::timestamp + interval '1 hour'))
          AND division_id = $${index++}
          ${subdivision_id ? `AND subdivision_id = $${index++}` : ''};
      `;

      const [alliancesResult, statsResult] = await Promise.all([
        pgPool.query(queryAlliances, [...baseParameters, maxAlliancesPerPage, offset]),
        pgPool.query(queryStats, baseParameters),
      ]);

      if (alliancesResult.rows.length === 0 && statsResult.rows.length === 0) {
        response.status(ApiHelper.HTTP_OK).send({ event: { alliances: [] }, pagination: {} });
        return;
      }

      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const total_items = Number(statsResult.rows[0]?.total_items || 0);
      const max_subdivision_id = Number(statsResult.rows[0]?.max_subdivision_id || 1);
      const total_pages = Math.ceil(total_items / maxAlliancesPerPage);
      const alliances = alliancesResult.rows.map((row) => {
        const serverObject = ApiHelper.ggeTrackerManager.getServerByZone(
          'EmpireEx' + (row.server_id === 1 ? '' : '_' + row.server_id),
        );
        const serverCode = serverObject && 'code' in serverObject ? serverObject.code : '999';
        return {
          alliance_id: Number.parseInt(row.alliance_id + serverCode) || null,
          alliance_name: row.alliance_name,
          server: serverObject?.outer_name || null,
          rank: row.rank,
          score: Number(row.score),
          subdivision: row.subdivision_id,
        };
      });

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
      const cacheTtl = 60 * 60 * 6; // 6 hours
      const responseData = {
        event: {
          division: {
            current_division: division_id,
            min_division: 1,
            max_division: 5,
          },
          subdivision: {
            current_subdivision: subdivision_id || null,
            min_subdivision: 1,
            max_subdivision: max_subdivision_id,
          },
          alliances,
        },
        pagination: {
          current_page: pagination_page,
          total_pages,
          current_items_count: alliances.length,
          total_items_count: total_items,
        },
      };
      void ApiHelper.updateCache(cachedKey, responseData, cacheTtl);
      response.status(ApiHelper.HTTP_OK).json(responseData);
    } catch (error: any) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).json({ error: message });
      ApiHelper.logError(error, 'getGrandTournament', request);
    }
  }

  /**
   * Retrieves a paginated list of players for a specific event, with optional filtering by player name and server.
   *
   * @param request - The Express request object, containing route parameters and query parameters:
   *   - `params.id`: The event ID (must be a valid number).
   *   - `params.eventType`: The event type ("outer-realms" or "beyond-the-horizon").
   *   - `query.page`: (Optional) The page number for pagination (defaults to 1).
   *   - `query.player_name`: (Optional) Filter for player names (case-insensitive, max 50 chars).
   *   - `query.server`: (Optional) Filter for server code (max 10 chars).
   * @param response - The Express response object used to send the result or error.
   * @param eventPgDbpool - The PostgreSQL connection pool for querying event data.
   * @returns A Promise that resolves when the response is sent. Responds with a JSON object containing:
   *   - `players`: An array of player objects (with player_id, player_name, rank, point, level, legendary_level, server).
   *   - `pagination`: Pagination metadata (current_page, total_pages, current_items_count, total_items_count).
   *o.
   */
  public static async getEventPlayers(
    request: express.Request,
    response: express.Response,
    eventPgDbpool: pg.Pool,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      const PAGINATION_LIMIT = 15;
      const id = ApiHelper.validatePageNumber(request.params.id, null);
      let page = ApiHelper.validatePageNumber(request.query.page);
      let playerNameFilter = ApiHelper.validateSearchAndSanitize(request.query.player_name);
      let serverFilter = ApiHelper.validateSearchAndSanitize(request.query.server, { maxLength: 10 });
      let eventType = ApiHelper.validateSearchAndSanitize(request.params.eventType);
      if (eventType !== EventTypes.OUTER_REALMS && eventType !== EventTypes.BEYOND_THE_HORIZON) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventType });
        return;
      }
      // Trick: we convert event type to match table name, e.g. "outer-realms" -> "outer_realms_ranking"
      // This needs to be upgraded if we add more event types in the future.
      const sqlTable = eventType.trim().replaceAll('-', '_') + '_ranking';
      if (!id) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventId });
        return;
      }
      if (playerNameFilter === ApiInvalidInputType) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
        return;
      }
      if (serverFilter === ApiInvalidInputType) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidServer });
        return;
      }
      const cachedKey = `events:${eventType}:${id}:players:${page}:${String(playerNameFilter)}:${String(serverFilter)}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      const isValidPlayerNameFilter = ApiHelper.isValidInput(playerNameFilter);
      const isValidServerFilter = ApiHelper.isValidInput(serverFilter);
      /* ---------------------------------
       * Count total items for pagination
       * --------------------------------- */
      let index = 1;
      let countQuery = `
        SELECT COUNT(*) AS total
        FROM ${sqlTable} O
        WHERE O.event_num = $${index++}
        ${isValidPlayerNameFilter ? `AND LOWER(player_name) LIKE $${index++}` : ''}
        ${isValidServerFilter ? `AND O.server = $${index++}` : ''}
        `;
      const countParameters: (string | number)[] = [id];
      if (isValidPlayerNameFilter) {
        countParameters.push(`%${playerNameFilter}%`);
      }
      if (isValidServerFilter) {
        countParameters.push(serverFilter);
      }

      /* ---------------------------------
       * Query paginated results
       * --------------------------------- */
      const countResult = await new Promise<{ total: number }>((resolve, reject) => {
        eventPgDbpool.query(countQuery, countParameters, (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getEventPlayers_countQuery', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows[0]);
          }
        });
      });
      const total = countResult.total;
      if (total == 0) {
        response.status(ApiHelper.HTTP_OK).send({
          players: [],
          pagination: {
            current_page: 1,
            total_pages: 1,
            current_items_count: 0,
            total_items_count: 0,
          },
        });
        return;
      }

      /* ---------------------------------
       * Construct main query
       * --------------------------------- */
      let parameterIndex = 1;
      const offset = (page - 1) * PAGINATION_LIMIT;
      const query = `
        SELECT player_id, player_name, rank, point, server
        FROM ${sqlTable}
        WHERE event_num = $${parameterIndex++}
        ${isValidPlayerNameFilter ? `AND LOWER(player_name) LIKE $${parameterIndex++}` : ''}
        ${isValidServerFilter ? `AND server = $${parameterIndex++}` : ''}
        ORDER BY rank
        LIMIT $${parameterIndex++} OFFSET $${parameterIndex++}
        `;
      const parameters: (string | number)[] = [id];
      if (isValidPlayerNameFilter) {
        parameters.push(`%${playerNameFilter}%`);
      }
      if (isValidServerFilter) {
        parameters.push(serverFilter);
      }
      parameters.push(PAGINATION_LIMIT, offset);

      /* ---------------------------------
       * Query from DB
       * --------------------------------- */
      const results = await new Promise<any[]>((resolve, reject) => {
        eventPgDbpool.query(query, parameters, (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getEventPlayers_query', request);
            reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
          } else {
            resolve(results.rows);
          }
        });
      });

      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const players = results.map((result: any) => ({
        player_id: result.player_id
          ? result.player_id + ApiHelper.ggeTrackerManager.getServerByCode(result.server)
          : null,
        player_name: result.player_name,
        rank: result.rank,
        point: result.point,
        level: result.level,
        legendary_level: result.legendary_level,
        server: result.server,
      }));
      const totalPages = Math.ceil(total / PAGINATION_LIMIT);
      const pagination = {
        current_page: page,
        total_pages: totalPages,
        current_items_count: players.length,
        total_items_count: total,
      };
      const responseData = {
        players,
        pagination,
      };

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
      const cacheTtl = 60 * 60 * 12; // 12 hours
      await ApiHelper.redisClient.setEx(cachedKey, cacheTtl, JSON.stringify(responseData));
      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getEventPlayers', request);
      return;
    }
  }

  /**
   * Handles the retrieval and aggregation of event ranking data for a specified event type and event ID.
   *
   * This endpoint supports only "outer-realms" and "beyond-the-horizon" event types. It performs multiple
   * database queries in parallel to gather statistics such as server rankings, top scores, rank distributions,
   * score statistics, level distributions, and more for the given event. Results are cached in Redis for performance.
   *
   * @param request - Express request object, expects `eventType` and `id` as route parameters.
   * @param response - Express response object used to send the aggregated event data or error messages.
   * @param eventPgDbpool - PostgreSQL connection pool for executing queries.
   *
   * @returns Sends a JSON response containing aggregated event statistics or an error message.
   *
   * @throws 400 - If the event type or event ID is invalid.
   * @throws 500 - If a database or internal error occurs.
   */
  public static async getDataEventType(
    request: express.Request,
    response: express.Response,
    eventPgDbpool: pg.Pool,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      let eventType = request.params.eventType;
      if (eventType !== 'outer-realms' && eventType !== 'beyond-the-horizon') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventType });
        return;
      }
      // Trick: we convert event type to match table name, e.g. "outer-realms" -> "outer_realms_ranking"
      // This needs to be upgraded if we add more event types in the future.
      const sqlTable = eventType.trim().replaceAll('-', '_') + '_ranking';
      const id = request.params.id;
      if (!id || Number.isNaN(Number(id))) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventId });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cachedKey = `events:outer-realms:${id}:data`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Construct queries
       * --------------------------------- */
      // # [1] => Number of players in top 100 by server
      const query_nb_in_top_100 = `
        SELECT server, COUNT(*) AS nb_in_top_100
        FROM ${sqlTable}
        WHERE event_num = $1 AND rank <= 100
        GROUP BY server
        ORDER BY nb_in_top_100 DESC;
        `;
      // # [2] => Top scores (for comparison)
      const query_top_scores = `
        SELECT rank, point
        FROM ${sqlTable}
        WHERE event_num = $1 AND rank IN (1,2,3,100,1000,10000)
        ORDER BY rank;
        `;
      // # [3] => Rank distribution by server
      const query_rank_distribution = `
          SELECT server,
            SUM(CASE WHEN rank <= 100 THEN 1 ELSE 0 END) AS top_100,
            SUM(CASE WHEN rank > 100 AND rank <= 1000 THEN 1 ELSE 0 END) AS top_1000,
            SUM(CASE WHEN rank > 1000 AND rank <= 10000 THEN 1 ELSE 0 END) AS top_10000
          FROM ${sqlTable}
          WHERE event_num = $1
          GROUP BY server
          ORDER BY server;
      `;

      // # [4] => Score statistics (average, median, max)
      const query_score_stats = `
        SELECT
          AVG(point) AS avg_score,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY point) AS median_score,
          MAX(point) AS max_score
        FROM ${sqlTable}
        WHERE event_num = $1;
      `;

      // # [5] => Score standard deviation
      const query_score_stddev = `
        SELECT STDDEV(point) AS score_stddev
        FROM ${sqlTable}
        WHERE event_num = $1;
      `;

      // # [6] => Level distribution
      const query_level_distribution = `
        SELECT level, COUNT(*) AS nb_players, AVG(point) AS avg_score
        FROM ${sqlTable}
        WHERE event_num = $1
        GROUP BY level
        ORDER BY level;
      `;

      // # [7] => Average score by server
      const query_server_avg_score = `
        SELECT
          server,
          AVG(point) AS avg_score,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY point) AS median_score,
          COUNT(*) AS nb_players
        FROM ${sqlTable}
        WHERE event_num = $1
        GROUP BY server
        ORDER BY avg_score DESC;
      `;

      // # [8] => Ratio of players in top 100 by server
      const query_top_100_ratio = `
        WITH server_counts AS (
          SELECT server,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE rank <= 100) AS in_top_100
          FROM ${sqlTable}
          WHERE event_num = $1
          GROUP BY server
        )
        SELECT server,
          in_top_100::float / total AS ratio_top_100
        FROM server_counts
        ORDER BY ratio_top_100 DESC;
      `;

      // # [9] => Event info (collect date, player count)
      const sqlTableWithoutRanked = sqlTable.replace(/_ranking$/, '') + '_event';
      const query_event_info = `
        SELECT collect_date
        FROM ${sqlTableWithoutRanked}
        WHERE event_num = $1
      `;

      /* ---------------------------------
       * Execute queries in parallel
       * --------------------------------- */
      const requests = [
        { query: query_nb_in_top_100, params: [id] },
        { query: query_top_scores, params: [id] },
        { query: query_rank_distribution, params: [id] },
        { query: query_score_stats, params: [id] },
        { query: query_score_stddev, params: [id] },
        { query: query_level_distribution, params: [id] },
        { query: query_server_avg_score, params: [id] },
        { query: query_top_100_ratio, params: [id] },
        { query: query_event_info, params: [id] },
      ];
      const results = await Promise.all(
        requests.map((request_) => {
          return new Promise((resolve, reject) => {
            eventPgDbpool.query(request_.query, request_.params, (error, result) => {
              if (error) {
                ApiHelper.logError(error, 'getDataEventType', request);
                reject(new Error(RouteErrorMessagesEnum.GenericInternalServerError));
              } else {
                resolve(result.rows);
              }
            });
          });
        }),
      );

      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const [
        nbInTop100,
        topScores,
        rankDistribution,
        scoreStats,
        scoreStddev,
        levelDistribution,
        serverAvgScore,
        top100Ratio,
        eventInfo,
      ] = results;
      const responseData = {
        event_id: id,
        event_type: eventType,
        collect_date: formatInTimeZone(
          eventInfo[0]?.collect_date,
          ApiHelper.APPLICATION_TIMEZONE,
          'yyyy-MM-dd HH:mm' + ':00',
        ),
        player_count: eventInfo[0]?.player_count || 0,
        nb_in_top_100: nbInTop100,
        top_scores: {
          top_1: topScores[0]?.point || 0,
          top_2: topScores[1]?.point || 0,
          top_3: topScores[2]?.point || 0,
          top_100: topScores[3]?.point || 0,
          top_1000: topScores[4]?.point || 0,
          top_10000: topScores[5]?.point || 0,
        },
        rank_distribution: rankDistribution,
        score_stats: {
          avg_score: scoreStats[0]?.avg_score || 0,
          median_score: scoreStats[0]?.median_score || 0,
          max_score: scoreStats[0]?.max_score || 0,
        },
        score_stddev: scoreStddev[0]?.score_stddev || 0,
        level_distribution: levelDistribution,
        server_avg_score: serverAvgScore,
        top_100_ratio: top100Ratio,
      };

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
      const cacheTtl = 60 * 60;
      void ApiHelper.updateCache(cachedKey, responseData, cacheTtl);
      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getDataEventType', request);
      return;
    }
  }

  private static validateDate(dateString: any): boolean {
    if (typeof dateString !== 'string') {
      return false;
    }
    // If date is not specific in YYYY-MM-DDTHH:00:00.000Z (with hours precision), reject it
    const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/;
    if (!dateRegex.test(dateString)) {
      return false;
    }
    return true;
  }
}
