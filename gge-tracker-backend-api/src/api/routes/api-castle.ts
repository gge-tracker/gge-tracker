import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';

const GGE_BRIDGE_TIMEOUT_MS = 10_000;

function fetchFromBridge(url: string): Promise<globalThis.Response> {
  return fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(GGE_BRIDGE_TIMEOUT_MS),
  });
}

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
  private static readonly RANDOM_CASTLE_COUNT = 12;
  private static readonly RANDOM_CASTLE_POOL_SIZE = 24;
  private static readonly RANDOM_CASTLE_POOL_TTL_SECONDS = 600;
  private static readonly pendingRandomPools = new Map<string, Promise<any[] | null>>();

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
      } else if (kingdomId > 0 && !ApiHelper.ggeTrackerManager.hasFeature(serverName ?? '', 'advancedCastle')) {
        response
          .status(ApiHelper.HTTP_BAD_REQUEST)
          .send({ error: RouteErrorMessagesEnum.UnavailableForSpecialServers });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const globalCastleId = ApiHelper.removeCountryCode(castleId);
      const cachedKey = '/castle/analysis/' + globalCastleId + '/' + kingdomId;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Fetch from GGE API
       * --------------------------------- */
      const basePath = kingdomId === 0 ? process.env.GGE_API_URL : process.env.GGE_API_URL_REALTIME;
      const zone = ApiHelper.ggeTrackerManager.getZoneFromRequestId(castleId);
      const responseData = await fetchFromBridge(`${basePath}/${zone}/jca/"CID":${globalCastleId},"KID":${kingdomId}`);
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
        // Each item contains an OID and a list of CIL entries with CID, S, and RS values
        constructionItems: Object.fromEntries(
          gca.CI.map((item) => {
            const { OID, CIL } = item;
            return [
              OID.toString(),
              CIL.map(
                (c: { CID: number; S: number; RS: number }) => [c.CID, c.S, c.RS ?? 0] as [number, number, number],
              ),
            ];
          }),
        ),
      };
      /* ---------------------------------
       * Cache results and send response
       * --------------------------------- */
      void ApiHelper.updateCache(cachedKey, responseContent, 360);
      response.status(ApiHelper.HTTP_OK).send(responseContent);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCastleById', request);
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
      const playerName = ApiHelper.validateSearchAndSanitize(request.params.playerName, { toLowerCase: false });
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
      const query = `SELECT id FROM players WHERE LOWER(name) = LOWER($1) AND castles IS NOT NULL AND castles != '[]' LIMIT 1;`;
      const result = await (request['pg_pool'] as pg.Pool).query(query, [playerName]);
      if (!result?.rows || result.rows.length === 0 || !result.rows[0].id) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }
      await ApiCastle.sendPlayerCastles(response, result.rows[0].id, code, cachedKey);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCastleByPlayerName', request);
    }
  }

  public static async getCastleByPlayerId(request: express.Request, response: express.Response): Promise<void> {
    try {
      const playerId = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
      if (!playerId || !ApiHelper.ggeTrackerManager.getZoneFromRequestId(playerId)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const cachedKey = `castle:playerId:${playerId}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }
      const code = ApiHelper.getCountryCode(String(playerId));
      await ApiCastle.sendPlayerCastles(response, Number(ApiHelper.removeCountryCode(playerId)), code, cachedKey);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getCastleByPlayerId', request);
    }
  }

  public static async getRandomCastle(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const code = request['code'];
      const targetEmpireEx = ApiHelper.ggeTrackerManager.getZoneFromCode(code);
      if (!ApiHelper.ggeTrackerManager.isValidCode(code) || !targetEmpireEx) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidServer });
        return;
      }

      const castles = await ApiCastle.randomCastlePool(request['pg_pool'] as pg.Pool, code, targetEmpireEx);
      if (castles === null) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
        return;
      }
      response.status(ApiHelper.HTTP_OK).send(ApiCastle.sample(castles, ApiCastle.RANDOM_CASTLE_COUNT));
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getRandomCastle', request);
    }
  }

  private static randomCastlePool(pool: pg.Pool, code: string, zone: string): Promise<any[] | null> {
    const pending =
      ApiCastle.pendingRandomPools.get(code) ??
      ApiCastle.loadRandomCastlePool(pool, code, zone).finally(() => ApiCastle.pendingRandomPools.delete(code));
    ApiCastle.pendingRandomPools.set(code, pending);
    return pending;
  }

  private static async loadRandomCastlePool(pool: pg.Pool, code: string, zone: string): Promise<any[] | null> {
    const cacheKey = `castle:random-pool:${code}`;
    const cached = await ApiHelper.redisClient.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);
    const result = await pool.query(
      `SELECT id FROM players WHERE castles IS NOT NULL AND castles != '[]' AND level = 70 ORDER BY RANDOM() LIMIT $1`,
      [ApiCastle.RANDOM_CASTLE_POOL_SIZE],
    );
    if (result.rows.length === 0) return null;
    const fetched = await Promise.all(
      result.rows.map((row: { id: number }) => ApiCastle.fetchMainCastle(zone, row.id, code)),
    );
    const castles = fetched.filter(Boolean);
    if (castles.length > 0) {
      void ApiHelper.updateCache(cacheKey, castles, ApiCastle.RANDOM_CASTLE_POOL_TTL_SECONDS);
    }
    return castles;
  }

  private static async fetchMainCastle(zone: string, playerId: number, code: string): Promise<any | null> {
    try {
      const responseData = await fetchFromBridge(`${process.env.GGE_API_URL}/${zone}/gdi/"PID":${playerId}`);
      if (!responseData.ok) return null;
      const data = await responseData.json();
      if (!data?.content?.gcl?.C) return null;
      for (const c of data['content']['gcl']['C']) {
        if (c.KID !== 0) continue;
        const ai = c.AI.find((castle: any) => castle.AI[0] === 1);
        if (ai) return ApiCastle.mapPlayerCastles([{ KID: 0, AI: [ai] }], code)[0];
      }
      return null;
    } catch {
      return null;
    }
  }

  private static sample<T>(items: T[], count: number): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    return shuffled.slice(0, count);
  }

  private static async sendPlayerCastles(
    response: express.Response,
    gamePlayerId: number,
    code: string,
    cachedKey: string,
  ): Promise<void> {
    const targetEmpireEx = ApiHelper.ggeTrackerManager.getZoneFromCode(code);
    // We send directly request to internal GGE API proxy, because this data is not stored in our DB
    const apiUrl = `${process.env.GGE_API_URL}/${targetEmpireEx}/gdi/"PID":${gamePlayerId}`;
    const responseData = await fetchFromBridge(apiUrl);
    if (!responseData.ok) {
      response.status(responseData.status).send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
      return;
    }
    const data = await responseData.json();
    if (!data?.content?.O?.AP) {
      response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.PlayerNotFound });
      return;
    }
    const mappedCastles = ApiCastle.mapPlayerCastles(data['content']['gcl']['C'], code);
    response.status(ApiHelper.HTTP_OK).send(mappedCastles);
    void ApiHelper.updateCache(cachedKey, mappedCastles, 3600);
  }

  private static mapPlayerCastles(castleObject: any[], code: string): any[] {
    const castlesAI = castleObject
      .filter((c: any) => [0, 1, 2, 3].includes(c.KID))
      .flatMap((c: any) => c.AI.map((ai: any) => ({ ...ai, KID: c.KID })));
    const serverName = ApiHelper.ggeTrackerManager.getServerNameFromCode(code) ?? '';
    const hasAdvancedCastle = ApiHelper.ggeTrackerManager.hasFeature(serverName, 'advancedCastle');
    return castlesAI.map((castle: any) => ({
      kingdomId: castle.KID,
      isAvailable: castle.KID === 0 ? true : hasAdvancedCastle,
      id: Number(ApiHelper.addCountryCode(castle.AI[3], code)),
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
    }));
  }
}
