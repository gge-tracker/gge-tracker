import { formatInTimeZone } from 'date-fns-tz';
import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { EventTypes } from '../enums/event-types.enums';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { ApiHelper } from '../helper/api-helper';
import { ApiInputErrorType, ApiInvalidInputType } from '../types/parameter.types';
import { TEMP_SERVER_SETTINGS } from '../interfaces/temporary-server-events.config';

/**
 * Abstract class providing API endpoints for event-related data (BTH, OR, GT, ...)
 *
 * The `ApiEvents` class implements the `ApiHelper` interface and exposes static methods to handle
 * HTTP requests for retrieving event lists, event player rankings, and detailed event statistics
 *
 * @abstract
 * @implements {ApiHelper}
 */
export abstract class ApiEvents implements ApiHelper {
  public static CLICKHOUSE_WOA_TABLE_NAME = 'wheel_unimaginable_affluence';
  public static CLICKHOUSE_PLAYER_METRICS_TABLE_NAME = 'player_metrics';

  private static readonly AQUAMARINE_ITEMS_PER_PAGE = 15;
  private static readonly AQUAMARINE_CACHE_TTL_LEADERBOARD = 60 * 60;
  private static readonly AQUAMARINE_CACHE_TTL_PLAYER = 10 * 60;
  private static readonly AQUAMARINE_ALLOWED_ORDER_DIRS = new Set(['ASC', 'DESC']);

  private static readonly STORMY_ISLES_ITEMS_PER_PAGE = 15;
  private static readonly STORMY_ISLES_CACHE_TTL_LEADERBOARD = 60 * 60;
  private static readonly STORMY_ISLES_ALLOWED_METRIC_IDS = new Set([15, 16, 17, 18, 19, 20, 100]);
  private static readonly STORMY_ISLES_ALLOWED_SORTABLE_KEYS = new Set(['player_name', 'level', 'might_current']);

