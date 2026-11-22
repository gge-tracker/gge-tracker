import { createClient } from 'redis';

export type TemporaryServerGame = 'ep' | 'e4k';

export const TEMPORARY_SERVER_ID_KEYS: Record<TemporaryServerGame, string> = {
  ep: 'temporaryServerData',
  e4k: 'temporaryServerData:e4k',
};

const OUTER_REALMS_EVENT_ID = 106;

export function findTemporaryServerId(gbdContent: any): number | null {
  const events = gbdContent?.sei?.E;
  if (!Array.isArray(events)) return null;
  const outerRealms = events.find((event: any) => event?.EID === OUTER_REALMS_EVENT_ID);
  return outerRealms?.TSID ?? null;
}

export async function saveTemporaryServerId(game: TemporaryServerGame, temporaryServerId: number): Promise<void> {
  const redisClient = createClient({ url: 'redis://redis-server:6379' });
  await redisClient.connect();
  try {
    await redisClient.set(TEMPORARY_SERVER_ID_KEYS[game], String(temporaryServerId));
  } finally {
    await redisClient.quit();
  }
}
