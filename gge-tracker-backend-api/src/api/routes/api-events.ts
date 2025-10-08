import * as express from 'express';
import { ApiHelper } from '../api-helper';
import * as pg from 'pg';
import { formatInTimeZone } from 'date-fns-tz';

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
   *
   * @remarks
   * - The returned event objects include `event_num`, `player_count`, `type`, and a formatted `collect_date`.
   * - On error, responds with HTTP 500 and an error message.
   * - Uses `ApiHelper.redisClient` for caching and `ApiHelper.updateCache` to update the cache.
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
          void ApiHelper.updateCache(cachedKey, { events });
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
      const id = request.params.id;
      let page = Number.parseInt(request.query.page as string) || 1;
      let playerNameFilter = (request.query.player_name as string) || '';
      let serverFilter = (request.query.server as string) || null;
      let eventType = request.params.eventType;
      if (eventType !== 'outer-realms' && eventType !== 'beyond-the-horizon') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid event type' });
        return;
      }
      // Trick: we convert event type to match table name, e.g. "outer-realms" -> "outer_realms_ranking"
      // This needs to be upgraded if we add more event types in the future.
      const sqlTable = eventType.trim().replaceAll('-', '_') + '_ranking';
      if (!id || Number.isNaN(Number(id))) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid event ID' });
        return;
      }
      if (Number.isNaN(page) || page < 1 || page > ApiHelper.MAX_RESULT_PAGE) {
        page = 1;
      }
      if (playerNameFilter) {
        playerNameFilter = playerNameFilter.trim().toLowerCase();
      }
      if (playerNameFilter.length > 50) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Player name filter is too long' });
        return;
      }
      if (serverFilter && serverFilter.length > 10) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid server filter' });
        return;
      }
      const cachedKey = `events:${eventType}:${id}:players:${page}:${playerNameFilter}:${serverFilter || 'all'}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Count total items for pagination
       * --------------------------------- */
      let index = 1;
      let countQuery = `
        SELECT COUNT(*) AS total
        FROM ${sqlTable} O
        WHERE O.event_num = $${index++}
        ${playerNameFilter ? `AND LOWER(player_name) LIKE $${index++}` : ''}
        ${serverFilter ? `AND O.server = $${index++}` : ''}
        `;
      const countParameters: (string | number)[] = [id];
      if (playerNameFilter) {
        countParameters.push(`%${playerNameFilter}%`);
      }
      if (serverFilter) {
        countParameters.push(serverFilter);
      }

      /* ---------------------------------
       * Query paginated results
       * --------------------------------- */
      const countResult = await new Promise<{ total: number }>((resolve, reject) => {
        eventPgDbpool.query(countQuery, countParameters, (error, results) => {
          if (error) {
            reject(error);
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
        ${playerNameFilter ? `AND LOWER(player_name) LIKE $${parameterIndex++}` : ''}
        ${serverFilter ? `AND server = $${parameterIndex++}` : ''}
        ORDER BY rank
        LIMIT $${parameterIndex++} OFFSET $${parameterIndex++}
        `;
      const parameters: (string | number)[] = [id];
      if (playerNameFilter) {
        parameters.push(`%${playerNameFilter}%`);
      }
      if (serverFilter) {
        parameters.push(serverFilter);
      }
      parameters.push(PAGINATION_LIMIT, offset);

      /* ---------------------------------
       * Query from DB
       * --------------------------------- */
      const results = await new Promise<any[]>((resolve, reject) => {
        eventPgDbpool.query(query, parameters, (error, results) => {
          if (error) {
            reject(error);
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
      const cacheTtl = 60 * 60;

      /* ---------------------------------
       * Update cache and send response
       * --------------------------------- */
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
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid event type' });
        return;
      }
      // Trick: we convert event type to match table name, e.g. "outer-realms" -> "outer_realms_ranking"
      // This needs to be upgraded if we add more event types in the future.
      const sqlTable = eventType.trim().replaceAll('-', '_') + '_ranking';
      const id = request.params.id;
      if (!id || Number.isNaN(Number(id))) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid event ID' });
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
                reject(error);
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
}
