import * as express from 'express';
import * as pg from 'pg';
import { ApiHelper } from '../helper/api-helper';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';

export abstract class ApiMiniGame implements ApiHelper {
  public static async getDailyMiniGame(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Cache validation
       * --------------------------------- */
      const currentDay = new Date().getDate();
      const cachedKey = `statistics:daily-mini-game:${currentDay}:${request['language']}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(cachedData);
        return;
      }

      /* ---------------------------------
       * Database query
       * --------------------------------- */
      try {
        const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
        const query = `
          SELECT id, game_date, server, player_id FROM mini_games
          WHERE game_date = CURRENT_DATE
          AND server = $1
          LIMIT 1;
        `;
        let result: pg.QueryResult = await pgPool.query(query, [request['language']]);

        if (result.rowCount === 0) {
          await this.generateDailyMiniGame(pgPool, request['pg_pool'], request['language']);
          result = await pgPool.query(query, [request['language']]);
        }

        const code = ApiHelper.ggeTrackerManager.getCodeFromOuterName(request['language']);

        const miniGameData = {
          id: result.rows[0].id,
          game_date: result.rows[0].game_date,
          server: result.rows[0].server,
          player_id: ApiHelper.addCountryCode(result.rows[0].player_id, code),
        };

        /* ---------------------------------
         * Update cache version
         * --------------------------------- */
        await ApiHelper.updateCache(cachedKey, miniGameData, 86_400);

        /* ---------------------------------
         * Send success response
         * --------------------------------- */
        response.status(ApiHelper.HTTP_OK).json(miniGameData);
      } catch (error) {
        console.error('Error executing queries:', error);
        response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
      }
    } catch (error) {
      console.error('Error executing query:', error);
      response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
    }
  }

  public static async getAutoCompletePlayerNames(request: express.Request, response: express.Response): Promise<void> {
    try {
      const { query } = request.query;
      if (typeof query !== 'string' || query.trim() === '') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid query parameter' });
        return;
      }

      const searchQuery = `
        SELECT name FROM players
        WHERE LOWER(name) LIKE LOWER($1)
        AND castles IS NOT NULL
        AND jsonb_array_length(castles) > 0
        ORDER BY might_current DESC
        LIMIT 10;
      `;
      const result: pg.QueryResult = await request['pg_pool'].query(searchQuery, [`%${query}%`]);
      response.status(ApiHelper.HTTP_OK).json(result.rows.map((row) => row.name));
    } catch (error) {
      console.error('Error fetching player names:', error);
      response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
    }
  }

  public static async submitMiniGameGuess(request: express.Request, response: express.Response): Promise<void> {
    try {
      const { guess, requestGameId } = request.body;
      if (typeof guess !== 'string' || guess.trim() === '') {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid guess input' });
        return;
      } else if (
        typeof requestGameId !== 'number' ||
        Number.isNaN(requestGameId) ||
        requestGameId <= 0 ||
        requestGameId > ApiHelper.MAX_BIG_VALUE
      ) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid game ID input' });
        return;
      }

      const pgPool = ApiHelper.ggeTrackerManager.getPgSqlPool(GgeTrackerServersEnum.GLOBAL);
      const query = `
        SELECT
          position_x, position_y, player_id, alliance_rank, level, legendary_level, honor, is_protection, might, fame
        FROM mini_games
        WHERE id = $1
        AND server = $2
        LIMIT 1;
      `;
      const result: pg.QueryResult = await pgPool.query(query, [requestGameId, request['language']]);
      if (result.rowCount === 0) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'Daily mini-game not found.' });
        return;
      }

      const miniGameData = result.rows[0];
      const targetX = miniGameData.position_x;
      const targetY = miniGameData.position_y;
      const targetPlayerId = miniGameData.player_id;

      // Fetch guessed player data
      const guessedPlayerQuery = `
        SELECT
          id, name, castles, alliance_rank, might_current, level, legendary_level, current_fame, honor, peace_disabled_at
        FROM players
        WHERE LOWER(name) = LOWER($1)
        AND castles IS NOT NULL
        AND jsonb_array_length(castles) > 0
        ORDER BY might_current DESC
      `;
      const guessedPlayerResult: pg.QueryResult = await request['pg_pool'].query(guessedPlayerQuery, [guess]);
      if (guessedPlayerResult.rowCount === 0) {
        response.status(ApiHelper.HTTP_OK).send({ error: 'Guessed player not found', playerName: guess });
        return;
      }
      const guessedPlayer = guessedPlayerResult.rows[0];
      const guessedCastle = guessedPlayer.castles.find((castle: number[]) => castle[2] === 1);
      if (!guessedCastle) {
        response
          .status(ApiHelper.HTTP_OK)
          .send({ error: 'Guessed player does not have a main castle', playerName: guess });
        return;
      }
      const allianceRankFormatted = guessedPlayer.alliance_rank === null ? 99 : guessedPlayer.alliance_rank;
      const miniGameAllianceRankFormatted = miniGameData.alliance_rank === null ? 99 : miniGameData.alliance_rank;
      const legendaryLevelFormatted = guessedPlayer.legendary_level === null ? 0 : guessedPlayer.legendary_level;
      const isGuessedPlayerInProtection =
        guessedPlayer.peace_disabled_at !== null && new Date(guessedPlayer.peace_disabled_at) > new Date();

      if (guessedPlayerResult.rows.some((player: any) => Number(player.id) === Number(targetPlayerId))) {
        response.status(ApiHelper.HTTP_OK).json({
          win: true,
          playerName: guess,
          direction: null,
          distance: 0,
          allianceRank: {
            guess: guessedPlayer.alliance_rank,
            direction: 'correct',
          },
          level: {
            guess: guessedPlayer.level,
            direction: 'correct',
          },
          legendaryLevel: {
            guess: guessedPlayer.legendary_level,
            direction: 'correct',
          },
          honor: {
            guess: guessedPlayer.honor,
            direction: 'correct',
          },
          isProtection: {
            guess: isGuessedPlayerInProtection,
            status: true,
          },
          might: {
            guess: guessedPlayer.might_current,
            direction: 'correct',
          },
          fame: {
            guess: guessedPlayer.current_fame,
            direction: 'correct',
          },
        });
        return;
      }
      // Otherwise, calculate distance and direction from the first castle of the guessed player to the target player
      const MAP_WIDTH = 1287;
      const guessedX = guessedCastle[0];
      const guessedY = guessedCastle[1];
      const rawDeltaX = targetX - guessedX;
      const wrappedDeltaX = ((rawDeltaX + MAP_WIDTH / 2) % MAP_WIDTH) - MAP_WIDTH / 2;
      const deltaX = wrappedDeltaX;
      const deltaY = guessedY - targetY;
      const distance = Math.hypot(deltaX, deltaY);
      const roundedDistance = Math.round(distance / 10) * 10;
      const direction = ApiHelper.calculateDirection(deltaX, deltaY);

      response.status(ApiHelper.HTTP_OK).json({
        win: false,
        distance: roundedDistance,
        direction,
        allianceRank: {
          guess: guessedPlayer.alliance_rank,
          direction:
            allianceRankFormatted === miniGameAllianceRankFormatted
              ? 'correct'
              : Number(allianceRankFormatted) < Number(miniGameAllianceRankFormatted)
                ? 'lower'
                : 'higher',
        },
        level: {
          guess: guessedPlayer.level,
          direction:
            guessedPlayer.level === miniGameData.level
              ? 'correct'
              : Number(guessedPlayer.level) < Number(miniGameData.level)
                ? 'higher'
                : 'lower',
        },
        legendaryLevel: {
          guess: guessedPlayer.legendary_level,
          direction:
            legendaryLevelFormatted === miniGameData.legendary_level
              ? 'correct'
              : Number(legendaryLevelFormatted) < Number(miniGameData.legendary_level)
                ? 'higher'
                : 'lower',
        },
        honor: {
          guess: guessedPlayer.honor,
          direction:
            guessedPlayer.honor === miniGameData.honor
              ? 'correct'
              : Number(guessedPlayer.honor) < Number(miniGameData.honor)
                ? 'higher'
                : 'lower',
        },
        isProtection: {
          guess: isGuessedPlayerInProtection,
          status: isGuessedPlayerInProtection === miniGameData.is_protection ? true : false,
        },
        might: {
          guess: guessedPlayer.might_current,
          direction:
            guessedPlayer.might_current === miniGameData.might
              ? 'correct'
              : Number(guessedPlayer.might_current) < Number(miniGameData.might)
                ? 'higher'
                : 'lower',
        },
        fame: {
          guess: guessedPlayer.current_fame,
          direction:
            guessedPlayer.current_fame === miniGameData.fame
              ? 'correct'
              : Number(guessedPlayer.current_fame) < Number(miniGameData.fame)
                ? 'higher'
                : 'lower',
        },
        playerName: guessedPlayer.name,
      });
    } catch (error) {
      console.error('Error processing guess:', error);
      response.status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR).send({ error: error.message });
    }
  }

  private static async generateDailyMiniGame(
    pgPool: pg.Pool,
    serverPgPool: pg.Pool,
    serverName: string,
  ): Promise<void> {
    const table = 'mini_games';
    const apiSearchCastleUrl = 'https://api.gge-tracker.com/api/v1/castle/search';

    // Step 1 : Select a random player from the database
    const playerQuery = `
      SELECT id, name, alliance_id, castles, honor, peace_disabled_at, might_current, level, legendary_level, alliance_rank, current_fame
      FROM players
      WHERE
        castles IS NOT NULL
        AND jsonb_array_length(castles) > 0
        AND might_current >= 1000000
        AND level >= 70
        AND current_fame >= 10000000
      ORDER BY RANDOM()
      LIMIT 1;
    `;
    const result: pg.QueryResult = await serverPgPool.query(playerQuery);
    if (result.rowCount === 0) {
      throw new Error('No player found with castles on the server');
    }
    const player = result.rows[0];
    const playerMainCastle: number[] = player.castles.find((castle: number[]) => castle[2] === 1);
    if (!playerMainCastle) {
      throw new Error('Selected player does not have a main castle');
    }

    // Step 2 : Check if the player exist
    const encodedPlayerName = encodeURIComponent(player.name);
    const url = `${apiSearchCastleUrl}/${encodedPlayerName}`;
    const headers = {
      'gge-server': serverName,
    };
    const castleSearchResponse = await ApiHelper.fetchWithFallback(url, headers);
    if (!castleSearchResponse.ok) {
      throw new Error(`Failed to fetch castle data for player ${player.name}`);
    }
    const castleSearchData: {
      kingdomId: number;
      isAvailable: boolean;
      id: number;
      positionX: number;
      positionY: number;
      type: number;
      name: string;
      keepLevel: number;
      wallLevel: number;
      gateLevel: number;
      towerLevel: number;
      moatLevel: number;
      equipmentUniqueIdSkin: number;
    }[] = await castleSearchResponse.json();
    if (!castleSearchData || castleSearchData.length === 0) {
      throw new Error(`No castle data found for player ${player.name}`);
    }
    const castle = castleSearchData.find(
      (c: any) => c.positionX === playerMainCastle[0] && c.positionY === playerMainCastle[1],
    );
    if (!castle) {
      throw new Error(`No castle found at the expected position for player ${player.name}`);
    }

    // Step 3 : Insert mini-game data into the database
    const insertQuery = `
      INSERT INTO ${table} (
        game_date, server, player_id, castle_id, position_x, position_y,
        nb_castles, skin_equipment_id, skin_equipment_name,
        gate_level, wall_level, keep_level, tower_level,
        castle_name, alliance_rank, honor,
        player_title_1, player_title_2,
        is_protection, level, legendary_level,
        might, fame, name
      ) VALUES (
        CURRENT_DATE, $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17,
        $18, $19, $20,
        $21, $22, $23
      )
      ON CONFLICT (game_date, server) DO NOTHING;
    `;
    const insertValues = [
      serverName,
      player.id,
      castle.id,
      castle.positionX,
      castle.positionY,
      player.castles.length,
      castle.equipmentUniqueIdSkin,
      '', // skin_equipment_name is not available in the API response
      castle.gateLevel,
      castle.wallLevel,
      castle.keepLevel,
      castle.towerLevel,
      castle.name,
      player.alliance_rank,
      player.honor,
      null, // player_title_1 is not available in the current database schema
      null, // player_title_2 is not available in the current database schema
      player.peace_disabled_at !== null && new Date(player.peace_disabled_at) > new Date(),
      player.level,
      player.legendary_level,
      player.might_current,
      player.current_fame,
      player.name,
    ];
    await pgPool.query(insertQuery, insertValues);
    return;
  }
}
