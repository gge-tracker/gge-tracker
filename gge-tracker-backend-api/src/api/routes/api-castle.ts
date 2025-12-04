import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { AuthorizedSpecialServersEnum } from '../enums/gge-tracker-special-servers.enums';
import { ApiHelper } from '../helper/api-helper';

/**
 * Abstract class providing API endpoints related to castle data retrieval and analysis
 *
 * @remarks
 * This class implements methods for fetching castle information by castle ID or player name,
 * interacting with external GGE APIs, handling caching with Redis, and formatting the response data
 *
 * @abstract
 */
export abstract class ApiCastle implements ApiHelper {
  /**
   * Handles the HTTP request to retrieve detailed information about a castle by its ID
   *
   * @param request - The Express request object, expected to contain `castleId` in `params`
   * @param response - The Express response object used to send the result or error
   * @returns A promise that resolves when the response is sent
   */
  public static async getCastleById(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const castleId = ApiHelper.verifyIdWithCountryCode(request.params.castleId);
      const kingdomId = Number.parseInt(String(request.query.kingdomId || '0'));
      const serverName = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(castleId || 1);
      if (!castleId) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidCastleId });
        return;
      } else if (Number.isNaN(kingdomId) || kingdomId < 0 || kingdomId > 3) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidKingdomId });
        return;
      } else if (
        kingdomId > 0 &&
        !Object.values(AuthorizedSpecialServersEnum).includes(serverName as AuthorizedSpecialServersEnum)
      ) {
        response
          .status(ApiHelper.HTTP_BAD_REQUEST)
          .send({ error: RouteErrorMessagesEnum.UnavailableForSpecialServers });
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
      const basePath = kingdomId === 0 ? process.env.GGE_API_URL : process.env.GGE_API_URL_REALTIME;
      // Step 1 : Send 'gbl' request  to clear previous context
      await fetch(`${basePath}/${ApiHelper.ggeTrackerManager.getZoneFromRequestId(castleId)}/gbl/null`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      // Step 2 : Send 'jca' request to get castle analysis data
      const apiUrl = `${basePath}/${ApiHelper.ggeTrackerManager.getZoneFromRequestId(castleId)}/jca/"CID":${globalCastleId},"KID":${kingdomId}`;
      const responseData = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      // Step 3 : Send 'gbl' request to clear context again. This parts needs to be optimized in the future
      await fetch(`${basePath}/${ApiHelper.ggeTrackerManager.getZoneFromRequestId(castleId)}/gbl/null`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (!responseData.ok) {
        response.status(responseData.status).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const data = await responseData.json();
      if (!data?.content?.gca) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }
      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const gca = data['content']['gca'];
      // Transform the raw API response into a structured format
      // Note: Some fields are based on assumptions due to lack of official documentation
      // and may need adjustments as more information becomes available
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
        // Note: The constructionItems structure is based on observed patterns and may require adjustments
        // Each item contains an OID and a list of CIL entries with CID and S values
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
      void ApiHelper.updateCache(cachedKey, responseContent, 360);
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
   * Handles the retrieval of castle information for a player by their name
   *
   * This endpoint validates the player name and request code, checks for cached results,
   * queries the database for the player's ID, and fetches detailed castle data from the GGE API
   * If successful, it maps and returns the player's castles; otherwise, it returns appropriate error responses
   *
   * @param request - The Express request object, expected to contain `params.playerName`, `code`, `language`, and `pg_pool`
   * @param response - The Express response object used to send the result or error
   * @returns A Promise that resolves when the response is sent
   *
   * @remarks
   * - Returns HTTP 400 for invalid player name, code, or zone
   * - Returns HTTP 404 if the player or their castles are not found
   * - Returns HTTP 200 with an array of mapped castles on success
   * - Returns HTTP 500 for unexpected errors
   */
  public static async getCastleByPlayerName(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const playerName = ApiHelper.validateSearchAndSanitize(request.params.playerName);
      const code = request['code'];
      const targetEmpireEx = ApiHelper.ggeTrackerManager.getZoneFromCode(code);
      if (ApiHelper.isInvalidInput(playerName) || !ApiHelper.ggeTrackerManager.isValidCode(code) || !targetEmpireEx) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerName });
        return;
      }
      const cachedKey = `castle:playerName:${code}:${playerName}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Query from DB to get player ID
       * --------------------------------- */
      const query = `SELECT id FROM players WHERE LOWER(name) = $1 AND castles IS NOT NULL AND castles != '[]' LIMIT 1;`;
      const result = await (request['pg_pool'] as pg.Pool).query(query, [playerName]);
      if (!result?.rows || result.rows.length === 0 || !result.rows[0].id) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }
      const playerId = result.rows[0].id;
      const basePath = process.env.GGE_API_URL;
      // We send directly request to internal GGE API proxy, because this data is not stored in our DB
      const apiUrl = `${basePath}/${targetEmpireEx}/gdi/"PID":${playerId}`;
      const responseData = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      if (!responseData.ok) {
        response.status(responseData.status).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }
      const data = await responseData.json();
      if (!data?.content?.O?.AP) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }
      /* ---------------------------------
       * Format results
       * --------------------------------- */
      const castleObject = data['content']['gcl']['C'];
      const castlesAIBase = castleObject
        .filter((c: any) => [0, 1, 2, 3].includes(c.KID))
        .map((c: any) => c.AI.map((ai: any) => ({ ...ai, KID: c.KID })));
      const castlesAI = castlesAIBase.flat();
      const serverName = ApiHelper.ggeTrackerManager.getServerNameFromRequestId(
        code as number,
      ) as AuthorizedSpecialServersEnum;
      const authorizedServers = Object.values(AuthorizedSpecialServersEnum);
      const mappedCastles = castlesAI.reduce((accumulator: any[], castle: any) => {
        accumulator.push({
          kingdomId: castle.KID,
          isAvailable: castle.KID === 0 ? true : authorizedServers.includes(serverName),
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
        return accumulator;
      }, []);
      response.status(ApiHelper.HTTP_OK).send(mappedCastles);
      void ApiHelper.updateCache(cachedKey, mappedCastles, 3600);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCastleByPlayerName', request);
      return;
    }
  }
}
