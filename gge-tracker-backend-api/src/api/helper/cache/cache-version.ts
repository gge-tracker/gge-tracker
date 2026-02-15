import { RedisClientType } from 'redis';

export async function getCacheVersion(redis: RedisClientType<any>, language: string): Promise<string> {
  return (await redis.get(`fill-version:${language}`)) ?? '1';
}
