//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//
import { DiscordApiMessageBody } from './interfaces';
import { GenericFetchAndSaveBackend } from './main';
import { outerRealmsAnnouncement } from './outer-realms-announcement';
import {
  OuterRealmsUniverse,
  outerRealmsGameOf,
  outerRealmsLinkQuery,
  outerRealmsUniverse,
} from './outer-realms-universe';

const ID_SERVER = process.env.ID_SERVER;
const PG_DB = process.env.PG_DB;
const CLICKHOUSE_DB = process.env.CLICKHOUSE_DB;
const logSuffix = process.env.LOG_SUFFIX;
const CONNECTION_LIMIT = process.env.CONNECTION_LIMIT;

const TARGET_PG_DB = process.env.TARGET_PG_DB;
const TARGET_MYSQL_DB = process.env.TARGET_MYSQL_DB;
const TARGET_CLICKHOUSE_DB = process.env.TARGET_CLICKHOUSE_DB;
const TARGET_LOG_SUFFIX = process.env.TARGET_LOG_SUFFIX;
const TARGET_CONNECTION_LIMIT = process.env.TARGET_CONNECTION_LIMIT;

const DISCORD_OR_API_URL = process.env.DISCORD_OR_API_URL;
const UNIVERSE = outerRealmsUniverse(outerRealmsGameOf(logSuffix));

if (
  !ID_SERVER ||
  !PG_DB ||
  !CLICKHOUSE_DB ||
  !logSuffix ||
  !CONNECTION_LIMIT ||
  !TARGET_PG_DB ||
  !TARGET_MYSQL_DB ||
  !TARGET_CLICKHOUSE_DB ||
  !TARGET_LOG_SUFFIX ||
  !TARGET_CONNECTION_LIMIT
) {
  console.error('Missing required environment variables');
  process.exit(1);
}
const BASE_DOMAIN_URL: string = `http://empire-api-realtime:3000`;
const BASE_API_URL: string = `${BASE_DOMAIN_URL}/${ID_SERVER}/`;

// ClickHouse Configuration
const CLICKHOUSE_CONFIG = {
  url: 'http://clickhouse',
  port: 8123,
  protocol: 'http',
  user: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DB,
};
const TARGET_CLICKHOUSE_CONFIG = {
  url: 'http://clickhouse',
  port: 8123,
  protocol: 'http',
  user: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: TARGET_CLICKHOUSE_DB,
};

// Postgres Configuration
const postgresConfig = {
  host: 'postgres',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: PG_DB,
  port: 5432,
  max: Number(CONNECTION_LIMIT),
};

const TARGET_postgresConfig = {
  host: 'postgres',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: TARGET_PG_DB,
  port: 5432,
  max: Number(TARGET_CONNECTION_LIMIT),
};

