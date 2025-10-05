import * as express from 'express';
import { ApiHelper } from '../api-helper';
import * as pg from 'pg';
import * as mysql from 'mysql';

/**
 * Provides API endpoints for retrieving dungeon data with various filters and sorting options.
 */
export abstract class ApiDungeons implements ApiHelper {
  /**
   * Handles the retrieval of dungeon data with various filters, sorting, and pagination options.
   *
   * This endpoint supports filtering dungeons by server, player, cooldown status, position, and other criteria.
   * It also supports sorting by distance to a given player's castle and paginating the results.
   *
   * @param request - Express request object, expected to contain query parameters for filtering and sorting:
   *   - `page`: (string) The page number for pagination (required, must be a positive integer).
   *   - `filterByKid`: (string) JSON array of dungeon "kid" types to filter by (default: "[2]").
   *   - `filterByAttackCooldown`: (string) Filter by attack cooldown status ("1", "2", or "3").
   *   - `filterByPlayerName`: (string) Filter dungeons by player name (max 60 chars).
   *   - `positionX`, `positionY`: (string) Coordinates to sort dungeons by proximity.
   *   - `nearPlayerName`: (string) Player name to sort dungeons by proximity to their castle.
   *   - `size`: (string) Number of results per page (default: 15, max: 4000).
   * @param response - Express response object used to send the result or error.
   *
   * @remarks
   * - Only specific authorized servers are supported, because dungeon data is not available for all servers.
   * - Handles validation of all input parameters and returns appropriate error messages.
   * - Returns a paginated list of dungeons with player information and calculated distances if requested.
   * - Integrates with both MySQL and PostgreSQL databases for dungeon and player data.
   * - Returns a 400 error for invalid input and a 500 error for server/database issues.
   *
   * @returns {void} Sends a JSON response with the following structure:
   *   {
   *     dungeons: Array<{
   *       kid: number,
   *       position_x: number,
   *       position_y: number,
   *       attack_cooldown: number,
   *       player_name: string,
   *       player_might: number,
   *       player_level: number,
   *       player_legendary_level: number,
   *       total_attack_count: number,
   *       updated_at: string,
   *       effective_cooldown_until: string,
   *       last_attack: string,
   *       distance: number | null
   *     }>,
   *     pagination: {
   *       current_page: number,
   *       total_pages: number,
   *       current_items_count: number,
   *       total_items_count: number
   *     }
   *   }
   */
  public static async getDungeons(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      // Authorized servers only, because dungeon data is not available for all servers.
      // However, in the future, we need to take out this configuration and expose it
      // in a separated file or from database.
      const authorizedServers = ['FR1', 'RO1', 'CZ1', 'IT1', 'SA1'];
      // List of banned player IDs. Populate as needed.
      // This is to prevent certain players from being included in the results.
      // This is not used for now, but kept in case we need it in the future.
      const bannedPlayersId = [];
      if (!authorizedServers.includes(request['language'])) {
        response
          .status(ApiHelper.HTTP_BAD_REQUEST)
          .send({ error: 'Invalid server. Currently, only' + authorizedServers.join(', ') + ' are supported.' });
        return;
      }
      const page = parseInt(request.query.page as string);
      if (Number.isNaN(page) || page < 1 || page > ApiHelper.MAX_RESULT_PAGE) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid page number' });
        return;
      }
      // By default, we show only type 2 dungeons
      let filterByKid = request.query.filterByKid ? (request.query.filterByKid as string) : '[2]';
      if (filterByKid && !Array.isArray(JSON.parse(filterByKid))) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid kid' });
        return;
      }
      let filtersKids = JSON.parse(filterByKid);
      const filterByAttackCooldown = request.query.filterByAttackCooldown
        ? (request.query.filterByAttackCooldown as string)
        : null;
      const filterByPlayerName = request.query.filterByPlayerName ? (request.query.filterByPlayerName as string) : null;
      let sortByPositionX = request.query.positionX ? (request.query.positionX as string) : null;
      let sortByPositionY = request.query.positionY ? (request.query.positionY as string) : null;
      const nearPlayerName = request.query.nearPlayerName ? (request.query.nearPlayerName as string) : null;
      const size = request.query.size ? (request.query.size as string) : null;
      filtersKids.forEach((kid: any) => {
        if (Number(kid) < 0 || Number(kid) > 9) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid kid' });
          return;
        }
      });
      if (filtersKids.length == 0) {
        response.status(ApiHelper.HTTP_OK).send({
          dungeons: [],
          pagination: {
            current_page: 1,
            total_pages: 1,
            current_items_count: 0,
            total_items_count: 0,
          },
        });
        return;
      }
      if ((filterByAttackCooldown && Number(filterByAttackCooldown) < 0) || Number(filterByAttackCooldown) > 99999999) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid attack cooldown' });
        return;
      }
      if (filterByPlayerName && filterByPlayerName.length > 60) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
        return;
      }
      if ((size && size.length > 30) || size.length < 0) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid size' });
        return;
      }
      /* ---------------------------------
       * Prepare SQL query parts
       * --------------------------------- */
      let sortPositionKid1: number[] | null = null;
      let sortPositionKid2: number[] | null = null;
      let sortPositionKid3: number[] | null = null;
      let customSql = '';
      let customParameterValues = [];
      /* ---------------------------------
       * If sorting by nearPlayerName, get their castle position
       * --------------------------------- */
      if (nearPlayerName) {
        if (nearPlayerName.length > 60) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
          return;
        }
        const playerQuery = `SELECT castles_realm FROM players WHERE LOWER(name) = $1 LIMIT 1`;
        const playerResults: any[] = await new Promise((resolve, reject) => {
          (request['pg_pool'] as pg.Pool).query(
            playerQuery,
            [nearPlayerName.trim().toLowerCase()],
            (error, results) => {
              if (error) reject(error);
              else resolve(results.rows);
            },
          );
        });
        if (playerResults.length === 0) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
          return;
        }
        const target: { castles_realm: number[][] } = playerResults[0];
        if (!target.castles_realm || target.castles_realm.length === 0) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player castles realm' });
          return;
        }
        const sortJsonPositionKid1 = target.castles_realm.find((kid: number[]) => kid[3] === 12 && kid[0] === 1);
        const sortJsonPositionKid2 = target.castles_realm.find((kid: number[]) => kid[3] === 12 && kid[0] === 2);
        const sortJsonPositionKid3 = target.castles_realm.find((kid: number[]) => kid[3] === 12 && kid[0] === 3);
        sortPositionKid1 =
          sortJsonPositionKid1 && sortJsonPositionKid1.length === 4
            ? [sortJsonPositionKid1[1], sortJsonPositionKid1[2]]
            : null;
        sortPositionKid2 =
          sortJsonPositionKid2 && sortJsonPositionKid2.length === 4
            ? [sortJsonPositionKid2[1], sortJsonPositionKid2[2]]
            : null;
        sortPositionKid3 =
          sortJsonPositionKid3 && sortJsonPositionKid3.length === 4
            ? [sortJsonPositionKid3[1], sortJsonPositionKid3[2]]
            : null;
        sortByPositionX = sortPositionKid1 ? String(sortPositionKid1[0]) : null;
        sortByPositionY = sortPositionKid1 ? String(sortPositionKid1[1]) : null;
        filtersKids = filtersKids.filter((kid: number) => {
          return target.castles_realm.some((castle: number[]) => castle[0] === kid && castle[3] === 12);
        });
        // Custom SQL to calculate distance considering the kid (kingdom)
        // and wrapping around the map edges.
        // The map width is considered to be 1287 units for wrapping calculations.
        // If a kid does not have a castle, it assigns a large distance (999999) to effectively exclude it.
        // /!\ Improvement note: This calculation might be improved in the future
        customSql = `
          LEAST(
              CASE WHEN D.kid = 1 THEN
                  POWER(LEAST(ABS(CAST(D.position_x AS SIGNED) - ?), 1287 - ABS(CAST(D.position_x AS SIGNED) - ?)), 2) +
                  POWER(ABS(CAST(D.position_y AS SIGNED) - ?), 2)
              ELSE 999999 END,
              CASE WHEN D.kid = 2 THEN
                  POWER(LEAST(ABS(CAST(D.position_x AS SIGNED) - ?), 1287 - ABS(CAST(D.position_x AS SIGNED) - ?)), 2) +
                  POWER(ABS(CAST(D.position_y AS SIGNED) - ?), 2)
              ELSE 999999 END,
              CASE WHEN D.kid = 3 THEN
                  POWER(LEAST(ABS(CAST(D.position_x AS SIGNED) - ?), 1287 - ABS(CAST(D.position_x AS SIGNED) - ?)), 2) +
                  POWER(ABS(CAST(D.position_y AS SIGNED) - ?), 2)
              ELSE 999999 END
          ) AS calculated_distance
        `;
        // Parameters for the three possible castle positions (kid 1, 2, 3)
        customParameterValues.push(
          sortPositionKid1 ? sortPositionKid1[0] : 0,
          sortPositionKid1 ? sortPositionKid1[0] : 0,
          sortPositionKid1 ? sortPositionKid1[1] : 0,
          sortPositionKid2 ? sortPositionKid2[0] : 0,
          sortPositionKid2 ? sortPositionKid2[0] : 0,
          sortPositionKid2 ? sortPositionKid2[1] : 0,
          sortPositionKid3 ? sortPositionKid3[0] : 0,
          sortPositionKid3 ? sortPositionKid3[0] : 0,
          sortPositionKid3 ? sortPositionKid3[1] : 0,
        );
      }
      if (filtersKids.length == 0) {
        // If no valid kids remain after filtering, return empty result
        response.status(ApiHelper.HTTP_OK).send({
          dungeons: [],
          pagination: {
            current_page: 1,
            total_pages: 1,
            current_items_count: 0,
            total_items_count: 0,
          },
        });
        return;
      }
      let isSorted = false;
      if (sortByPositionX !== null || sortByPositionY !== null) {
        if (Number.isNaN(parseInt(sortByPositionX as string)) || Number.isNaN(parseInt(sortByPositionY as string))) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid position' });
          return;
        } else if (parseInt(sortByPositionX as string) < 0 || parseInt(sortByPositionY as string) < 0) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid position' });
          return;
        } else if (parseInt(sortByPositionX as string) > 1286 || parseInt(sortByPositionY as string) > 1286) {
          response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid position' });
          return;
        } else {
          isSorted = true;
        }
      }
      const MAX_NUMBER = 4000;
      const viewPerPage = size === '0' ? MAX_NUMBER : size !== null ? parseInt(size) : 15;
      const conditions: string[] = [];
      const queryValues: any[] = [];
      const countValues: any[] = [];
      conditions.push(`D.kid IN (${filtersKids.map(() => '?').join(', ')})`);
      countValues.push(...filtersKids);
      let playerId: number | null = null;
      let realCooldownExpr = `TIMESTAMPADD(SECOND, D.attack_cooldown, D.updated_at)`;
      if (filterByPlayerName) {
        const playerQuery = `SELECT id FROM players WHERE LOWER(name) = $1 LIMIT 1`;
        const playerResults: any[] = await new Promise((resolve, reject) => {
          (request['pg_pool'] as pg.Pool).query(
            playerQuery,
            [filterByPlayerName.trim().toLowerCase()],
            (error, results) => {
              if (error) reject(error);
              else resolve(results.rows);
            },
          );
        });
        if (playerResults.length === 0) {
          conditions.push('1 = 0');
        } else {
          playerId = playerResults[0].id;
          if (
            playerId &&
            bannedPlayersId.includes(Number(ApiHelper.addCountryCode(String(playerId), request['code'])))
          ) {
            response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
            return;
          }
          realCooldownExpr = `
            CASE
                WHEN DPS.last_attack_at IS NOT NULL
                THEN GREATEST(
                TIMESTAMPADD(SECOND, D.attack_cooldown, D.updated_at),
                TIMESTAMPADD(SECOND, 432000, DPS.last_attack_at)
                )
                ELSE TIMESTAMPADD(SECOND, D.attack_cooldown, D.updated_at)
            END
        `;
        }
      }
      /* ---------------------------------
       * If filtering by attack cooldown, build conditions
       * --------------------------------- */
      if (filterByAttackCooldown) {
        // The attack cooldown filter works as follows:
        // 1: Dungeons that can be attacked now (cooldown expired)
        // 2: Dungeons that will be attackable within the next 5 minutes
        // 3: Dungeons that will be attackable within the next 60 minutes
        switch (filterByAttackCooldown) {
          case '1':
            conditions.push(`(${realCooldownExpr} <= NOW())`);
            break;
          case '2':
            conditions.push(`(${realCooldownExpr} > NOW())`);
            conditions.push(`TIMESTAMPDIFF(SECOND, NOW(), ${realCooldownExpr}) <= 300`);
            break;
          case '3':
            conditions.push(`(${realCooldownExpr} > NOW())`);
            conditions.push(`TIMESTAMPDIFF(SECOND, NOW(), ${realCooldownExpr}) <= 3600`);
            break;
        }
      }
      /* ---------------------------------
       * Build and execute count query (pagination)
       * --------------------------------- */
      let dungeonsCount = 0;
      let countQuery = `
          SELECT COUNT(*) AS dungeons_count
          FROM dungeons D
      `;

      let query = `
        SELECT
          D.kid,
          D.position_x,
          D.position_y,
          D.attack_cooldown,
          D.total_attack_count,
          D.updated_at,
          D.player_id,
          ${realCooldownExpr} AS effective_cooldown_until,
          (
              SELECT MAX(DPSt.last_attack_at)
              FROM dungeon_player_state DPSt
              WHERE DPSt.kid = D.kid
                  AND DPSt.position_x = D.position_x
                  AND DPSt.position_y = D.position_y
                  AND DPSt.player_id = D.player_id
          ) AS last_attack
      `;
      /* ---------------------------------
       * In count query and if sorted, calculate distance for sorting
       * --------------------------------- */
      if (isSorted) {
        if (!nearPlayerName) {
          // /!\ Improvement note: This calculation might be improved in the future
          query += `,(
            POWER(LEAST(ABS(CAST(D.position_x AS SIGNED) - ?), 1287 - ABS(CAST(D.position_x AS SIGNED) - ?)), 2) +
            POWER(ABS(CAST(D.position_y AS SIGNED) - ?), 2)
        ) AS calculated_distance`;
        } else {
          query += `, ${customSql}`;
        }
      }
      query += `
        FROM dungeons D
      `;
      /* ---------------------------------
       * Player join if filtering by player name
       * --------------------------------- */
      if (playerId !== null) {
        const playerIdCondStr = `
          LEFT JOIN (
          SELECT kid, position_x, position_y, player_id, MAX(last_attack_at) AS last_attack_at
          FROM dungeon_player_state
          WHERE player_id = ${mysql.escape(playerId)}
          GROUP BY kid, position_x, position_y, player_id
          ) DPS ON D.kid = DPS.kid AND D.position_x = DPS.position_x AND D.position_y = DPS.position_y AND DPS.player_id = ${mysql.escape(playerId)}
        `;
        query += playerIdCondStr;
        countQuery += playerIdCondStr;
      }
      if (conditions.length > 0) {
        countQuery += ` WHERE ` + conditions.join(' AND ');
      }
      /* ---------------------------------
       * Execute count query for pagination
       * --------------------------------- */
      await new Promise((resolve, reject) => {
        (request['mysql_pool'] as mysql.Pool).query(countQuery, countValues, (error, results) => {
          if (error) {
            reject(error);
          } else {
            dungeonsCount = results[0]['dungeons_count'];
            resolve(null);
          }
        });
      });
      const totalPages = Math.ceil(dungeonsCount / viewPerPage);
      // If the requested page exceeds total pages, return empty result
      if (page > totalPages) {
        const responseContent = {
          dungeons: [],
          pagination: {
            current_page: page,
            total_pages: totalPages,
            current_items_count: 0,
            total_items_count: dungeonsCount,
          },
        };
        response.status(ApiHelper.HTTP_OK).send(responseContent);
        return;
      }
      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }
      if (!isSorted) {
        // Default sorting: Dungeons that can be attacked now first, then by shortest cooldown
        // and finally by oldest updated dungeons.
        // Dungeons that can be attacked now have last_attack < NOW()
        // If last_attack is NULL, it means the dungeon has never been attacked,
        // so we treat it as the highest priority (can be attacked now).
        query += `
          ORDER BY
          CASE
              WHEN last_attack < NOW() THEN last_attack
              ELSE NULL
          END ASC,
          effective_cooldown_until ASC`;
      } else {
        query += ` ORDER BY calculated_distance ASC`;
        if (!nearPlayerName) {
          // Parameters for sorting by given position.
          // Added again here for the main query.
          queryValues.push(parseInt(sortByPositionX as string));
          queryValues.push(parseInt(sortByPositionX as string));
          queryValues.push(parseInt(sortByPositionY as string));
        } else {
          // Otherwise, add the custom parameters for sorting by nearPlayerName
          queryValues.push(...customParameterValues);
        }
      }
      /* ---------------------------------
       * Finalize query with pagination
       * --------------------------------- */
      query += ` LIMIT ? OFFSET ?;`;
      queryValues.push(...filtersKids);
      queryValues.push(viewPerPage, (page - 1) * viewPerPage);
      (request['mysql_pool'] as mysql.Pool).query(query, queryValues, (error, results) => {
        if (error) {
          response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
          return;
        } else {
          /* ---------------------------------
           * Fetch player details for the resulting dungeons
           * --------------------------------- */
          const playerIds: (number | null | undefined)[] = results.map((result: any) => result.player_id);
          const playerQuery = `
            SELECT id, name, might_current AS player_might, level AS player_level, legendary_level AS player_legendary_level
            FROM players
            WHERE id IN (${playerIds.map((_, index) => `$${index + 1}`).join(', ')})
          `;
          (request['pg_pool'] as pg.Pool).query(playerQuery, playerIds, (error, playerResults) => {
            if (error) {
              response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
              return;
            }
            /* ---------------------------------
             * Map player details to dungeons
             * --------------------------------- */
            const playerMap: Map<number, any> = new Map(playerResults.rows.map((row: any) => [row.id, row]));
            results = results.map((result: any) => {
              const player = playerMap.get(result.player_id);
              return {
                ...result,
                player_name: player ? player.name : 'Unknown',
                player_might: player ? player.player_might : 0,
                player_level: player ? player.player_level : 0,
                player_legendary_level: player ? player.player_legendary_level : 0,
              };
            });
            const dungeons = results.map((result: any) => {
              return {
                kid: result.kid,
                position_x: result.position_x,
                position_y: result.position_y,
                attack_cooldown: result.attack_cooldown,
                player_name: result.player_name,
                player_might: result.player_might,
                player_level: result.player_level,
                player_legendary_level: result.player_legendary_level,
                total_attack_count: result.total_attack_count,
                updated_at: result.updated_at,
                effective_cooldown_until: result.effective_cooldown_until,
                last_attack: result.last_attack,
                distance:
                  result.calculated_distance !== undefined
                    ? parseFloat(Math.sqrt(result.calculated_distance).toFixed(1))
                    : null,
              };
            });
            const responseContent = {
              dungeons,
              pagination: {
                current_page: page,
                total_pages: totalPages,
                current_items_count: dungeons.length,
                total_items_count: dungeonsCount,
              },
            };
            response.status(ApiHelper.HTTP_OK).send(responseContent);
            // There is no need to cache this data because it changes frequently
            // and users expect always fresh data.
            return;
          });
        }
      });
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getDungeons', request);
      return;
    }
  }
}
