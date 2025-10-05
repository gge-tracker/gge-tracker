import * as express from 'express';
import { ApiHelper } from '../api-helper';
import * as pg from 'pg';

/**
 * Abstract class providing API endpoints related to castle data retrieval and analysis.
 *
 * @remarks
 * This class implements methods for fetching castle information by castle ID or player name,
 * interacting with external GGE APIs, handling caching with Redis, and formatting the response data.
 *
 * @abstract
 */
export abstract class ApiCastle implements ApiHelper {
  /**
   * Handles the HTTP request to retrieve detailed information about a castle by its ID.
   *
   * This method performs the following steps:
   * 1. Validates the provided castle ID from the request parameters.
   * 2. Checks for cached castle analysis data in Redis and returns it if available.
   * 3. Fetches castle data from the external GGE API if not cached.
   * 4. Parses and transforms the API response into a structured object containing player, castle, and construction details.
   * 5. Caches the response for future requests.
   * 6. Handles and responds to errors appropriately, including invalid IDs, missing data, and API failures.
   *
   * @param request - The Express request object, expected to contain `castleId` in `params`.
   * @param response - The Express response object used to send the result or error.
   * @returns A promise that resolves when the response is sent.
   */
  public static async getCastleById(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const castleId = ApiHelper.getVerifiedId(request.params.castleId);
      if (castleId === false || castleId === undefined) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid castle id' });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const globalCastleId = ApiHelper.removeCountryCode(castleId);
      const cachedKey = '/castle/analysis/' + globalCastleId;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Fetch from GGE API
       * --------------------------------- */
      const basePath = process.env.GGE_API_URL;
      // Step 1 : Send 'gbl' request  to clear previous context
      await fetch(`${basePath}/${ApiHelper.ggeTrackerManager.getZoneFromRequestId(castleId)}/gbl/null`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      // Step 2 : Send 'jca' request to get castle analysis data
      const apiUrl = `${basePath}/${ApiHelper.ggeTrackerManager.getZoneFromRequestId(castleId)}/jca/"CID":${globalCastleId},"KID":0`;
      const responseData = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      // Step 3 : Send 'gbl' request to clear context again. This parts needs to be optimized in the future.
      await fetch(`${basePath}/${ApiHelper.ggeTrackerManager.getZoneFromRequestId(castleId)}/gbl/null`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (!responseData.ok) {
        response.status(responseData.status).send({ error: 'Failed to fetch data from GGE API' });
        return;
      }
      const data = await responseData.json();
      if (!data || !data['content'] || !data['content']['gca']) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'No castles found for this player' });
        return;
      }
      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const gca = data['content']['gca'];
      // Transform the raw API response into a structured format
      // Note: Some fields are based on assumptions due to lack of official documentation
      // and may need adjustments as more information becomes available.
      const responseContent = {
        playerName: gca.O.N,
        castleName: gca.A[10],
        castleType: gca.A[0],
        level: gca.O.L,
        legendaryLevel: gca.O.LL,
        positionX: gca.A[1],
        positionY: gca.A[2],
        data: {
          buildings: gca.BD.map((building: any) => ({
            wodID: building[0],
            objectID: building[1],
            positionX: building[2],
            positionY: building[3],
            rotation: building[4] % 2,
            constructionCompletionInSec: building[5],
            buildingState: building[6],
            hitPoints: building[7],
            constructionBoostAtStart: building[8],
            efficiency: building[9],
            damageType: building[10],
            inDistrictID: building[14],
            districtSlotID: building[15],
            damageFactor: (100 - Number(building[7])) / 100,
          })),
          towers: gca.T.map((tower: any) => ({
            wodID: tower[0],
            objectID: tower[1],
            positionX: tower[2],
            positionY: tower[3],
            rotation: tower[4] % 2,
            constructionCompletionInSec: tower[5],
            buildingState: tower[6],
            hitPoints: tower[7],
            constructionBoostAtStart: tower[8],
            efficiency: tower[9],
            damageType: tower[10],
            inDistrictID: tower[14],
            districtSlotID: tower[15],
            damageFactor: (100 - Number(tower[7])) / 100,
          })),
          defenses: gca.D.map((defense: any) => ({
            wodID: defense[0],
            objectID: defense[1],
            positionX: defense[2],
            positionY: defense[3],
            rotation: defense[4] % 2,
            constructionCompletionInSec: defense[5],
            buildingState: defense[6],
            hitPoints: defense[7],
            constructionBoostAtStart: defense[8],
            efficiency: defense[9],
            damageType: defense[10],
            inDistrictID: defense[14],
            districtSlotID: defense[15],
            damageFactor: (100 - Number(defense[7])) / 100,
          })),
          gates: gca.G.map((gate: any) => ({
            wodID: gate[0],
            objectID: gate[1],
            positionX: gate[2],
            positionY: gate[3],
            rotation: gate[4] % 2,
            constructionCompletionInSec: gate[5],
            buildingState: gate[6],
            hitPoints: gate[7],
            constructionBoostAtStart: gate[8],
            efficiency: gate[9],
            damageType: gate[10],
            inDistrictID: gate[14],
            districtSlotID: gate[15],
            damageFactor: (100 - Number(gate[7])) / 100,
          })),
          grounds: gca.BG.map((ground: any) => ({
            wodID: ground[0],
            objectID: ground[1],
            positionX: ground[2],
            positionY: ground[3],
            rotation: ground[4] % 2,
            constructionCompletionInSec: ground[5],
            buildingState: ground[6],
            hitPoints: ground[7],
            constructionBoostAtStart: ground[8],
            efficiency: ground[9],
            damageType: ground[10],
            inDistrictID: ground[14],
            districtSlotID: ground[15],
            damageFactor: (100 - Number(ground[7])) / 100,
          })),
        },
        // Note: The constructionItems structure is based on observed patterns and may require adjustments.
        // Each item contains an OID and a list of CIL entries with CID and S values.
        constructionItems: Object.fromEntries(
          gca.CI.map((item) => {
            const { OID, CIL } = item;
            return [OID.toString(), CIL.map((c: { CID: number; S: number }) => [c.CID, c.S] as [number, number])];
          }),
        ),
      };
      /* ---------------------------------
       * Cache results and send response
       * --------------------------------- */
      void ApiHelper.updateCache(cachedKey, responseContent, 60);
      response.status(ApiHelper.HTTP_OK).send(responseContent);
      return;
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCastleById', request);
      return;
    }
  }

  /**
   * Handles the retrieval of castle information for a player by their name.
   *
   * This endpoint validates the player name and request code, checks for cached results,
   * queries the database for the player's ID, and fetches detailed castle data from the GGE API.
   * If successful, it maps and returns the player's castles; otherwise, it returns appropriate error responses.
   *
   * @param request - The Express request object, expected to contain `params.playerName`, `code`, `language`, and `pg_pool`.
   * @param response - The Express response object used to send the result or error.
   * @returns A Promise that resolves when the response is sent.
   *
   * @remarks
   * - Returns HTTP 400 for invalid player name, code, or zone.
   * - Returns HTTP 404 if the player or their castles are not found.
   * - Returns HTTP 200 with an array of mapped castles on success.
   * - Returns HTTP 500 for unexpected errors.
   */
  public static async getCastleByPlayerName(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerName = request.params.playerName;
      if (playerName.length > 40) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid player name' });
        return;
      }
      const code = request['code'];
      if (!ApiHelper.ggeTrackerManager.isValidCode(code)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid code' });
        return;
      }
      const targetEmpireEx = ApiHelper.ggeTrackerManager.getZoneFromCode(code);
      if (!targetEmpireEx) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: 'Invalid zone' });
        return;
      }
      // In this endpoint, there is no need to use cache
      // because the data is needed to be always fresh.

      /* ---------------------------------
       * Query from DB to get player ID
       * --------------------------------- */
      const query = `SELECT id FROM players WHERE LOWER(name) = LOWER($1) AND castles IS NOT NULL AND castles != '[]' LIMIT 1;`;
      const result = await (request['pg_pool'] as pg.Pool).query(query, [playerName]);
      if (!result || !result.rows || result.rows.length === 0 || !result.rows[0].id) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'Player not found' });
        return;
      }
      const playerId = result.rows[0].id;
      const basePath = process.env.GGE_API_URL;
      // We send directly request to internal GGE API proxy, because this data is not stored in our DB.
      const apiUrl = `${basePath}/${targetEmpireEx}/gdi/"PID":${playerId}`;
      const responseData = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (!responseData.ok) {
        response.status(responseData.status).send({ error: 'Failed to fetch data from GGE API' });
        return;
      }
      const data = await responseData.json();
      if (!data || !data['content'] || !data['content']['O'] || !data['content']['O']['AP']) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: 'No castles found for this player' });
        return;
      }
      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const castleObject = data['content']['gcl']['C'];
      const castlesAI = castleObject.find((c: any) => c.KID === 0)['AI'];
      const mappedCastles = castlesAI.reduce((acc: any[], castle: any) => {
        acc.push({
          kingdomId: 0,
          id: Number(ApiHelper.addCountryCode(castle.AI[3], request['code'])),
          positionX: castle.AI[1],
          positionY: castle.AI[2],
          type: castle.AI[0],
          name: castle.AI[10],
          keepLevel: castle.AI[5],
          wallLevel: castle.AI[6],
          gateLevel: castle.AI[7],
          towerLevel: castle.AI[8],
          moatLevel: castle.AI[9],
          equipmentUniqueIdSkin: castle.AI[17],
        });
        return acc;
      }, []);
      response.status(ApiHelper.HTTP_OK).send(mappedCastles);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCastleByPlayerName', request);
      return;
    }
  }
}
