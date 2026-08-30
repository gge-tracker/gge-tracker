//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025-2026 - gge-tracker.com & gge-tracker contributors
//
import axios, { AxiosError, AxiosResponse } from 'axios';
import { format } from 'date-fns';
import * as mysql from 'mysql2/promise';
import pLimit from 'p-limit';
import * as pg from 'pg';
import { randomInt } from 'node:crypto';
import * as readline from 'node:readline';
import { createClient } from 'redis';
import { HIGHSCORES_CONFIG } from './definitions/highest_scores.config';
import { SWAP_RANK_POINTS_TABLE } from './definitions/swap-rank-points.config';
import { TEMP_SERVER_SETTINGS } from './definitions/temp-server-events.config';
import {
  AllianceDatabase,
  Castle,
  CastleMovement,
  DungeonMap,
  HighScoreKey,
  PlayerDatabase,
  StormFort,
  StormIsle,
  StormIsleState,
  StormScanResult,
} from './interfaces';
import Utils from './utils';

export interface PlayerUpsertInput {
  playerId: number;
  playerName: string;
  allianceId: any;
  allianceName: any;
  might_current: any;
  might_all_time: any;
  loot_current: any;
  loot_all_time: any;
  castles?: any;
  minimalist?: boolean;
}

interface OuterRealmsEntry {
  OID: number;
  N: string;
  server: string;
  score: number;
  rank: number;
  level: number;
  legendaryLevel: number;
  might: number;
  castlePositionX: number;
  castlePositionY: number;
}

interface DungeonCooldownUpdate {
  kid: number;
  position_x: number;
  position_y: number;
  global_available_at: Date;
  player_available_at: Date;
  player_id: number;
}

interface DungeonScanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  step: number;
  zone: number;
  totalRequests: number;
}

interface EventHistoryEntity {
  playerId: number;
  playerName: string;
  category: number;
  point: number;
  allianceId: number;
  allianceName: string;
}

interface LootRankingPlayer {
  uid: number;
  rank: number;
  name: string;
  points: number;
  allianceID: number;
  allianceName?: string;
  mightPoints: number;
}

interface MightRankingPlayer {
  uid: number;
  name: string;
  allianceID: number;
  allianceName?: string;
  mightPoints: number;
}

export interface DiscordApiMessageBody {
  channelId: string;
  embeds: {
    title: string;
    color: number;
    fields: {
      name: string;
      value: string;
      inline: boolean;
    }[];
    thumbnail?: {
      url: string;
    };
    image?: {
      url: string;
    };
    footer?: {
      text: string;
    };
    timestamp: string;
  }[];
}

/**
 * This class provides a comprehensive backend service for fetching, processing,
 * and storing game-related data from various APIs and databases. It supports operations for player and alliance
 * management, event history tracking, server statistics calculation, cache management, and health checks.
 *
 * @remarks
 * This class is intended for internal backend use in the gge-tracker project and is not exposed to the public.
 * This class is instantiated for each server each time a fill is requested (every ~1 hour).
 *
 * @todo
 * This file should be divided into smaller, more manageable modules in the future.
 * Each module should handle a specific aspect of the functionality, such as:
 * - Database interactions
 * - API communications
 * - Data processing
 * - Logging and error handling
 * - Configuration management
 * - Utility functions
 * This file contains a lot of legacy code that needs to be refactored and cleaned up.
 * Comments and logs should be standardized to English.
 */
export class GenericFetchAndSaveBackend {
  private static readonly PG_TRANSIENT_ERRORS = [
    'Connection terminated unexpectedly',
    'Connection terminated due to connection timeout',
    'timeout exceeded when trying to connect',
    'sorry, too many clients already',
    'the database system is starting up',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
  ];
  private static readonly CLICKHOUSE_RETRYABLE_CODES: ReadonlySet<number> = new Set([
    159, // TIMEOUT_EXCEEDED
    202, // TOO_MANY_SIMULTANEOUS_QUERIES
    203, // NO_FREE_CONNECTION
    209, // SOCKET_TIMEOUT
    210, // NETWORK_ERROR
    241, // MEMORY_LIMIT_EXCEEDED
    252, // TOO_MANY_PARTS
    394, // QUERY_WAS_CANCELLED
    425, // SYSTEM_ERROR
    745, // SERVER_OVERLOADED
  ]);

  private static readonly SCAN_DELAY_MIN_MS = 100;
  private static readonly SCAN_DELAY_MAX_MS = 1100;
  private static readonly CLICKHOUSE_INSERT_CHUNK_SIZE = 50000;
  private static readonly CLICKHOUSE_MAX_ATTEMPTS = 6;
  private static readonly CLICKHOUSE_BASE_BACKOFF_MS = 2000;
  private static readonly CLICKHOUSE_MAX_BACKOFF_MS = 60000;

  public playerRenamedList: { [key: string]: any } = {};
  public allianceRenamedList: { [key: string]: any } = {};
  public DB_UPDATES = {
    alliancesCreated: 0,
    playersCreated: 0,
    playersAllianceUpdated: 0,
    alliancesUpdated: 0,
    criticalErrors: 0,
  };
  public connection!: mysql.Pool;
  public pgSqlConnection!: pg.Pool;
  public allianceUpdated: { [key: string]: boolean } = {};
  private pgSqlPoolEnded: boolean = false;
  private readonly WEBHOOK_URL: string = process.env.WEBHOOK_URL || '';
  private readonly CURRENT_ENV: string = process.env.ENVIRONMENT || 'development';
  private readonly DISCORD_OR_CHANNEL_ID: string = process.env.DISCORD_OR_CHANNEL_ID || '';
  private readonly DISCORD_OR_API_URL: string = process.env.DISCORD_OR_API_URL || '';
  private readonly MAP_SIZE = 1286;
  private readonly STORM_KID = 4;
  private readonly STORM_CENTER_X = 644;
  private readonly STORM_CENTER_Y = 644;
  private readonly STORM_TILE_SPAN = 100;
  private readonly STORM_TILE_HALF_SPAN = 50;
  private readonly STORM_TILE_SPACING = 101;
  private readonly STORM_MAX_RINGS = 5;
  private readonly STORM_FORT_OBJECT_ID = 25;
  private readonly STORM_ISLE_OBJECT_ID = 24;
  private readonly STORM_BORDER_OBJECT_ID = 31;
  private readonly STORM_RESET_HOUR_UTC = 0;
  private readonly STORM_RESET_MINUTE_UTC = 30;
  private readonly STORM_CHUNK_SIZE = 500;
  private readonly BASE_API_URL: string;
  private readonly CLICKHOUSE_CONFIG: { [key: string]: string | number | undefined } | undefined;
  private readonly PGSQL_CONFIG: pg.PoolConfig | undefined;
  private readonly server: string;
  private playerLootAndMightPointHistoryList: { [key: string]: any[] } = {};
  private playerEventPointHistoryList: { [key: string]: { [key: string]: number | null } } = {};
  private customPlayersAttributesList: { [key: string]: any } = {};
  private currentPlayers: PlayerDatabase[] = [];
  private currentAlliances: AllianceDatabase[] = [];
  private readonly isE4KServer: boolean = false;
  private readonly ENV_LT = {
    war_realms: 44,
    samurai: 51,
    nomad: 46,
    berimondKingdom: 30,
    bloodcrow: 58,
    outerRealms: 76,
    beyondTheHorizon: 78,
    allianceBeyondTheHorizon: 79,
  };

  constructor(
    BASE_API_URL: string,
    CLICKHOUSE_CONFIG: { [key: string]: string | number | undefined } | null,
    PGSQL_CONFIG: pg.PoolConfig | null,
    server: string | undefined,
  ) {
    this.BASE_API_URL = BASE_API_URL;
    this.CLICKHOUSE_CONFIG = CLICKHOUSE_CONFIG || undefined;
    if (PGSQL_CONFIG) {
      this.PGSQL_CONFIG = PGSQL_CONFIG;
    }
    this.server = server || 'unknown';
    this.isE4KServer = String(server).toLowerCase().startsWith('e4k');
    if (PGSQL_CONFIG) {
      this.createNewPool();
    }
  }

  private static parseClickHouseErrorCode(error: unknown): number | undefined {
    const response = (error as AxiosError)?.response;
    if (!response) return undefined;
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    const match = /Code:\s*(\d+)/.exec(body);
    return match ? Number(match[1]) : undefined;
  }

  private static isClickHouseRetryable(error: unknown): boolean {
    const response = (error as AxiosError)?.response;
    if (!response) return true;
    if (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
      return true;
    }
    const code = GenericFetchAndSaveBackend.parseClickHouseErrorCode(error);
    return code !== undefined && GenericFetchAndSaveBackend.CLICKHOUSE_RETRYABLE_CODES.has(code);
  }

  private static nullIfNotPositive(value: any): any {
    return !value || Number(value) <= 0 ? null : value;
  }

  private static isMissingAllianceError(error: any): boolean {
    return error?.code === 'ER_NO_REFERENCED_ROW_2' || error?.code == '23503';
  }

  private static eventServerDatabaseName(server: string): string {
    switch (server) {
      case 'WLD1':
      case 'LIVE':
        return 'empire-ranking-world1';
      case 'WLD2':
      case 'LIVE2':
        return 'empire-ranking-world2';
      case 'HANT':
        return 'empire-ranking-hant1';
      default:
        return `empire-ranking-${server.toLowerCase()}`;
    }
  }

  private static buildThrottleDelays(totalRequests: number): number[] {
    const randoms: number[] = [];
    for (let i = 0; i < totalRequests; i++) {
      randoms.push(
        randomInt(GenericFetchAndSaveBackend.SCAN_DELAY_MIN_MS, GenericFetchAndSaveBackend.SCAN_DELAY_MAX_MS + 1),
      );
    }
    // We shuffle the list to avoid having patterns in the requests
    for (let i = randoms.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [randoms[i], randoms[j]] = [randoms[j], randoms[i]];
    }
    return randoms;
  }

  private static appendDungeons(data: any, dungeonMaps: DungeonMap[]): void {
    const dungeons = data.content?.AI ?? [];
    for (const dungeon of dungeons) {
      if (dungeon[0] == '11') {
        dungeonMaps.push({
          coordinates: [dungeon[1], dungeon[2]],
          time: dungeon[5],
          playerId: dungeon[6],
          updatedAt: new Date(),
        });
      }
    }
  }

  private static renderScanProgress(done: number, totalRequests: number): void {
    // clearLine and cursorTo only exist on a terminal; the scrapers also run with a pipe.
    if (!process.stdout.isTTY) return;
    const percent = (done / totalRequests) * 100;
    const barWidth = 40;
    const filled = Math.round(barWidth * (done / totalRequests));
    const bar =
      '[' + '█'.repeat(filled) + '-'.repeat(barWidth - filled) + `] ${percent.toFixed(1)}% (${done}/${totalRequests})`;
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(bar);
  }

  private static async abortOuterRealmsFetch(redisClient: ReturnType<typeof createClient>): Promise<void> {
    await redisClient.set(`outerRealmsDataFetchError`, 'No active event found with known LT codes');
    await redisClient.quit();
  }

  private static collectOuterRealmsBatch(
    content: any[],
    LT: number,
    playerEntries: Map<number, OuterRealmsEntry>,
  ): number {
    const outerRealmType = Object.keys(HIGHSCORES_CONFIG).find(
      (key) => HIGHSCORES_CONFIG[key as keyof typeof HIGHSCORES_CONFIG] === LT,
    ) as HighScoreKey;
    let duplicatesInThisBatch = 0;
    for (const entry of content) {
      const playerData = entry[2];
      const OID = Number(playerData.OID);
      if (playerEntries.has(OID)) {
        duplicatesInThisBatch++;
        continue;
      }
      const parts = String(playerData.N).split('_');
      const castleEntry = playerData.AP.find((ap: number[]) => ap[0] === 0 && ap[4] === 1);
      const { rank, score } = GenericFetchAndSaveBackend.resolveOuterRealmsScore(outerRealmType, entry);
      playerEntries.set(OID, {
        OID,
        N: parts.slice(0, -1).join('_'),
        server: parts.at(-1) ?? '',
        score: score ?? Number(entry[1]),
        rank: rank,
        level: Number(playerData.L),
        legendaryLevel: Number(playerData.LL),
        might: Number(playerData.MP),
        castlePositionX: Number(castleEntry ? castleEntry[2] : null),
        castlePositionY: Number(castleEntry ? castleEntry[3] : null),
      });
    }
    return duplicatesInThisBatch;
  }

  private static resolveOuterRealmsScore(outerRealmType: HighScoreKey, entry: any[]): { rank: number; score?: number } {
    if (outerRealmType === 'TEMP_SERVER_DAILY_MIGHT_POINTS_BUILDINGS') {
      return { rank: Number(entry[4]) };
    }
    if (outerRealmType === 'TEMP_SERVER_DAILY_RANK_SWAP') {
      const rank = Number(entry[0]);
      const rankPointsEntry = SWAP_RANK_POINTS_TABLE.find((rp) => rank >= rp.maxRank && rank <= rp.minRank);
      return { rank, score: rankPointsEntry ? rankPointsEntry.rankPoints : 0 };
    }
    return { rank: Number(entry[0]) };
  }

