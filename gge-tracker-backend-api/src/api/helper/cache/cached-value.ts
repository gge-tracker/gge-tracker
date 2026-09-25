import { ApiHelper } from '../api-helper';

export abstract class CachedValue {
  public static async remember<T>(cacheKey: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const cached = await ApiHelper.redisClient.get(cacheKey).catch(() => null);
    if (cached !== null) return JSON.parse(cached) as T;
    const value = await compute();
    void ApiHelper.updateCache(cacheKey, value, ttlSeconds);
    return value;
  }
}
