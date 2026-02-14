//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//
import { exit } from 'node:process';
import { GenericFetchAndSaveBackend } from './main';

const ID_SERVER = process.env.ID_SERVER;
const PG_DB = process.env.PG_DB;
const logSuffix = process.env.LOG_SUFFIX;
const CONNECTION_LIMIT = process.env.CONNECTION_LIMIT;

if (!ID_SERVER || !PG_DB || !logSuffix || !CONNECTION_LIMIT) {
  console.error('Missing required environment variables');
  process.exit(1);
}
const BASE_API_URL: string = `http://empire-api-realtime:3000/${ID_SERVER}/`;
const DATABASE_CONFIG = {
  host: 'mariadb',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: PG_DB,
  connectionLimit: Number(CONNECTION_LIMIT),
};
const postgresConfig = {
  host: 'postgres',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: PG_DB,
  port: 5432,
  max: 5,
};

async function executeFillInOrder(): Promise<void> {
  console.log('Starting the dungeon fetcher for ' + logSuffix + '...');
  const generic = new GenericFetchAndSaveBackend(BASE_API_URL, DATABASE_CONFIG, {}, postgresConfig, logSuffix);
  await generic.getDungeonsList(2);
  console.log('Finished fetching dungeons for ' + logSuffix + '. Waiting 1 minute before fetching again...');
  await new Promise((resolve) => setTimeout(resolve, 60000));
  await generic.getDungeonsList(1);
  console.log('Finished fetching dungeons for ' + logSuffix + '. Waiting 1 minute before fetching again...');
  await new Promise((resolve) => setTimeout(resolve, 60000));
  await generic.getDungeonsList(3);
  console.log('Finished fetching dungeons for ' + logSuffix + '.');
  exit(0);
}

void executeFillInOrder();
