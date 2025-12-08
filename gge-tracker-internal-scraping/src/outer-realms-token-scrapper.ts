//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//
import { GenericFetchAndSaveBackend } from './main';

const ID_SERVER = process.env.ID_SERVER;
const PG_DB = process.env.PG_DB;
const MYSQL_DB = process.env.MYSQL_DB;
const CLICKHOUSE_DB = process.env.CLICKHOUSE_DB;
const logSuffix = process.env.LOG_SUFFIX;
const CONNECTION_LIMIT = process.env.CONNECTION_LIMIT;

const TARGET_ID_SERVER = process.env.TARGET_ID_SERVER;
const TARGET_PG_DB = process.env.TARGET_PG_DB;
const TARGET_MYSQL_DB = process.env.TARGET_MYSQL_DB;
const TARGET_CLICKHOUSE_DB = process.env.TARGET_CLICKHOUSE_DB;
const TARGET_LOG_SUFFIX = process.env.TARGET_LOG_SUFFIX;
const TARGET_CONNECTION_LIMIT = process.env.TARGET_CONNECTION_LIMIT;

if (
  !ID_SERVER ||
  !PG_DB ||
  !MYSQL_DB ||
  !CLICKHOUSE_DB ||
  !logSuffix ||
  !CONNECTION_LIMIT ||
  !TARGET_ID_SERVER ||
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
const TARGET_BASE_API_URL: string = `${BASE_DOMAIN_URL}/${TARGET_ID_SERVER}/`;

// MariaDB Configuration
const DATABASE_CONFIG = {
  host: 'mariadb',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: MYSQL_DB,
  connectionLimit: Number(CONNECTION_LIMIT),
};
const TARGET_DATABASE_CONFIG = {
  host: 'mariadb',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: TARGET_MYSQL_DB,
  connectionLimit: Number(TARGET_CONNECTION_LIMIT),
};

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

async function createOuterRealmsInstance(): Promise<void> {
  const statusUrl = BASE_DOMAIN_URL + '/status';
  const serverUrl = BASE_DOMAIN_URL + '/server';
  try {
    const generic = new GenericFetchAndSaveBackend(
      BASE_API_URL,
      DATABASE_CONFIG,
      CLICKHOUSE_CONFIG,
      postgresConfig,
      logSuffix,
    );

    console.log('Checking Empire API Realtime status for Outer Realms server...');
    const statusResponse = await generic.fetchUrl(statusUrl, 'GET', null);

    if (!statusResponse.data || statusResponse.data['EmpireEx_42'] !== true) {
      console.log('Deleting existing Outer Realms server configuration if any...');
      try {
        await generic.fetchUrl(serverUrl + '/' + ID_SERVER, 'DELETE', null);
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5000));

      console.log('Fetching Outer Realms tokens...');
      const data = await generic.getOuterRealmsCode();
      if (!data) {
        console.error('Failed to get Outer Realms tokens');
        return;
      }

      console.log('Outer Realms server is not connected yet. Connecting...');
      const { TLT, TSIP, TSZ } = data;
      const url = BASE_DOMAIN_URL + '/server';
      const body = {
        server: TSZ,
        socket_url: TSIP,
        username: 'gge-tracker-outer-realms',
        password: TLT,
      };
      await generic.fetchUrl(url, 'POST', body);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.log('Outer Realms server might be connected. Verifying...');
      const verifyResponse = await generic.fetchUrl(statusUrl, 'GET', null);
      if (verifyResponse.data && verifyResponse.data['EmpireEx_42'] === true) {
        console.log('Outer Realms server is successfully connected!');
      } else {
        console.error('Failed to connect Outer Realms server, exiting.');
        return;
      }
    }
    console.log('Starting Outer Realms data fetch process...');
    const target = new GenericFetchAndSaveBackend(
      TARGET_BASE_API_URL,
      TARGET_DATABASE_CONFIG,
      TARGET_CLICKHOUSE_CONFIG,
      TARGET_postgresConfig,
      TARGET_LOG_SUFFIX,
    );
    await target.startOuterRealmsDataFetch();
  } catch (error) {
    console.error('Error fetching Empire API Realtime status:', error);
    return;
  }
}

void createOuterRealmsInstance();