async function ensureOuterRealmsConnected(
  generic: GenericFetchAndSaveBackend,
  universe: OuterRealmsUniverse,
  statusUrl: string,
  serverUrl: string,
): Promise<string | null> {
  const knownZone = (await generic.getRedisValue(universe.liveZoneKey)) || universe.defaultLiveZone;
  console.log('Checking Empire API Realtime status for the', universe.game, 'Outer Realms server', knownZone);
  const statusResponse = await generic.fetchUrl(statusUrl, 'GET', null);
  const realtimeRedisStatus = await generic.getRedisValue(universe.fetchErrorKey);
  if (statusResponse.data?.[knownZone] === true && !realtimeRedisStatus) return knownZone;

  const lastCheckTime = await generic.getRedisValue(universe.lastCheckTimeKey);
  const now = Date.now();
  if (lastCheckTime && now - Number(lastCheckTime) < 10 * 60 * 1000) {
    console.error('Outer Realms server is not ready yet. Last check was less than 10 minutes ago. Exiting.');
    return null;
  }
  await generic.setRedisValue(universe.lastCheckTimeKey, now.toString());

  console.log('Deleting existing Outer Realms server configuration if any...');
  try {
    await generic.fetchUrl(serverUrl + '/' + knownZone, 'DELETE', null);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('Fetching Outer Realms tokens...');
  const data = await generic.getOuterRealmsCode();
  if (!data) {
    console.error('Failed to get Outer Realms tokens');
    return null;
  }

  console.log('Outer Realms server is not connected yet. Connecting...');
  const { TLT, TSIP, TSZ } = data;
  await generic.fetchUrl(BASE_DOMAIN_URL + '/server', 'POST', {
    server: TSZ,
    socket_url: TSIP,
    username: 'gge-tracker-outer-realms',
    password: TLT,
    serverType: universe.socketType,
  });
  await generic.setRedisValue(universe.liveZoneKey, TSZ);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('Outer Realms server might be connected. Verifying...');
  const verifyResponse = await generic.fetchUrl(statusUrl, 'GET', null);
  if (verifyResponse.data?.[TSZ] !== true) {
    console.error('Failed to connect Outer Realms server, exiting.');
    return null;
  }
  console.log('Outer Realms server is successfully connected!');
  return TSZ;
}

async function notifyOuterRealmsEvent(
  generic: GenericFetchAndSaveBackend,
  discordApiUrl: string,
  channelId: string,
  universe: OuterRealmsUniverse,
  scoringSystemType: 'collector' | 'might' | 'rankSwap',
): Promise<boolean> {
  try {
    await generic.fetchUrl(discordApiUrl, 'POST', getDiscordApiMessageBody(channelId, universe, scoringSystemType));
    return true;
  } catch (error) {
    console.error('Error sending Discord notification:', error);
    return false;
  }
}

async function announceNewOuterRealmsEvent(
  generic: GenericFetchAndSaveBackend,
  universe: OuterRealmsUniverse,
  scoringSystemType: 'collector' | 'might' | 'rankSwap' | null,
): Promise<void> {
  const currentTSIDValue = await generic.getRedisValue(universe.temporaryServerIdKey);
  const announcedTSIDValue = await generic.getRedisValue(universe.announcedTsidKey);
  const decision = outerRealmsAnnouncement(currentTSIDValue, announcedTSIDValue);
  console.log('Current TSID:', currentTSIDValue, '- last announced:', announcedTSIDValue, '- decision:', decision);
  if (decision === 'none' || !currentTSIDValue) return;
  const channelId = universe.eventsChannelId();
  if (decision === 'announce' && DISCORD_OR_API_URL && channelId) {
    if (!scoringSystemType) return;
    const posted = await notifyOuterRealmsEvent(generic, DISCORD_OR_API_URL, channelId, universe, scoringSystemType);
    if (!posted) return;
  }
  await generic.setRedisValue(universe.announcedTsidKey, currentTSIDValue);
}

async function createOuterRealmsInstance(): Promise<void> {
  const statusUrl = BASE_DOMAIN_URL + '/status';
  const serverUrl = BASE_DOMAIN_URL + '/server';
  try {
    const generic = new GenericFetchAndSaveBackend(
      BASE_API_URL,
      CLICKHOUSE_CONFIG,
      postgresConfig,
      logSuffix || 'Outer Realms Token Scraper',
    );

    const liveZone = await ensureOuterRealmsConnected(generic, UNIVERSE, statusUrl, serverUrl);
    if (!liveZone) return;

    console.log('Starting Outer Realms data fetch process...');
    const target = new GenericFetchAndSaveBackend(
      `${BASE_DOMAIN_URL}/${liveZone}/`,
      TARGET_CLICKHOUSE_CONFIG,
      TARGET_postgresConfig,
      TARGET_LOG_SUFFIX || 'Outer Realms Token Scraper',
    );
    const scoringSystemType: 'collector' | 'might' | 'rankSwap' | null = await target.startOuterRealmsDataFetch(
      UNIVERSE.game,
    );
    console.log('Scoring system type detected:', scoringSystemType);
    await announceNewOuterRealmsEvent(generic, UNIVERSE, scoringSystemType);
  } catch (error) {
    console.error('Error fetching Empire API Realtime status:', error);
  }
}

const OuterRealmsData = {
  collector: {
    name: 'Heritage hunter',
    image: 'https://gge-tracker.com/assets/live/collector.png',
    description:
      'Collect daily ranking points by launching attacks on the main castle of your enemies in the Great Empire and looting their heritage. The amount of heritage that can be claimed during each attack can be increased by using special heritage boosters, which can be purchased with rubies from the event shop.',
  },
  might: {
    name: 'Masters of might',
    image: 'https://gge-tracker.com/assets/live/might.png',
    description:
      'Collect daily ranking points by constructing mighty buildings and decorations in your new event castle and earn treasures of rare value for your people. The might points of any buildings in your castle that are burning will not be considered when the daily points are calculated, so keep those defenses up!',
  },
  rankSwap: {
    name: 'Snappy swap',
    image: 'https://gge-tracker.com/assets/live/rankSwap.png',
    description:
      'Collect daily ranking points by launching attacks on the main castle of your enemies in the Great Empire and swap ranking positions with them. Eligible players are marked in the daily ranking list.',
  },
};

function getDiscordApiMessageBody(
  channelId: string,
  universe: OuterRealmsUniverse,
  scoring: 'collector' | 'might' | 'rankSwap',
): DiscordApiMessageBody {
  const pageUrl = `https://gge-tracker.com/live/outer-realms${outerRealmsLinkQuery(universe.game)}`;
  return {
    channelId,
    embeds: [
      {
        title: 'Outer Realms Notification',
        color: 7419530,
        fields: [
          {
            name: `:fire: A new Outer Realms event is available : ${OuterRealmsData[scoring].name}`,
            value: `${OuterRealmsData[scoring].description}\n\n :arrow_right: ${pageUrl} `,
            inline: false,
          },
        ],
        thumbnail: {
          url: OuterRealmsData[scoring].image,
        },
        footer: {
          text: 'gge-tracker.com',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

void createOuterRealmsInstance();
