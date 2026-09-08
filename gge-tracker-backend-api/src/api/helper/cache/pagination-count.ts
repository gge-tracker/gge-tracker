import { ApiHelper } from '../api-helper';

export abstract class PaginationCount {
  public static readonly DEFAULT_TTL_SECONDS = 3600;

  public static async resolve(
    cacheKey: string,
    runCount: () => Promise<number>,
    ttlSeconds: number = PaginationCount.DEFAULT_TTL_SECONDS,
  ): Promise<number> {
    const cached = await ApiHelper.redisClient.get(cacheKey).catch(() => null);
    if (cached !== null) {
      const parsed = Number(cached);
      if (Number.isFinite(parsed)) return parsed;
    }
    const count = Number(await runCount());
    void ApiHelper.updateCache(cacheKey, String(count), ttlSeconds, true);
    return count;
  }
}
