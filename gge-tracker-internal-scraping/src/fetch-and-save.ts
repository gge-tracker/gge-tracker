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

if (!ID_SERVER || !PG_DB || !MYSQL_DB || !CLICKHOUSE_DB || !logSuffix || !CONNECTION_LIMIT) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const BASE_API_URL: string =
  ID_SERVER === 'null' ? 'http://empire-api:3000/EmpireEx/' : 'http://empire-api:3000/EmpireEx_' + ID_SERVER + '/';
const DATABASE_CONFIG = {
  host: 'mariadb',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: MYSQL_DB,
  connectionLimit: Number(CONNECTION_LIMIT),
};
const CLICKHOUSE_CONFIG = {
  url: 'http://clickhouse',
  port: 8123,
  protocol: 'http',
  user: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DB,
};
const postgresConfig = {
  host: 'postgres',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: PG_DB,
  port: 5432,
  max: Number(CONNECTION_LIMIT),
};
const genericPostgresConfig = {
  host: 'postgres',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: 'empire-ranking-global',
  port: 5432,
  max: 5,
};

async function executeFillInOrder(): Promise<void> {
  const generic = new GenericFetchAndSaveBackend(
    BASE_API_URL,
    DATABASE_CONFIG,
    CLICKHOUSE_CONFIG,
    postgresConfig,
    logSuffix,
  );
  await generic.executeFillInOrder();
  if (logSuffix === 'DE1') {
    const generic2 = new GenericFetchAndSaveBackend(BASE_API_URL, null, null, genericPostgresConfig, 'GLOBAL_RANKING');
    await generic2.refreshGlobalRankings();
  }
  setTimeout(() => {
    console.log('Timeout reached, forcing exit.');
    process.exit(1);
  }, 60 * 1000);
}

void executeFillInOrder();