  /**
   * Retrieves a list of events from the database, combining results from both
   * "outer realms" and "beyond the horizon" event sources. Results are cached
   * in Redis for performance optimization. If cached data is available, it is
   * returned immediately; otherwise, the data is queried from the database,
   * formatted, cached, and then returned
   *
   * @param request - The Express request object
   * @param response - The Express response object
   * @param eventPgDbpool - The PostgreSQL connection pool used for querying event data
   * @returns A Promise that resolves when the response has been sent
   */
  public static async getEvents(
    request: express.Request,
    response: express.Response,
    eventPgDbpool: pg.Pool,
  ): Promise<void> {
    try {
      const itemsPerPage = 8;
      /* ---------------------------------
       * Validate request
       * --------------------------------- */
      const eventType = String(request.query.type || '').toLowerCase();
      if (eventType && !Object.values(EventTypes).includes(eventType as EventTypes)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventType });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cachedKey = `events:list:${eventType || 'all'}:page:${page}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Construct Count SQL Query
       * --------------------------------- */
      let whereClause = '';
      if (eventType === EventTypes.OUTER_REALMS) {
        whereClause = `WHERE type = 'outer_realms'`;
      } else if (eventType === EventTypes.BEYOND_THE_HORIZON) {
        whereClause = `WHERE type = 'beyond_the_horizon'`;
      } else {
        whereClause = '';
      }

      const countQuery = `
        SELECT COUNT(*) AS total_count FROM (
          SELECT DISTINCT event_num,
          'outer_realms' AS type
          FROM outer_realms_event
          UNION ALL
          SELECT event_num,
          'beyond_the_horizon' AS type
          FROM beyond_the_horizon_event
        ) AS combined_events
        ${whereClause}
      `;
      const countResult = await eventPgDbpool.query(countQuery);
      const totalCount = Number(countResult.rows[0]?.total_count || 0);
      if (totalCount === 0) {
        response.status(ApiHelper.HTTP_OK).send({
          events: [],
          pagination: { current_page: page, total_pages: 0, current_items_count: 0, total_items_count: 0 },
        });
        return;
      } else if (totalCount < (page - 1) * itemsPerPage) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.PageOutOfRange });
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
        ${whereClause}
        ORDER BY collect_date DESC
        LIMIT ${itemsPerPage} OFFSET ${(page - 1) * itemsPerPage};
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
            collect_date: new Date(result.collect_date).toISOString(),
          }));
          const pagination = {
            current_page: page,
            total_pages: Math.ceil(totalCount / itemsPerPage),
            current_items_count: events.length,
            total_items_count: totalCount,
          };

          /* ---------------------------------
           * Update cache and send response
           * --------------------------------- */
          void ApiHelper.updateCache(cachedKey, { events, pagination }, 3600 * 3);
          response.status(ApiHelper.HTTP_OK).send({ events, pagination });
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
   * - 500 Internal Server Error: on unexpected failures
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
          ARRAY_AGG(hour ORDER BY hour) AS dates
        FROM grand_tournament_hours_mv
        GROUP BY event_id
        ORDER BY event_id;
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
   * - 500 Internal Server Error: on unexpected failures
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
   * - 200 OK: returns cached or freshly fetched response object described above. If no matches, returns { total_items: 0, alliances: [] } (or the standardized response with empty alliances and pagination)
   * - 400 Bad Request: when `date` or `alliance_name` is invalid (or missing); returns appropriate error message
   * - 500 Internal Server Error: on unexpected failures
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
   * Retrieves a paginated snapshot of Grand Tournament alliances for a specific hour
   *
   * Query parameters
   * - date: required; ISO 8601 hour precision string (example: "2023-01-23T14:00:00.000Z"). If invalid, returns 400
   * - division_id: optional; integer 1..5. Defaults to 5. If out of range or not a number, returns 400
   * - subdivision_id: optional; integer 1..999_999. If out of range or not a number, returns 400
   * - page: optional; integer >= 1. Defaults to 1
   *
   * @param request - express.Request containing query parameters (date, division_id, subdivision_id, page)
   * @param response - express.Response used to send JSON responses and HTTP status codes
   *
   * @returns JSON response containing aggregated event data
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
      const subdivision_id = ApiHelper.validatePageNumber(request.query.subdivision_id, null);
      if (division_id > maxDivisionId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidDivisionId });
        return;
      } else if (request.query.subdivision_id && !subdivision_id) {
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

  public static async getEventByPlayerId(request: express.Request, response: express.Response): Promise<void> {
    try {
      const playerId = ApiHelper.verifyIdWithCountryCode(String(request.params.playerId));
      let eventType = String(request.params.eventType).toLowerCase();
      if (eventType !== EventTypes.OUTER_REALMS && eventType !== EventTypes.BEYOND_THE_HORIZON && eventType !== 'all') {
        eventType = 'all';
      }
      if (!playerId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const realPlayerId = ApiHelper.removeCountryCode(playerId);
      const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.FR1);
      let query: string;
      if (eventType === 'all') {
        query = `
          SELECT O.event_num, O.collect_date, R.rank, R.point, R.server, '${EventTypes.OUTER_REALMS}' AS type
          FROM outer_realms_event O
          INNER JOIN outer_realms_ranking R
            ON O.event_num = R.event_num
          WHERE R.player_id = $1
          UNION ALL
          SELECT O.event_num, O.collect_date, R.rank, R.point, R.server, '${EventTypes.BEYOND_THE_HORIZON}' AS type
          FROM beyond_the_horizon_event O
          INNER JOIN beyond_the_horizon_ranking R
            ON O.event_num = R.event_num
          WHERE R.player_id = $1
          ORDER BY collect_date DESC
        `;
      } else {
        query = `
          SELECT O.event_num, O.collect_date, R.rank, R.point, R.server
          FROM ${eventType.trim().replaceAll('-', '_')}_event O
          INNER JOIN ${eventType.trim().replaceAll('-', '_')}_ranking R
            ON O.event_num = R.event_num
          WHERE R.player_id = $1
          ORDER BY O.collect_date DESC
        `;
      }
      pgPool.query(query, [realPlayerId], (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
          return;
        } else {
          const events = results.rows.map((result: any) => ({
            type: result.type || eventType,
            event_num: result.event_num,
            collect_date: new Date(result.collect_date).toISOString(),
            rank: result.rank,
            point: result.point,
            server: result.server,
          }));
          response.status(ApiHelper.HTTP_OK).send({ events });
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getEventByPlayerId', request);
      return;
    }
  }

  /**
   * Retrieves a paginated list of players for a specific event, with optional filtering by player name and server
   *
   * @param request - The Express request object, containing route parameters and query parameters:
   *   - `params.id`: The event ID (must be a valid number)
   *   - `params.eventType`: The event type ("outer-realms" or "beyond-the-horizon")
   *   - `query.page`: (Optional) The page number for pagination (defaults to 1)
   *   - `query.player_name`: (Optional) Filter for player names (case-insensitive, max 50 chars)
   *   - `query.server`: (Optional) Filter for server code (max 10 chars)
   * @param response - The Express response object used to send the result or error
   * @param eventPgDbpool - The PostgreSQL connection pool for querying event data
   *
   * @returns A Promise that resolves when the response is sent. Responds with a JSON object containing:
   *   - `players`: An array of player objects (with player_id, player_name, rank, point, level, legendary_level, server)
   *   - `pagination`: Pagination metadata (current_page, total_pages, current_items_count, total_items_count)
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
      let playerNameFilter = ApiHelper.validateSearchAndSanitize(request.query.player_name, { toLowerCase: false });
      let serverFilter = ApiHelper.validateSearchAndSanitize(request.query.server, { maxLength: 20 });
      let eventType = ApiHelper.validateSearchAndSanitize(request.params.eventType);
      if (eventType !== EventTypes.OUTER_REALMS && eventType !== EventTypes.BEYOND_THE_HORIZON) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventType });
        return;
      }
      // Trick: we convert event type to match table name, e.g. "outer-realms" -> "outer_realms_ranking"
      // This needs to be upgraded if we add more event types in the future
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
        ${isValidPlayerNameFilter ? `AND LOWER(player_name) LIKE LOWER($${index++})` : ''}
        ${isValidServerFilter ? `AND O.server = $${index++}` : ''}
        `;
      const parameters: (string | number)[] = [id];
      if (isValidPlayerNameFilter) {
        parameters.push(`%${playerNameFilter}%`);
      }
      if (isValidServerFilter) {
        parameters.push(serverFilter.toUpperCase());
      }

      /* ---------------------------------
       * Query paginated results
       * --------------------------------- */
      const countResult = await new Promise<{ total: number }>((resolve, reject) => {
        eventPgDbpool.query(countQuery, parameters, (error, results) => {
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
        SELECT player_id, player_name, rank, point, server, alliance_name
        FROM ${sqlTable}
        WHERE event_num = $${parameterIndex++}
        ${isValidPlayerNameFilter ? `AND LOWER(player_name) LIKE LOWER($${parameterIndex++})` : ''}
        ${isValidServerFilter ? `AND server = $${parameterIndex++}` : ''}
        ORDER BY rank
        LIMIT $${parameterIndex++} OFFSET $${parameterIndex++}
        `;
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
          ? result.player_id + ApiHelper.ggeTrackerManager.getOuterServer(result.server)?.code
          : null,
        player_name: result.player_name,
        rank: result.rank,
        point: result.point,
        level: result.level,
        legendary_level: result.legendary_level,
        server: result.server,
        alliance_name: result.alliance_name,
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
   * Handles the retrieval and aggregation of event ranking data for a specified event type and event ID
   *
   * This endpoint supports only "outer-realms" and "beyond-the-horizon" event types. It performs multiple
   * database queries in parallel to gather statistics such as server rankings, top scores, rank distributions,
   * score statistics, level distributions, and more for the given event. Results are cached in Redis for performance
   *
   * @param request - Express request object, expects `eventType` and `id` as route parameters
   * @param response - Express response object used to send the aggregated event data or error messages
   * @param eventPgDbpool - PostgreSQL connection pool for executing queries
   *
   * @returns JSON response containing aggregated event data
   *
   * @throws 400 - If the event type or event ID is invalid
   * @throws 500 - If a database or internal error occurs
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
      // This needs to be upgraded if we add more event types in the future
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
        collect_date: new Date(eventInfo[0]?.collect_date).toISOString(),
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

  /**
   * Retrieves the live Outer Realms ranking data for a specific player
   *
   * This endpoint returns historical ranking data for a player in the Outer Realms event,
   * including their score, rank, level, legendary level, might, and castle position over time
   *
   * @param request - Express request object containing the playerId in params
   * @param request.params.playerId - The player ID with country code to look up
   * @param response - Express response object
   *
   * @returns A Promise that resolves when the response is sent
   *
   * @throws {400} If the player ID is invalid or missing country code
   * @throws {500} If there's an error querying the database or processing the request
   */
  public static async getLiveOuterRealmsRankingSpecificPlayer(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (!playerId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();

      /* ---------------------------------
       * Database query for player data
       * --------------------------------- */
      const playersQuery = `
        SELECT
          player_id,
          player_name,
          server,
          score,
          rank,
          level,
          legendary_level,
          might,
          fetch_date,
          castle_position_x,
          castle_position_y
        FROM ggetracker_global.outer_realms_ranking
        WHERE player_id = {playerId:UInt32}
        ORDER BY fetch_date DESC
      `;
      const rawResult = await clickhouseClient.query({
        query: playersQuery,
        query_params: {
          playerId: playerId,
        },
      });

      const json = await rawResult.json();

      if (json.data.length === 0) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ player: null });
        return;
      }
      const firstEntry: any = json.data[0];
      const finalEntry = {
        // PlayerID is a global playerID, so we do not need to append country code
        player_id: firstEntry.player_id,
        player_name: firstEntry.player_name,
        server: firstEntry.server,
        castle_position: [firstEntry.castle_position_x, firstEntry.castle_position_y],
        data: json.data.map((row: any) => ({
          timestamp: new Date(row.fetch_date).toISOString(),
          might: row.might,
          level: row.level,
          legendary_level: row.legendary_level,
          score: row.score,
          rank: row.rank,
        })),
      };

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */

      const currentOuterRealmsEvent = await this.getCurrentOuterRealmsEvent();
      const responseData = { player: finalEntry, current_event: currentOuterRealmsEvent };
      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getLiveOuterRealmsRankingSpecificPlayer', request);
      return;
    }
  }

  public static async getLiveOuterRealmsRanking(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      const page = ApiHelper.validatePageNumber(request.query.page) || 1;
      const searchPlayerName = ApiHelper.validateSearchAndSanitize(request.query.player_name, {
        maxLength: 50,
        toLowerCase: false,
      });
      const sizePerPage = 10;
      const offset = (page - 1) * sizePerPage;
      const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();

      /* ---------------------------------
       * Query database for players
       * --------------------------------- */
      const playersQuery = `
        WITH
          (SELECT max(fetch_date) FROM ggetracker_global.outer_realms_ranking) AS last_date,
          (
            SELECT max(fetch_date)
            FROM ggetracker_global.outer_realms_ranking
            WHERE fetch_date < last_date
          ) AS prev_date
        SELECT
          now.player_id,
          now.player_name,
          now.server,
          now.score,
          now.rank,
          now.level,
          now.legendary_level,
          now.might,
          now.castle_position_x,
          now.castle_position_y,
          now.fetch_date,
          (now.score - coalesce(before.score, now.score)) AS score_diff,
          (coalesce(before.rank, now.rank) - now.rank) AS rank_diff,
          count() OVER () AS total_count
        FROM ggetracker_global.outer_realms_ranking AS now
        LEFT JOIN
        (
          SELECT player_id, score, rank
          FROM ggetracker_global.outer_realms_ranking
          WHERE fetch_date = prev_date
        ) AS before
        ON before.player_id = now.player_id
        WHERE now.fetch_date = last_date
        ${ApiHelper.isValidInput(searchPlayerName) ? `AND now.player_name_lower LIKE {searchPlayerName:String}` : ''}
        ORDER BY now.rank ASC
        LIMIT ${sizePerPage} OFFSET ${offset};
      `;
      const rawPlayersResult = await clickhouseClient.query({
        query: playersQuery,
        query_params: ApiHelper.isValidInput(searchPlayerName)
          ? { searchPlayerName: `%${searchPlayerName.toLowerCase()}%` }
          : {},
      });
      const jsonPlayers = await rawPlayersResult.json();
      const playersResult: any = jsonPlayers.data;

      /* ---------------------------------
       * Event active verification
       * --------------------------------- */
      const nowTs = new Date();
      const tenMinutesAgo = new Date(nowTs.getTime() - 10 * 60 * 1000);

      if (
        (!ApiHelper.isValidInput(searchPlayerName) || playersResult.length > 0) &&
        (!playersResult[0]?.fetch_date || new Date(playersResult[0]?.fetch_date) < tenMinutesAgo)
      ) {
        response.status(ApiHelper.HTTP_FORBIDDEN).send({ error: RouteErrorMessagesEnum.EventNotActive });
        return;
      }

      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const players = playersResult.map((row: any) => ({
        player_id: row.player_id,
        player_name: row.player_name,
        server: row.server,
        score: row.score,
        rank: row.rank,
        level: row.level,
        legendary_level: row.legendary_level,
        might: row.might,
        rank_diff: row.rank_diff,
        score_diff: row.score_diff,
        castle_position: [row.castle_position_x, row.castle_position_y],
      }));

      /* ---------------------------------
       * Query database for total count
       * --------------------------------- */
      const currentOuterRealmsEvent = await this.getCurrentOuterRealmsEvent();
      const total_items = playersResult[0]?.total_count || 0;
      const total_pages = Math.ceil(total_items / sizePerPage);

      const responseData = {
        players,
        current_event: currentOuterRealmsEvent,
        pagination: {
          current_page: page,
          total_pages,
          current_items_count: players.length,
          total_items_count: total_items,
        },
      };

      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getLiveOuterRealmsRanking', request);
      return;
    }
  }

  public static async getWoaEventsByPlayerId(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(String(request.params.playerId));
      if (!playerId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const realPlayerId = ApiHelper.removeCountryCode(playerId);
      const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(playerId);
      if (!database) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }

      /* ---------------------------------
       * Query database for WOA events of the player
       * --------------------------------- */
      const query = `
        SELECT
          point,
          created_at,
          RANK() OVER (
            PARTITION BY created_at
            ORDER BY point DESC
          ) AS rank
        FROM ${database}.${ApiEvents.CLICKHOUSE_WOA_TABLE_NAME}
        QUALIFY player_id = {playerId:UInt32}
        ORDER BY created_at DESC
        LIMIT 100
      `;
      const rawResult = await clickhouseClient.query({
        query,
        query_params: {
          playerId: realPlayerId,
        },
      });
      const json = await rawResult.json();

      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const events = json.data.map((row: any) => ({
        point: row.point,
        date: new Date(row.created_at).toISOString(),
        rank: row.rank,
      }));
      response.status(ApiHelper.HTTP_OK).send({ events });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getWoaEventsByPlayerId', request);
      return;
    }
  }

  public static async getWoaEventDataByEvent(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      const parameters = this.parseWoaEventSharedParams(request, response);
      if (!parameters) return;
      const { code, page, searchPlayerName, searchAllianceName } = parameters;
      const dateParameter = request.params.date;
      let dateObject: Date;
      if (this.validateDate(dateParameter, true)) {
        dateObject = new Date(dateParameter);
      } else {
        try {
          dateObject = ApiHelper.decodeDate(dateParameter);
        } catch {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidFlatDateFormat });
          return;
        }
      }
      if (Number.isNaN(dateObject.getTime()) || dateObject > new Date()) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidFlatDateFormat });
        return;
      }

      /* ---------------------------------
       * Fetch and return WOA event data
       * --------------------------------- */
      await this.fetchWoaEventData(
        response,
        code,
        dateObject,
        page,
        searchPlayerName,
        searchAllianceName,
        request['pg_pool'] as pg.Pool,
      );
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getWoaEventDataByEvent', request);
    }
  }

  public static async getWoaEventDataById(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      const parameters = this.parseWoaEventSharedParams(request, response);
      if (!parameters) return;
      const { code, page, searchPlayerName, searchAllianceName } = parameters;
      let dateObject: Date;
      try {
        dateObject = ApiHelper.decodeDate(request.params.id);
      } catch {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      }
      if (Number.isNaN(dateObject.getTime()) || dateObject > new Date()) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidInput });
        return;
      }

      /* ---------------------------------
       * Fetch and return WOA event data
       * --------------------------------- */
      await this.fetchWoaEventData(
        response,
        code,
        dateObject,
        page,
        searchPlayerName,
        searchAllianceName,
        request['pg_pool'] as pg.Pool,
      );
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getWoaEventDataById', request);
    }
  }

  public static async getWoaEventList(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate and parse parameters
       * --------------------------------- */
      const code = request['code'];
      const page = ApiHelper.validatePageNumber(request.query.page) || 1;
      const itemsPerPage = 8;
      if (!ApiHelper.ggeTrackerManager.isValidCode(code)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromCode(code);
      if (!database) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cachedKey = `woa_events:${code}-page:${page}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Query database for WOA events list
       * --------------------------------- */
      const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const rawCountResult = await clickhouseClient.query({
        query: `SELECT COUNT(DISTINCT created_at) AS total FROM ${database}.${ApiEvents.CLICKHOUSE_WOA_TABLE_NAME}`,
      });
      const jsonCount: any = await rawCountResult.json();
      const total = jsonCount.data[0] ? Number(jsonCount.data[0].total) : 0;
      if (total === 0) {
        response.status(ApiHelper.HTTP_OK).send({
          events: [],
          pagination: { current_page: page, total_pages: 1, current_items_count: 0, total_items_count: 0 },
        });
        return;
      }

      /* ---------------------------------
       * Construct and execute query
       * --------------------------------- */
      const rawResult = await clickhouseClient.query({
        query: `
          SELECT
            created_at,
            COUNT(DISTINCT player_id) AS participants,
            SUM(point) AS total_points
          FROM ${database}.${ApiEvents.CLICKHOUSE_WOA_TABLE_NAME}
          GROUP BY created_at
          ORDER BY created_at DESC
          LIMIT ${itemsPerPage} OFFSET ${(page - 1) * itemsPerPage}
        `,
      });
      const json = await rawResult.json();

      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const events = json.data.map((row: any) => ({
        date: new Date(row.created_at).toISOString(),
        participants: row.participants || 0,
        total_tickets: row.total_points || 0,
        id: ApiHelper.encodeDate(new Date(row.created_at).toISOString()),
      }));
      const total_pages = Math.ceil(total / itemsPerPage);
      const pagination = {
        current_page: page,
        total_pages,
        current_items_count: events.length,
        total_items_count: total,
      };
      void ApiHelper.updateCache(cachedKey, { events, pagination }, 60 * 60);
      response.status(ApiHelper.HTTP_OK).send({ events, pagination });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getWoaEventList', request);
    }
  }

  public static async getAquamarinePointsByPlayerId(
    request: express.Request,
    response: express.Response,
  ): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerId = ApiHelper.verifyIdWithCountryCode(String(request.params.playerId));
      if (!playerId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const realPlayerId = Number(ApiHelper.removeCountryCode(playerId));

      const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromRequestId(playerId);
      if (!database) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const cachedKey = `aquamarine:player:${playerId}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * ClickHouse query
       * --------------------------------- */
      const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const rawResult = await clickhouseClient.query({
        query: `
          SELECT
            metric_id,
            value,
            collected_at
          FROM ${database}.${ApiEvents.CLICKHOUSE_PLAYER_METRICS_TABLE_NAME}
          WHERE player_id = {playerId:UInt32}
          ORDER BY collected_at DESC
        `,
        query_params: { playerId: realPlayerId },
      });
      const json = await rawResult.json();

      if (json.data.length === 0) {
        response.status(ApiHelper.HTTP_OK).send({ metrics: [] });
        return;
      }

      /* ---------------------------------
       * Format results into snapshots
       * grouped by collected_at timestamp
       * --------------------------------- */
      const snapshotMap = new Map<string, { metric_id: number; value: number }[]>();
      for (const row of json.data as Array<{ metric_id: number; value: number; collected_at: string }>) {
        const ts = new Date(row.collected_at).toISOString();
        if (!snapshotMap.has(ts)) snapshotMap.set(ts, []);
        snapshotMap.get(ts)!.push({ metric_id: Number(row.metric_id), value: Number(row.value) });
      }
      const snapshots = [...snapshotMap.entries()].map(([collected_at, metrics]) => ({
        collected_at,
        metrics,
      }));

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
      const responseData = { player_id: String(playerId), snapshots };
      void ApiHelper.updateCache(cachedKey, responseData, ApiEvents.AQUAMARINE_CACHE_TTL_PLAYER);
      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAquamarinePointsByPlayerId', request);
    }
  }

  public static async getAquamarinePointsData(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const code = request['code'] as string;
      const pgPool = request['pg_pool'] as pg.Pool;
      if (!ApiHelper.ggeTrackerManager.isValidCode(code)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromCode(code);
      if (!database) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const rawOrderDirection = String(request.query.order_dir || 'DESC').toUpperCase();
      const orderDirection = ApiEvents.AQUAMARINE_ALLOWED_ORDER_DIRS.has(rawOrderDirection)
        ? rawOrderDirection
        : 'DESC';
      const rawOrderBy = request.query.order_by;
      let orderByMetricId: number | null = null;
      let orderByDate = false;
      if (rawOrderBy === 'collected_at') {
        orderByDate = true;
      } else {
        const parsed = Number.parseInt(String(rawOrderBy ?? 100));
        orderByMetricId = Number.isNaN(parsed) || parsed < 0 ? 100 : parsed;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const orderKey = orderByDate ? 'collected_at' : String(orderByMetricId);
      const cachedKey = `aquamarine:leaderboard:${code}:page:${page}:order:${orderKey}:${orderDirection}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * ClickHouse query to get paginated
       * player metrics with sorting
       * --------------------------------- */
      const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const table = `${database}.${ApiEvents.CLICKHOUSE_PLAYER_METRICS_TABLE_NAME}`;
      const limit = ApiEvents.AQUAMARINE_ITEMS_PER_PAGE;
      const offset = (page - 1) * limit;

      const [rawCount, rawData] = await Promise.all([
        clickhouseClient.query({
          query: `SELECT COUNT(DISTINCT player_id) AS total FROM ${table}`,
        }),
        clickhouseClient.query({
          // Inner query: argMax per (player_id, metric_id) to pick the latest value
          // Outer query: pivot into arrays and extract the sort column
          query: `
            SELECT
              player_id,
              groupArray(metric_id)    AS metric_ids,
              groupArray(latest_value) AS latest_values,
              max(last_collected_at)   AS last_collected_at,
              sumIf(latest_value, metric_id = {orderMetricId:Int64}) AS order_metric_value
            FROM (
              SELECT
                player_id,
                metric_id,
                argMax(value, collected_at) AS latest_value,
                max(collected_at)           AS last_collected_at
              FROM ${table}
              GROUP BY player_id, metric_id
            )
            GROUP BY player_id
            ORDER BY ${orderByDate ? 'last_collected_at' : 'order_metric_value'} ${orderDirection}
            LIMIT ${limit} OFFSET ${offset}
          `,
          query_params: { orderMetricId: orderByMetricId ?? 100 },
        }),
      ]);
      const jsonCount = await rawCount.json();
      const total_items = Number((jsonCount.data as Array<{ total: number }>)[0]?.total ?? 0);
      if (total_items === 0) {
        const empty = {
          players: [],
          pagination: { current_page: page, total_pages: 1, current_items_count: 0, total_items_count: 0 },
        };
        response.status(ApiHelper.HTTP_OK).send(empty);
        return;
      }

      /* ---------------------------------
       * Format ClickHouse results and
       * enrich with PostgreSQL player data
       * --------------------------------- */
      const jsonData = await rawData.json();
      const rows = jsonData.data as Array<{
        player_id: number;
        metric_ids: number[];
        latest_values: number[];
        last_collected_at: string;
      }>;
      const playerIds = rows.map((r) => r.player_id);
      const pgResult = await pgPool.query(
        `SELECT id, name AS player_name, alliance_id, might_current AS player_current_might
          FROM players WHERE id = ANY($1)`,
        [playerIds],
      );
      const pgById = new Map(pgResult.rows.map((r: any) => [r.id, r]));

      /* ---------------------------------
       * Construct final player data with metrics
       * --------------------------------- */
      const players = rows.map((row) => {
        const metrics: Record<number, number> = {};
        for (let index = 0; index < row.metric_ids.length; index++) {
          metrics[Number(row.metric_ids[index])] = Number(row.latest_values[index]);
        }
        const pg = pgById.get(row.player_id);
        return {
          player_id: ApiHelper.addCountryCode(String(row.player_id), code),
          player_name: pg?.player_name ?? null,
          alliance_id: pg?.alliance_id ? ApiHelper.addCountryCode(String(pg.alliance_id), code) : null,
          player_current_might: pg?.player_current_might ?? 0,
          metrics,
          last_collected_at: new Date(row.last_collected_at).toISOString(),
        };
      });

      const total_pages = Math.ceil(total_items / limit);
      const responseData = {
        players,
        pagination: {
          current_page: page,
          total_pages,
          current_items_count: players.length,
          total_items_count: total_items,
        },
      };
      void ApiHelper.updateCache(cachedKey, responseData, ApiEvents.AQUAMARINE_CACHE_TTL_LEADERBOARD);
      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getAquamarinePointsData', request);
    }
  }

  public static async getStormyIslesLeaderboard(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const pgPool = request['pg_pool'] as pg.Pool;
      const code = request['code'] as string;
      if (!ApiHelper.ggeTrackerManager.isValidCode(code)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromCode(code);
      if (!database) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const page = ApiHelper.validatePageNumber(request.query.page);
      const rawOrderDirection = String(request.query.order_dir || 'DESC').toUpperCase();
      const orderDirection = ['ASC', 'DESC'].includes(rawOrderDirection) ? rawOrderDirection : 'DESC';
      const rawOrderBy = String(request.query.order_by);
      let orderMetricId: number | string = 100;
      if (rawOrderBy !== undefined && ApiEvents.STORMY_ISLES_ALLOWED_METRIC_IDS.has(Number(rawOrderBy))) {
        orderMetricId = Number(rawOrderBy);
      } else if (this.STORMY_ISLES_ALLOWED_SORTABLE_KEYS.has(rawOrderBy)) {
        orderMetricId = rawOrderBy;
      }
      const playerNameRaw = ApiHelper.validateSearchAndSanitize(request.query.player_name, { toLowerCase: false });
      const allianceNameRaw = ApiHelper.validateSearchAndSanitize(request.query.alliance_name, { toLowerCase: false });
      const playerNameString = ApiHelper.isValidInput(playerNameRaw) ? playerNameRaw : null;
      const allianceNameString = ApiHelper.isValidInput(allianceNameRaw) ? allianceNameRaw : null;

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const filterKey = `pn:${playerNameString ?? ''}:an:${allianceNameString ?? ''}`;
      const cachedKey = `stormy-isles:lb:${code}:p:${page}:o:${orderMetricId}:${orderDirection}:${filterKey}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Pre-filtering in PostgreSQL to get relevant
       * player IDs based on name/alliance search
       * --------------------------------- */
      const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
      const table = `${database}.${ApiEvents.CLICKHOUSE_PLAYER_METRICS_TABLE_NAME}`;
      const limit = ApiEvents.STORMY_ISLES_ITEMS_PER_PAGE;
      const offset = (page - 1) * limit;

      const latestDateResult = await clickhouseClient.query({
        query: `SELECT toDate(MAX(collected_at)) AS latest_date FROM ${table}`,
      });
      const latestDateJson = await latestDateResult.json();
      const latestDate = (latestDateJson.data as Array<{ latest_date: string }>)[0]?.latest_date;
      if (!latestDate) {
        const empty = {
          players: [],
          snapshot_date: null,
          pagination: { current_page: page, total_pages: 0, current_items_count: 0, total_items_count: 0 },
        };
        response.status(ApiHelper.HTTP_OK).send(empty);
        return;
      }

      /* ---------------------------------
       * Filter player/alliance IDs (string match)
       * --------------------------------- */
      let pgFilteredIds: number[] | null = null;
      if (playerNameString || allianceNameString) {
        const conditions: string[] = [];
        const pgParameters: unknown[] = [];
        if (playerNameString) {
          pgParameters.push(`%${playerNameString}%`);
          conditions.push(`P.name ILIKE $${pgParameters.length}`);
        }
        if (allianceNameString) {
          pgParameters.push(`%${allianceNameString}%`);
          conditions.push(`A.name ILIKE $${pgParameters.length}`);
        }
        const pgFilterResult = await pgPool.query(
          `SELECT P.id FROM players P LEFT JOIN alliances A ON P.alliance_id = A.id WHERE ${conditions.join(' AND ')}`,
          pgParameters,
        );
        pgFilteredIds = pgFilterResult.rows.map((r: { id: number }) => r.id);
        if (pgFilteredIds.length === 0) {
          const empty = {
            players: [],
            snapshot_date: latestDate,
            pagination: { current_page: page, total_pages: 0, current_items_count: 0, total_items_count: 0 },
          };
          response.status(ApiHelper.HTTP_OK).send(empty);
          return;
        }
      }
      const playerIdClause = pgFilteredIds ? `AND player_id IN (${pgFilteredIds.join(',')})` : '';

      /* ---------------------------------
       * Branch: sort by PostgreSQL player field
       * (player_name, level, might_current)
       * --------------------------------- */
      if (typeof orderMetricId === 'string') {
        const chIdsResult = await clickhouseClient.query({
          query: `
            SELECT DISTINCT player_id
            FROM ${table}
            WHERE toDate(collected_at) = {latestDate:String}
            ${playerIdClause}
          `,
          query_params: { latestDate },
        });
        const chIdsJson = await chIdsResult.json();
        const allChPlayerIds = (chIdsJson.data as Array<{ player_id: number }>).map((r) => r.player_id);
        if (allChPlayerIds.length === 0) {
          const empty = {
            players: [],
            snapshot_date: latestDate,
            pagination: { current_page: page, total_pages: 0, current_items_count: 0, total_items_count: 0 },
          };
          response.status(ApiHelper.HTTP_OK).send(empty);
          return;
        }

        const pgSortExpr =
          orderMetricId === 'player_name'
            ? 'P.name'
            : orderMetricId === 'level'
              ? '(P.level + P.legendary_level)'
              : 'P.might_current';
        const [pgCountResult, pgPageResult] = await Promise.all([
          pgPool.query(`SELECT COUNT(*) AS total FROM players P WHERE P.id = ANY($1)`, [allChPlayerIds]),
          pgPool.query(
            `SELECT
                P.id,
                P.name         AS player_name,
                P.alliance_id,
                A.name         AS alliance_name,
                P.might_current,
                P.might_all_time,
                P.level,
                P.legendary_level
              FROM players P
              LEFT JOIN alliances A ON P.alliance_id = A.id
              WHERE P.id = ANY($1)
              ORDER BY ${pgSortExpr} ${orderDirection}
              LIMIT $2 OFFSET $3`,
            [allChPlayerIds, limit, offset],
          ),
        ]);
        const pgTotal = Number(pgCountResult.rows[0]?.total ?? 0);
        if (pgTotal === 0) {
          const empty = {
            players: [],
            snapshot_date: latestDate,
            pagination: { current_page: page, total_pages: 0, current_items_count: 0, total_items_count: 0 },
          };
          response.status(ApiHelper.HTTP_OK).send(empty);
          return;
        }
        const pgRows = pgPageResult.rows as Array<{
          id: number;
          player_name: string | null;
          alliance_id: number | null;
          alliance_name: string | null;
          might_current: number;
          might_all_time: number;
          level: number;
          legendary_level: number;
        }>;
        const pagePlayerIds = pgRows.map((r) => r.id);

        const metricsByPlayerId = new Map<
          number,
          { metric_ids: number[]; metric_values: number[]; latest_collected_at: string }
        >();
        if (pagePlayerIds.length > 0) {
          const chMetricsResult = await clickhouseClient.query({
            query: `
              SELECT
                player_id,
                groupArray(metric_id)  AS metric_ids,
                groupArray(value)      AS metric_values,
                any(collected_at)      AS latest_collected_at
              FROM ${table}
              WHERE toDate(collected_at) = {latestDate:String}
                AND player_id IN (${pagePlayerIds.join(',')})
              GROUP BY player_id
            `,
            query_params: { latestDate },
          });
          const chMetricsJson = await chMetricsResult.json();
          for (const r of chMetricsJson.data as Array<{
            player_id: number;
            metric_ids: number[];
            metric_values: number[];
            latest_collected_at: string;
          }>) {
            metricsByPlayerId.set(Number(r.player_id), r);
          }
        }

        const players = pgRows.map((pg, index) => {
          const chRow = metricsByPlayerId.get(pg.id);
          const metrics: Record<number, number> = {};
          if (chRow) {
            for (let index_ = 0; index_ < chRow.metric_ids.length; index_++) {
              metrics[Number(chRow.metric_ids[index_])] = Number(chRow.metric_values[index_]);
            }
          }
          return {
            rank: offset + index + 1,
            player_id: ApiHelper.addCountryCode(String(pg.id), code),
            player_name: pg.player_name ?? null,
            alliance_id: pg.alliance_id ? ApiHelper.addCountryCode(String(pg.alliance_id), code) : null,
            alliance_name: pg.alliance_name ?? null,
            might_current: pg.might_current ?? 0,
            might_all_time: pg.might_all_time ?? 0,
            level: pg.level ?? 0,
            legendary_level: pg.legendary_level ?? 0,
            metrics,
            collected_at: chRow ? new Date(chRow.latest_collected_at).toISOString() : null,
          };
        });
        const total_pages = Math.ceil(pgTotal / limit);
        const responseData = {
          players,
          snapshot_date: latestDate,
          pagination: {
            current_page: page,
            total_pages,
            current_items_count: players.length,
            total_items_count: pgTotal,
          },
        };
        void ApiHelper.updateCache(cachedKey, responseData, ApiEvents.STORMY_ISLES_CACHE_TTL_LEADERBOARD);
        response.status(ApiHelper.HTTP_OK).send(responseData);
        return;
      }

      /* ---------------------------------
       * ClickHouse query to get paginated, sorted
       * player metrics (metric_id sort)
       * --------------------------------- */
      const [rawCount, rawData] = await Promise.all([
        clickhouseClient.query({
          query: `
            SELECT COUNT(DISTINCT player_id) AS total
            FROM ${table}
            WHERE toDate(collected_at) = {latestDate:String}
            ${playerIdClause}
          `,
          query_params: { latestDate },
        }),
        clickhouseClient.query({
          query: `
            SELECT
              player_id,
              groupArray(metric_id)    AS metric_ids,
              groupArray(value)        AS metric_values,
              any(collected_at)        AS latest_collected_at,
              sumIf(value, metric_id = {orderMetricId:Int64}) AS order_metric_value
            FROM ${table}
            WHERE toDate(collected_at) = {latestDate:String}
            ${playerIdClause}
            GROUP BY player_id
            ORDER BY order_metric_value ${orderDirection}
            LIMIT ${limit} OFFSET ${offset}
          `,
          query_params: { latestDate, orderMetricId },
        }),
      ]);
      const jsonCount = await rawCount.json();
      const total_items = Number((jsonCount.data as Array<{ total: number }>)[0]?.total ?? 0);
      if (total_items === 0) {
        const empty = {
          players: [],
          snapshot_date: latestDate,
          pagination: { current_page: page, total_pages: 0, current_items_count: 0, total_items_count: 0 },
        };
        response.status(ApiHelper.HTTP_OK).send(empty);
        return;
      }
      const jsonData = await rawData.json();
      const rows = jsonData.data as Array<{
        player_id: number;
        metric_ids: number[];
        metric_values: number[];
        latest_collected_at: string;
      }>;

      /* ---------------------------------
       * Enrich with PostgreSQL player data
       * --------------------------------- */
      const playerIds = rows.map((r) => r.player_id);
      const pgResult = await pgPool.query(
        `SELECT
          P.id,
          P.name         AS player_name,
          P.alliance_id,
          A.name         AS alliance_name,
          P.might_current,
          P.might_all_time,
          P.level,
          P.legendary_level
          FROM players P
          LEFT JOIN alliances A ON P.alliance_id = A.id
          WHERE P.id = ANY($1)`,
        [playerIds],
      );
      const pgById = new Map(pgResult.rows.map((r: any) => [r.id, r]));

      /* ---------------------------------
       * Format and respond
       * --------------------------------- */
      const players = rows.map((row, index) => {
        const metrics: Record<number, number> = {};
        for (let index_ = 0; index_ < row.metric_ids.length; index_++) {
          metrics[Number(row.metric_ids[index_])] = Number(row.metric_values[index_]);
        }
        const pg = pgById.get(row.player_id);
        return {
          rank: offset + index + 1,
          player_id: ApiHelper.addCountryCode(String(row.player_id), code),
          player_name: pg?.player_name ?? null,
          alliance_id: pg?.alliance_id ? ApiHelper.addCountryCode(String(pg.alliance_id), code) : null,
          alliance_name: pg?.alliance_name ?? null,
          might_current: pg?.might_current ?? 0,
          might_all_time: pg?.might_all_time ?? 0,
          level: pg?.level ?? 0,
          legendary_level: pg?.legendary_level ?? 0,
          metrics,
          collected_at: new Date(row.latest_collected_at).toISOString(),
        };
      });

      const total_pages = Math.ceil(total_items / limit);
      const responseData = {
        players,
        snapshot_date: latestDate,
        pagination: {
          current_page: page,
          total_pages,
          current_items_count: players.length,
          total_items_count: total_items,
        },
      };
      void ApiHelper.updateCache(cachedKey, responseData, ApiEvents.STORMY_ISLES_CACHE_TTL_LEADERBOARD);
      response.status(ApiHelper.HTTP_OK).send(responseData);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStormyIslesLeaderboard', request);
    }
  }

  /**
   * Parses and validates shared parameters for WoA event requests
   * @param request express.Request object containing the request parameters
   * @param response express.Response object to send the response in case of errors
   * @returns An object containing the parsed parameters or null if validation fails
   */
  private static parseWoaEventSharedParams(
    request: express.Request,
    response: express.Response,
  ): {
    code: string;
    page: number;
    searchPlayerName: ApiInputErrorType | string;
    searchAllianceName: ApiInputErrorType | string;
  } | null {
    const code = request['code'];
    const page = ApiHelper.validatePageNumber(request.query.page) || 1;
    const searchPlayerName = ApiHelper.validateSearchAndSanitize(request.query.player_name, {
      maxLength: 50,
      toLowerCase: false,
    });
    const searchAllianceName = ApiHelper.validateSearchAndSanitize(request.query.alliance_name, {
      maxLength: 50,
      toLowerCase: false,
    });
    if (!ApiHelper.ggeTrackerManager.isValidCode(code)) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
      return null;
    }
    if (searchPlayerName === ApiInvalidInputType) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
      return null;
    }
    if (searchAllianceName === ApiInvalidInputType) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidAllianceName });
      return null;
    }
    return { code, page, searchPlayerName, searchAllianceName };
  }

  /**
   * Core WoA event data fetcher: runs the ClickHouse leaderboard query for the given date
   * and enriches results with PostgreSQL player details; Sends the final response directly
   * @param response express.Response object to send the response
   * @param code game code
   * @param dateObject Date object representing the event date
   * @param page pagination page number
   * @param searchPlayerName optional player name filter (takes precedence over alliance filter)
   * @param searchAllianceName optional alliance name filter
   * @param pgPool PostgreSQL connection pool for player data enrichment
   */
  private static async fetchWoaEventData(
    response: express.Response,
    code: string,
    dateObject: Date,
    page: number,
    searchPlayerName: ApiInputErrorType | string,
    searchAllianceName: ApiInputErrorType | string,
    pgPool: pg.Pool,
  ): Promise<void> {
    const sizePerPage = 15;
    const emptyResponse = {
      players: [],
      event_date: dateObject.toISOString(),
      pagination: { current_page: page, total_pages: 1, current_items_count: 0, total_items_count: 0 },
    };

    const cachedKey = `woa_event_data:${code}:${dateObject.toISOString()}:${page}:${String(searchPlayerName)}:${String(searchAllianceName)}`;
    const cachedData = await ApiHelper.redisClient.get(cachedKey);
    if (cachedData) {
      response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
      return;
    }

    // Note: player_name and alliance_name filters are mutually
    // exclusive; but player_name takes precedence
    let idsToFilter: number[] = [];
    try {
      if (ApiHelper.isValidInput(searchPlayerName)) {
        const results = await pgPool.query(
          `SELECT P.id FROM players P WHERE LOWER(P.name) = LOWER($1) AND P.castles <> '[]';`,
          [searchPlayerName],
        );
        if (results.rows.length === 0) throw new Error('No player found');
        idsToFilter = results.rows.map((row) => row.id);
      } else if (ApiHelper.isValidInput(searchAllianceName)) {
        const results = await pgPool.query(
          `SELECT P.id FROM players P LEFT JOIN active_alliances A ON A.id = P.alliance_id WHERE LOWER(A.name) = LOWER($1) AND P.castles <> '[]';`,
          [searchAllianceName],
        );
        if (results.rows.length === 0) throw new Error('No alliance found');
        idsToFilter = results.rows.map((row) => row.id);
      }
    } catch {
      response.status(ApiHelper.HTTP_OK).send(emptyResponse);
      return;
    }

    const database = ApiHelper.ggeTrackerManager.getOlapDatabaseFromCode(code);
    if (!database) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
      return;
    }

    const clickhouseClient = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    const dateParameter = dateObject.toISOString().slice(0, 19).replace('T', ' ');
    const playerFilter = idsToFilter.length > 0 ? `AND player_id IN (${idsToFilter.join(',')})` : '';

    const rawCountResult = await clickhouseClient.query({
      query: `
        SELECT COUNT(*) AS total_items
        FROM ${database}.${ApiEvents.CLICKHOUSE_WOA_TABLE_NAME}
        WHERE created_at = toDateTime({date:String})
        ${playerFilter}
      `,
      query_params: { date: dateParameter },
    });
    const jsonCount = await rawCountResult.json();
    const total_items = (jsonCount.data as Array<{ total_items: number }>)[0]
      ? Number((jsonCount.data as Array<{ total_items: number }>)[0].total_items)
      : 0;
    if (total_items === 0) {
      response.status(ApiHelper.HTTP_OK).send(emptyResponse);
      return;
    }

    const rawResult = await clickhouseClient.query({
      query: `
        SELECT
          player_id,
          point,
        FROM ${database}.${ApiEvents.CLICKHOUSE_WOA_TABLE_NAME}
        WHERE
          created_at = toDateTime({date:String})
          ${playerFilter}
        ORDER BY point DESC
        LIMIT ${sizePerPage} OFFSET ${(page - 1) * sizePerPage}
      `,
      query_params: { date: dateParameter },
    });
    const json = await rawResult.json();
    if (json.data.length === 0) {
      response.status(ApiHelper.HTTP_OK).send(emptyResponse);
      return;
    }

    const playerIds = json.data.map((row: any) => row.player_id);
    const pgResult = await pgPool.query(
      `
      SELECT
        P.id,
        P.name AS player_name,
        P.alliance_rank AS player_alliance_rank,
        P.might_current AS player_current_might,
        P.might_all_time AS player_all_time_might,
        P.level AS player_level,
        P.legendary_level AS player_legendary_level,
        P.alliance_id,
        A.name AS alliance_name
      FROM players P LEFT JOIN alliances A ON A.id = P.alliance_id
      WHERE P.id = ANY($1)
      `,
      [playerIds],
    );
    const playersData = pgResult.rows;
    const players = json.data.map((row: any) => {
      const playerInfo = playersData.find((player: any) => player.id === row.player_id);
      return {
        player_id: row.player_id ? ApiHelper.addCountryCode(row.player_id, code) : null,
        player_name: playerInfo?.player_name || 'Unknown',
        alliance_id: playerInfo?.alliance_id ? ApiHelper.addCountryCode(playerInfo.alliance_id, code) : null,
        alliance_name: playerInfo?.alliance_name || null,
        alliance_rank: playerInfo?.player_alliance_rank || null,
        player_current_might: playerInfo?.player_current_might || 0,
        player_all_time_might: playerInfo?.player_all_time_might || 0,
        player_level: playerInfo?.player_level || 0,
        player_legendary_level: playerInfo?.player_legendary_level || 0,
        point: row.point,
      };
    });
    const total_pages = Math.ceil(total_items / sizePerPage);
    const responseData = {
      players,
      event_date: dateObject.toISOString(),
      pagination: {
        current_page: page,
        total_pages,
        current_items_count: players.length,
        total_items_count: total_items,
      },
    };
    void ApiHelper.updateCache(cachedKey, responseData, 60 * 60);
    response.status(ApiHelper.HTTP_OK).send(responseData);
  }

  /**
   * Validates that the provided value is a date-time string with hour precision
   * in strict UTC ISO-8601 form: YYYY-MM-DDTHH:00:00.000Z (if hourPrecision is true)
   * or YYYY-MM-DDTHH:mm:ss.000Z (if hourPrecision is false or not provided)
   *
   * @upgrade This method should be replaced with a more robust date-time validation library if needed
   * @param dateString - The value to validate as a date-time string
   * @param hourPrecision - Whether to validate for hour precision (true) or second precision (false, default)
   * @returns True if the value is a valid date-time string in the expected format, false otherwise
   */
  private static validateDate(dateString: any, hourPrecision: boolean = false): boolean {
    if (typeof dateString !== 'string') {
      return false;
    }
    let dateRegex: RegExp;
    if (hourPrecision) {
      dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/;
    } else {
      dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/;
    }
    if (!dateRegex.test(dateString)) {
      return false;
    }
    return true;
  }

  /**
   * Retrieves the current active Outer Realms event's scoring system from Redis
   *
   * @returns The scoring system of the current active Outer Realms event, or null if not found or in case of an error
   */
  private static async getCurrentOuterRealmsEvent(): Promise<string | null> {
    try {
      const temporaryServerData = await ApiHelper.redisClient.get('temporaryServerData');
      const temporaryServerSetting = TEMP_SERVER_SETTINGS.find(
        (element) => element.settingID && Number(element.settingID) === Number(temporaryServerData),
      );
      if (temporaryServerSetting) {
        return temporaryServerSetting?.scoringSystem;
      }
      throw new Error('No temporary server data found in Redis');
    } catch (error) {
      ApiHelper.logError(error, 'getCurrentOuterRealmsEvent', null);
      return null;
    }
  }
}
