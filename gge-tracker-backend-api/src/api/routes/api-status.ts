import * as express from 'express';
import { ApiHelper } from '../api-helper';

/**
 * Abstract class providing API status and server information endpoints.
 *
 * @remarks
 * This class implements methods to handle API status checks and server list retrievals.
 * It is intended to be used as a base class for API route handlers.
 */
export abstract class ApiStatus implements ApiHelper {
  /**
   * Handles the API status endpoint.
   *
   * Retrieves the latest update timestamps for specific parameters from the database,
   * sorts and formats them, and returns a status object containing server information,
   * API version, release date, and update progress status.
   *
   * @param request - The Express request object, expected to contain a `pg_pool` property for database access,
   *                  as well as `language` and `code` properties for server identification.
   * @param response - The Express response object used to send the status data or error information.
   * @returns A Promise that resolves when the response has been sent.
   */
  public static async getStatus(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Fetch last update timestamps from the database
       * --------------------------------- */
      const lastUpdate: { [key: string]: string } = {};
      const queryParameter = `SELECT identifier, updated_at FROM parameters WHERE id > 1 AND id  < 10`;
      await new Promise((resolve, reject) => {
        request['pg_pool'].query(queryParameter, (error, results) => {
          if (error) {
            ApiHelper.logError(error, 'getStatus_query', request);
            reject(new Error('An error occurred. Please try again later.'));
          } else {
            results.rows.forEach((result: any) => {
              lastUpdate[result.identifier] = result.updated_at;
            });
            resolve(null);
          }
        });
      });

      /* ---------------------------------
       * Sort and format the last update timestamps
       * --------------------------------- */
      const lastUpdateSorted = Object.keys(lastUpdate)
        .sort((a, b) => new Date(lastUpdate[b]).getTime() - new Date(lastUpdate[a]).getTime())
        .reduce((object: any, key: string) => {
          object[key] = new Date(lastUpdate[key]).toISOString();
          return object;
        }, {});
      const lastUpdateLoot = lastUpdate['loot'] ? new Date(lastUpdate['loot']).getTime() : 0;
      const lastUpdateMight = lastUpdate['might'] ? new Date(lastUpdate['might']).getTime() : 0;
      const update_in_progress = lastUpdateMight < lastUpdateLoot;

      /* ---------------------------------
       * Return status data
       * --------------------------------- */
      const data = {
        server: request['language'],
        server_code: request['code'],
        website_url: 'https://gge-tracker.com',
        api_url: 'https://api.gge-tracker.com',
        discord_url: 'https://discord.gg/eb6WSHQqYh',
        version: ApiHelper.API_VERSION,
        release_version: ApiHelper.API_VERSION_RELEASE_DATE,
        last_update: lastUpdateSorted,
        update_in_progress,
      };
      response.status(ApiHelper.HTTP_OK).send(data);
      // There is no cache for this endpoint as it is expected to be called frequently to monitor update progress
      return;
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getStatus', request);
      return;
    }
  }

  /**
   * Handles the retrieval of all server names.
   *
   * This method first attempts to fetch the list of server names from a Redis cache.
   * If the data is found in the cache, it is returned immediately.
   * Otherwise, it retrieves the server names from the GGE Tracker Manager, caches the result for 24 hours,
   * and then returns the list to the client.
   *
   * @param request - The Express request object.
   * @param response - The Express response object.
   * @returns A promise that resolves when the response is sent.
   *
   * @remarks
   * Responds with HTTP 200 and the list of server names on success.
   * Responds with HTTP 500 and an error message if an error occurs.
   */
  public static async getServers(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Check Redis cache for server names
       * --------------------------------- */
      const cachedKey = 'all_servers';
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Fetch server names and cache the result
       * --------------------------------- */
      const servers = ApiHelper.ggeTrackerManager.getAllServerNames();
      await ApiHelper.redisClient.setEx(cachedKey, 86_400, JSON.stringify(servers));
      response.status(ApiHelper.HTTP_OK).send(servers);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getServers', request);
      return;
    }
  }
}
