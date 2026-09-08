import * as express from 'express';
import { ApiHelper } from '../api-helper';

/**
 * Serves a JSON body through Redis without ever serialising it twice
 */
export abstract class CachedResponse {
  public static async serve(
    response: express.Response,
    cacheKey: string,
    body: unknown,
    ttlSeconds = 3600,
  ): Promise<void> {
    const payload = JSON.stringify(body);
    void ApiHelper.updateCache(cacheKey, payload, ttlSeconds, true);
    response.status(ApiHelper.HTTP_OK).type('application/json').send(payload);
  }

  public static async serveCached(response: express.Response, cacheKey: string): Promise<boolean> {
    const cached = await ApiHelper.redisClient.get(cacheKey).catch(() => null);
    if (cached === null) return false;
    response.status(ApiHelper.HTTP_OK).type('application/json').send(cached);
    return true;
  }
}
