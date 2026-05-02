//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { GenericFetchAndSaveBackend } from './main';

const ID_SERVER = process.env.ID_SERVER;
const PG_DB = process.env.PG_DB;
const CLICKHOUSE_DB = process.env.CLICKHOUSE_DB;
const logSuffix = process.env.LOG_SUFFIX;
const CONNECTION_LIMIT = process.env.CONNECTION_LIMIT;

if (!ID_SERVER || !PG_DB || !CLICKHOUSE_DB || !logSuffix || !CONNECTION_LIMIT) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const BASE_API_URL: string = `http://empire-api:3000/${ID_SERVER}/`;
const CLICKHOUSE_CONFIG = {
  url: 'http://clickhouse',
  port: 8123,
  protocol: 'http',
  user: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DB,
};

async function updateWheelAffluence(): Promise<void> {
  const generic = new GenericFetchAndSaveBackend(BASE_API_URL, null, CLICKHOUSE_CONFIG, null, logSuffix);
  await generic.insertWheelOfUnimaginableAffluenceData();
}

void updateWheelAffluence();