  public async sleep(numberMs: number = 1500): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, numberMs));
  }

  public async closePool(): Promise<void> {
    if (!this.pgSqlConnection || this.pgSqlPoolEnded) {
      return;
    }
    this.pgSqlPoolEnded = true;
    await this.pgSqlConnection.end().catch((error) => {
      Utils.logMessage('An error occurred while closing the PostgreSQL pool:', error);
    });
  }

  public async getOuterRealmsCode(): Promise<{
    TLT: string;
    ZID: string;
    IID: string;
    TSIP: string;
    TSP: string;
    TSZ: string;
    ICS: number;
  } | null> {
    Utils.logMessage('Try getting TLT token for Outer Realms...');
    let response = await this.genericFetchData('glt', { GST: 2 });
    if (!response.data.content) {
      const responseTsh = await this.genericFetchData('tsh', null);
      if (!responseTsh.data.content) {
        Utils.logMessage(' No content received from tsh endpoint. Aborting Outer Realms entry.');
        Utils.logMessage('Content received:', JSON.stringify(responseTsh.data));
        return null;
      }
      await this.genericFetchData('qsc', { QID: 3490 });
      await this.genericFetchData('dcl', { CD: 1 });
      await this.sleep(500);
      Utils.logMessage('Selecting free castle in Outer Realms...');
      await this.genericFetchData('tsc', { ID: 31, OC2: 1, PWR: 0, GST: 2 });
      await this.sleep(500);
      response = await this.genericFetchData('glt', { GST: 2 });
      if (!response.data.content) {
        Utils.logMessage(' No content received from glt endpoint. Aborting Outer Realms entry.');
        return null;
      }
    }
    const content = response.data.content;
    Utils.logMessage('[debug] Outer Realms tokens received:', JSON.stringify(content));
    const { TLT, ZID, IID, TSIP, TSP, TSZ, ICS } = content;
    if (
      TLT === undefined ||
      ZID === undefined ||
      IID === undefined ||
      TSIP === undefined ||
      TSP === undefined ||
      TSZ === undefined ||
      ICS === undefined
    ) {
      Utils.logMessage(' Missing one or more required tokens for Outer Realms entry. Aborting.');
      return null;
    }
    Utils.logMessage('Successfully retrieved Outer Realms tokens.');
    return { TLT, ZID, IID, TSIP, TSP, TSZ, ICS };
  }

  public async fetchUrl(url: string, method: 'POST' | 'GET' | 'DELETE', body: any): Promise<AxiosResponse<any>> {
    if (method.toUpperCase() === 'POST') {
      return await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
    } else if (method.toUpperCase() === 'DELETE') {
      return await axios.delete(url);
    } else {
      return await axios.get(url);
    }
  }

  public async getRedisValue(key: string): Promise<string | null> {
    const redisClient = createClient({
      url: 'redis://redis-server:6379',
    });
    await redisClient.connect();
    const value = await redisClient.get(key);
    await redisClient.quit();
    return value;
  }

  public async setRedisValue(key: string, value: string): Promise<void> {
    const redisClient = createClient({
      url: 'redis://redis-server:6379',
    });
    await redisClient.connect();
    await redisClient.set(key, value);
    await redisClient.quit();
  }

  public async fillGrandTournamentResults(): Promise<void> {
    const start = new Date();
    try {
      Utils.logMessage('=====================================');
      Utils.logMessage(' Starting global rankings refresh');
      Utils.logMessage(' Current environment:', this.CURRENT_ENV);
      Utils.logMessage('=====================================');
      Utils.logMessage('Refreshing Grand Tournament results...');

      const currentEventId = await this.resolveGrandTournamentEventId();
      Utils.logMessage('Current eventId: ', currentEventId);
      const maxLevelCategory = 5;
      const alliances: { [key: string]: any } = {};
      const dateStr = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
      for (let lc = 1; lc <= maxLevelCategory; lc++) {
        Utils.logMessage(' Processing level category:', lc);
        const subDivisionCount = await this.collectGrandTournamentDivision(lc, currentEventId, dateStr, alliances);
        Utils.logMessage(' Total subdivisions processed for level category', lc + ':', subDivisionCount);
      }
      const insertValues: any[] = Object.values(alliances);
      Utils.logMessage('Inserting ', insertValues.length, 'records into the database...');
      if (insertValues.length > 0) {
        await this.insertGrandTournamentRows(insertValues);
      }
      Utils.logMessage('Grand Tournament results updated successfully');
      // If there is more that 1 record inserted, we increment the redis-fill version
      if (insertValues.length > 1) {
        const redisClient = createClient({
          url: 'redis://redis-server:6379',
        });
        await redisClient.connect();
        await redisClient.incr(`grand-tournament:event-dates:version`);
        const refreshQuery = 'REFRESH MATERIALIZED VIEW CONCURRENTLY grand_tournament_hours_mv';
        await this.pgSqlQuery(refreshQuery);
      }
      const end = new Date();
      const duration = end.getTime() - start.getTime();
      const durationInSeconds = Math.floor(duration / 1000);
      Utils.logMessage(
        'Duration of Grand Tournament results update:',
        durationInSeconds + ' seconds, with ' + insertValues.length + ' records inserted',
      );
      for (let i = 0; i < 9; i++) {
        Utils.logMessage('.');
      }
    } catch (error) {
      Utils.logCritical('411', error, 'Error refreshing Grand Tournament results');
      this.DB_UPDATES.criticalErrors++;
    }
    await this.closePool();
    Utils.flushRunSummary(this.DB_UPDATES.criticalErrors, this.server);

    await this.logToLoki({
      job: 'grand-tournament',
      data: {
        server: this.server,
        grandTournamentRecordsInserted:
          Object.keys(this.DB_UPDATES).length > 0 ? Object.values(this.DB_UPDATES).length : 0,
        criticalErrors: this.DB_UPDATES.criticalErrors,
        durationMs: Date.now() - start.getTime(),
      },
    });
  }

  /**
   * Refreshes the global rankings by executing a PostgreSQL query to refresh the materialized view.
   *
   * @returns {Promise<void>} A promise that resolves when the refresh operation is complete.
   */
  public async refreshGlobalRankings(): Promise<void> {
    const start = new Date();
    try {
      Utils.logMessage('=====================================');
      Utils.logMessage(' Starting global rankings refresh');
      Utils.logMessage(' Current environment:', this.CURRENT_ENV);
      Utils.logMessage('=====================================');
      Utils.logMessage('Refreshing global rankings...');
      await this.pgSqlQuery('REFRESH MATERIALIZED VIEW CONCURRENTLY global_ranking;');
      Utils.logMessage('Global rankings refreshed successfully');
    } catch (error) {
      Utils.logCritical('100', error, 'Error refreshing global rankings');
      this.DB_UPDATES.criticalErrors++;
    }
    const end = new Date();
    const duration = end.getTime() - start.getTime();
    const durationInSeconds = Math.floor(duration / 1000);
    Utils.logMessage('Duration of global rankings refresh:', durationInSeconds + ' seconds');
    for (let i = 0; i < 9; i++) {
      Utils.logMessage('.');
    }
    await this.closePool();
    Utils.flushRunSummary(this.DB_UPDATES.criticalErrors, 'GLOBAL_RANKING');
    await this.logToLoki({
      job: 'global-rankings-refresh',
      data: {
        server: this.server,
        criticalErrors: this.DB_UPDATES.criticalErrors,
        durationMs: Date.now() - start.getTime(),
      },
    });
  }

  /**
   * Retrieves the list of dungeons for a given world and map size, processes the data,
   * and inserts the results into the database.
   *
   * The method divides the map into grid sections, sends throttled API requests to fetch dungeon data,
   * displays a progress bar in the console, and stores relevant dungeon information in the database.
   * This method use a MariaDB connection pool (legacy database)
   *
   * @param worldNumber - The identifier of the world to retrieve dungeons from.
   * @returns A Promise that resolves when the dungeon list has been retrieved and stored.
   */
  public async getDungeonsList(worldNumber: number): Promise<void> {
    const castles = await this.collectRealmCastles(worldNumber);
    if (!castles || castles.length === 0) return;

    const bounds = this.computeDungeonScanBounds(castles);
    const randoms = GenericFetchAndSaveBackend.buildThrottleDelays(bounds.totalRequests);
    if (!(await this.confirmDungeonScan(worldNumber, bounds))) {
      Utils.logMessage('Dungeon retrieval aborted by user.');
      return;
    }

    const dungeonMaps: DungeonMap[] = [];
    const start = new Date();
    const completed = await this.scanDungeonArea(worldNumber, bounds, randoms, dungeonMaps);
    if (!completed) return;

    const elapsedTimeInSeconds = Math.floor((new Date().getTime() - start.getTime()) / 1000);
    console.log(
      '\nTime taken to retrieve dungeons:',
      elapsedTimeInSeconds,
      'seconds (',
      Math.floor(elapsedTimeInSeconds / 60),
      'minutes) : ',
      dungeonMaps.length,
      'dungeons found.',
    );
    console.log('Database connection successful');
    await this.insertDungeonRows(worldNumber, dungeonMaps);
    console.log('\nDungeons list updated successfully for world', worldNumber, '\n');
  }

  public async fillGenericEventHistory(dryRunInsertBTH = false, dryRunInsertOR = false): Promise<void> {
    const start = new Date();
    Utils.logMessage('Execution of the event history for Outer Realms + BTH');
    try {
      await this.executeCustomEventHistory(
        'Outer Realms',
        'outer_realms_event',
        'outer_realms_ranking',
        this.ENV_LT.outerRealms,
        10,
        6,
        dryRunInsertOR,
      );
      await this.executeCustomEventHistory(
        'Beyond the Horizon',
        'beyond_the_horizon_event',
        'beyond_the_horizon_ranking',
        this.ENV_LT.beyondTheHorizon,
        10,
        6,
        dryRunInsertBTH,
      );
      const end = new Date();
      Utils.logMessage('Duration of processing:', Math.floor((end.getTime() - start.getTime()) / 1000), 'seconds');
      Utils.logMessage('+ + + + + + + +');
      Utils.logMessage('');
      Utils.logMessage('');
      Utils.logMessage('');
      Utils.logMessage('');
      Utils.logMessage('');
      Utils.logMessage('=====================================');
      Utils.logMessage('.');
    } catch (error) {
      Utils.logCritical(
        '101',
        error,
        'Error occurred while executing the event history for Outer Realms + Beyond the Horizon',
      );
      this.DB_UPDATES.criticalErrors++;
    } finally {
      if (!dryRunInsertOR || !dryRunInsertBTH) {
        await this.closePool();
        await this.logToLoki({
          job: 'outer-realms-and-beyond-the-horizon-event-history',
          data: {
            server: this.server,
            criticalErrors: this.DB_UPDATES.criticalErrors,
            durationMs: Date.now() - start.getTime(),
          },
        });
        Utils.flushRunSummary(this.DB_UPDATES.criticalErrors, 'OUTER_REALMS_AND_BEYOND_THE_HORIZON_EVENT_HISTORY');
      }
    }
  }

  public async executeHealthCheck(): Promise<void> {
    try {
      try {
        await this.getPool().query('SELECT 1');
        Utils.logMessage(' [info] PostgreSQL database connection is operational');
      } catch {
        Utils.logMessage(' [error] PostgreSQL database connection failed');
      }
      try {
        await this.connection.execute('SELECT 1');
        Utils.logMessage(' [info] MariaDB database connection is operational');
      } catch {
        Utils.logMessage(' [error] MariaDB database connection failed');
      }
      try {
        await this.pingClickHouse();
        Utils.logMessage(' [info] ClickHouse database connection is operational');
      } catch {
        Utils.logMessage(' [error] ClickHouse database connection failed');
      }
      try {
        const res = await this.fetchDataAndReturn(6, 1, 5);
        Utils.logMessage(' [info] Data retrieved successfully:', res);
      } catch {
        Utils.logMessage(' [error] Data retrieval failed');
      }
    } catch (error) {
      Utils.logCritical('000', error, ' [error] Database connection failed');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  public async executeFillInOrder(): Promise<void> {
    const start = new Date();
    try {
      Utils.logMessage('=====================================');
      Utils.logMessage(' [info] Starting fill process');
      Utils.logMessage(' [info] Current environment:', this.CURRENT_ENV);
      Utils.logMessage(' [info] Target server:', this.server);
      Utils.logMessage(' [info] isE4KServer:', this.isE4KServer ? 'Yes' : 'No');
      Utils.logMessage('=====================================');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // Request a full clear of parameters
      await this.clearParameters();
      Utils.logMessage(' [info] Retrieving player data from the database...');
      const { players, alliances } = await this.getDatabasePlayers();
      this.currentPlayers = players;
      this.currentAlliances = alliances;
      Utils.logMessage('* Processing loot (1/9)');
      await this.updateParameter('is_currently_updating', 1);
      await this.fillLootHistory();
      await this.updateParameter('loot', 1);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      Utils.logMessage('* Processing War realms (2/9)');
      await this.fillWarRealmsHistory();
      await this.updateParameter('war_realms', 1);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      Utils.logMessage('* Processing Samurai (3/9)');
      await this.fillSamuraiHistory();
      await this.updateParameter('samurai', 1);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      Utils.logMessage('* Processing Berimond kingdoms (5/9)');
      await this.fillBerimondKingdomHistory();
      await this.updateParameter('berimond_kingdom', 1);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      Utils.logMessage('* Processing Bloodcrows (6/9)');
      await this.fillBloodcrowHistory();
      await this.updateParameter('bloodcrow', 1);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      Utils.logMessage('* Processing Nomads (7/9)');
      await this.fillNomadsHistory();
      await this.updateParameter('nomad', 1);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      Utils.logMessage('* Processing Might points (8/9)');
      await this.fillMightPointsHistory();
      await this.updateParameter('might', 1);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      Utils.logMessage('* Updating player might and loot current/total (9/9)');
      await this.updatePlayersMightAndLoot();
      Utils.logMessage('* Updating player aquamarine data');
      await this.fillPlayerAquamarineData();
      Utils.logMessage('* Updating server statistics');
      await this.updateServerStatistics();
      Utils.logMessage('* Updating inactive players');
      await this.updateInactivePlayers();
      const end = new Date();
      const redisClient = createClient({
        url: 'redis://redis-server:6379',
      });
      await redisClient.connect();
      await redisClient.incr(`fill-version:${this.server}`);
      await this.updateParameter('is_currently_updating', 0);
      await this.updateParameter('duration', Math.round((end.getTime() - start.getTime()) / 1000));
      Utils.logMessage('');
      Utils.logMessage('=====================================');
      Utils.logMessage('End of fill process');
      const durationSeconds = (end.getTime() - start.getTime()) / 1000;
      const durationMinutes = durationSeconds / 60;
      if (durationMinutes >= 1) {
        Utils.logMessage(
          'Processing time:',
          Math.floor(durationMinutes),
          'minute(s) and',
          Math.floor(durationSeconds % 60),
          'second(s)',
        );
      } else {
        Utils.logMessage('Processing time:', Math.floor(durationSeconds), 'second(s)');
      }
      Utils.logMessage('+ + + + + + + +');
      Utils.logMessage('Number of alliances created:', this.DB_UPDATES.alliancesCreated);
      Utils.logMessage('Number of players created:', this.DB_UPDATES.playersCreated);
      Utils.logMessage('Number of players whose alliance has been updated:', this.DB_UPDATES.playersAllianceUpdated);
      Utils.logMessage('Number of alliances updated:', this.DB_UPDATES.alliancesUpdated);
      Utils.logMessage('Number of critical errors:', this.DB_UPDATES.criticalErrors);
      Utils.logMessage('=====================================');
      Utils.logMessage('.');
    } catch (error) {
      Utils.logCritical('999', error, ' [CRITICAL] Unhandled error occurred while processing fills');
    } finally {
      const end = new Date();
      try {
        await this.logToClickHouse({
          server: this.server,
          startTime: new Date(start),
          endTime: new Date(end),
          alliancesCreated: this.DB_UPDATES.alliancesCreated,
          playersCreated: this.DB_UPDATES.playersCreated,
          playersAllianceUpdated: this.DB_UPDATES.playersAllianceUpdated,
          alliancesUpdated: this.DB_UPDATES.alliancesUpdated,
          criticalErrors: this.DB_UPDATES.criticalErrors,
          playerCount: Object.keys(this.playerLootAndMightPointHistoryList).length || 0,
          allianceCount: this.customPlayersAttributesList['alliances_count'] || 0,
        });
      } catch {}
      const criticalErrors = this.DB_UPDATES.criticalErrors;
      this.DB_UPDATES.alliancesCreated = 0;
      this.DB_UPDATES.playersCreated = 0;
      this.DB_UPDATES.playersAllianceUpdated = 0;
      this.DB_UPDATES.alliancesUpdated = 0;
      this.DB_UPDATES.criticalErrors = 0;
      this.playerLootAndMightPointHistoryList = {};
      this.customPlayersAttributesList = {};
      this.playerEventPointHistoryList = {};
      this.currentPlayers = [];
      await this.closePool();
      Utils.flushRunSummary(criticalErrors, this.server);
    }
  }

  public async updateDungeonsList(): Promise<void> {
    const squares: { [key: string]: { AX1: number; AY1: number; AX2: number; AY2: number } } = {};
    const start = new Date();
    const pgPool = this.getPool();
    try {
      console.log('Connection to the database successful');
      const { rows } = await pgPool.query(
        `
        SELECT kid, position_x, position_y, global_available_at
        FROM dungeons
        WHERE global_available_at <= NOW()
        `,
      );
      const totalRequests = rows.length;
      console.log('Total dungeons to check:', totalRequests);
      const dungeonsToUpdate: DungeonCooldownUpdate[] = [];
      const scanned = await this.scanDungeonCooldowns(rows, squares, totalRequests, dungeonsToUpdate);
      if (!scanned) return;

      await this.upsertParameter('dungeons_scan', dungeonsToUpdate.length);
      await this.persistDungeonUpdates(pgPool, dungeonsToUpdate);
    } catch (error) {
      console.error('Error while updating dungeons list:', error);
      this.DB_UPDATES.criticalErrors++;
    } finally {
      await this.closePool();
      const end = new Date();
      const elapsedTime = end.getTime() - start.getTime();
      const elapsedTimeInSeconds = Math.floor(elapsedTime / 1000);
      const elapsedTimeInMinutes = Math.floor(elapsedTimeInSeconds / 60);
      console.log(
        'Time taken to retrieve dungeons:',
        elapsedTimeInSeconds,
        'seconds (',
        elapsedTimeInMinutes,
        'minutes)',
      );
      console.log('Dungeons list updated successfully');
      console.log('Squares count:', Object.keys(squares).length);
      await this.logToLoki({
        job: 'update-dungeons-list',
        data: {
          server: this.server,
          criticalErrors: this.DB_UPDATES.criticalErrors,
          durationMs: elapsedTime,
          squaresCount: Object.keys(squares).length,
          dungeonsUpdated: this.DB_UPDATES.playersCreated,
        },
      });
    }
  }

  /**
   * Scans the Storm Islands kingdom and refreshes the current state of every storm fort and
   * resource isle for this server
   *
   * @returns A Promise that resolves once the storm state has been persisted.
   */
  public async updateStormMap(): Promise<void> {
    const start = new Date();
    try {
      await this.applyStormSeasonRolloverIfNeeded();

      const { rows: metaRows } = await this.pgSqlQuery('SELECT scan_radius FROM storm_meta WHERE id = TRUE');
      const knownRadius = metaRows.length > 0 ? Number(metaRows[0].scan_radius) : this.STORM_TILE_HALF_SPAN;

      const scan = await this.scanStormMap(knownRadius);
      console.log(
        `Storm scan done for ${this.server}: ${scan.forts.length} forts, ${scan.isles.length} isles, ` +
          `radius ${scan.radius}${scan.borderReached ? ' (border reached)' : ''}`,
      );

      await this.persistStormForts(scan.forts);
      await this.persistStormIsles(scan.isles);
      await this.pgSqlQuery('UPDATE storm_meta SET scan_radius = $1, last_scan_at = NOW() WHERE id = TRUE', [
        scan.radius,
      ]);
    } catch (error) {
      console.error('Error while updating the storm map:', error);
      this.DB_UPDATES.criticalErrors++;
      throw error;
    } finally {
      const elapsedTime = Date.now() - start.getTime();
      await this.logToLoki({
        job: 'update-storm-map',
        data: {
          server: this.server,
          criticalErrors: this.DB_UPDATES.criticalErrors,
          durationMs: elapsedTime,
        },
      });
    }
  }

  public getCorrespondigLtByOuterRealmsType(type: string): string | null {
    switch (type) {
      case 'collector':
        return HIGHSCORES_CONFIG.TEMP_SERVER_DAILY_COLLECTOR_POINTS as unknown as string;
      case 'might':
        return HIGHSCORES_CONFIG.TEMP_SERVER_DAILY_MIGHT_POINTS_BUILDINGS as unknown as string;
      case 'rankSwap':
        return HIGHSCORES_CONFIG.TEMP_SERVER_DAILY_RANK_SWAP as unknown as string;
      default:
        return null;
    }
  }

  public async startOuterRealmsDataFetch(): Promise<'collector' | 'might' | 'rankSwap' | null> {
    const start = new Date();
    let LT: number | null = null;
    let scoringSystemType: 'collector' | 'might' | 'rankSwap' | null = null;
    try {
      Utils.logMessage('=====================================');
      Utils.logMessage(' Starting Outer Realms data fetch');
      Utils.logMessage(' Current environment:', this.CURRENT_ENV);
      Utils.logMessage('=====================================');
      const redisClient = createClient({
        url: 'redis://redis-server:6379',
      });
      await redisClient.connect();
      const temporaryServerData = await redisClient.get(`temporaryServerData`);
      if (!temporaryServerData) {
        Utils.logMessage(' No temporary server setting found in Redis. Exiting temporary server LT check.');
        await GenericFetchAndSaveBackend.abortOuterRealmsFetch(redisClient);
        throw new Error('No temporary server setting found in Redis');
      }

      const scoring = this.resolveOuterRealmsScoring(temporaryServerData);
      scoringSystemType = scoring.scoringSystemType;
      LT = scoring.LT;

      const initialResponse = await this.genericFetchData('hgh', { LT: Number(LT), LID: 1, SV: '1' });
      if (initialResponse.data.return_code == '0' && initialResponse.data.content?.L?.length > 0) {
        Utils.logMessage(` Active Outer Realms event found with last known LT=${LT}. Proceeding with data fetch.`);
      } else {
        Utils.logMessage(
          ` No active Outer Realms event found with last known LT=${LT}. Exiting temporary server LT check.`,
        );
        await GenericFetchAndSaveBackend.abortOuterRealmsFetch(redisClient);
        throw new Error(`No active Outer Realms event found with last known LT=${LT}`);
      }
      if (!LT) {
        Utils.logMessage(' No active Outer Realms event found with any known LT code. Aborting data fetch.');
        await GenericFetchAndSaveBackend.abortOuterRealmsFetch(redisClient);
        throw new Error('No active Outer Realms event found with known LT codes');
      }
      await redisClient.del(`outerRealmsDataFetchError`);
      await redisClient.quit();

      const playerEntries = await this.collectOuterRealmsEntries(LT, initialResponse);
      Utils.logMessage(' Total unique player entries fetched:', playerEntries.size);
      await this.storeOuterRealmsEntries(playerEntries);
    } catch (error) {
      Utils.logCritical('', error, 'Error during Outer Realms data fetch:');
      this.DB_UPDATES.criticalErrors++;
    } finally {
      const end = new Date();
      const duration = end.getTime() - start.getTime();
      const durationInSeconds = Math.floor(duration / 1000);
      Utils.logMessage('Duration of Outer Realms data fetch:', durationInSeconds + ' seconds');
      for (let i = 0; i < 9; i++) {
        Utils.logMessage('.');
      }
      Utils.flushRunSummary(this.DB_UPDATES.criticalErrors, 'LIVE_OUTER_REALMS');
      await this.logToLoki({
        job: 'outer-realms-data-fetch',
        data: {
          server: this.server,
          criticalErrors: this.DB_UPDATES.criticalErrors,
          playersCreated: this.DB_UPDATES.playersCreated,
          LT,
          durationMs: duration,
        },
      });
    }
    return scoringSystemType || null;
  }

  public async sendDiscordNotification(messageBody: DiscordApiMessageBody): Promise<void> {
    if (!this.DISCORD_OR_API_URL) {
      console.error('Missing Discord API URL or Channel ID environment variables');
      throw new Error('Missing Discord API URL or Channel ID environment variables');
    }
    try {
      await this.fetchUrl(this.DISCORD_OR_API_URL, 'POST', messageBody);
      Utils.logMessage(' [info] Discord notification sent successfully');
    } catch (error) {
      Utils.logMessage(error);
    }
  }

  public getDiscordApiMessageBody(
    eventType: 'Beyond the Horizon' | 'Outer Realms',
    playersAdded: number,
    eventNum: number,
    players: {
      server: string;
      level: number;
      legendaryLevel: number;
      point: number;
      rank: number;
      realPlayerId: number;
      playerName: string;
      allianceName: string;
    }[],
  ): DiscordApiMessageBody {
    if (!this.DISCORD_OR_CHANNEL_ID) {
      console.error('Missing Discord Channel ID environment variable');
      throw new Error('Missing Discord Channel ID environment variable');
    }
    const description = `**Top 10 Players: ** \n${players
      .slice(0, 10)
      .map(
        (p, index) =>
          `**${index + 1}. ${Utils.medalForRank(index)}${this.formatValueForDiscord(p.playerName)} ${this.transformServerNameToEmoji(p.server)}** (Level: ${p.legendaryLevel ? p.level + '/' + p.legendaryLevel : p.level}, Alliance: _${this.formatValueForDiscord(p.allianceName) || '-'}_)`,
      )
      .join('\n')}`;
    const baseImageUrl = 'https://gge-tracker.com/assets/';
    return {
      channelId: this.DISCORD_OR_CHANNEL_ID,
      embeds: [
        {
          title: `${eventType} Leaderboard Update`,
          color: 11027200,
          fields: [
            {
              name: `:trophy: The final ranking for '${eventType}' event is available!`,
              value: `\n${description}\n\n :arrow_right: https://gge-tracker.com/events/${eventType.toLowerCase().replace(/\s/g, '-')}/${eventNum}`,
              inline: false,
            },
          ],
          image: {
            url: baseImageUrl + eventType.toLowerCase().replace(/\s/g, '-') + '.png',
          },
          footer: {
            text: 'gge-tracker.com - ' + playersAdded + ' players',
          },
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  public async insertWheelOfUnimaginableAffluenceData(retry = 0): Promise<void> {
    const LT = 72;
    const LID = 1;
    Utils.logMessage('Start fetching Wheel of Unimaginable Affluence data with LT =', LT);
    try {
      const response = await this.genericFetchData('hgh', { LT, LID, SV: '1' });
      if (response.data.return_code == '0' && response.data.content?.L?.length > 0) {
        Utils.logMessage('Wheel of Unimaginable Affluence event is active. Start fetching data...');
        const entriesPerPage = response.data.content.L.length;
        const totalEntries = response.data.content.LR || 0;
        const wheelData = await this.fetchWheelEntries(LT, LID, entriesPerPage, totalEntries);
        const now = new Date();
        Utils.logMessage(
          'Finished fetching Wheel of Unimaginable Affluence data. Total entries:',
          wheelData.length,
          ', at time:',
          now.toISOString(),
        );
        await this.storeWheelEntries(wheelData);
      } else {
        Utils.logMessage('Wheel of Unimaginable Affluence event is not active. No data to fetch.');
      }
    } catch (error) {
      if (retry < 3) {
        Utils.logMessage(`Error fetching Wheel of Unimaginable Affluence data. Retrying... (Attempt ${retry + 1}/3)`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await this.insertWheelOfUnimaginableAffluenceData(retry + 1);
        return;
      }
      Utils.logCritical('', error, 'Error fetching Wheel of Unimaginable Affluence data:');
      this.DB_UPDATES.criticalErrors++;
    } finally {
      Utils.logMessage('Finished processing Wheel of Unimaginable Affluence data.');
      if (this.DB_UPDATES.criticalErrors > 0) {
        Utils.logMessage(
          'Number of critical errors during Wheel of Unimaginable Affluence data fetch:',
          this.DB_UPDATES.criticalErrors,
        );
      }
      Utils.flushRunSummary(this.DB_UPDATES.criticalErrors, this.server);
    }
  }

  private async resolveGrandTournamentEventId(): Promise<number> {
    const getLastEventQuery = `
        SELECT event_id, created_at
        FROM grand_tournament
        ORDER BY created_at DESC
        LIMIT 1;
      `;
    const result = await this.pgSqlQuery(getLastEventQuery);
    const lastEvent = result.rows[0];
    if (!lastEvent) return 1;

    const lastDate = new Date(lastEvent.created_at);
    const now = new Date();
    const diffHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
    return diffHours > 24 ? lastEvent.event_id + 1 : lastEvent.event_id;
  }

  private async collectGrandTournamentDivision(
    lc: number,
    currentEventId: number,
    dateStr: string,
    alliances: { [key: string]: any },
  ): Promise<number> {
    const key = 'llsp';
    const lt = 84;
    const maxResult = 1000;
    let subdivisionId = 1;
    let hasMore = true;
    let subDivisionCount = 0;
    while (hasMore && subdivisionId <= 9999) {
      try {
        const url: string = encodeURI(
          this.BASE_API_URL + key + `/"LT":${lt},"LID":${lc},"M":${maxResult},"R":1,"SDI":${subdivisionId}`,
        );
        const response = await this.fetchGrandTournamentSubdivision(url);
        const data = response?.data;
        if (data.content?.L) {
          this.collectSubdivisionAlliances(data.content.L || [], {
            lc,
            subdivisionId,
            currentEventId,
            dateStr,
            alliances,
          });
        } else {
          hasMore = false;
        }
        subdivisionId++;
        subDivisionCount++;
      } catch (error) {
        console.error('=====================================');
        console.error('[Error] ', error);
        console.error('=====================================');
        hasMore = false;
      }
    }
    return subDivisionCount;
  }

  private async fetchGrandTournamentSubdivision(url: string): Promise<AxiosResponse<any> | undefined> {
    let response: AxiosResponse<any> | undefined;
    let tryCount = 0;
    while (tryCount < 3) {
      try {
        response = await axios.get(url);
        if (response?.data.content?.L) {
          break;
        } else {
          tryCount++;
        }
      } catch {
        tryCount++;
        Utils.logMessage('   Error fetching URL:', url);
        Utils.logMessage('   Retry count:', tryCount);
        if (tryCount === 3) {
          Utils.logMessage('   Max retries reached. Giving up.');
        }
      }
    }
    return response;
  }

  private collectSubdivisionAlliances(
    results: any[],
    context: {
      lc: number;
      subdivisionId: number;
      currentEventId: number;
      dateStr: string;
      alliances: { [key: string]: any };
    },
  ): void {
    const { lc, subdivisionId, currentEventId, dateStr, alliances } = context;
    for (const result of results) {
      const SIelements = String(result.SI).trim().split('-');
      const allianceId = Number.parseInt(String(SIelements.at(-1)));
      const token = String(allianceId) + '_' + String(result.I);
      if (allianceId && !alliances[token]) {
        alliances[token] = {
          server_id: Number.parseInt(String(result.I)),
          alliance_name: String(result.A),
          subdivision_id: subdivisionId,
          division_id: lc,
          alliance_id: allianceId,
          rank: Number.parseInt(String(result.R)),
          created_at: dateStr,
          score: Number.parseInt(String(result.S)),
          event_id: currentEventId,
        };
      }
    }
  }

  private async insertGrandTournamentRows(insertValues: any[]): Promise<void> {
    const tableName = 'grand_tournament';
    const batchSize = 50;
    const requiredKeys = [
      'server_id',
      'alliance_name',
      'subdivision_id',
      'division_id',
      'alliance_id',
      'created_at',
      'rank',
      'score',
      'event_id',
    ] as const;
    for (let i = 0; i < insertValues.length; i += batchSize) {
      const batch = insertValues.slice(i, i + batchSize);
      const values: any[] = [];
      const placeholders = batch
        .map((row, rowIndex) => {
          for (const key of requiredKeys) {
            if (!(key in row) || row[key] === undefined || row[key] === null) {
              throw new Error(`Missing or invalid property '${key}' in row: ${JSON.stringify(row)}`);
            }
          }
          const rowValues = requiredKeys.map((k) => row[k]);
          const baseIndex = rowIndex * requiredKeys.length;
          values.push(...rowValues);
          const params = Array.from({ length: requiredKeys.length }, (_, j) => `$${baseIndex + j + 1}`);
          return `(${params.join(', ')})`;
        })
        .join(', ');
      const queryText = `
            INSERT INTO ${tableName}
            (${requiredKeys.join(', ')})
            VALUES ${placeholders};
          `;
      try {
        await this.pgSqlQuery(queryText, values);
      } catch (error) {
        Utils.logCritical('', error, 'Error executing query:');
        Utils.logMessage('Query text:', queryText);
        Utils.logMessage('Values:', values);
        this.DB_UPDATES.criticalErrors++;
      }
    }
  }

  private async collectRealmCastles(worldNumber: number): Promise<Castle[] | null> {
    const pgSqlPlayerCastles = 'SELECT castles_realm FROM players WHERE castles IS NOT NULL';
    const pgSqlPlayerCastlesResult = await this.pgSqlQuery(pgSqlPlayerCastles);
    if (!pgSqlPlayerCastlesResult.rows || pgSqlPlayerCastlesResult.rows.length === 0) {
      Utils.logMessage('No castles found in the database. Aborting dungeon retrieval.');
      return null;
    }
    const castles: Castle[] = [];
    for (const { castles_realm } of pgSqlPlayerCastlesResult.rows) {
      if (!Array.isArray(castles_realm)) continue;
      for (const castleData of castles_realm) {
        if (
          Array.isArray(castleData) &&
          castleData.length === 4 &&
          castleData[3] === 12 &&
          castleData[0] === worldNumber
        ) {
          castles.push([castleData[0], castleData[1], castleData[2]]);
        }
      }
    }
    return castles;
  }

  private computeDungeonScanBounds(castles: Castle[]): DungeonScanBounds {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const castle of castles) {
      const [, x, y] = castle;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const step = 100;
    const zone = step + 1;
    const margin = zone * 2;

    minX = Math.floor(Math.max(0, minX - margin) / zone) * zone;
    minY = Math.floor(Math.max(0, minY - margin) / zone) * zone;
    maxX = Math.ceil(Math.min(this.MAP_SIZE, maxX + margin) / zone) * zone;
    maxY = Math.ceil(Math.min(this.MAP_SIZE, maxY + margin) / zone) * zone;
    const totalRequests = Math.ceil((maxX - minX) / zone) * Math.ceil((maxY - minY) / zone);

    return { minX, minY, maxX, maxY, step, zone, totalRequests };
  }

  private async confirmDungeonScan(worldNumber: number, bounds: DungeonScanBounds): Promise<boolean> {
    const { minX, minY, maxX, maxY, step, zone, totalRequests } = bounds;
    const averageDelayMs =
      (GenericFetchAndSaveBackend.SCAN_DELAY_MIN_MS + GenericFetchAndSaveBackend.SCAN_DELAY_MAX_MS) / 2;
    const minuteToRetrieve = Math.ceil((totalRequests * averageDelayMs) / 60000);
    const confirmationMessage = `About to retrieve dungeons for world ${worldNumber} with the following parameters:
      - minX: ${minX}
      - minY: ${minY}
      - maxX: ${maxX}
      - maxY: ${maxY}
      - step: ${step}
      - zone: ${zone}
      This will result in approximately ${totalRequests} API requests, which may take around ${minuteToRetrieve} minutes to complete. Do you want to proceed? (yes/no)`;
    return this.askConfirmation(confirmationMessage);
  }

  private async scanDungeonArea(
    worldNumber: number,
    bounds: DungeonScanBounds,
    randoms: number[],
    dungeonMaps: DungeonMap[],
  ): Promise<boolean> {
    const { minX, minY, maxX, maxY, step, zone, totalRequests } = bounds;
    const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
    let done = 0;
    let rowIndex = 0;
    for (let y = minY; y < maxY; y += zone) {
      const xValues: number[] = [];
      for (let x = minX; x < maxX; x += zone) {
        xValues.push(x);
      }
      if (rowIndex % 2 !== 0) {
        xValues.reverse();
      }
      for (const x of xValues) {
        const keepScanning = await this.scanDungeonTile(worldNumber, x, y, step, dungeonMaps);
        if (!keepScanning) return false;
        // Throttle management
        await delay(randoms[rowIndex % randoms.length]);
        done++;
        GenericFetchAndSaveBackend.renderScanProgress(done, totalRequests);
      }
      rowIndex++;
    }
    return true;
  }

  private async scanDungeonTile(
    worldNumber: number,
    x: number,
    y: number,
    step: number,
    dungeonMaps: DungeonMap[],
  ): Promise<boolean> {
    const json = `"KID":${worldNumber},"AX1":${x},"AY1":${y},"AX2":${x + step},"AY2":${y + step}`;
    const url: string = encodeURI(this.BASE_API_URL + 'gaa/' + json);
    try {
      const response = await axios.get(url);
      const data = response.data;
      if (data?.['return_code'] == '0') {
        GenericFetchAndSaveBackend.appendDungeons(data, dungeonMaps);
        return true;
      }
      console.error('Invalid response for URL:', url, data);
      console.error('Waiting 3 seconds before retrying...');
      await this.sleep(3000);
      // We retry once if the response is invalid, as it can be a temporary issue
      const retryResponse = await axios.get(url);
      const retryData = retryResponse.data;
      if (retryData?.['return_code'] == '0') {
        GenericFetchAndSaveBackend.appendDungeons(retryData, dungeonMaps);
      } else {
        console.error('Retry failed for URL:', url, retryData);
      }
      return true;
    } catch (err) {
      console.error('Error on URL:', url, err);
      this.DB_UPDATES.criticalErrors++;
      if (this.DB_UPDATES.criticalErrors >= 10) {
        console.error('Too many errors encountered. Aborting dungeon retrieval.');
        return false;
      }
      return true;
    }
  }

  private async insertDungeonRows(worldNumber: number, dungeonMaps: DungeonMap[]): Promise<void> {
    const CHUNK_SIZE = 500;
    const chunks = this.chunkArray(dungeonMaps, CHUNK_SIZE);
    for (const chunk of chunks) {
      const values: any[] = [];
      const placeholders = chunk
        .map((dungeon, i) => {
          const baseIndex = i * 4;
          const coordinates = dungeon.coordinates;
          const global_available_at = new Date(Date.now() + dungeon.time * 1000);

          values.push(worldNumber, coordinates[0], coordinates[1], global_available_at);

          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`;
        })
        .join(', ');

      await this.pgSqlQuery(
        `INSERT INTO dungeons (kid, position_x, position_y, global_available_at) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
        values,
      );
    }
  }

  private async scanDungeonCooldowns(
    rows: any[],
    squares: { [key: string]: { AX1: number; AY1: number; AX2: number; AY2: number } },
    totalRequests: number,
    dungeonsToUpdate: DungeonCooldownUpdate[],
  ): Promise<boolean> {
    let done = 0;
    for (const row of rows) {
      const { kid, position_x, position_y } = row;
      const square = await this.getCorrespondingSquare(position_x, position_y, this.MAP_SIZE);
      if (!square) continue;

      squares[`${kid}-${position_x}-${position_y}`] = square;
      const { AX1, AY1, AX2, AY2 } = square;
      const json = `"KID":${kid},"AX1":${AX1},"AY1":${AY1},"AX2":${AX2},"AY2":${AY2}`;
      const url: string = encodeURI(this.BASE_API_URL + 'gaa/' + json);

      const keepScanning = await this.refreshDungeonSquare(row, url, dungeonsToUpdate);
      if (!keepScanning) return false;

      if (done % 20 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      done++;
      if (process.stdout.isTTY) {
        GenericFetchAndSaveBackend.renderScanProgress(done, totalRequests);
      }
    }
    return true;
  }

  private async refreshDungeonSquare(
    row: any,
    url: string,
    dungeonsToUpdate: DungeonCooldownUpdate[],
  ): Promise<boolean> {
    try {
      const response = await axios.get(url);
      const currentTime = new Date();
      const data = response.data;
      if (data?.['return_code'] == '0') {
        this.collectDungeonCooldowns(data, row.kid, currentTime, dungeonsToUpdate);
        return true;
      }
      if (data['return_code'] && data['return_code'] !== '-1') return true;

      if (this.WEBHOOK_URL) {
        const message = {
          content: 'An error occurred: ' + JSON.stringify(row),
          username: 'Dungeon Fetcher',
        };
        await axios.post(this.WEBHOOK_URL, message);
        console.log('Message sent to Discord webhook');
        return false;
      }
      this.DB_UPDATES.criticalErrors++;
      console.error('Invalid response for URL:', url, data);
      return true;
    } catch (err: any) {
      if (err instanceof AxiosError) {
        console.error('Axios error on URL:', url, err.message);
        throw new Error(`Fetch error: ${err.message}`);
      }
      console.error('Error on URL:', url);
      throw new Error('Terminating due to error while fetching dungeon data.');
    }
  }

  private collectDungeonCooldowns(
    data: any,
    kid: number,
    currentTime: Date,
    dungeonsToUpdate: DungeonCooldownUpdate[],
  ): void {
    const PLAYER_COOLDOWN_SECONDS = 4 * 24 * 60 * 60;
    const dungeons = data.content?.AI ?? [];
    for (const dungeon of dungeons) {
      if (dungeon[0] != '11') continue;

      // We calculate the date of the last attack
      this.DB_UPDATES.playersCreated++;
      const remainingCooldown24h = dungeon[5];
      if (remainingCooldown24h <= 0) {
        // Skipping cooldown update if the dungeon is already available
        continue;
      }
      dungeonsToUpdate.push({
        kid,
        position_x: dungeon[1],
        position_y: dungeon[2],
        global_available_at: new Date(currentTime.getTime() + remainingCooldown24h * 1000),
        player_available_at: new Date(currentTime.getTime() + (remainingCooldown24h + PLAYER_COOLDOWN_SECONDS) * 1000),
        player_id: dungeon[6],
      });
    }
  }

  private async persistDungeonUpdates(pgPool: pg.Pool, dungeonsToUpdate: DungeonCooldownUpdate[]): Promise<void> {
    try {
      const updateValues: (Date | number)[] = [];
      const updatePlaceholders: string[] = [];
      const historyValues: number[] = [];
      const historyPlaceholders: string[] = [];
      const cooldownValues: (number | Date)[] = [];
      const cooldownPlaceholders: string[] = [];

      dungeonsToUpdate.forEach((dungeon, index) => {
        const updateOffset = index * 4;
        updatePlaceholders.push(
          `(
              $${updateOffset + 1}::timestamp,
              $${updateOffset + 2}::smallint,
              $${updateOffset + 3}::smallint,
              $${updateOffset + 4}::smallint
            )`,
        );
        updateValues.push(dungeon.global_available_at, dungeon.kid, dungeon.position_x, dungeon.position_y);

        const historyOffset = index * 4;
        historyPlaceholders.push(
          `(
              $${historyOffset + 1}::smallint,
              $${historyOffset + 2}::smallint,
              $${historyOffset + 3}::smallint,
              $${historyOffset + 4}::integer
            )`,
        );
        historyValues.push(dungeon.kid, dungeon.position_x, dungeon.position_y, dungeon.player_id);

        const cooldownOffset = index * 5;
        cooldownPlaceholders.push(
          `(
                $${cooldownOffset + 1}::smallint,
                $${cooldownOffset + 2}::smallint,
                $${cooldownOffset + 3}::smallint,
                $${cooldownOffset + 4}::integer,
                $${cooldownOffset + 5}::timestamp
              )`,
        );

        cooldownValues.push(
          dungeon.kid,
          dungeon.position_x,
          dungeon.position_y,
          dungeon.player_id,
          dungeon.player_available_at,
        );
      });

      if (updatePlaceholders.length === 0) {
        console.log('No dungeons to update in PostgreSQL');
        return;
      }
      console.log('\nUpdating dungeons...');
      await pgPool.query(
        `
          UPDATE dungeons d
          SET global_available_at = v.global_available_at
          FROM (
            VALUES
              ${updatePlaceholders.join(',')}
          ) AS v(global_available_at, kid, position_x, position_y)
          WHERE d.kid = v.kid
            AND d.position_x = v.position_x
            AND d.position_y = v.position_y
          `,
        updateValues,
      );

      console.log('Inserting dungeon history...');
      await pgPool.query(
        `
          INSERT INTO dungeons_history (
            kid,
            position_x,
            position_y,
            player_id
          )
          VALUES
            ${historyPlaceholders.join(',')}
          `,
        historyValues,
      );

      console.log('Updating dungeon cooldowns...');
      await pgPool.query(
        `
          INSERT INTO dungeon_player_cooldowns (
            kid,
            position_x,
            position_y,
            player_id,
            available_at
          )
          VALUES ${cooldownPlaceholders.join(',')}
          ON CONFLICT (kid, position_x, position_y, player_id)
          DO UPDATE SET available_at = EXCLUDED.available_at
          `,
        cooldownValues,
      );
    } catch (error) {
      console.log(error);
      throw new Error(
        'Error while updating dungeon data in the PostgreSQL database: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private resolveOuterRealmsScoring(temporaryServerData: string): {
    scoringSystemType: 'collector' | 'might' | 'rankSwap';
    LT: number | null;
  } {
    const tempServerSetting = TEMP_SERVER_SETTINGS.find(
      (el) => el.settingID && Number(el.settingID) === Number(temporaryServerData),
    );
    if (!tempServerSetting) {
      throw new Error(
        `No matching temporary server setting found for temporaryServerData value: ${temporaryServerData}`,
      );
    }
    if (!['collector', 'might', 'rankSwap'].includes(tempServerSetting.scoringSystem)) {
      throw new Error(
        `Unrecognized scoring system type '${tempServerSetting.scoringSystem}' in temporary server settings.`,
      );
    }
    const scoringSystemType = tempServerSetting.scoringSystem as 'collector' | 'might' | 'rankSwap';
    const correspondingLt = this.getCorrespondigLtByOuterRealmsType(scoringSystemType);
    if (!correspondingLt) return { scoringSystemType, LT: null };

    const LT = Number(correspondingLt);
    Utils.logMessage(
      ` Temporary server setting found with scoring system '${scoringSystemType}' corresponding to LT=${LT}. Proceeding with data fetch using this LT.`,
    );
    return { scoringSystemType, LT };
  }

  private async collectOuterRealmsEntries(
    LT: number,
    initialResponse: AxiosResponse<any>,
  ): Promise<Map<number, OuterRealmsEntry>> {
    const entriesByPage = initialResponse.data.content?.L?.length || 0;
    const increment = Math.ceil(Number(entriesByPage) / 2);
    const maxItemLimit = initialResponse.data.content?.LR || 0;
    const playerEntries = new Map<number, OuterRealmsEntry>();
    let hasMore = true;
    let item = increment;

    while (hasMore && item < maxItemLimit + increment) {
      const { response, exhausted } = await this.fetchOuterRealmsPage(LT, item);
      if (exhausted) hasMore = false;
      if (response.data.return_code == '0' && response.data.content) {
        const content = response.data.content.L || [];
        if (content.length === 0) {
          Utils.logMessage(' No more data to fetch. Ending Outer Realms data fetch.');
          break;
        }
        const duplicatesInThisBatch = GenericFetchAndSaveBackend.collectOuterRealmsBatch(content, LT, playerEntries);
        // If we have a full batch with all duplicates, we can stop fetching more data
        if (duplicatesInThisBatch === content.length) {
          Utils.logMessage(` All entries in this batch are duplicates (SV=${item}). Ending Outer Realms data fetch.`);
          break;
        }
      }
      item += increment;
    }
    return playerEntries;
  }

  private async fetchOuterRealmsPage(
    LT: number,
    item: number,
  ): Promise<{ response: AxiosResponse<any>; exhausted: boolean }> {
    let response: AxiosResponse<any>;
    let tryCount = 0;
    do {
      response = await this.genericFetchData('hgh', { LT, LID: 1, SV: String(item) });
      if (response.data.return_code == '0' && response.data.content) {
        return { response, exhausted: false };
      }
      tryCount++;
      Utils.logMessage(`   Error fetching Outer Realms data for SV=${item}. Retry count: ${tryCount}`);
      if (tryCount === 3) {
        Utils.logMessage('   Max retries reached. Ending Outer Realms data fetch.');
        return { response, exhausted: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } while (tryCount < 3);
    return { response, exhausted: false };
  }

  private async storeOuterRealmsEntries(playerEntries: Map<number, OuterRealmsEntry>): Promise<void> {
    try {
      const playerArray = Array.from(playerEntries.values());
      this.DB_UPDATES.playersCreated = playerArray.length;

      const fetchDateStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const rows = playerArray.map((p) => ({
        player_id: p.OID,
        player_name: p.N,
        server: p.server,
        score: p.score,
        rank: p.rank,
        level: p.level,
        legendary_level: p.legendaryLevel,
        might: p.might,
        castle_position_x: p.castlePositionX,
        castle_position_y: p.castlePositionY,
        fetch_date: fetchDateStr,
      }));

      await this.insertRowsClickHouse('outer_realms_ranking', rows);
      Utils.logMessage('Outer Realms data fetch and database update completed successfully');

      await this.insertRowsClickHouse('latest_fetch_date', [{ fetch_date: fetchDateStr }]);
    } catch (error) {
      Utils.logCritical('', error, 'Error executing query:');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  /**
   * This method fetches data for the "Wheel of Unimaginable Affluence"
   *  event (LT: 72) and inserts it into the ClickHouse database.
   */
  private async fetchWheelEntries(
    LT: number,
    LID: number,
    entriesPerPage: number,
    totalEntries: number,
  ): Promise<{ playerId: number; points: number }[]> {
    const wheelData: { playerId: number; points: number }[] = [];
    const seen = new Set<number>();
    let SV = Math.ceil(entriesPerPage / 2);
    let hasMore = true;

    while (hasMore) {
      const pageResponse = await this.genericFetchData('hgh', { LT, LID, SV: String(SV) });
      if (pageResponse.data.return_code != '0' || (pageResponse.data.content?.L?.length ?? 0) <= 0) break;

      for (const entry of pageResponse.data.content.L) {
        const OID = Number(entry[2].OID);
        if (seen.has(OID)) {
          // This is unexpected but we log it just in case
          Utils.logMessage(`Duplicate entry found for player ID ${OID} at SV=${SV}. Skipping.`);
          continue;
        }
        seen.add(OID);
        wheelData.push({ playerId: OID, points: Number(entry[1]) });
      }
      Utils.logMessage(`Fetched ${wheelData.length}/${totalEntries} entries...`);

      SV += entriesPerPage;
      hasMore = SV <= totalEntries + entriesPerPage;
    }
    return wheelData;
  }

  private async storeWheelEntries(wheelData: { playerId: number; points: number }[]): Promise<void> {
    try {
      const fetchDateStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await this.insertRowsClickHouse(
        'wheel_unimaginable_affluence',
        wheelData.map((entry) => ({
          player_id: entry.playerId,
          point: entry.points,
          created_at: fetchDateStr,
        })),
      );
    } catch (error) {
      Utils.logCritical('', error, 'Error executing query:');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private clickhouseBaseUrl(): string {
    if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
    return (this.CLICKHOUSE_CONFIG.url as string) + ':' + this.CLICKHOUSE_CONFIG.port;
  }

  private clickhouseAuth(): { username: string; password: string } {
    if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
    return {
      username: this.CLICKHOUSE_CONFIG.user as string,
      password: this.CLICKHOUSE_CONFIG.password as string,
    };
  }

  private clickhouseUrl(query: string, extraParams: Record<string, string> = {}): string {
    if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
    const params = new URLSearchParams({
      query,
      database: this.CLICKHOUSE_CONFIG.database as string,
      ...extraParams,
    });
    return this.clickhouseBaseUrl() + '/?' + params.toString();
  }

  private async clickhousePost(
    url: string,
    payload: string,
    description: string,
    maxAttempts: number = GenericFetchAndSaveBackend.CLICKHOUSE_MAX_ATTEMPTS,
  ): Promise<void> {
    let delay = GenericFetchAndSaveBackend.CLICKHOUSE_BASE_BACKOFF_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        await axios.post(url, payload, {
          headers: { 'Content-Type': 'text/plain' },
          auth: this.clickhouseAuth(),
          timeout: 120000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        });
        return;
      } catch (error) {
        const retryable = GenericFetchAndSaveBackend.isClickHouseRetryable(error);
        if (!retryable || attempt >= maxAttempts) {
          throw error;
        }
        const code = GenericFetchAndSaveBackend.parseClickHouseErrorCode(error);
        const wait = delay + randomInt(delay);
        Utils.logMessage(
          ' [retry] ClickHouse',
          description,
          'failed (code',
          code ?? 'network',
          ') - attempt',
          attempt + '/' + maxAttempts + ', retrying in',
          wait + 'ms',
        );
        await this.sleep(wait);
        delay = Math.min(delay * 2, GenericFetchAndSaveBackend.CLICKHOUSE_MAX_BACKOFF_MS);
      }
    }
  }

  /**
   * The single entry point for every ClickHouse insert
   *
   * @param table Target table, optionally database-qualified
   * @param rows Rows to insert; an empty array is a no-op
   * @param options `chunkSize`, `database`, or a smaller `maxAttempts` budget
   */
  private async insertRowsClickHouse(
    table: string,
    rows: Array<Record<string, unknown>>,
    options: { chunkSize?: number; database?: string; maxAttempts?: number } = {},
  ): Promise<void> {
    if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
    if (rows.length === 0) return;

    const chunkSize = options.chunkSize ?? GenericFetchAndSaveBackend.CLICKHOUSE_INSERT_CHUNK_SIZE;
    const extraParams: Record<string, string> = {
      async_insert: '1',
      wait_for_async_insert: '1',
    };
    if (options.database) extraParams.database = options.database;

    const url = this.clickhouseUrl(`INSERT INTO ${table} FORMAT JSONEachRow`, extraParams);

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const payload = chunk.map((row) => JSON.stringify(row)).join('\n');
      await this.clickhousePost(url, payload, `insert into ${table}`, options.maxAttempts);
      Utils.logMessage(' [info] Inserted', chunk.length, 'rows into', table);
    }
  }

  private async pingClickHouse(): Promise<void> {
    await axios.post(this.clickhouseUrl('SELECT 1'), '', {
      headers: { 'Content-Type': 'text/plain' },
      auth: this.clickhouseAuth(),
      timeout: 15000,
    });
  }

  private createNewPool(): void {
    this.pgSqlConnection = new pg.Pool({
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      allowExitOnIdle: true,
      ...this.PGSQL_CONFIG,
    });
    this.pgSqlPoolEnded = false;
    this.pgSqlConnection.on('error', (error) => {
      Utils.logMessage(' [WARN] Idle PostgreSQL client discarded by the pool:', error.message);
    });
  }

  private getPool(): pg.Pool {
    if (!this.pgSqlConnection || this.pgSqlPoolEnded) {
      this.createNewPool();
    }
    return this.pgSqlConnection;
  }

  private async scanStormRing(
    ring: number,
    forts: Map<string, StormFort>,
    isles: Map<string, StormIsle>,
    requestsSoFar: number,
  ): Promise<{ ringHasObjects: boolean; borderReached: boolean; requests: number }> {
    let ringHasObjects = false;
    let borderReached = false;
    let done = requestsSoFar;
    for (const tile of this.getStormRingTiles(ring)) {
      const json = `"KID":${this.STORM_KID},"AX1":${tile.AX1},"AY1":${tile.AY1},"AX2":${tile.AX2},"AY2":${tile.AY2}`;
      console.log('Fetching zone: ' + json);
      const url: string = encodeURI(this.BASE_API_URL + 'gaa/' + json);
      const areaInfos = await this.fetchStormArea(url);
      const currentTime = new Date();

      for (const object of areaInfos) {
        const objectType = Number(object[0]);
        if (objectType === this.STORM_BORDER_OBJECT_ID) {
          borderReached = true;
          continue;
        }
        if (objectType === this.STORM_FORT_OBJECT_ID) {
          const fort = this.parseStormFort(object, currentTime);
          forts.set(`${fort.positionX}:${fort.positionY}`, fort);
          ringHasObjects = true;
        } else if (objectType === this.STORM_ISLE_OBJECT_ID) {
          const isle = this.parseStormIsle(object, currentTime);
          isles.set(`${isle.positionX}:${isle.positionY}`, isle);
          ringHasObjects = true;
        }
      }

      done++;
      await this.sleep(30);
      if (done % 5 === 0) {
        await this.sleep(1000);
      }
    }
    return { ringHasObjects, borderReached, requests: done };
  }

  private async scanStormMap(knownRadius: number): Promise<StormScanResult> {
    const forts = new Map<string, StormFort>();
    const isles = new Map<string, StormIsle>();
    const knownRings = this.stormRadiusToRings(knownRadius);
    let borderReached = false;
    let ring = 0;
    let reachedRings = knownRings;
    let done = 0;

    while (ring <= this.STORM_MAX_RINGS) {
      const scan = await this.scanStormRing(ring, forts, isles, done);
      done = scan.requests;
      borderReached = borderReached || scan.borderReached;
      const ringHasObjects = scan.ringHasObjects;

      if (ringHasObjects && ring > reachedRings) {
        reachedRings = ring;
      }
      // Keep growing only while the frontier still yields
      // storm objects and the edge is not met
      if (ring >= knownRings && (!ringHasObjects || borderReached)) {
        console.log('Border reached for current ring, stopping scan.');
        break;
      }
      ring++;
    }

    return {
      forts: [...forts.values()],
      isles: [...isles.values()],
      radius: this.stormRingsToRadius(reachedRings),
      borderReached,
    };
  }

  /**
   * Performs a single gaa call on the storm kingdom,
   * retrying once on an invalid payload
   *
   * @param url The gaa URL
   * @returns The AI array of the area
   */
  private async fetchStormArea(url: string): Promise<any[]> {
    try {
      const response = await axios.get(url);
      if (response.data?.['return_code'] == '0') {
        return response.data.content?.AI ?? [];
      }
      console.error('Invalid storm response for URL:', url, response.data);
      await this.sleep(3000);
      const retryResponse = await axios.get(url);
      if (retryResponse.data?.['return_code'] == '0') {
        return retryResponse.data.content?.AI ?? [];
      }
      console.error('Storm retry failed for URL:', url, retryResponse.data);
      this.DB_UPDATES.criticalErrors++;
      return [];
    } catch (error: any) {
      console.error('Error on storm URL:', url, error instanceof AxiosError ? error.message : error);
      this.DB_UPDATES.criticalErrors++;
      if (this.DB_UPDATES.criticalErrors >= 10) {
        throw new Error('Too many errors encountered while scanning the storm map.');
      }
      return [];
    }
  }

  /**
   * Parses a raw AI row of type 25 into a storm fort
   *
   * @param row The raw AI entry
   * @param observedAt Timestamp of the scan
   */
  private parseStormFort(row: any[], observedAt: Date): StormFort {
    const cooldownSeconds = Number(row[6]) || 0;
    return {
      positionX: Number(row[1]),
      positionY: Number(row[2]),
      isleId: Number(row[5]),
      victoryCount: Number(row[7]) || 0,
      isVisible: Number(row[8]) === 0,
      availableAt: cooldownSeconds > 0 ? new Date(observedAt.getTime() + cooldownSeconds * 1000) : observedAt,
    };
  }

  /**
   * Parses a raw AI row of type 24 into a resource isle
   *
   * @param row The raw AI entry
   * @param observedAt Timestamp of the scan
   */
  private parseStormIsle(row: any[], observedAt: Date): StormIsle {
    const occupierId = Number(row[4]);
    const remainingSeconds = Number(row[9]) || 0;
    const isOccupied = occupierId > 0;
    let state = StormIsleState.FREE;
    if (isOccupied) state = StormIsleState.OCCUPIED;
    else if (remainingSeconds > 0) state = StormIsleState.RESPAWNING;

    return {
      positionX: Number(row[1]),
      positionY: Number(row[2]),
      objectId: Number(row[3]),
      isleId: Number(row[8]),
      occupierId: isOccupied ? occupierId : null,
      state,
      availableAt: remainingSeconds > 0 ? new Date(observedAt.getTime() + remainingSeconds * 1000) : observedAt,
    };
  }

  /**
   * Upserts the scanned forts, refreshing existing coordinates in place
   *
   * @param forts The forts collected by the scan
   */
  private async persistStormForts(forts: StormFort[]): Promise<void> {
    if (forts.length === 0) return;
    for (const chunk of this.chunkArray(forts, this.STORM_CHUNK_SIZE)) {
      const values: (number | boolean | Date)[] = [];
      const placeholders = chunk
        .map((fort, index) => {
          const offset = index * 6;
          values.push(fort.positionX, fort.positionY, fort.isleId, fort.victoryCount, fort.isVisible, fort.availableAt);
          return `($${offset + 1}::smallint, $${offset + 2}::smallint, $${offset + 3}::smallint,
                  $${offset + 4}::smallint, $${offset + 5}::boolean, $${offset + 6}::timestamptz)`;
        })
        .join(', ');

      await this.pgSqlQuery(
        `INSERT INTO storm_forts (position_x, position_y, isle_id, victory_count, is_visible, available_at)
        VALUES ${placeholders}
        ON CONFLICT (position_x, position_y) DO UPDATE SET
          isle_id       = EXCLUDED.isle_id,
          victory_count = EXCLUDED.victory_count,
          is_visible    = EXCLUDED.is_visible,
          available_at  = EXCLUDED.available_at,
          updated_at    = NOW()`,
        values,
      );
    }
  }

  /**
   * Upserts the scanned resource isles, refreshing existing coordinates in place
   *
   * @param isles - The isles collected by the scan.
   */
  private async persistStormIsles(isles: StormIsle[]): Promise<void> {
    if (isles.length === 0) return;
    for (const chunk of this.chunkArray(isles, this.STORM_CHUNK_SIZE)) {
      const values: (number | Date | null)[] = [];
      const placeholders = chunk
        .map((isle, index) => {
          const offset = index * 7;
          values.push(
            isle.positionX,
            isle.positionY,
            isle.objectId,
            isle.isleId,
            isle.occupierId,
            isle.state,
            isle.availableAt,
          );
          return `($${offset + 1}::smallint, $${offset + 2}::smallint, $${offset + 3}::integer,
                  $${offset + 4}::smallint, $${offset + 5}::integer, $${offset + 6}::smallint,
                  $${offset + 7}::timestamptz)`;
        })
        .join(', ');

      await this.pgSqlQuery(
        `INSERT INTO storm_isles (position_x, position_y, object_id, isle_id, occupier_id, state, available_at)
        VALUES ${placeholders}
        ON CONFLICT (position_x, position_y) DO UPDATE SET
          object_id    = EXCLUDED.object_id,
          isle_id      = EXCLUDED.isle_id,
          occupier_id  = EXCLUDED.occupier_id,
          state        = EXCLUDED.state,
          available_at = EXCLUDED.available_at,
          updated_at   = NOW()`,
        values,
      );
    }
  }

  private async applyStormSeasonRolloverIfNeeded(): Promise<void> {
    const boundary = this.getLastStormSeasonBoundary();
    const { rows } = await this.pgSqlQuery('SELECT season_started_at FROM storm_meta WHERE id = TRUE');
    if (rows.length > 0 && new Date(rows[0].season_started_at) >= boundary) {
      return;
    }

    console.log(`New storm season detected for ${this.server}, wiping the previous map...`);
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE storm_forts, storm_isles');
      await client.query(
        `INSERT INTO storm_meta (id, season_started_at, scan_radius, last_scan_at)
        VALUES (TRUE, $1, $2, NULL)
        ON CONFLICT (id) DO UPDATE SET
          season_started_at = EXCLUDED.season_started_at,
          scan_radius       = EXCLUDED.scan_radius,
          last_scan_at      = NULL`,
        [boundary, this.STORM_TILE_HALF_SPAN],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    // Enter in storm islands event
    const kscContent = await axios.get(encodeURI(this.BASE_API_URL + 'ksc/' + '"ID":16,"D":0,"PWR":0,"OC2":0,"SID":4'));
    if (kscContent.data.return_code === 0) {
      console.log('Success: player entered island');
      await this.sleep(1000);
    } else {
      console.log('Info: player already entered island. Continue...');
    }
  }

  private getLastStormSeasonBoundary(): Date {
    const now = new Date();
    const boundary = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
        this.STORM_RESET_HOUR_UTC,
        this.STORM_RESET_MINUTE_UTC,
        0,
        0,
      ),
    );
    if (now < boundary) {
      boundary.setUTCMonth(boundary.getUTCMonth() - 1);
    }
    return boundary;
  }

  private getStormRingTiles(ring: number): { AX1: number; AY1: number; AX2: number; AY2: number }[] {
    const tiles: { AX1: number; AY1: number; AX2: number; AY2: number }[] = [];
    for (let tileY = -ring; tileY <= ring; tileY++) {
      for (let tileX = -ring; tileX <= ring; tileX++) {
        if (ring > 0 && Math.abs(tileX) !== ring && Math.abs(tileY) !== ring) continue;
        const AX1 = this.STORM_CENTER_X - this.STORM_TILE_HALF_SPAN + tileX * this.STORM_TILE_SPACING;
        const AY1 = this.STORM_CENTER_Y - this.STORM_TILE_HALF_SPAN + tileY * this.STORM_TILE_SPACING;
        const AX2 = AX1 + this.STORM_TILE_SPAN;
        const AY2 = AY1 + this.STORM_TILE_SPAN;
        if (AX1 < 0 || AY1 < 0 || AX2 > this.MAP_SIZE || AY2 > this.MAP_SIZE) continue;
        tiles.push({ AX1, AY1, AX2, AY2 });
      }
    }
    return tiles;
  }

  private stormRadiusToRings(radius: number): number {
    const rings = Math.ceil((radius - this.STORM_TILE_HALF_SPAN) / this.STORM_TILE_SPACING);
    return Math.min(Math.max(rings, 0), this.STORM_MAX_RINGS);
  }

  private stormRingsToRadius(rings: number): number {
    return this.STORM_TILE_HALF_SPAN + rings * this.STORM_TILE_SPACING;
  }

  private async getCorrespondingSquare(
    x: number,
    y: number,
    mapSize: number,
  ): Promise<{ AX1: number; AY1: number; AX2: number; AY2: number } | null> {
    const step = 12;
    const spacing = step + 1;
    const xIndex = Math.floor(x / spacing);
    const yIndex = Math.floor(y / spacing);
    const AX1 = xIndex * spacing;
    const AY1 = yIndex * spacing;
    const AX2 = AX1 + step;
    const AY2 = AY1 + step;
    if (AX1 >= 0 && AX2 <= mapSize && AY1 >= 0 && AY2 <= mapSize) {
      return { AX1, AY1, AX2, AY2 };
    } else {
      return null;
    }
  }

  private async genericFetchData(
    type: string,
    parameters: { [key: string]: string | number } | null,
  ): Promise<AxiosResponse<any>> {
    let paramString = '';
    if (parameters) {
      const paramEntries = Object.entries(parameters);
      paramEntries.forEach(([key, value], index) => {
        const serialized = typeof value === 'string' ? `"${value}"` : value;
        paramString += `"${key}":${serialized}`;
        if (index < paramEntries.length - 1) {
          paramString += ',';
        }
      });
    } else {
      paramString = 'null';
    }
    const url: string = encodeURI(this.BASE_API_URL + type + '/' + paramString);
    return await axios.get(url);
  }

  private async fetchDataAndReturn(
    lt: string | number,
    lid: string | number,
    sv: string | number,
    type: string = 'hgh',
  ): Promise<any> {
    try {
      const response = await this.genericFetchData(type, { LT: Number(lt), LID: Number(lid), SV: String(sv) });
      const data = response.data;
      return data;
    } catch (error: any) {
      console.error('=====================================');
      console.error('[Error] ', error.message);
      console.error('=====================================');
      return null;
    }
  }

  private rankingPageUrl(lt: string | number, levelCategory: string | number, sv: string | number): string {
    return this.BASE_API_URL + 'hgh' + `/"LT":${lt},"LID":${levelCategory},"SV":"${sv}"`;
  }

  private async fetchRankingPage(
    lt: string | number,
    levelCategory: string | number,
    sv: string | number,
    attempts: number,
    retryDelayMs: number,
    onRetry?: (response: any, attempt: number) => void,
  ): Promise<{ response: any; players: any[] }> {
    let response = await this.fetchDataAndReturn(lt, levelCategory, sv);
    let players = response?.content?.L ?? [];
    let attempt = 0;
    while (attempt < attempts && (response?.['return_code'] != '0' || !players || players.length === 0)) {
      onRetry?.(response, attempt);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      response = await this.fetchDataAndReturn(lt, levelCategory, sv);
      players = response?.content?.L ?? [];
      attempt++;
    }
    return { response, players };
  }

  private mergeRankingSnapshot(infos: any): any[] {
    const key = infos['OID'].toString();
    this.playerLootAndMightPointHistoryList[key] = this.playerLootAndMightPointHistoryList[key] || [];
    const history = this.playerLootAndMightPointHistoryList[key];
    history[2] = infos['AID'];
    history[3] = infos['AN'];
    const AP = infos['AP'];
    if (AP && AP.length > 0) {
      history[4] = structuredClone(AP.filter((ap: number[]) => ap[0] === 0).map((ap: any[]) => [ap[2], ap[3], ap[4]]));
      history[13] = structuredClone(
        AP.filter((ap: number[]) => [1, 2, 3, 4].includes(ap[0])).map((ap: any[]) => [ap[0], ap[2], ap[3], ap[4]]),
      );
    }
    history[5] = infos['H'];
    history[6] = infos['RPT'];
    const now = new Date();
    history[14] = new Date(now.getTime() + Number(infos['RPT']) * 1000).toISOString();
    history[7] = infos['N'];
    history[8] = infos['L'];
    history[9] = infos['LL'];
    history[10] = infos['HF'];
    history[11] = infos['CF'];
    history[12] = infos['RRD'];
    history[15] = infos['AR'];
    return history;
  }

  private async genericFillHistory(
    args: { lt: number; increment: number; tableName: string; query: string; levelCategorySize: number },
    date: Date,
    eventName: string,
    successCallback: () => void | Promise<void>,
  ): Promise<void> {
    try {
      if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
      const { lt, tableName, levelCategorySize } = args;
      const entities: { [key: string]: EventHistoryEntity } = {};
      Utils.logMessage('Database connection successful (' + eventName + ')');
      const currentDateFormatted = format(date, 'yyyy-MM-dd HH:mm:ss');

      for (let levelCategory = 1; levelCategory <= levelCategorySize; levelCategory++) {
        const outcome = await this.collectEventCategory(lt, levelCategory, levelCategorySize, eventName, entities);
        if (outcome === 'abort') return;
      }
      Utils.logMessage('Finished searching for all categories, starting insertion into the database for', eventName);

      const rows = this.buildEventHistoryRows(entities, lt.toString(), currentDateFormatted);

      try {
        await this.insertRowsClickHouse(tableName, rows);
      } catch (error) {
        Utils.logCritical('004', error, 'Error while inserting into player table for', eventName);
        this.DB_UPDATES.criticalErrors++;
        return;
      }

      await successCallback();
    } catch (error) {
      Utils.logCritical('007', error, 'Final error while processing statistics');
    }
  }

  private async collectEventCategory(
    lt: number,
    levelCategory: number,
    levelCategorySize: number,
    eventName: string,
    entities: { [key: string]: EventHistoryEntity },
  ): Promise<'abort' | 'next'> {
    Utils.logMessage('Starting to retrieve statistics for category', levelCategory, '(of', levelCategorySize + ')');
    let data = await this.fetchDataAndReturn(lt, levelCategory, 1);
    if (data?.['return_code'] != '0') {
      if (levelCategory == 1) {
        Utils.logMessage(' [info] No event active (0)');
        return 'abort';
      }
      const attempts = 3;
      let k = 0;
      while (k < attempts && data?.['return_code'] != '0') {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        data = await this.fetchDataAndReturn(lt, levelCategory, 1);
        k++;
      }
    }
    if (data?.['return_code'] != '0' || !data?.content?.LR) {
      /*
       * [PATCH #2512091]
       * In some cases, levelCategorySize can start at 2 (issue observed with bloodcrows)
       * Thus, we need to skip levelCategory 1 to avoid missing the entire event data...
       * [PATCH #2512161]
       * Same for war realms
       */
      if ((eventName === 'bloodcrows' || eventName === 'war realms') && levelCategory <= 2) {
        return 'next';
      }
      Utils.logMessage(' [info] No event active (1)');
      return 'abort';
    }
    const increment = (data?.content?.L ?? []).length;
    const startSV = Math.ceil(increment / 2);
    const max = data?.content?.LR ?? 50000;
    if (!max || Number(max) < 0) return 'next';

    if (!data?.content?.L) {
      Utils.logMessage('Url :', this.rankingPageUrl(lt, levelCategory, startSV));
      Utils.logMessage(JSON.stringify(data));
      Utils.logCritical('005', undefined, 'No players found for category', levelCategory);
      this.DB_UPDATES.criticalErrors++;
      return 'next';
    }

    const completed = await this.scanEventPages(lt, levelCategory, increment, startSV, max, eventName, entities);
    if (!completed) return 'abort';
    Utils.logMessage('Finished searching for category', levelCategory, 'for', eventName);
    return 'next';
  }

  private async scanEventPages(
    lt: number,
    levelCategory: number,
    increment: number,
    startSV: number,
    max: number,
    eventName: string,
    entities: { [key: string]: EventHistoryEntity },
  ): Promise<boolean> {
    let i = startSV;
    let j = 0;
    let c = true;
    while (c) {
      const { response, players } = await this.fetchRankingPage(lt, levelCategory, i, 7, 2000);
      if (!players || players.length === 0) {
        Utils.logMessage('Url :', this.rankingPageUrl(lt, levelCategory, i));
        Utils.logMessage('Nb:', j + ' players found on', max);
        Utils.logMessage('p:', JSON.stringify(response));
        Utils.logCritical('002-' + eventName, undefined, String.raw`/!\ No players found, but status is OK`);
        this.DB_UPDATES.criticalErrors++;
        return false;
      }
      const ids: number[] = [];
      for (const singleData of players) {
        if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
        try {
          ids.push(singleData[0]);
          const playerId = singleData[2]['OID'];
          entities[playerId.toString()] = {
            playerId: playerId,
            playerName: singleData[2]['N'],
            category: levelCategory,
            point: singleData[1],
            allianceId: singleData[2]['AID'],
            allianceName: singleData[2]['AN'],
          };
        } catch (error) {
          Utils.logMessage('Error while migrating to genericFillHistory', JSON.stringify(singleData));
          console.error(error);
          this.DB_UPDATES.criticalErrors++;
        }
        j++;
      }
      i += increment;
      if (j >= max || ids.includes(max)) {
        Utils.logMessage(
          'Finished searching for category',
          levelCategory + ', ' + j + ' players found on',
          max + ' for',
          eventName,
        );
        c = false;
      }
      if (j % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    return true;
  }

  private buildEventHistoryRows(
    entities: { [key: string]: EventHistoryEntity },
    ltString: string,
    currentDateFormatted: string,
  ): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for (const entity of Object.values(entities)) {
      if (!entity?.playerId) continue;
      const playerKey = entity.playerId.toString();
      this.playerEventPointHistoryList[playerKey] = this.playerEventPointHistoryList[playerKey] || {};
      this.playerEventPointHistoryList[playerKey][ltString] = entity.point;
      rows.push({ player_id: entity.playerId, point: entity.point, created_at: currentDateFormatted });
    }
    return rows;
  }

  private async fillMightPointsHistory(): Promise<void> {
    try {
      if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
      const levelCategorySize: number = 6;
      const playerList: { [key: string]: MightRankingPlayer } = {};
      const currentDate = new Date();
      const currentDateFormatted = format(currentDate, 'yyyy-MM-dd HH:mm:ss');
      for (let levelCategory = 1; levelCategory <= levelCategorySize; levelCategory++) {
        const completed = await this.collectMightForCategory(levelCategory, levelCategorySize, playerList);
        if (!completed) return;
      }
      Utils.logMessage('Finished searching for all categories for might points, starting insertion into database');
      if (this.DB_UPDATES.criticalErrors > 0) {
        Utils.logMessage(' [KO] Error while retrieving data for might points');
        Utils.logMessage(
          'There were',
          this.DB_UPDATES.criticalErrors,
          'critical errors while retrieving data, skipping insertion to avoid corrupting the database',
        );
        return;
      }
      const rows: Array<Record<string, unknown>> = [];
      for (const player of Object.values(playerList)) {
        if (player?.uid && player.name) {
          rows.push({ player_id: player.uid, point: player.mightPoints, created_at: currentDateFormatted });
        }
      }
      try {
        await this.insertRowsClickHouse('player_might_history', rows);
      } catch (error) {
        Utils.logCritical('728', error, ' [KO] Error while adding mightPoints to ClickHouse');
        this.DB_UPDATES.criticalErrors++;
      }
    } catch (error) {
      Utils.logCritical('012', error, ' [KO] Final error occurred while processing statistics');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async collectMightForCategory(
    levelCategory: number,
    levelCategorySize: number,
    playerList: { [key: string]: MightRankingPlayer },
  ): Promise<boolean> {
    const increment: number = this.isE4KServer ? 6 : 10;
    Utils.logMessage(
      'Starting to retrieve statistics for category',
      levelCategory + '(out of ' + levelCategorySize + ')',
    );
    const startSV = increment / 2;
    let data = await this.fetchDataAndReturn(6, levelCategory, startSV);
    if (data?.['return_code'] != '0') {
      const attempts = 10;
      let k = 0;
      while (k < attempts && data?.['return_code'] != '0') {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        data = await this.fetchDataAndReturn(6, levelCategory, startSV);
        k++;
      }
      if (data?.['return_code'] != '0') {
        Utils.logMessage(' [KO] Request failed for category', levelCategory);
        const messages = ['Url : ' + this.rankingPageUrl(6, levelCategory, startSV), JSON.stringify(data)];
        void this.stackTraceError('008', messages, true);
        return false;
      }
    }
    const max = data?.content?.LR ?? 50000;
    Utils.logMessage('Request succeeded:', max, 'players found');
    if (!data?.content?.L || !max || Number(max) < 0) {
      Utils.logMessage('Url : ', this.rankingPageUrl(6, levelCategory, startSV));
      Utils.logMessage(JSON.stringify(data));
      Utils.logCritical('011', undefined, ' [KO] No players found for category', levelCategory);
      return true;
    }
    await this.scanMightPages(levelCategory, increment, startSV, max, playerList);
    return true;
  }

  private async scanMightPages(
    levelCategory: number,
    increment: number,
    startSV: number,
    max: number,
    playerList: { [key: string]: MightRankingPlayer },
  ): Promise<void> {
    let i = startSV;
    let j = 0;
    let c = true;
    while (c) {
      const { response, players } = await this.fetchRankingPage(6, levelCategory, i, 10, 10000);
      if (!players || players.length === 0) {
        this.reportEmptyMightPage(levelCategory, i, j, max, players, response);
        c = false;
      } else {
        const ids = this.storeMightPage(players, playerList, j, max);
        j += players.length;
        i += increment;
        if (j >= max || ids.includes(max)) {
          Utils.logMessage('Finished searching for category', levelCategory + ', ' + j + ' players found out of', max);
          c = false;
        }
        if (j % 100 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (this.isUncleanedLowMightPage(levelCategory, players)) {
        Utils.logMessage('Search stopped for IN1, level=' + levelCategory);
        c = false;
      }
    }
  }

  // Specific issue on IN1 : server is not cleaned at all, so low players aren't taken into account
  private isUncleanedLowMightPage(levelCategory: number, players: any[]): boolean {
    return levelCategory === 1 && this.server === 'IN1' && players.length > 0 && players[0][2]['MP'] <= 35;
  }

  private reportEmptyMightPage(
    levelCategory: number,
    sv: number,
    scannedCount: number,
    max: number,
    players: any[],
    response: any,
  ): void {
    Utils.logMessage('Url : ', this.rankingPageUrl(6, levelCategory, sv));
    Utils.logMessage('Nb:', scannedCount + 'players found out of', max);
    if (players) Utils.logMessage('Players.length:' + players.length);
    Utils.logMessage(JSON.stringify(response));
    Utils.logCritical('009', undefined, ' [KO] No players found, but status is OK');
    this.DB_UPDATES.criticalErrors++;
  }

  private storeMightPage(
    players: any[],
    playerList: { [key: string]: MightRankingPlayer },
    scannedCount: number,
    max: number,
  ): number[] {
    const ids: number[] = [];
    let j = scannedCount;
    for (const player of players) {
      if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
      try {
        ids.push(player[0]);
        this.storeMightPlayer(player[2], playerList);
      } catch (error) {
        Utils.logCritical('052', error, ' [KO] Error while storing in playerMightHistoryList', JSON.stringify(player));
        this.DB_UPDATES.criticalErrors++;
      }
      j++;
    }
    return ids;
  }

  private storeMightPlayer(infos: any, playerList: { [key: string]: MightRankingPlayer }): void {
    const uid: number = infos['OID'];
    const mightPoints: number = infos['MP'];
    if (!mightPoints || mightPoints <= 0) return;

    const AP = infos['AP'];
    if (AP && AP.length > 0) {
      playerList[uid.toString()] = {
        uid: uid,
        name: infos['N'],
        allianceID: infos['AID'],
        allianceName: infos['AN'],
        mightPoints: mightPoints,
      };
    }
    this.mergeRankingSnapshot(infos)[1] = mightPoints;
  }

  private transformServerNameToEmoji(serverName: string): string {
    const server = serverName.toLowerCase().trim().replace(/\d*/g, '');
    return Utils.getDiscordEmojis().find((flagName) => flagName === ':flag_' + server + ':') || '(' + serverName + ')';
  }

  private formatValueForDiscord(value?: string | number): string {
    if (value === undefined || value === null) return '';
    const strValue = value.toString();
    return strValue.replace(/([\\_*~`>|@#])/g, String.raw`\$1`);
  }

  private async fillLootHistory(): Promise<void> {
    try {
      if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
      const levelCategorySize: number = 1;
      const playerList: { [key: string]: LootRankingPlayer } = {};
      Utils.logMessage(' Database connection successful (Loot Points)');
      const currentDate = new Date();
      const currentDateFormatted = format(currentDate, 'yyyy-MM-dd HH:mm:ss');

      for (let levelCategory = 1; levelCategory <= levelCategorySize; levelCategory++) {
        const completed = await this.collectLootForCategory(levelCategory, levelCategorySize, playerList);
        if (!completed) return;
      }
      Utils.logMessage(' End of search for all categories for loot');

      Utils.logMessage(' Beginning insertion of loot for players into the database');
      const rows: Array<Record<string, unknown>> = [];
      for (const player of Object.values(playerList)) {
        if (player?.uid && player.name) {
          rows.push({ player_id: player.uid, point: player.points, created_at: currentDateFormatted });
        }
      }
      try {
        await this.insertRowsClickHouse('player_loot_history', rows);
      } catch (error) {
        Utils.logCritical('726', error, ' [KO] Error while adding loot to ClickHouse');
        this.DB_UPDATES.criticalErrors++;
      }
    } catch (error) {
      Utils.logCritical('018', error, ' [KO] Final error while processing statistics');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async collectLootForCategory(
    levelCategory: number,
    levelCategorySize: number,
    playerList: { [key: string]: LootRankingPlayer },
  ): Promise<boolean> {
    const increment: number = this.isE4KServer ? 6 : 10;
    Utils.logMessage(
      ' Beginning retrieval of statistics for category ',
      levelCategory + '(out of ' + levelCategorySize + ')',
    );
    const startSV = increment / 2;
    const data = await this.fetchDataAndReturn(2, levelCategory, startSV);
    const max = data?.content?.LR ?? 50000;
    Utils.logMessage(' Request successful: ', max, 'players found');
    if (!data?.content?.L) {
      Utils.logMessage('Url : ', this.rankingPageUrl(2, levelCategory, startSV));
      Utils.logMessage(JSON.stringify(data));
      Utils.logCritical('017', undefined, ' [KO] No players found for category', levelCategory);
      return true;
    }

    const scanned = await this.scanPositiveLootPages(levelCategory, increment, startSV, max, playerList);
    if (scanned === null) return false;

    try {
      await this.scanNegativeLootPages(levelCategory, increment, scanned, playerList);
    } catch (error) {
      Utils.logCritical('027', error, 'Error while retrieving negative loot points');
    }
    return true;
  }

  private async scanPositiveLootPages(
    levelCategory: number,
    increment: number,
    startSV: number,
    max: number,
    playerList: { [key: string]: LootRankingPlayer },
  ): Promise<number | null> {
    let i = startSV;
    let j = 0;
    let c = true;
    while (c) {
      const { response, players } = await this.fetchRankingPage(2, levelCategory, i, 10, 3000, (previous, attempt) =>
        this.logLootRetry(previous, levelCategory, i, attempt),
      );
      if (!players || players.length === 0) {
        Utils.logMessage('Url : ', this.rankingPageUrl(2, levelCategory, i));
        Utils.logMessage(JSON.stringify(response));
        Utils.logCritical('014', undefined, String.raw` /!\ There are no players found, but the status is OK`);
        this.DB_UPDATES.criticalErrors++;
        return null;
      }
      const ids = this.storeLootPage(players, playerList, j, max);
      j += players.length;
      c = !this.lootScanReachedEnd(players, ids, j, max, levelCategory);
      i += increment;
      if (j % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    return j;
  }

  private storeLootPage(
    players: any[],
    playerList: { [key: string]: LootRankingPlayer },
    scannedCount: number,
    max: number,
  ): number[] {
    const ids: number[] = [];
    let j = scannedCount;
    for (const player of players) {
      if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
      try {
        ids.push(player[0]);
        this.storeLootPlayer(player, player[0], playerList);
      } catch (error) {
        Utils.logCritical('063', error, ' [KO] Error while storing in playerLootHistoryList', JSON.stringify(player));
        this.DB_UPDATES.criticalErrors++;
      }
      j++;
    }
    return ids;
  }

  private lootScanReachedEnd(
    players: any[],
    ids: number[],
    scannedCount: number,
    max: number,
    levelCategory: number,
  ): boolean {
    let reachedEnd = false;
    const lastPoints = players[players.length - 1]?.[1];
    if (players.length <= 0 || !lastPoints || lastPoints == 0) {
      reachedEnd = true;
      Utils.logMessage('Search for loot stopped due to a player with 0 points, players: ', scannedCount);
    }
    if (scannedCount >= max || ids.includes(max)) {
      Utils.logMessage(
        ' End of search for category',
        levelCategory + ', ' + scannedCount + 'players found out of',
        max,
      );
      reachedEnd = true;
    }
    return reachedEnd;
  }

  private async scanNegativeLootPages(
    levelCategory: number,
    increment: number,
    scannedCount: number,
    playerList: { [key: string]: LootRankingPlayer },
  ): Promise<void> {
    Utils.logMessage(' [Info] Processing loot for players with negative points');
    let maxNegative = await this.resolveNegativeLootStart(levelCategory);
    let c = maxNegative !== null;
    while (c) {
      if (maxNegative === null) break;
      const { response, players } = await this.fetchRankingPage(2, levelCategory, maxNegative, 3, 3000);
      if (!players || players.length === 0) {
        c = false;
        Utils.logMessage('Url : ', this.rankingPageUrl(2, levelCategory, maxNegative));
        Utils.logMessage(JSON.stringify(response));
        Utils.logCritical('023', undefined, ' [KO] No players found');
      } else {
        c = this.storeNegativeLootPage(players, playerList, scannedCount, maxNegative);
        maxNegative -= increment;
      }
    }
  }

  private async resolveNegativeLootStart(levelCategory: number): Promise<number | null> {
    let data = await this.fetchDataAndReturn(2, levelCategory, 1);
    if (data?.['return_code'] != '0') {
      const attempts = 3;
      let k = 0;
      while (k < attempts && data?.['return_code'] != '0') {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        data = await this.fetchDataAndReturn(2, levelCategory, 1);
        k++;
      }
    }
    const maxNegative = data?.content?.LR;
    if (data?.['return_code'] != '0' || !maxNegative) {
      Utils.logMessage('Url : ', this.rankingPageUrl(2, levelCategory, maxNegative));
      Utils.logMessage(JSON.stringify(data));
      Utils.logCritical('026', undefined, ' [KO] The request failed for category', levelCategory);
      console.error('[KO] The request failed for category', levelCategory);
      return null;
    }
    return maxNegative;
  }

  private storeNegativeLootPage(
    players: any[],
    playerList: { [key: string]: LootRankingPlayer },
    scannedCount: number,
    maxNegative: number,
  ): boolean {
    let keepScanning = true;
    for (const player of players) {
      if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(scannedCount, maxNegative);
      try {
        if (Number(player[1]) < 0) {
          const infos: any = player[2];
          Utils.logMessage(' [Info] Player with negative points found', infos['OID'], '(', infos['N'], ')');
          this.storeLootPlayer(player, -1, playerList);
        } else if (keepScanning) {
          keepScanning = false;
          Utils.logMessage('Stopping search for negative loot due to player with 0 points: ', scannedCount);
        }
      } catch (error) {
        Utils.logCritical('064', error, ' [KO] Error while storing in playerLootHistoryList', JSON.stringify(player));
      }
    }
    return keepScanning;
  }

  private storeLootPlayer(player: any[], rank: number, playerList: { [key: string]: LootRankingPlayer }): void {
    const OVERFLOW_OFFSET = 2 ** 32;
    const rawPoints = Number(player[1]);
    const points: number = rawPoints >= 0 ? rawPoints : rawPoints + OVERFLOW_OFFSET;
    const infos: any = player[2];
    const uid: number = infos['OID'];
    const mightPoints: number = infos['MP'];
    if (!mightPoints || mightPoints < 0) return;

    const AP = infos['AP'];
    if (AP && AP.length > 0) {
      playerList[uid.toString()] = {
        rank: rank,
        uid: uid,
        name: infos['N'],
        points: points,
        allianceID: infos['AID'],
        allianceName: infos['AN'],
        mightPoints: mightPoints,
      };
    }
    this.mergeRankingSnapshot(infos)[0] = points;
  }

  private logLootRetry(response: any, levelCategory: number, sv: number, attempt: number): void {
    if (this.CURRENT_ENV !== 'development') return;
    Utils.logMessage('Debug:');
    Utils.logMessage('Try n°', attempt + 1, 'for category', levelCategory, 'with i =', sv);
    Utils.logMessage('Url :', this.rankingPageUrl(2, levelCategory, sv));
    Utils.logMessage('Data :', JSON.stringify(response));
  }

  private async removePlayerFromDatabase(playerId: number): Promise<void> {
    const pgSqlQuery = `
      UPDATE players SET
        castles = '[]'::jsonb,
        castles_realm = '[]'::jsonb,
        alliance_id = NULL,
        might_current = 0,
        loot_current = 0,
        alliance_rank = NULL,
        honor = 0,
        current_fame = 0
      WHERE id = $1`;
    Utils.logMessage(' [Info] Deleting player', playerId);
    try {
      await this.pgSqlQuery(pgSqlQuery, [playerId]);
      Utils.logMessage(' [OK] Player deletion successful', playerId);
    } catch (error) {
      Utils.logCritical('019', error, ' [KO] Error while deleting player', playerId);
    }
  }

  private async updateAllianceName(
    allianceId: any,
    allianceName: any,
    currentAllianceName: string | null,
  ): Promise<void> {
    this.allianceUpdated[allianceId] = true;
    this.DB_UPDATES.alliancesUpdated++;
    const pgSqlQueryUpdateAllianceName = 'UPDATE alliances SET name = $1 WHERE id = $2';
    await this.pgSqlQuery(pgSqlQueryUpdateAllianceName, [allianceName, allianceId]);
    const pgSqlQueryInsertAllianceUpdateHistory = `
      INSERT INTO alliance_update_history (alliance_id, old_name, new_name)
      VALUES ($1, $2, $3)
    `;
    await this.pgSqlQuery(pgSqlQueryInsertAllianceUpdateHistory, [allianceId, currentAllianceName, allianceName]);
    this.customPlayersAttributesList['alliance_name_update_count'] =
      this.customPlayersAttributesList['alliance_name_update_count'] || 0;
    this.customPlayersAttributesList['alliance_name_update_count']++;
  }

  private async updatePlayerAlliance(
    playerId: number,
    allianceId: any,
    currentAllianceId: any,
    allianceName: any,
    currentAllianceName: any,
  ): Promise<void> {
    const pgSqlQueryUpdatePlayerAlliance = 'UPDATE players SET alliance_id = $1 WHERE id = $2';
    await this.pgSqlQuery(pgSqlQueryUpdatePlayerAlliance, [allianceId, playerId]);
    const pgSqlQueryInsertAllianceUpdateHistory = `
            INSERT INTO player_alliance_update (player_id, old_alliance_id, new_alliance_id, old_alliance_name, new_alliance_name)
            VALUES ($1, $2, $3, $4, $5)
        `;
    await this.pgSqlQuery(pgSqlQueryInsertAllianceUpdateHistory, [
      playerId,
      currentAllianceId,
      allianceId,
      currentAllianceName,
      allianceName,
    ]);
    this.customPlayersAttributesList['player_alliance_update_count'] =
      this.customPlayersAttributesList['player_alliance_update_count'] || 0;
    this.customPlayersAttributesList['player_alliance_update_count']++;
    this.DB_UPDATES.playersAllianceUpdated++;
  }

  private async addPlayerInDatabase(input: PlayerUpsertInput): Promise<void> {
    const { playerId, minimalist = false } = input;
    const allianceId = GenericFetchAndSaveBackend.nullIfNotPositive(input.allianceId);
    const player = this.currentPlayers.find((p) => p.playerId == playerId);

    if (!player) {
      await this.insertNewPlayer(input, allianceId);
      return;
    }
    await this.updateExistingPlayer(player, input, allianceId, minimalist);
  }

  private async insertNewPlayer(input: PlayerUpsertInput, allianceId: any): Promise<void> {
    const { playerId, playerName, allianceName } = input;
    const pgSqlQueryPlayer = `
      INSERT INTO players (id, name, alliance_id, might_current, might_all_time, loot_current, loot_all_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const values = [
      playerId,
      playerName,
      allianceId,
      GenericFetchAndSaveBackend.nullIfNotPositive(input.might_current),
      GenericFetchAndSaveBackend.nullIfNotPositive(input.might_all_time),
      GenericFetchAndSaveBackend.nullIfNotPositive(input.loot_current),
      GenericFetchAndSaveBackend.nullIfNotPositive(input.loot_all_time),
    ];
    try {
      await this.pgSqlQuery(pgSqlQueryPlayer, values);
      this.DB_UPDATES.playersCreated++;
    } catch (error: any) {
      if (error.code != '23503') return;
      try {
        await this.addAllianceInDatabase(allianceId, allianceName);
        await this.pgSqlQuery(pgSqlQueryPlayer, values);
        this.DB_UPDATES.playersCreated++;
      } catch (error) {
        Utils.logMessage('PlayerId:', playerId);
        Utils.logMessage('PlayerName:', playerName);
        Utils.logCritical('838', error, ' [KO] Error while adding player', playerId, '(name :', playerName, ')');
        this.DB_UPDATES.criticalErrors++;
      }
    }
  }

  private async updateExistingPlayer(
    player: PlayerDatabase,
    input: PlayerUpsertInput,
    allianceId: any,
    minimalist: boolean,
  ): Promise<void> {
    const { playerId, playerName, allianceName } = input;
    const currentAllianceId = GenericFetchAndSaveBackend.nullIfNotPositive(player.allianceId);
    const currentAllianceName = player.allianceName || null;

    await this.updatePlayerCastlesSafely(playerId, playerName, player.castles, input.castles ?? null);
    await this.renamePlayerIfChanged(playerId, playerName, player.playerName);
    if (minimalist) return;
    await this.movePlayerAllianceIfChanged(input, allianceId, currentAllianceId, currentAllianceName);

    if (
      allianceId &&
      currentAllianceId == allianceId &&
      currentAllianceName != allianceName &&
      !this.allianceUpdated[allianceId]
    ) {
      await this.renameAllianceSafely(
        playerId,
        playerName,
        allianceId,
        currentAllianceId,
        allianceName,
        currentAllianceName,
      );
    }
  }

  private async updatePlayerCastlesSafely(
    playerId: number,
    playerName: string,
    currentCastles: Castle[] | [],
    castles: any,
  ): Promise<void> {
    try {
      await this.updatePlayerCastles(playerId, currentCastles, castles || []);
    } catch (error) {
      Utils.logMessage('PlayerId:', playerId);
      Utils.logMessage('PlayerName:', playerName);
      Utils.logMessage('currentCastles:', currentCastles);
      Utils.logMessage('castles:', castles);
      Utils.logCritical(
        '077',
        error,
        ' [KO] Error while updating player castles',
        playerId,
        '(name :',
        playerName,
        ')',
      );
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async renamePlayerIfChanged(playerId: number, playerName: string, currentPlayerName: string): Promise<void> {
    if (currentPlayerName == playerName || this.playerRenamedList[playerId]) return;
    try {
      this.playerRenamedList[playerId] = true;
      Utils.logMessage(
        ' [Info] Update player name',
        playerId,
        '(name :',
        playerName,
        ') - Old name :',
        currentPlayerName,
      );
      const pgSqlQueryUpdatePlayerName = 'UPDATE players SET name = $1 WHERE id = $2';
      const pgSqlQueryInsertPlayerNameUpdateHistory = `
        INSERT INTO player_name_update_history (player_id, old_name, new_name)
        VALUES ($1, $2, $3)
      `;
      await Promise.all([
        this.pgSqlQuery(pgSqlQueryUpdatePlayerName, [playerName, playerId]),
        this.pgSqlQuery(pgSqlQueryInsertPlayerNameUpdateHistory, [playerId, currentPlayerName, playerName]),
      ]);
      this.customPlayersAttributesList['player_name_update_count'] =
        this.customPlayersAttributesList['player_name_update_count'] || 0;
      this.customPlayersAttributesList['player_name_update_count']++;
    } catch (error) {
      Utils.logMessage('PlayerId:', playerId);
      Utils.logMessage('PlayerName:', playerName);
      Utils.logMessage('currentPlayerName:', currentPlayerName);
      Utils.logCritical('010', error, ' [KO] Error while updating player name', playerId, '(name :', playerName, ')');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async movePlayerAllianceIfChanged(
    input: PlayerUpsertInput,
    allianceId: any,
    currentAllianceId: any,
    currentAllianceName: any,
  ): Promise<void> {
    const { playerId, playerName, allianceName } = input;
    if (currentAllianceId == allianceId) return;
    try {
      Utils.logMessage(
        ' [Info] Update player alliance',
        playerId,
        '(name :',
        playerName,
        ') - Old alliance :',
        currentAllianceId,
        'New alliance :',
        allianceId,
      );
      await this.updatePlayerAlliance(playerId, allianceId, currentAllianceId, allianceName, currentAllianceName);
    } catch (error: any) {
      if (!GenericFetchAndSaveBackend.isMissingAllianceError(error)) {
        this.DB_UPDATES.criticalErrors++;
        this.logAllianceMoveFailure('019', error, playerId, playerName, currentAllianceId, allianceId);
        return;
      }
      await this.retryAllianceMoveAfterCreation(input, allianceId, currentAllianceId, currentAllianceName);
    }
  }

  private async retryAllianceMoveAfterCreation(
    input: PlayerUpsertInput,
    allianceId: any,
    currentAllianceId: any,
    currentAllianceName: any,
  ): Promise<void> {
    const { playerId, playerName, allianceName } = input;
    try {
      await this.addAllianceInDatabase(allianceId, allianceName);
      await this.updatePlayerAlliance(playerId, allianceId, currentAllianceId, allianceName, currentAllianceName);
    } catch (error: any) {
      if (!GenericFetchAndSaveBackend.isMissingAllianceError(error)) return;
      this.logAllianceMoveFailure('091', error, playerId, playerName, currentAllianceId, allianceId);
    }
  }

  private logAllianceMoveFailure(
    identifier: string,
    error: unknown,
    playerId: number,
    playerName: string,
    currentAllianceId: any,
    allianceId: any,
  ): void {
    Utils.logMessage('PlayerId:', playerId);
    Utils.logMessage('PlayerName:', playerName);
    Utils.logMessage('OldAllianceId:', currentAllianceId);
    Utils.logMessage('NewAllianceId:', allianceId);
    Utils.logCritical(
      identifier,
      error,
      ' [KO] Error while updating player alliance',
      playerId,
      '(name :',
      playerName,
      ')',
    );
  }

  private async renameAllianceSafely(
    playerId: number,
    playerName: string,
    allianceId: any,
    currentAllianceId: any,
    allianceName: any,
    currentAllianceName: any,
  ): Promise<void> {
    try {
      Utils.logMessage(
        ' [Info] Update alliance name',
        playerId,
        '(name :',
        playerName,
        ') - Old name :',
        currentAllianceName,
        'New name :',
        allianceName,
      );
      await this.updateAllianceName(allianceId, allianceName, currentAllianceName);
    } catch (error) {
      Utils.logMessage('PlayerId:', playerId);
      Utils.logMessage('PlayerName:', playerName);
      Utils.logMessage('currentAllianceId:', currentAllianceId);
      Utils.logMessage('allianceId:', allianceId);
      Utils.logMessage('currentAllianceName:', currentAllianceName);
      Utils.logMessage('allianceName:', allianceName);
      Utils.logCritical('020', error, ' [KO] Error while updating alliance name', playerId, '(name :', playerName, ')');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async addAllianceInDatabase(allianceId: any, allianceName: any): Promise<void> {
    const pgSqlQueryAlliance = 'INSERT INTO alliances (id, name) VALUES ($1, $2)';
    try {
      await this.pgSqlQuery(pgSqlQueryAlliance, [allianceId, allianceName]);
    } catch (error: any) {
      if (error.code != '23505') {
        this.DB_UPDATES.criticalErrors++;
        Utils.logCritical(
          '021',
          error,
          ' [KO] Error while inserting alliance',
          allianceId,
          '(name :',
          allianceName,
          ')',
        );
      }
    }
  }

  private async fillWarRealmsHistory(): Promise<void> {
    if (this.DB_UPDATES.criticalErrors > 0) {
      Utils.logMessage(' [KO] There are critical errors, stopping process');
      return;
    }
    const args = {
      lt: this.ENV_LT.war_realms,
      increment: 8,
      query: `
        INSERT INTO player_event_war_realms_history (player_id, category, point, created_at)
        VALUES (?, ?, ?, ?)
      `,
      tableName: 'player_event_war_realms_history',
      levelCategorySize: 5,
    };
    const date = new Date();
    const successCallback = async (): Promise<void> => {
      Utils.logMessage('War history inserted successfully');
      if (this.DB_UPDATES.criticalErrors === 0) await this.addEventTimestamp(date, 'player_event_war_realms_history');
    };
    await this.genericFillHistory(args, date, 'war realms', successCallback);
  }

  private async fillSamuraiHistory(): Promise<void> {
    if (this.DB_UPDATES.criticalErrors > 0) {
      Utils.logMessage(' [KO] There are critical errors, stopping process');
      return;
    }
    const args = {
      lt: this.ENV_LT.samurai,
      increment: 8,
      query: `
        INSERT INTO player_event_samurai_history (player_id, category, point, created_at)
        VALUES (?, ?, ?, ?)
      `,
      tableName: 'player_event_samurai_history',
      levelCategorySize: 5,
    };
    const date = new Date();
    const successCallback = async (): Promise<void> => {
      Utils.logMessage('Samurai history inserted successfully');
      if (this.DB_UPDATES.criticalErrors === 0) await this.addEventTimestamp(date, 'player_event_samurai_history');
    };
    await this.genericFillHistory(args, date, 'samurai', successCallback);
  }

  private async fillNomadsHistory(): Promise<void> {
    if (this.DB_UPDATES.criticalErrors > 0) {
      Utils.logMessage(' [KO] There are critical errors, stopping process');
      return;
    }
    const args = {
      lt: this.ENV_LT.nomad,
      increment: 8,
      query: `
        INSERT INTO player_event_nomad_history (player_id, category, point, created_at)
        VALUES (?, ?, ?, ?)
      `,
      tableName: 'player_event_nomad_history',
      levelCategorySize: 5,
    };
    const date = new Date();
    const successCallback = async (): Promise<void> => {
      Utils.logMessage('History of nomads inserted successfully');
      if (this.DB_UPDATES.criticalErrors === 0) await this.addEventTimestamp(date, 'player_event_nomad_history');
    };
    await this.genericFillHistory(args, date, 'nomads', successCallback);
  }

  private async fillBerimondKingdomHistory(): Promise<void> {
    if (this.DB_UPDATES.criticalErrors > 0) {
      Utils.logMessage(' [KO] There are critical errors, stopping process');
      return;
    }
    const args = {
      lt: this.ENV_LT.berimondKingdom,
      increment: 5,
      query: `
        INSERT INTO player_event_berimond_kingdom_history (player_id, category, point, created_at)
        VALUES (?, ?, ?, ?)
      `,
      tableName: 'player_event_berimond_kingdom_history',
      levelCategorySize: 4,
    };
    const date = new Date();
    const successCallback = async (): Promise<void> => {
      Utils.logMessage('History of berimond kingdoms inserted successfully');
      if (this.DB_UPDATES.criticalErrors === 0)
        await this.addEventTimestamp(date, 'player_event_berimond_kingdom_history');
    };
    await this.genericFillHistory(args, date, 'berimond kingdoms', successCallback);
  }

  /**
   * Fetches the details of a single alliance
   *
   * @param allianceId - The alliance to fetch
   * @returns The `ain` response, or null if every attempt failed
   */
  private async fetchAllianceInfo(allianceId: number): Promise<AxiosResponse<any> | null> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.genericFetchData('ain', { AID: allianceId });
      } catch (error) {
        Utils.logMessage(
          ' [KO] Error fetching alliance',
          allianceId,
          '- attempt',
          attempt + '/' + maxAttempts,
          ':',
          String(error),
        );
        if (attempt === maxAttempts) {
          return null;
        }
        await this.sleep(1000 * attempt);
      }
    }
    return null;
  }

  private async bulkUpdateAlliance(allianceIds: Set<number>): Promise<void> {
    Utils.logMessage('Starting bulkUpdateAlliance insertions...');
    const allianceToUpdates = [];
    const batchSize = 25;
    const currentAlliancesMap = new Map(this.currentAlliances.map((a) => [a.allianceId, a]));

    for (const allianceId of allianceIds) {
      const response = await this.fetchAllianceInfo(allianceId);
      if (!response?.data?.content?.A) {
        Utils.logMessage(' [KO] No alliance data for alliance', allianceId);
        continue;
      }
      const data = response.data.content.A;
      const allianceDescription: string = data.D;
      const allianceLanguage: string = data.ALL;
      const autoJoinEnabled: boolean = data.IA !== 0;
      const isIslandKingAlliance: boolean = data.KA !== 0;
      const isSearchingAlliance: boolean = data.IS !== 0;
      const currentAlliance = currentAlliancesMap.get(allianceId);

      if (
        currentAlliance?.auto_join_enabled !== autoJoinEnabled ||
        currentAlliance.description !== allianceDescription ||
        currentAlliance.language !== allianceLanguage ||
        currentAlliance.is_island_king !== isIslandKingAlliance ||
        currentAlliance.is_searching_alliance !== isSearchingAlliance
      ) {
        allianceToUpdates.push({
          allianceId,
          oldDescription: currentAlliance?.description ?? null,
          new: !currentAlliance,
          autoJoinEnabled,
          isIslandKingAlliance,
          isSearchingAlliance,
          allianceLanguage,
          allianceDescription,
        });
      }
    }

    const createdAt = new Date();

    Utils.logMessage('Preparing database bulk insertion of ' + allianceToUpdates.length + 'items...');

    for (let i = 0; i < allianceToUpdates.length; i += batchSize) {
      const batch = allianceToUpdates.slice(i, i + batchSize);
      try {
        Utils.logMessage('[bulkUpdateAlliance] : Insert new batch : ' + i);
        await Promise.all(
          batch.map(async (allianceToUpdate) => {
            const pgSqlAllianceUpdateQuery = `
              UPDATE alliances
              SET
                is_searching_alliance = $1,
                auto_join_enabled = $2,
                is_island_king = $3,
                language = $4,
                description = $5
              WHERE id = $6
            `;

            await this.pgSqlQuery(pgSqlAllianceUpdateQuery, [
              allianceToUpdate.isSearchingAlliance,
              allianceToUpdate.autoJoinEnabled,
              allianceToUpdate.isIslandKingAlliance,
              allianceToUpdate.allianceLanguage,
              allianceToUpdate.allianceDescription,
              allianceToUpdate.allianceId,
            ]);

            if (
              currentAlliancesMap.get(allianceToUpdate.allianceId) &&
              allianceToUpdate.oldDescription !== allianceToUpdate.allianceDescription
            ) {
              const pgSqlAllianceHistoryQuery = `
                INSERT INTO alliance_description_history
                (
                  alliance_id,
                  old_description,
                  new_description,
                  created_at
                )
                VALUES
                ($1, $2, $3, $4)
              `;

              await this.pgSqlQuery(pgSqlAllianceHistoryQuery, [
                allianceToUpdate.allianceId,
                allianceToUpdate.oldDescription,
                allianceToUpdate.allianceDescription,
                createdAt,
              ]);
            }
          }),
        );
      } catch (error) {
        Utils.logMessage('Error during bulkUpdateAlliance : ' + error);
        Utils.logMessage('Skipping');
      }
    }

    Utils.logMessage('Finished bulkUpdateAlliance insertions');
  }

  private async fillBloodcrowHistory(): Promise<void> {
    if (this.DB_UPDATES.criticalErrors > 0) {
      Utils.logMessage(' [KO] There are critical errors, stopping process');
      return;
    }
    const args = {
      lt: this.ENV_LT.bloodcrow,
      increment: 8,
      query: `
        INSERT INTO player_event_bloodcrow_history (player_id, category, point, created_at)
        VALUES (?, ?, ?, ?)
      `,
      tableName: 'player_event_bloodcrow_history',
      levelCategorySize: 5,
    };
    const date = new Date();
    const successCallback = async (): Promise<void> => {
      Utils.logMessage('History of bloodcrows inserted successfully');
      if (this.DB_UPDATES.criticalErrors === 0) await this.addEventTimestamp(date, 'player_event_bloodcrow_history');
    };
    await this.genericFillHistory(args, date, 'bloodcrows', successCallback);
  }

  private async addEventTimestamp(date: Date, tableName: string): Promise<void> {
    if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
    try {
      await this.insertRowsClickHouse('event_dates', [
        { table_name: tableName, created_at: format(date, 'yyyy-MM-dd HH:mm:ss') },
      ]);
    } catch (error) {
      Utils.logCritical('467', error, 'Error while adding event timestamp for table', tableName);
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private askConfirmation(question: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
      });
    });
  }

  private async bulkUpdatePlayers(updates: Record<number, any[]>): Promise<void> {
    await this.pgSqlQuery(`
      CREATE TEMP TABLE tmp_players_update (
        id INTEGER PRIMARY KEY,
        might_current BIGINT,
        loot_current BIGINT,
        might_all_time BIGINT,
        loot_all_time BIGINT,
        alliance_rank SMALLINT,
        castles JSONB,
        castles_realm JSONB,
        honor INTEGER,
        max_honor INTEGER,
        remaining_peace_time INTEGER,
        level SMALLINT,
        legendary_level SMALLINT,
        highest_fame NUMERIC(20, 0),
        current_fame NUMERIC(20, 0),
        remaining_relocation_time INTEGER,
        peace_disabled_at TIMESTAMP DEFAULT NULL
      );
    `);
    const CHUNK_SIZE = 3000;
    const columns = [
      'id',
      'might_current',
      'loot_current',
      'might_all_time',
      'loot_all_time',
      'alliance_rank',
      'castles',
      'castles_realm',
      'honor',
      'max_honor',
      'remaining_peace_time',
      'level',
      'legendary_level',
      'highest_fame',
      'current_fame',
      'remaining_relocation_time',
      'peace_disabled_at',
    ];
    const nbColumns = columns.length;
    const insertValues: any[][] = [];
    for (const [key, data] of Object.entries(updates)) {
      const playerId = Number(key);
      const loot_current = data[0] || 0;
      const might_current = data[1] || 0;
      const castles = data[4] ? JSON.stringify(data[4]) : null;
      const castles_realm = data[13] ? JSON.stringify(data[13]) : null;
      const honor = data[5] || 0;
      const remaining_peace_time = data[6] || 0;
      const level = data[8] || 0;
      const legendaryLevel = data[9] || 0;
      const highestFame = data[10] || 0;
      const currentFame = data[11] || 0;
      const remainingRelocationTime = data[12] || 0;
      const peaceDisabledAt = Number(remaining_peace_time) > 0 ? (data[14] ?? null) : null;
      const alliance_rank = Number(data[15]) >= 0 && Number(data[15]) <= 100 ? Number(data[15]) : null;
      insertValues.push([
        playerId,
        might_current,
        loot_current,
        might_current,
        loot_current,
        alliance_rank,
        castles,
        castles_realm,
        honor,
        honor,
        remaining_peace_time,
        level,
        legendaryLevel,
        highestFame,
        currentFame,
        remainingRelocationTime,
        peaceDisabledAt,
      ]);
    }
    Utils.logMessage('Chunk array...');
    const chunks = this.chunkArray(insertValues, CHUNK_SIZE);
    Utils.logMessage('Loop chunks...');
    for (const chunk of chunks) {
      const valuesClause = chunk
        .map((_, rowIndex) => {
          const start = rowIndex * nbColumns + 1;
          const placeholders = new Array(nbColumns).fill(0).map((_, colIndex) => `$${start + colIndex}`);
          return `(${placeholders.join(', ')})`;
        })
        .join(', ');
      const flatValues = chunk.flat();
      const query = `
        INSERT INTO tmp_players_update (${columns.join(', ')})
        VALUES ${valuesClause}
      `;
      Utils.logMessage('Inserting chunk of size', chunk.length);
      await this.pgSqlQuery(query, flatValues);
    }
    Utils.logMessage('Update players table with temporary data');
    await this.pgSqlQuery(`
      UPDATE players p
      SET
        loot_current = tmp.loot_current,
        might_current = tmp.might_current,
        loot_all_time = GREATEST(COALESCE(p.loot_all_time, 0), tmp.loot_all_time),
        might_all_time = GREATEST(COALESCE(p.might_all_time, 0), tmp.might_all_time),
        alliance_rank = tmp.alliance_rank,
        castles = tmp.castles,
        castles_realm = tmp.castles_realm,
        honor = tmp.honor,
        max_honor = GREATEST(COALESCE(p.max_honor, 0), tmp.max_honor),
        remaining_peace_time = tmp.remaining_peace_time,
        level = GREATEST(COALESCE(p.level, 0), tmp.level),
        legendary_level = GREATEST(COALESCE(p.legendary_level, 0), tmp.legendary_level),
        highest_fame = GREATEST(COALESCE(p.highest_fame, 0), tmp.highest_fame),
        current_fame = tmp.current_fame,
        remaining_relocation_time = tmp.remaining_relocation_time,
        peace_disabled_at = tmp.peace_disabled_at,
        updated_at = CURRENT_TIMESTAMP
      FROM tmp_players_update tmp
      WHERE p.id = tmp.id
        `);
  }

  private async fillPlayerAquamarineData(): Promise<void> {
    try {
      if (this.DB_UPDATES.criticalErrors > 0) {
        Utils.logMessage(' [KO] There are critical errors, stopping the process');
        return;
      }

      if (!this.CLICKHOUSE_CONFIG) {
        throw new Error('ClickHouse configuration is missing.');
      }

      // Only process players that have aquamarine realm AP data (index 4)
      const eligiblePlayerIds = Object.keys(this.playerLootAndMightPointHistoryList)
        .map(Number)
        .filter((playerId) => {
          const realmAp = this.playerLootAndMightPointHistoryList[playerId][13];
          return realmAp?.length > 0 && realmAp.some((ap: any[]) => ap[0] === 4);
        });

      Utils.logMessage('Number of players to update with aquamarine', eligiblePlayerIds.length);

      const EID = 102;

      const fetchDate = new Date();
      const collected_at = new Date(fetchDate).toISOString().slice(0, 19).replace('T', ' ');
      const allRows: any[] = [];
      const limit = pLimit(5);

      await Promise.all(
        eligiblePlayerIds.map((playerId) =>
          limit(async () => {
            try {
              const response = await this.genericFetchData('gpe', {
                PID: playerId,
                EID,
              });

              if (!response?.data?.content) {
                Utils.logMessage(' [KO] No data returned for player', playerId);
                return;
              }
              const { PST = [], AMT: cargoAmt = 0, PE = 0 } = response.data.content;
              if (PE !== 1) {
                Utils.logMessage(' [KO] Player has not entered', playerId);
                return;
              }

              for (const item of PST) {
                if (!item) continue;
                allRows.push({
                  player_id: playerId,
                  metric_id: Number(item.PSI),
                  value: Number(item.AMT ?? 0),
                  collected_at,
                });
              }

              // Cargo points
              allRows.push({
                player_id: playerId,
                metric_id: 100,
                value: Number(cargoAmt ?? 0),
                collected_at,
              });
            } catch (error) {
              Utils.logMessage(`Error while fetching aquamarine data for player ${playerId}`);
              console.error(error);
            }
          }),
        ),
      );

      if (allRows.length === 0) {
        Utils.logMessage('No player_metrics rows to insert');
        return;
      }
      try {
        await this.insertRowsClickHouse('player_metrics', allRows);
        Utils.logMessage(`Inserted ${allRows.length} player_metrics rows for ${eligiblePlayerIds.length} players`);
      } catch (error) {
        Utils.logCritical('104', error, 'Error while bulk-inserting player metrics');
        this.DB_UPDATES.criticalErrors++;
      }
    } catch (error) {
      Utils.logCritical('103', error, 'Error updating player aquamarine data');

      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async updatePlayersMightAndLoot(): Promise<void> {
    try {
      if (this.DB_UPDATES.criticalErrors > 0) {
        Utils.logMessage(' [KO] There are critical errors, stopping the process');
        return;
      }
      Utils.logMessage(' Database connection successful');
      const keys = Object.keys(this.playerLootAndMightPointHistoryList);
      const length = keys.length;
      let j = 0;
      const dbConnectionLimit = Number(this.PGSQL_CONFIG?.['max']) || 5;
      let targetLimit: number = 1;
      if (dbConnectionLimit > 20) {
        targetLimit = 20;
      } else if (dbConnectionLimit > 10) {
        targetLimit = 10;
      } else {
        targetLimit = 5;
      }
      const limit = pLimit(targetLimit);
      const insertionPromises: Promise<void>[] = [];
      const updates: Record<number, any[]> = {};
      const allianceIds: Set<number> = new Set<number>();
      for (const key of keys) {
        const playerId = Number(key);
        const loot_current = this.playerLootAndMightPointHistoryList[key][0] || 0;
        const might_current = this.playerLootAndMightPointHistoryList[key][1] || 0;
        const allianceId = this.playerLootAndMightPointHistoryList[key][2] || null;
        allianceIds.add(allianceId);
        const allianceName = this.playerLootAndMightPointHistoryList[key][3] || null;
        let ap = this.playerLootAndMightPointHistoryList[key][4] || null;
        let realmAp = this.playerLootAndMightPointHistoryList[key][13] || null;
        const honor = this.playerLootAndMightPointHistoryList[key][5] || 0;
        const rpt = this.playerLootAndMightPointHistoryList[key][6] || 0;
        const playerName = this.playerLootAndMightPointHistoryList[key][7] || null;
        const level = this.playerLootAndMightPointHistoryList[key][8] || 0;
        const legendaryLevel = this.playerLootAndMightPointHistoryList[key][9] || 0;
        const highestFame = this.playerLootAndMightPointHistoryList[key][10] || 0;
        const currentFame = this.playerLootAndMightPointHistoryList[key][11] || 0;
        const remainingRelocationTime = this.playerLootAndMightPointHistoryList[key][12];
        const peaceDisabledAt = Number(rpt) > 0 ? this.playerLootAndMightPointHistoryList[key][14] : null;
        const allianceRank = this.playerLootAndMightPointHistoryList[key][15];
        updates[playerId] = [
          loot_current, // loot_current
          might_current, // might_current
          allianceId, // alliance_id
          allianceName, // alliance_name
          ap, // castles/outposts
          honor, // honor
          rpt, // rpt
          playerName, // player_name
          level, // level
          legendaryLevel, // legendary_level
          highestFame, // highest_fame
          currentFame, // current_fame
          remainingRelocationTime, // remaining_relocation_time
          realmAp, // realm castles
          peaceDisabledAt, // peace_disabled_at
          allianceRank, // alliance rank
        ];
        const targetedPlayer = this.currentPlayers.find((p) => p.playerId == playerId);
        const shouldInsert =
          !targetedPlayer ||
          (targetedPlayer && targetedPlayer.allianceId != allianceId) ||
          (targetedPlayer && targetedPlayer.allianceName != allianceName) ||
          (targetedPlayer && targetedPlayer.playerName != playerName) ||
          (targetedPlayer &&
            this.getCastleMovements(
              playerId,
              targetedPlayer.castles,
              this.playerLootAndMightPointHistoryList[key][4] || null,
            ).length > 0);
        if (shouldInsert) {
          const promise = limit(() =>
            this.addPlayerInDatabase({
              playerId,
              playerName,
              allianceId,
              allianceName,
              might_current,
              might_all_time: null,
              loot_current,
              loot_all_time: null,
              castles: ap,
            }),
          );
          insertionPromises.push(promise);
          j++;
        }
      }
      Utils.logMessage('Number of players to update (1):', j);
      Utils.logMessage('Updating players...');
      await Promise.all(insertionPromises);
      Utils.logMessage('Number of players to update (2):', length);
      Utils.logMessage('Updating players...');
      await this.bulkUpdatePlayers(updates);
      Utils.logMessage('Player updates completed successfully!');
      Utils.logMessage('Power and loot points updates completed successfully');
      Utils.logMessage('Number of players updated:', j);
      Utils.logMessage('Updating alliance history...');
      await this.bulkUpdateAlliance(allianceIds);
    } catch (error) {
      Utils.logCritical('099', error, 'Error updating player power and loot points');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async refreshInactivePlayer(id: number): Promise<void> {
    try {
      const url: string = encodeURI(this.BASE_API_URL + 'gdi' + `/"PID":${id}`);
      const response = await axios.get(url);
      const data = response.data;
      if (data?.content) {
        const player = data.content;
        if (player?.['O']) {
          await this.applyInactivePlayerRefresh(id, player['O']);
        } else {
          await this.removePlayerFromDatabase(id);
        }
      } else if (data?.error === 'Timeout') {
        Utils.logMessage(' [Info] Player data timeout, removing player from database', id);
        await this.removePlayerFromDatabase(id);
      }
    } catch (error) {
      Utils.logCritical('104', error, ' [KO] Error', id);
      const pgSqlQuery = `
            UPDATE players
            SET
              castles = [],
              castles_realm = [],
              alliance_id = NULL
            WHERE id = $1
          `;
      try {
        await this.pgSqlQuery(pgSqlQuery, [id]);
      } catch (error) {
        Utils.logCritical('105', error, ' [KO] Error while updating player', id);
        this.DB_UPDATES.criticalErrors++;
      }
    }
  }

  private async applyInactivePlayerRefresh(id: number, o: Record<string, any>): Promise<void> {
    const allianceId = o['AID'] || null;
    const allianceName = o['AN'] || null;
    const might_current = o['MP'] || 0;
    const loot_current = o['P'] || 0;
    const playerName = o['N'];
    const rpt = o['RPT'] || 0;
    const level = o['L'] || 0;
    const legendaryLevel = o['LL'] || 0;
    const honor = o['H'] || 0;
    const targetDateISO = new Date(Date.now() + rpt * 1000).toISOString();
    let ap = o['AP'] || null;
    if (ap && ap.length > 0) {
      ap = o['AP'].filter((entry: number[]) => entry[0] === 0).map((entry: any[]) => [entry[2], entry[3], entry[4]]);
    }
    if (!ap) ap = null;

    await this.addPlayerInDatabase({
      playerId: id,
      playerName,
      allianceId,
      allianceName,
      might_current,
      might_all_time: null,
      loot_current,
      loot_all_time: null,
      castles: ap,
    });

    const pgQuery = `
      UPDATE players
      SET
        might_current = $1,
        loot_current = $2,
        might_all_time = GREATEST(COALESCE(might_all_time, 0), $3),
        loot_all_time = GREATEST(COALESCE(loot_all_time, 0), $4),
        castles = $5,
        honor = $6,
        max_honor = GREATEST(COALESCE(max_honor, 0), $7),
        remaining_peace_time = $8,
        level = GREATEST(COALESCE(level, 0), $9),
        legendary_level = GREATEST(COALESCE(legendary_level, 0), $10),
        peace_disabled_at = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
    `;
    await this.pgSqlQuery(pgQuery, [
      might_current,
      loot_current,
      might_current,
      loot_current,
      JSON.stringify(ap),
      honor,
      honor,
      rpt,
      level,
      legendaryLevel,
      targetDateISO,
      id,
    ]);
  }

  private async updateInactivePlayers(): Promise<void> {
    try {
      if (Object.keys(this.playerLootAndMightPointHistoryList).length < 100) {
        Utils.logMessage(' [-1] Not enough players to update inactive players');
        return;
      } else if (this.DB_UPDATES.criticalErrors > 0) {
        Utils.logMessage(' [KO] There are critical errors, stopping the process updateInactivePlayers');
        return;
      }

      Utils.logMessage(' Database connection successful');
      const pgPoolForIn1 = this.server === 'IN1' ? 'AND might_current > 35' : '';
      const pgSqlQuery = `
        SELECT id
        FROM players
        WHERE updated_at < NOW() - INTERVAL '24 hours'
        AND castles IS NOT NULL
        ${pgPoolForIn1}
      `;
      const result = await this.pgSqlQuery(pgSqlQuery);
      const ids = result.rows.map((row: { id: any }) => row.id);
      Utils.logMessage('Number of inactive players to update:', ids.length);
      for (const id of ids) {
        await this.refreshInactivePlayer(id);
      }
    } catch (error) {
      Utils.logCritical('100', error, 'Error updating inactive players');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async updateServerStatistics(): Promise<void> {
    try {
      if (
        this.DB_UPDATES.criticalErrors > 0 ||
        !this.playerLootAndMightPointHistoryList ||
        Object.keys(this.playerLootAndMightPointHistoryList).length === 0
      ) {
        this.DB_UPDATES.criticalErrors++;
        Utils.logMessage('There are critical errors or no player data, stopping the process updateServerStatistics');
        return;
      }
      Utils.logMessage(' Connection to the database successful');
      const query = `SELECT * FROM server_statistics ORDER BY created_at DESC LIMIT 1`;
      const result = await this.pgSqlQuery(query);
      const lastStats = result.rows[0];
      const playerLootAndMightPointHistoryListWithMoreThanOneCastle = Object.fromEntries(
        Object.entries(this.playerLootAndMightPointHistoryList).filter(
          ([, val]) => val[4] && val[4].length > 0 && (!val[6] || val[6] < 60 * 60 * 24 * 63),
        ),
      );
      const playersCount = Object.keys(playerLootAndMightPointHistoryListWithMoreThanOneCastle).length;
      const playerLootMightEntries: [number, any[]][] = Object.entries(
        playerLootAndMightPointHistoryListWithMoreThanOneCastle,
      ).map(([key, val]) => [Number(key), val]);
      const playerEventValues = Object.values(this.playerEventPointHistoryList);
      const avgMight = (
        playerLootMightEntries.reduce((acc, [, val]) => Number(acc ?? 0) + Number(val[1] ?? 0), 0) / playersCount
      ).toFixed(8);
      const avgLoot = (
        playerLootMightEntries.reduce((acc, [, val]) => Number(acc ?? 0) + Number(val[0] ?? 0), 0) / playersCount
      ).toFixed(8);
      const avgHonor = (
        playerLootMightEntries.reduce((acc, [, val]) => Number(acc ?? 0) + Number(val[5] ?? 0), 0) / playersCount
      ).toFixed(8);
      const avgLevel = (
        playerLootMightEntries.reduce(
          (acc, [, val]) => Number(acc ?? 0) + Number(val[8] ?? 0) + Number(val[9] ?? 0),
          0,
        ) / playersCount
      ).toFixed(8);
      const alliancesCount = new Set(
        playerLootMightEntries.map(([, val]) => val[2]).filter((id) => id !== undefined && id !== -1),
      ).size;
      this.customPlayersAttributesList['alliances_count'] = alliancesCount;
      // We get the number of players who are in protection and who are not new players (level >= 11)
      const playersInPeace = playerLootMightEntries.filter(
        ([, val]) => val[6] && val[6] > 0 && val[6] < 60 * 60 * 24 * 63 && val[8] && val[8] >= 11,
      ).length;
      const playersWhoChangedAlliance = this.customPlayersAttributesList['player_alliance_update_count'] || 0;
      const playersWhoChangedName = this.customPlayersAttributesList['player_name_update_count'] || 0;
      const totalMight = playerLootMightEntries.reduce((acc, [, val]) => Number(acc ?? 0) + Number(val[1] ?? 0), 0);
      const totalLoot = playerLootMightEntries.reduce((acc, [, val]) => Number(acc ?? 0) + Number(val[0] ?? 0), 0);
      const totalHonor = playerLootMightEntries.reduce((acc, [, val]) => Number(acc ?? 0) + Number(val[5] ?? 0), 0);
      // Might
      const maxMightEntry = playerLootMightEntries
        .filter(
          ([, val]) =>
            val?.[1] !== undefined && val[1] !== null && !Number.isNaN(Number(val[1])) && Number(val[1]) >= 0,
        )
        .reduce<
          [number, any[]]
        >((maxEntry, currentEntry) => (Number(currentEntry[1][1]) > Number(maxEntry[1][1]) ? currentEntry : maxEntry), [0, [0,
              0]]);
      const maxMight = Number(maxMightEntry[1][1]);
      const maxMightPlayerId = maxMightEntry[0] || null;
      // Loot
      const maxLootEntry = playerLootMightEntries
        .filter(
          ([, val]) => val[0] !== undefined && val[0] !== null && !Number.isNaN(Number(val[0])) && Number(val[0]) >= 0,
        )
        .reduce<
          [number, any[]]
        >((maxEntry, currentEntry) => (Number(currentEntry[1][0]) > Number(maxEntry[1][0]) ? currentEntry : maxEntry), [0, [0,
              0]]);
      const maxLoot = Number(maxLootEntry[1][0]);
      const maxLootPlayerId = maxLootEntry[0] || null;
      const variationMight = totalMight - (lastStats ? lastStats.total_might : 0);
      const variationLoot = totalLoot - (lastStats ? lastStats.total_loot : 0);
      const variationHonor = totalHonor - (lastStats ? lastStats.total_honor : 0);
      const alliancesChangedName = this.customPlayersAttributesList['alliance_name_update_count'] || 0;
      const LtEventsSet = new Set(playerEventValues.flatMap((event) => Object.keys(event)));
      const eventsCount = LtEventsSet.size;
      const eventsTop3Names: Record<string, { id: string; point: number }[]> = {};
      for (const event of LtEventsSet) {
        const eventPlayers: { id: string; point: number | null }[] = Object.entries(this.playerEventPointHistoryList)
          .map(([playerId, events]) => ({ id: playerId, point: events[event] ?? null }))
          .filter((player) => player.point !== null)
          .sort((a, b) => (b.point ?? 0) - (a.point ?? 0));
        const p: { id: string; point: number }[] = eventPlayers.slice(0, 3).map((player) => ({
          id: player.id,
          point: player.point ?? 0,
        }));
        eventsTop3Names[event] = p;
      }
      const eventsParticipationRate: Record<string, [number, number]> = {};
      for (const event of LtEventsSet) {
        const eventPlayers = Object.entries(this.playerEventPointHistoryList)
          .map(([playerId, events]) => ({ id: playerId, point: events[event] ?? null }))
          .filter((player) => player.point !== null && player.point > 0);
        eventsParticipationRate[event] = [eventPlayers.length, eventPlayers.length / playersCount];
      }
      const eventNomadPoints = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.nomad] || 0),
        0,
      );
      const eventWarRealmsPoints = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.war_realms] || 0),
        0,
      );
      const eventBloodcrowPoints = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.bloodcrow] || 0),
        0,
      );
      const eventSamuraiPoints = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.samurai] || 0),
        0,
      );
      //const eventBerimondInvasionPoints = Object.values(this.playerEventPointHistoryList).reduce((acc, val) => acc + (val[this.ENV_LT.berimondInvasion] || 0), 0);
      const eventBerimondKingdomPoints = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.berimondKingdom] || 0),
        0,
      );
      const eventNomadPlayers = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.nomad] ? 1 : 0),
        0,
      );
      const eventWarRealmsPlayers = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.war_realms] ? 1 : 0),
        0,
      );
      const eventBloodcrowPlayers = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.bloodcrow] ? 1 : 0),
        0,
      );
      const eventSamuraiPlayers = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.samurai] ? 1 : 0),
        0,
      );
      //const eventBerimondInvasionPlayers = Object.values(this.playerEventPointHistoryList).reduce((acc, val) => acc + (val[this.ENV_LT.berimondInvasion] ? 1 : 0), 0);
      const eventBerimondKingdomPlayers = playerEventValues.reduce(
        (acc, val) => Number(acc ?? 0) + (val[this.ENV_LT.berimondKingdom] ? 1 : 0),
        0,
      );
      // SQL Query
      const pgServerStatsQuery = `
        INSERT INTO server_statistics (
          avg_might,
          avg_loot,
          avg_honor,
          avg_level,
          players_count,
          alliance_count,
          players_in_peace,
          players_who_changed_alliance,
          players_who_changed_name,
          total_might,
          total_loot,
          total_honor,
          variation_might,
          variation_loot,
          variation_honor,
          alliances_changed_name,
          events_count,
          events_top_3_names,
          events_participation_rate,
          event_nomad_points,
          event_war_realms_points,
          event_bloodcrow_points,
          event_samurai_points,
          event_berimond_kingdom_points,
          event_nomad_players,
          event_war_realms_players,
          event_bloodcrow_players,
          event_samurai_players,
          event_berimond_kingdom_players,
          max_might,
          max_loot,
          max_might_player_id,
          max_loot_player_id
        )
        VALUES ($1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27, $28,
          $29, $30, $31, $32,
          $33)
        `;
      const params = [
        avgMight,
        avgLoot,
        avgHonor,
        avgLevel,
        playersCount,
        alliancesCount,
        playersInPeace,
        playersWhoChangedAlliance,
        playersWhoChangedName,
        totalMight,
        totalLoot,
        totalHonor,
        variationMight,
        variationLoot,
        variationHonor,
        alliancesChangedName,
        eventsCount,
        JSON.stringify(eventsTop3Names),
        JSON.stringify(eventsParticipationRate),
        eventNomadPoints,
        eventWarRealmsPoints,
        eventBloodcrowPoints,
        eventSamuraiPoints,
        eventBerimondKingdomPoints,
        eventNomadPlayers,
        eventWarRealmsPlayers,
        eventBloodcrowPlayers,
        eventSamuraiPlayers,
        eventBerimondKingdomPlayers,
        maxMight || 0,
        maxLoot || 0,
        maxMightPlayerId || null,
        maxLootPlayerId || null,
      ];
      Utils.logMessage('[debug] Server statistics params:', params);
      Utils.logMessage('maxMightPlayerId:', maxMightPlayerId);
      Utils.logMessage('maxLootPlayerId:', maxLootPlayerId);
      Utils.logMessage('[end debug] Server statistics params');
      //await this.connection.execute(ServerStatsQuery, params);
      await this.pgSqlQuery(pgServerStatsQuery, params);
      Utils.logMessage('PostgreSQL: Updating server statistics...');
    } catch (error) {
      Utils.logCritical('103', error, 'Error updating server statistics');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private getCastleMovements(
    playerId: number,
    parsedCurrentCastles: Castle[],
    parsedNewCastles: Castle[],
  ): CastleMovement[] {
    if (!parsedCurrentCastles || parsedCurrentCastles.length === 0) {
      parsedCurrentCastles = [];
    }
    if (!parsedNewCastles || parsedNewCastles.length === 0) {
      parsedNewCastles = [];
    }
    const currentCastlesMap = new Map(parsedCurrentCastles.map((c) => [`${c[0]},${c[1]},${c[2]}`, c]));
    const newCastlesMap = new Map(parsedNewCastles.map((c) => [`${c[0]},${c[1]},${c[2]}`, c]));
    const mainCastleMove = this.detectMainCastleMove(playerId, parsedCurrentCastles, parsedNewCastles);
    const mainCastleMoved = mainCastleMove !== null;

    const removals: CastleMovement[] = [];
    for (const [key, castle] of currentCastlesMap) {
      const [xOld, yOld, type] = castle;
      if (type === 1 && mainCastleMoved) continue;
      if (newCastlesMap.has(key) || parsedNewCastles.some((c) => c[2] === type)) continue;
      removals.push({
        player_id: playerId,
        castle_type: type,
        movement_type: 'remove',
        position_x_old: xOld,
        position_y_old: yOld,
      });
    }

    const additions: CastleMovement[] = [];
    for (const [key, castle] of newCastlesMap) {
      const [xNew, yNew, type] = castle;
      if (type === 1 && mainCastleMoved) continue;
      if (currentCastlesMap.has(key)) continue;
      additions.push({
        player_id: playerId,
        castle_type: type,
        movement_type: 'add',
        position_x_new: xNew,
        position_y_new: yNew,
      });
    }

    return [...(mainCastleMove ? [mainCastleMove] : []), ...removals, ...additions];
  }

  private detectMainCastleMove(
    playerId: number,
    parsedCurrentCastles: Castle[],
    parsedNewCastles: Castle[],
  ): CastleMovement | null {
    const currentMainCastle = parsedCurrentCastles.find((c) => c[2] === 1);
    const newMainCastle = parsedNewCastles.find((c) => c[2] === 1);
    if (!currentMainCastle || !newMainCastle) return null;
    const [xOld, yOld] = currentMainCastle;
    const [xNew, yNew] = newMainCastle;
    if (xOld === xNew && yOld === yNew) return null;
    return {
      player_id: playerId,
      castle_type: 1,
      movement_type: 'move',
      position_x_old: xOld,
      position_y_old: yOld,
      position_x_new: xNew,
      position_y_new: yNew,
    };
  }

  private async updatePlayerCastles(
    playerId: number,
    parsedCurrentCastles: Castle[],
    parsedNewCastles: Castle[],
  ): Promise<void> {
    const movements = this.getCastleMovements(playerId, parsedCurrentCastles, parsedNewCastles);
    if (movements.length > 0) {
      Utils.logMessage('Castle movements detected for player', playerId, ':', movements);
      await this.insertMovements(movements);
    }
  }

  private async insertMovements(movements: CastleMovement[]): Promise<void> {
    const pgQuery = `
      INSERT INTO player_castle_movements_history (player_id, castle_type, movement_type, position_x_old, position_y_old, position_x_new, position_y_new)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    try {
      for (const move of movements) {
        await this.pgSqlQuery(pgQuery, [
          move.player_id,
          move.castle_type,
          move.movement_type,
          move.position_x_old || null,
          move.position_y_old || null,
          move.position_x_new || null,
          move.position_y_new || null,
        ]);
      }
    } catch (error) {
      Utils.logCritical('104', error, 'Error inserting castle movements');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async getDatabasePlayers(): Promise<{ players: PlayerDatabase[]; alliances: AllianceDatabase[] }> {
    if (this.DB_UPDATES.criticalErrors > 0) {
      Utils.logMessage(' [KO] There are critical errors, stopping the process getDatabasePlayers');
      return { players: [], alliances: [] };
    }
    Utils.logMessage('Database connection successful');
    const pgQuery = `
      SELECT
        P.id as player_id,
        P.alliance_id,
        P.name AS player_name,
        P.castles,
        A.name AS alliance_name,
        A.is_searching_alliance,
        A.auto_join_enabled,
        A.is_island_king,
        A.language,
        A.description
      FROM players P
      LEFT JOIN alliances A
      ON P.alliance_id = A.id
    `;

    const result = await this.pgSqlQuery(pgQuery);
    const rows = result.rows;

    const players: PlayerDatabase[] = [];
    const alliancesMap = new Map<number, AllianceDatabase>();

    rows.forEach((row: any) => {
      // Player
      players.push({
        playerId: row.player_id,
        allianceId: row.alliance_id,
        playerName: row.player_name,
        allianceName: row.alliance_name,
        castles: row.castles ?? [],
      });

      // Alliance
      if (row.alliance_id !== null && !alliancesMap.has(row.alliance_id)) {
        alliancesMap.set(row.alliance_id, {
          allianceId: row.alliance_id,
          is_searching_alliance: row.is_searching_alliance,
          auto_join_enabled: row.auto_join_enabled,
          language: row.language,
          description: row.description,
          is_island_king: row.is_island_king,
        });
      }
    });
    const alliances = Array.from(alliancesMap.values());
    return { players, alliances };
  }

  private async clearParameters(): Promise<void> {
    //  We clear all parameters in the database
    Utils.logMessage('Database connection successful');
    const pgQuery = `
      UPDATE parameters
      SET value = NULL
    `;
    await this.pgSqlQuery(pgQuery);
  }

  /**
   * Records a parameter whose row is not part of the seeded set, creating it on first run
   */
  private async upsertParameter(identifier: string, value: number): Promise<void> {
    const pgQuery = `
      INSERT INTO parameters (id, identifier, value, updated_at)
      SELECT COALESCE(MAX(id), 0) + 1, $1, $2, NOW() FROM parameters
      ON CONFLICT (identifier)
      DO UPDATE SET value = EXCLUDED.value,
        updated_at = NOW()
    `;
    await this.pgSqlQuery(pgQuery, [identifier, value]);
  }

  private async updateParameter(identifier: string, value: number): Promise<void> {
    const pgQuery = `
      UPDATE parameters
      SET value = $1,
        updated_at = NOW()
      WHERE identifier = $2
    `;
    await this.pgSqlQuery(pgQuery, [value, identifier]);
  }

  private async executeCustomEventHistory(
    eventName: 'Beyond the Horizon' | 'Outer Realms',
    tableEventName: string,
    tableEventHistoryName: string,
    lt: number,
    increment: number = 10,
    levelCategory: number = 6,
    dryRunInsert: boolean = false,
  ): Promise<number> {
    try {
      Utils.logMessage(' Executing custom event history for', eventName);
      if (!this.PGSQL_CONFIG) {
        Utils.logMessage(' [KO] No database connection, stopping the process executeCustomEventHistory');
        return -1;
      }
      const start = Date.now();
      const pgQuery = `
        SELECT event_num, player_name, level, point, rank
        FROM ${tableEventHistoryName}
        WHERE event_num = (
          SELECT MAX(event_num)
          FROM ${tableEventHistoryName}
        )
        ORDER BY point DESC
        LIMIT 10
      `;
      const result = await this.pgSqlQuery(pgQuery);
      const lastEventNum = result.rows.length > 0 ? result.rows[0].event_num : 0;
      const eventNum = lastEventNum + 1;
      const startSV = Math.ceil(increment / 2);

      const data = await this.fetchCustomEventHeader(lt, levelCategory, startSV);
      if (!data) return -1;

      const max = data?.content?.LR ?? 50000;
      if (!max || Number(max) < 0 || !data?.content?.L) {
        Utils.logMessage(' [info] No data found for event ' + eventName);
        return -1;
      }
      const content = data.content.L;
      if ((await this.checkEventAlreadyExists(content, result.rows, 'trace')) && !dryRunInsert) {
        Utils.logMessage(' [info] No new event to fill');
        return -1;
      }
      Utils.logMessage(' [info] New event to fill');
      if (!dryRunInsert) {
        await this.pgSqlQuery(
          `
              INSERT INTO ${tableEventName} (event_num, collect_date, fr, igh, top1_player_id, top1_player_score)
              VALUES ($1, $2, $3, $4, $5, $6)
            `,
          [eventNum, new Date(), data?.content?.FR, data?.content?.IGH, content[0][2]['OID'], content[0][1]],
        );
      }

      const entities: Record<string, any> = {};
      const playersFound = await this.scanCustomEventPages(
        lt,
        levelCategory,
        increment,
        startSV,
        max,
        eventName,
        entities,
      );
      if (playersFound === null) return -1;
      Utils.logMessage(' [info] Total players found for the event of ' + eventName + ': ' + playersFound);

      const entries = Object.entries(entities);
      if (!dryRunInsert) await this.resolveRealPlayerIds(entries);

      Utils.logMessage(' [info] Insertion of players into the database for event ' + eventName);
      const invalidPlayerIdCount = await this.insertCustomEventRows(
        tableEventHistoryName,
        entries,
        eventNum,
        dryRunInsert,
      );

      if (!dryRunInsert) {
        Utils.logMessage(' [info] Insertion of event data for ' + eventName + ' completed successfully');
        await this.logToLoki({
          job: 'event-history-scraper-' + eventName.toLowerCase().replace(/\s/g, '-'),
          level: 'info',
          data: {
            playersAdded: entries.length,
            invalidPlayerIds: invalidPlayerIdCount,
            eventNum: eventNum,
            durationMs: Date.now() - start,
          },
        });
      }
      await this.notifyCustomEventOnDiscord(eventName, entities, entries.length, eventNum);
      return 0;
    } catch (error) {
      Utils.logCritical('099', error, 'Error while filling event history for ' + eventName);
      this.DB_UPDATES.criticalErrors++;
      return -1;
    }
  }

  private async fetchCustomEventHeader(lt: number, levelCategory: number, sv: number): Promise<any | null> {
    let data = await this.fetchDataAndReturn(lt, levelCategory, sv);
    if (data?.['return_code'] != '0') {
      if (sv < 10) {
        Utils.logMessage(' [info] Invalid event');
        return null;
      }
      const attempts = 3;
      let k = 0;
      while (k < attempts && data?.['return_code'] != '0') {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        data = await this.fetchDataAndReturn(lt, levelCategory, sv);
        k++;
      }
    }
    if (data?.['return_code'] != '0' || !data?.content?.LR) {
      Utils.logMessage(' [info] Invalid event');
      return null;
    }
    return data;
  }

  private async scanCustomEventPages(
    lt: number,
    levelCategory: number,
    increment: number,
    startSV: number,
    max: number,
    eventName: string,
    entities: Record<string, any>,
  ): Promise<number | null> {
    let i = startSV;
    let j = 0;
    let c = true;
    while (c) {
      const { response, players } = await this.fetchRankingPage(lt, levelCategory, i, 7, 2000);
      if (!players || players.length === 0) {
        Utils.logMessage('Url :', this.rankingPageUrl(lt, levelCategory, i));
        Utils.logMessage('Nb:', j + 'players found on', max);
        Utils.logMessage('p:', JSON.stringify(response));
        Utils.logCritical('002-' + eventName, undefined, String.raw`/!\ No players found, but status OK`);
        this.DB_UPDATES.criticalErrors++;
        return null;
      }
      const ids: number[] = [];
      for (const singleData of players) {
        if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
        try {
          ids.push(singleData[0]);
          const playerId = singleData[2]['OID'];
          const parts = String(singleData[2]['N']).split('_');
          entities[playerId.toString()] = {
            rank: singleData[0],
            playerId: playerId,
            playerName: parts.slice(0, -1).join('_'),
            point: singleData[1],
            server: parts.at(-1),
            level: singleData[2]['L'],
            legendaryLevel: singleData[2]['LL'],
            allianceName: singleData[2]['AN'] || null,
          };
        } catch (error) {
          Utils.logMessage(' [error] Migration error:', JSON.stringify(singleData));
          console.error(error);
          this.DB_UPDATES.criticalErrors++;
        }
        j++;
      }
      i += increment;
      if (j >= max || ids.includes(max)) {
        Utils.logMessage(
          ' [info] End of search for category',
          levelCategory + ', ' + j + 'players found on',
          max + 'for',
          eventName,
        );
        c = false;
      }
      if (j % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    return j;
  }

  private async resolveRealPlayerIds(entries: [string, any][]): Promise<void> {
    const serverEntities = new Map<string, any[]>();
    for (const [, entity] of entries) {
      if (!serverEntities.has(entity.server)) {
        serverEntities.set(entity.server, []);
      }
      serverEntities.get(entity.server)?.push(entity);
    }
    for (const [server, entitiesForServer] of serverEntities.entries()) {
      Utils.logMessage(' [info] Processing server:', server);
      await this.attachRealPlayerIds(server, entitiesForServer);
    }
  }

  private async attachRealPlayerIds(server: string, entitiesForServer: any[]): Promise<void> {
    if (!this.PGSQL_CONFIG) return;
    let dbConn: pg.Pool | null = server === 'FR1' ? this.getPool() : null;
    let tempPool: pg.Pool | null = null;
    try {
      if (!dbConn) {
        const dbName = GenericFetchAndSaveBackend.eventServerDatabaseName(server);
        const exists = await this.pgSqlQuery('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
        if (!exists.rowCount) return;
        tempPool = new pg.Pool({
          user: this.PGSQL_CONFIG.user,
          password: this.PGSQL_CONFIG.password,
          host: this.PGSQL_CONFIG.host,
          port: this.PGSQL_CONFIG.port,
          database: dbName,
          max: 1,
          idleTimeoutMillis: 10_000,
          connectionTimeoutMillis: 15_000,
          allowExitOnIdle: true,
        });
        dbConn = tempPool;
        Utils.logMessage(' [info] Connected to database for server:', server);
      }
      const names = entitiesForServer.map((e: { playerName: any }) => e.playerName);
      Utils.logMessage(' [info] Count: ' + names.length + ' players to process for server ' + server);
      const res = await dbConn.query(
        `SELECT n AS name, MIN(p.id) AS id FROM unnest($1::text[]) n LEFT JOIN players p ON p.name = n GROUP BY n;`,
        [names],
      );
      Utils.logMessage(' [info] Retrieval of real player_ids completed');
      const nameToId = new Map(res.rows.map((r) => [r.name, r.id]));
      Utils.logMessage(' [info] Number of real player_ids retrieved:', nameToId.size);
      for (const entity of entitiesForServer) {
        entity.realPlayerId = nameToId.get(entity.playerName);
      }
    } finally {
      if (tempPool) {
        await tempPool.end().catch((error) => {
          Utils.logMessage(' [WARN] Error closing temporary PostgreSQL pool for ' + server + ':', error);
        });
      }
    }
  }

  private async insertCustomEventRows(
    tableEventHistoryName: string,
    entries: [string, any][],
    eventNum: number,
    dryRunInsert: boolean,
  ): Promise<number> {
    const batchSize = 3000;
    let invalidPlayerIdCount = 0;
    for (let i = 0; i < entries.length; i += batchSize) {
      const chunk = entries.slice(i, i + batchSize);
      const insertValues: any[] = [];
      const valuesPlaceholders: string[] = [];
      let paramIndex = 1;
      for (const [playerId, entity] of chunk) {
        if (Number.isNaN(Number(playerId))) {
          Utils.logMessage(' [info] Invalid player ID:', playerId);
          invalidPlayerIdCount++;
          continue;
        }
        const { server, level, legendaryLevel, point, rank, realPlayerId, playerName, allianceName } = entity;
        valuesPlaceholders.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8})`,
        );
        insertValues.push(eventNum, realPlayerId, server, level, legendaryLevel, point, rank, playerName, allianceName);
        paramIndex += 9;
      }
      if (!dryRunInsert && insertValues.length > 0) {
        const insertQuery = `
                INSERT INTO ${tableEventHistoryName}
                  (event_num, player_id, server, level, legendary_level, point, rank, player_name, alliance_name)
                VALUES
                  ${valuesPlaceholders.join(',\n')}
              `;
        Utils.logMessage(
          ` [info] Insertion of batch of ${insertValues.length / 9} players (batch ${Math.floor(i / batchSize) + 1})`,
        );
        await this.pgSqlQuery(insertQuery, insertValues);
      }
    }
    return invalidPlayerIdCount;
  }

  private async notifyCustomEventOnDiscord(
    eventName: 'Beyond the Horizon' | 'Outer Realms',
    entities: Record<string, any>,
    playersCount: number,
    eventNum: number,
  ): Promise<void> {
    try {
      const top10Players = Object.values(entities)
        .sort((a, b) => b.point - a.point)
        .slice(0, 10);
      const discordMessage = this.getDiscordApiMessageBody(eventName, playersCount, eventNum, top10Players);
      await this.sendDiscordNotification(discordMessage);
    } catch (error) {
      Utils.logMessage('Error while sending Discord notification for event ' + eventName);
      Utils.logMessage(error);
    }
  }

  private async checkEventAlreadyExists(
    fetchedData: any[],
    existingEntries: { event_num: number; player_name: string; level: number; point: number; rank: number }[],
    logLevel: string,
  ): Promise<boolean> {
    const existingSet = new Set(
      existingEntries.map((entry) => `${entry.player_name}|${entry.level}|${entry.point}|${entry.rank}`),
    );
    if (logLevel === 'trace')
      Utils.logMessage(' [trace] Existing entries:', JSON.stringify(Array.from(existingSet).slice(0, 10)));
    for (const entry of fetchedData) {
      const playerName = entry[2]['N'].split('_').slice(0, -1).join('_');
      const level = entry[2]['L'];
      const point = entry[1];
      const rank = entry[0];
      const key = `${playerName}|${level}|${point}|${rank}`;
      if (logLevel === 'trace') Utils.logMessage(' [trace] Checking entry:', key);
      if (!existingSet.has(key)) {
        if (logLevel === 'trace') {
          Utils.logMessage(` [trace] Entry not found in existing records: ${key}`);
        }
        return false; // Found a non-matching entry
      }
    }
    if (logLevel === 'trace') Utils.logMessage(' [trace] All entries match existing records');
    return true; // All entries match
  }

  private isTransientPgError(error: any): boolean {
    const message = String(error?.message ?? '');
    return GenericFetchAndSaveBackend.PG_TRANSIENT_ERRORS.some((pattern) => message.includes(pattern));
  }

  private async pgSqlQuery(query: string, params: any[] = [], attempts: number = 3): Promise<any> {
    let lastError: any;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.getPool().query(query, params);
      } catch (error: any) {
        lastError = error;
        if (!this.isTransientPgError(error) || attempt === attempts) {
          break;
        }
        const delayMs = 5000 * attempt;
        Utils.logMessage(
          ` [WARN] Transient PostgreSQL error (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms:`,
          error.message,
        );
        await this.sleep(delayMs);
      }
    }
    if (this.isTransientPgError(lastError)) {
      Utils.logCritical('999', lastError, ' [CRITICAL] PostgreSQL query failed after all retries');
      this.DB_UPDATES.criticalErrors++;
    }
    throw lastError;
  }

  private generateTraceId(): string {
    return crypto.randomUUID().replace(/-/g, '');
  }

  private generateSpanId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }

  private formatAttribute(value: any): {
    stringValue?: string;
    intValue?: number;
    doubleValue?: number;
    boolValue?: boolean;
  } {
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return { intValue: value };
      }
      return { doubleValue: value };
    }
    if (typeof value === 'boolean') {
      return { boolValue: value };
    }
    return { stringValue: String(value) };
  }

  private async logToClickHouse({
    server,
    startTime,
    endTime,
    playersCreated = 0,
    alliancesCreated = 0,
    playersAllianceUpdated = 0,
    alliancesUpdated = 0,
    criticalErrors = 0,
    playerCount = 0,
    allianceCount = 0,
  }: {
    server: string;
    startTime: Date;
    endTime: Date;
    playersCreated?: number;
    alliancesCreated?: number;
    playersAllianceUpdated?: number;
    alliancesUpdated?: number;
    criticalErrors?: number;
    playerCount?: number;
    allianceCount?: number;
  }): Promise<void> {
    const durationMs = endTime.getTime() - startTime.getTime();
    try {
      await this.insertRowsClickHouse(
        'logs.scrapes',
        [
          {
            server,
            timestamp: Math.floor(endTime.getTime() / 1000),
            durationMs,
            playersCreated,
            alliancesCreated,
            playersAllianceUpdated,
            alliancesUpdated,
            criticalErrors,
            playerCount,
            allianceCount,
          },
        ],
        { maxAttempts: 2 },
      );
    } catch (err: any) {
      console.error('ClickHouse insert error:', err.message);
    }
  }

  private async logToTempo({
    name = 'scrape',
    server,
    startTime,
    endTime,
    attributes = {},
  }: {
    name?: string;
    server: string;
    startTime: number;
    endTime: number;
    attributes?: Record<string, any>;
  }): Promise<void> {
    let traceId: string;
    let spanId: string;
    let payload: any;
    try {
      traceId = this.generateTraceId();
      spanId = this.generateSpanId();

      payload = {
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'scraper' } }],
            },
            scopeSpans: [
              {
                scope: {
                  name: 'custom-scraper',
                },
                spans: [
                  {
                    traceId,
                    spanId,
                    name,
                    kind: 1,
                    startTimeUnixNano: `${startTime * 1_000_000}`,
                    endTimeUnixNano: `${endTime * 1_000_000}`,
                    attributes: [
                      { key: 'server', value: { stringValue: server } },
                      ...Object.entries(attributes).map(([key, value]) => ({
                        key,
                        value: this.formatAttribute(value),
                      })),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      await axios.post('http://tempo:4318/v1/traces', payload);
    } catch (err: any) {
      console.error('Error sending trace to Tempo:', err.message);
      console.error('Payload was:', JSON.stringify(payload));
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  private async logToLoki({
    data,
    level = 'info',
    job = 'cron-scraper',
  }: {
    data: Record<string, any>;
    level?: 'debug' | 'info' | 'warn' | 'error';
    job?: string;
  }): Promise<void> {
    const logEntry = {
      ...data,
      ts: new Date().toISOString(),
    };
    const payload = {
      streams: [
        {
          stream: {
            job,
            level,
          },
          values: [[`${Date.now()}000000`, JSON.stringify(logEntry)]],
        },
      ],
    };
    try {
      await axios.post('http://loki:3100/loki/api/v1/push', payload);
    } catch (err: any) {
      console.error('Error sending log to Loki:', err.message);
    }
  }

  private async stackTraceError(identifier: string, error: string | string[], criticalError = false): Promise<void> {
    if (Array.isArray(error)) {
      error.forEach((err) => Utils.logMessage(err));
    }
    Utils.logCritical('' + identifier, error);
    if (criticalError) this.DB_UPDATES.criticalErrors++;
  }
}
