/**
 * Redis access to the mocked backend's cache database
 */
import { createClient } from 'redis';

export type CacheClient = ReturnType<typeof createClient>;

export async function openMockedCache(): Promise<CacheClient> {
  const client = createClient({
    url: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });
  client.on('error', () => undefined);
  await client.connect();
  return client;
}
