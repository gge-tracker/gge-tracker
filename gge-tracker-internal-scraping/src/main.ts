//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//
import axios, { AxiosResponse } from 'axios';
import { ClickHouse } from 'clickhouse';
import { format } from 'date-fns';
import * as mysql from 'mysql2/promise';
import { RowDataPacket } from 'mysql2/promise';
import pLimit from 'p-limit';
import * as pg from 'pg';
import { exit } from 'process';
import { createClient } from 'redis';
import { HIGHSCORES_CONFIG } from './definitions/highest_scores.config';
import { SWAP_RANK_POINTS_TABLE } from './definitions/swap-rank-points.config';
import { Castle, CastleMovement, DungeonMap, HighScoreKey, PlayerDatabase } from './interfaces';
import Utils from './utils';

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
  public playerRenamedList: { [key: string]: any } = {};
  public allianceRenamedList: { [key: string]: any } = {};
  public DB_UPDATES = {
    alliancesCreated: 0,
    playersCreated: 0,
    playersAllianceUpdated: 0,
    alliancesUpdated: 0,
    criticalErrors: 0,
  };
  public allianceUpdated: { [key: string]: boolean } = {};
  private readonly WEBHOOK_URL: string = process.env.WEBHOOK_URL || '';
  private readonly CURRENT_ENV: string = process.env.ENVIRONMENT || 'development';
  private readonly MAP_SIZE = 1286;
  private BASE_API_URL: string;
  private DATABASE_CONFIG: mysql.PoolOptions | null;
  private CLICKHOUSE_CONFIG: { [key: string]: string | number | undefined } | undefined;
  private PGSQL_CONFIG: pg.PoolConfig;
  private server: string;
  private playerLootAndMightPointHistoryList: { [key: string]: any[] } = {};
  private playerEventPointHistoryList: { [key: string]: { [key: string]: number | null } } = {};
  private customPlayersAttributesList: { [key: string]: any } = {};
  private connection: mysql.Pool;
  private pgSqlConnection: pg.Pool;
  private currentPlayers: PlayerDatabase[] = [];
  private isE4KServer: boolean = false;
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
    DATABASE_CONFIG: mysql.PoolOptions | null,
    CLICKHOUSE_CONFIG: { [key: string]: string | number | undefined } | null,
    PGSQL_CONFIG: pg.PoolConfig,
    server: string,
  ) {
    this.BASE_API_URL = BASE_API_URL;
    this.DATABASE_CONFIG = DATABASE_CONFIG;
    this.CLICKHOUSE_CONFIG = CLICKHOUSE_CONFIG ? CLICKHOUSE_CONFIG : undefined;
    this.PGSQL_CONFIG = PGSQL_CONFIG;
    this.server = server;
    this.isE4KServer = String(server).toLowerCase().startsWith('e4k');
    this.createNewPool();
  }

  public async sleep(numberMs: number = 1500): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, numberMs));
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
      await this.genericFetchData('qsc', { QID: 3490 });
      await this.genericFetchData('dcl', { CD: 1 });
      const responseTsh = await this.genericFetchData('tsh', null);
      if (!responseTsh.data.content) {
        Utils.logMessage(' No content received from tsh endpoint. Aborting Outer Realms entry.');
        Utils.logMessage('Content received:', JSON.stringify(responseTsh.data));
        return null;
      }
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

  public async fillGrandTournamentResults(): Promise<void> {
    const start = new Date();
    try {
      Utils.logMessage('=====================================');
      Utils.logMessage(' Starting global rankings refresh');
      Utils.logMessage(' Current environment:', this.CURRENT_ENV);
      Utils.logMessage('=====================================');
      Utils.logMessage('Refreshing Grand Tournament results...');

      const getLastEventQuery = `
        SELECT event_id, created_at
        FROM grand_tournament
        ORDER BY created_at DESC
        LIMIT 1;
      `;
      const result = await this.pgSqlQuery(getLastEventQuery);
      const lastEvent = result.rows[0];
      let currentEventId: number;
      if (!lastEvent) {
        currentEventId = 1;
      } else {
        const lastDate = new Date(lastEvent.created_at);
        const now = new Date();
        const diffHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
        currentEventId = diffHours > 24 ? lastEvent.event_id + 1 : lastEvent.event_id;
      }
      Utils.logMessage('Current eventId: ', currentEventId);
      const key = 'llsp';
      const lt = 84;
      const maxResult = 1000;
      const levelCategory = 1;
      const maxLevelCategory = 5;
      const alliances = {};
      const dateStr = format(new Date(), 'yyyy-MM-dd HH:mm:ss');
      for (let lc = levelCategory; lc <= maxLevelCategory; lc++) {
        Utils.logMessage(' Processing level category:', lc);
        let subdivisionId = 1;
        let hasMore = true;
        let subDivisionCount = 0;
        while (hasMore && subdivisionId <= 9999) {
          try {
            const url: string = encodeURI(
              this.BASE_API_URL + key + `/"LT":${lt},"LID":${lc},"M":${maxResult},"R":1,"SDI":${subdivisionId}`,
            );
            let response;
            let tryCount = 0;
            while (tryCount < 3) {
              try {
                response = await axios.get(url);
                if (response.data.content && response.data.content.L) {
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
            const data = response.data;
            if (data.content && data.content.L) {
              const results = data.content.L || [];
              for (const result of results) {
                const SIelements = String(result.SI).trim().split('-');
                const allianceId = Number.parseInt(String(SIelements[SIelements.length - 1]));
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
            } else {
              hasMore = false;
            }
            subdivisionId++;
            subDivisionCount++;
          } catch (error) {
            console.error('=====================================');
            console.error('[Error] ', error.message);
            console.error('=====================================');
            hasMore = false;
          }
        }
        Utils.logMessage(' Total subdivisions processed for level category', lc + ':', subDivisionCount);
      }
      const insertValues: any[] = Object.values(alliances);
      Utils.logMessage('Inserting ', insertValues.length, 'records into the database...');
      if (insertValues.length > 0) {
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
            Utils.logMessage('Error executing query:', error);
            Utils.logMessage('Query text:', queryText);
            Utils.logMessage('Values:', values);
            this.DB_UPDATES.criticalErrors++;
          }
        }
      }
      Utils.logMessage('Grand Tournament results updated successfully');
      // If there is more that 1 record inserted, we increment the redis-fill version
      if (insertValues.length > 1) {
        const redisClient = createClient({
          url: 'redis://redis-server:6379',
        });
        await redisClient.connect();
        await redisClient.incr(`grand-tournament:event-dates:version`);
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
      await this.pgSqlConnection.end();
      Utils.logsAllInFile(this.DB_UPDATES.criticalErrors, this.server);
    } catch (error) {
      Utils.logMessage('Error refreshing Grand Tournament results');
      Utils.logMessage('========= BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 411');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
    await this.pgSqlConnection.end();
    Utils.logsAllInFile(this.DB_UPDATES.criticalErrors, this.server);
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
      Utils.logMessage('Error refreshing global rankings');
      Utils.logMessage('========= BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 100');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
    const end = new Date();
    const duration = end.getTime() - start.getTime();
    const durationInSeconds = Math.floor(duration / 1000);
    Utils.logMessage('Duration of global rankings refresh:', durationInSeconds + ' seconds');
    for (let i = 0; i < 9; i++) {
      Utils.logMessage('.');
    }
    await this.pgSqlConnection.end();
    Utils.logsAllInFile(this.DB_UPDATES.criticalErrors, this.server);
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
   * @param mapSize - The size of the map to scan for dungeons.
   * @returns A Promise that resolves when the dungeon list has been retrieved and stored.
   */
  public async getDungeonsList(worldNumber: number, mapSize: number): Promise<void> {
    const step = 12;
    const dungeonMaps: DungeonMap[] = [];
    const numSteps = Math.ceil(mapSize / (step + 1));
    const totalRequests = numSteps * numSteps;
    let intervalTimer = 0;
    let done = 0;
    const start = new Date();
    for (let yIndex = 0; yIndex < numSteps; yIndex++) {
      const y = yIndex * (step + 1);
      const xRange = yIndex % 2 === 0 ? [...Array(numSteps).keys()] : [...Array(numSteps).keys()].reverse();
      for (const xIndex of xRange) {
        const x = xIndex * (step + 1);
        const AX1 = x;
        const AY1 = y;
        const AX2 = x + step;
        const AY2 = y + step;
        const json = `"KID":${worldNumber},"AX1":${AX1},"AY1":${AY1},"AX2":${AX2},"AY2":${AY2}`;
        const url: string = encodeURI(this.BASE_API_URL + 'gaa/' + json);
        try {
          const response = await axios.get(url);
          const data = response.data;
          if (data && data['return_code'] == '0') {
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
          } else {
            console.error('Invalid response for URL:', url, data);
          }
        } catch (err) {
          console.error('Error on URL:', url, err);
        }
        // Throttle management
        const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
        intervalTimer++;
        if (intervalTimer === 50) {
          await delay(50);
          intervalTimer = 0;
        }
        done++;
        const percent = (done / totalRequests) * 100;
        const barWidth = 40;
        const filled = Math.round(barWidth * (done / totalRequests));
        const bar =
          '[' +
          '█'.repeat(filled) +
          '-'.repeat(barWidth - filled) +
          `] ${percent.toFixed(1)}% (${done}/${totalRequests})`;
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(bar);
      }
    }
    const end = new Date();
    const elapsedTime = end.getTime() - start.getTime();
    const elapsedTimeInSeconds = Math.floor(elapsedTime / 1000);
    const elapsedTimeInMinutes = Math.floor(elapsedTimeInSeconds / 60);
    console.log(
      '\nTime taken to retrieve dungeons:',
      elapsedTimeInSeconds,
      'seconds (',
      elapsedTimeInMinutes,
      'minutes) : ',
      dungeonMaps.length,
      'dungeons found.',
    );
    console.log('Database connection successful');
    const values: any[] = [];
    for (const dungeon of dungeonMaps) {
      const coordinates = dungeon.coordinates;
      const time = dungeon.time;
      const playerId = dungeon.playerId;
      const updatedAt = dungeon.updatedAt;
      values.push(worldNumber, coordinates[0], coordinates[1], time, playerId, 0, updatedAt);
    }
    const placeholders = dungeonMaps.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    await this.connection.execute(
      `INSERT INTO dungeons (kid, position_x, position_y, attack_cooldown, player_id, total_attack_count, updated_at) VALUES ${placeholders}`,
      values,
    );
    console.log('\nDungeons list updated successfully for world', worldNumber, '\n');
  }

  public async fillGenericEventHistory(): Promise<void> {
    const start = new Date();
    Utils.logMessage('Execution of the event history for Outer Realms + BTH');
    try {
      await this.executeCustomEventHistory(
        'Outer Realms',
        'outer_realms_event',
        'outer_realms_ranking',
        this.ENV_LT.outerRealms,
      );
      await this.executeCustomEventHistory(
        'Beyond the Horizon',
        'beyond_the_horizon_event',
        'beyond_the_horizon_ranking',
        this.ENV_LT.beyondTheHorizon,
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
      Utils.logMessage('Error occurred while executing the event history for Outer Realms + Beyond the Horizon');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 101');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    } finally {
      await this.pgSqlConnection.end();
      Utils.logsAllInFile(this.DB_UPDATES.criticalErrors, 'OUTER_REALMS_AND_BEYOND_THE_HORIZON_EVENT_HISTORY');
    }
  }

  public async executeHealthCheck(): Promise<void> {
    try {
      try {
        await this.pgSqlConnection.query('SELECT 1');
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
        const clickhouse = new ClickHouse(this.CLICKHOUSE_CONFIG);
        await clickhouse.query('SELECT 1').toPromise();
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
      Utils.logMessage(' [error] Database connection failed');
      Utils.logMessage('=========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 000');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  public async executeFillInOrder(): Promise<void> {
    const start = new Date();
    try {
      await this.logToLoki(
        JSON.stringify({
          message: 'Starting fill process',
          server: this.server,
          step: 'start',
          timestamp: start.toISOString(),
        }),
        { server: this.server, step: 'start' },
      );
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
      this.currentPlayers = await this.getDatabasePlayers();
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
      return;
    } catch (error) {
      Utils.logMessage(' [CRITICAL] Unhandled error occurred while processing fills');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 999');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
    } finally {
      const end = new Date();
      const durationMs = end.getTime() - start.getTime();
      await this.logToLoki(
        JSON.stringify({
          message: 'End of data filling',
          server: this.server,
          step: 'end',
          criticalErrors: this.DB_UPDATES.criticalErrors,
          alliancesCreated: this.DB_UPDATES.alliancesCreated,
          playersCreated: this.DB_UPDATES.playersCreated,
          playersAllianceUpdated: this.DB_UPDATES.playersAllianceUpdated,
          alliancesUpdated: this.DB_UPDATES.alliancesUpdated,
          durationMs,
          timestamp: end.toISOString(),
        }),
        { server: this.server, step: 'end' },
      );
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
      await this.pgSqlConnection.end();
      Utils.logsAllInFile(criticalErrors, this.server);
    }
  }

  public async updateDungeonsList(): Promise<void> {
    const squares: { [key: string]: { AX1: number; AY1: number; AX2: number; AY2: number } } = {};
    const mapSize = this.MAP_SIZE;
    let done = 0;
    console.log('Connection to the database successful');
    const [rows] = await this.connection.query<RowDataPacket[]>(`
      SELECT kid, position_x, position_y
      FROM dungeons
      WHERE attack_cooldown = 0
      OR TIMESTAMPADD(SECOND, attack_cooldown, updated_at) <= NOW()`);
    const start = new Date();
    const totalRequests = rows.length;
    for (const row of rows) {
      const { kid, position_x, position_y } = row;
      const square = await this.getCorrespondingSquare(position_x, position_y, mapSize);
      if (square) {
        squares[`${kid}-${position_x}-${position_y}`] = square;
        const { AX1, AY1, AX2, AY2 } = square;
        const json = `"KID":${kid},"AX1":${AX1},"AY1":${AY1},"AX2":${AX2},"AY2":${AY2}`;
        const url: string = encodeURI(this.BASE_API_URL + 'gaa/' + json);
        try {
          const response = await axios.get(url);
          const data = response.data;
          if (data && data['return_code'] == '0') {
            const dungeons = data.content?.AI ?? [];
            for (const dungeon of dungeons) {
              if (dungeon[0] == '11') {
                const coordinates = [dungeon[1], dungeon[2]];
                const time = dungeon[5];
                // We calculate the time since the last attack
                const attackedTimeInSeconds = 24 * 60 * 60 - time;
                // We calculate the date of the last attack
                const lastAttackDate = new Date(Date.now() - attackedTimeInSeconds * 1000);
                const playerId = dungeon[6];
                try {
                  // We retrieve the old player_id
                  const [rows] = await this.connection.execute(
                    `SELECT player_id FROM dungeons WHERE kid = ? AND position_x = ? AND position_y = ?`,
                    [kid, coordinates[0], coordinates[1]],
                  );
                  const oldPlayerId = rows[0]?.player_id;
                  if (oldPlayerId !== playerId) {
                    await this.connection.execute(
                      `INSERT INTO dungeon_player_state (kid, position_x, position_y, player_id, last_attack_at)
                      VALUES (?, ?, ?, ?, ?)`,
                      [kid, coordinates[0], coordinates[1], playerId, lastAttackDate],
                    );
                  }
                  await this.connection.execute(
                    `UPDATE dungeons
                    SET attack_cooldown = ?, player_id = ?, updated_at = NOW()
                    WHERE kid = ? AND position_x = ? AND position_y = ?`,
                    [time, playerId, kid, coordinates[0], coordinates[1]],
                  );
                } catch (error) {
                  console.log(error);
                  exit(1);
                }
              }
            }
          } else if (!data['return_code'] || data['return_code'] === '-1') {
            if (this.WEBHOOK_URL) {
              const message = {
                content: 'An error occurred: ' + JSON.stringify(row),
                username: 'Dungeon Fetcher',
              };
              await axios.post(this.WEBHOOK_URL, message);
              console.log('Message sent to Discord webhook');
              exit();
            }
          }
          if (done % 20 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          done++;
          const percent = (done / totalRequests) * 100;
          const barWidth = 40;
          const filled = Math.round(barWidth * (done / totalRequests));
          const bar =
            '[' +
            '█'.repeat(filled) +
            '-'.repeat(barWidth - filled) +
            `] ${percent.toFixed(1)}% (${done}/${totalRequests})`;
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(bar);
        } catch (err) {
          console.error('Error on URL:', url, err);
        }
      }
    }
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
    await this.connection.end();
  }

  public async startOuterRealmsDataFetch(): Promise<void> {
    const start = new Date();
    const type = 'hgh';
    const LID = 1;
    try {
      Utils.logMessage('=====================================');
      Utils.logMessage(' Starting Outer Realms data fetch');
      Utils.logMessage(' Current environment:', this.CURRENT_ENV);
      Utils.logMessage('=====================================');
      let LT: number | null = null;
      let initialResponse: AxiosResponse<any>;
      const ltValues = [
        HIGHSCORES_CONFIG.TEMP_SERVER_DAILY_COLLECTOR_POINTS,
        HIGHSCORES_CONFIG.TEMP_SERVER_DAILY_RANK_SWAP,
        HIGHSCORES_CONFIG.TEMP_SERVER_DAILY_MIGHT_POINTS_BUILDINGS,
      ] as number[];
      const redisClient = createClient({
        url: 'redis://redis-server:6379',
      });
      await redisClient.connect();
      const lastLtValue = await redisClient.get(`outer-realms:last-active-lt:${this.CURRENT_ENV}`);
      if (lastLtValue) {
        initialResponse = await this.genericFetchData(type, { LT: Number(lastLtValue), LID, SV: '1' });
        if (initialResponse.data.return_code == '0' && initialResponse.data.content?.L?.length > 0) {
          LT = Number(lastLtValue);
          Utils.logMessage(` Active Outer Realms event found with last known LT=${LT}. Proceeding with data fetch.`);
        } else {
          Utils.logMessage(` No active Outer Realms event found with last known LT=${lastLtValue}.`);
        }
      }
      if (!LT) {
        for (const ltValue of ltValues) {
          initialResponse = await this.genericFetchData(type, { LT: ltValue, LID, SV: '1' });
          if (initialResponse.data.return_code == '0' && initialResponse.data.content?.L?.length > 0) {
            LT = ltValue;
            Utils.logMessage(` Active Outer Realms event found with LT=${LT}. Proceeding with data fetch.`);
            break;
          } else {
            Utils.logMessage(` No active Outer Realms event found with LT=${ltValue}.`);
          }
        }
      }
      if (LT) {
        if (LT !== Number(lastLtValue)) {
          Utils.logMessage(` Updating last active LT in Redis to ${LT}.`);
          await redisClient.set(`outer-realms:last-active-lt:${this.CURRENT_ENV}`, String(LT));
        }
      } else {
        Utils.logMessage(' No active Outer Realms event found with any known LT code. Aborting data fetch.');
        await redisClient.quit();
        return;
      }
      await redisClient.quit();
      const entriesByPage = initialResponse.data.content?.L?.length || 0;
      const increment = Math.ceil(Number(entriesByPage) / 2);
      let hasMore = true;
      let maxItemLimit = 50000;
      let item = increment;
      let playerEntries = new Map<
        number,
        {
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
      >();
      while (hasMore && item < maxItemLimit) {
        let response: AxiosResponse<any>;
        let tryCount = 0;
        do {
          response = await this.genericFetchData(type, { LT, LID, SV: String(item) });
          if (response.data.return_code == '0' && response.data.content) {
            break;
          } else {
            tryCount++;
            Utils.logMessage(`   Error fetching Outer Realms data for SV=${item}. Retry count: ${tryCount}`);
            if (tryCount === 3) {
              Utils.logMessage('   Max retries reached. Ending Outer Realms data fetch.');
              hasMore = false;
            } else {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
        } while (tryCount < 3);
        if (response.data.return_code == '0' && response.data.content) {
          const content = response.data.content.L || [];
          if (content.length === 0) {
            hasMore = false;
            Utils.logMessage(' No more data to fetch. Ending Outer Realms data fetch.');
            break;
          }
          let duplicatesInThisBatch = 0;
          for (const entry of content) {
            const playerData = entry[2];
            const OID = Number(playerData.OID);
            if (!playerEntries.has(OID)) {
              const parts = String(playerData.N).split('_');
              const server = parts[parts.length - 1];
              const playerName = parts.slice(0, -1).join('_');
              const castleEntry = playerData.AP.find((ap: number[]) => ap[0] === 0 && ap[4] === 1);
              let rank: number, score: number | undefined;

              const outerRealmType = Object.keys(HIGHSCORES_CONFIG).find(
                (key) => HIGHSCORES_CONFIG[key as keyof typeof HIGHSCORES_CONFIG] === LT,
              ) as HighScoreKey;
              if (outerRealmType === 'TEMP_SERVER_DAILY_MIGHT_POINTS_BUILDINGS') {
                rank = Number(entry[4]);
              } else if (outerRealmType === 'TEMP_SERVER_DAILY_RANK_SWAP') {
                rank = Number(entry[0]);
                const rankPointsEntry = SWAP_RANK_POINTS_TABLE.find((rp) => rank >= rp.maxRank && rank <= rp.minRank);
                score = rankPointsEntry ? rankPointsEntry.rankPoints : 0;
              }
              playerEntries.set(OID, {
                OID,
                N: playerName,
                server: server,
                score: score ?? Number(entry[1]),
                rank: rank,
                level: Number(playerData.L),
                legendaryLevel: Number(playerData.LL),
                might: Number(playerData.MP),
                castlePositionX: Number(castleEntry ? castleEntry[2] : null),
                castlePositionY: Number(castleEntry ? castleEntry[3] : null),
              });
            } else {
              duplicatesInThisBatch++;
            }
          }
          // If we have a full batch with all duplicates, we can stop fetching more data
          if (duplicatesInThisBatch === content.length) {
            Utils.logMessage(` All entries in this batch are duplicates (SV=${item}). Ending Outer Realms data fetch.`);
            hasMore = false;
            break;
          }
        }
        item += increment;
      }
      Utils.logMessage(' Total unique player entries fetched:', playerEntries.size);
      const clickhouseBaseUrl = (this.CLICKHOUSE_CONFIG.url as string) + ':' + this.CLICKHOUSE_CONFIG.port;
      try {
        const batchSize = 5000;
        const insertSQL = 'INSERT INTO outer_realms_ranking FORMAT JSONEachRow';
        const clickhouseUrl =
          clickhouseBaseUrl +
          '/?query=' +
          encodeURIComponent(insertSQL) +
          '&database=' +
          encodeURIComponent(this.CLICKHOUSE_CONFIG.database as string);
        const fetchDate = new Date();
        const playerArray = Array.from(playerEntries.values());
        const clickhouseAuth = {
          username: this.CLICKHOUSE_CONFIG.user as string,
          password: this.CLICKHOUSE_CONFIG.password as string,
        };

        const fetchDateStr = new Date(fetchDate).toISOString().slice(0, 19).replace('T', ' ');
        for (let i = 0; i < playerArray.length; i += batchSize) {
          const batch = playerArray.slice(i, i + batchSize);
          const payload = batch
            .map((p) =>
              JSON.stringify({
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
              }),
            )
            .join('\n');

          try {
            await axios.post(clickhouseUrl, payload, {
              headers: {
                'Content-Type': 'text/plain',
              },
              auth: clickhouseAuth,
            });
            Utils.logMessage(`Inserted ${batch.length} players`);
            Utils.logMessage('Outer Realms data fetch and database update completed successfully');
          } catch (error) {
            Utils.logMessage('Error inserting batch into ClickHouse:', error);
            Utils.logMessage('Payload:', payload);
            this.DB_UPDATES.criticalErrors++;
          }
        }

        const updateLatestFetchSQL = `
          INSERT INTO latest_fetch_date (fetch_date)
          VALUES ('${fetchDateStr}')
        `;
        await axios.post(
          clickhouseBaseUrl +
            '/?query=' +
            encodeURIComponent(updateLatestFetchSQL) +
            '&database=' +
            encodeURIComponent(this.CLICKHOUSE_CONFIG.database as string),
          '',
          {
            auth: clickhouseAuth,
            headers: { 'Content-Type': 'text/plain' },
          },
        );
      } catch (error) {
        Utils.logMessage('Error executing query:', error);
        this.DB_UPDATES.criticalErrors++;
      }
    } catch (error) {
      Utils.logMessage('Error during Outer Realms data fetch:', error);
      this.DB_UPDATES.criticalErrors++;
    } finally {
      const end = new Date();
      const duration = end.getTime() - start.getTime();
      const durationInSeconds = Math.floor(duration / 1000);
      Utils.logMessage('Duration of Outer Realms data fetch:', durationInSeconds + ' seconds');
      for (let i = 0; i < 9; i++) {
        Utils.logMessage('.');
      }
      Utils.logsAllInFile(this.DB_UPDATES.criticalErrors, this.server);
    }
  }

  private createNewPool(): void {
    if (this.connection) {
      this.connection.end().catch((error) => {
        Utils.logMessage('An error occurred while closing the previous connection:', error);
      });
    }
    if (this.pgSqlConnection) {
      this.pgSqlConnection.end().catch((error) => {
        Utils.logMessage('An error occurred while closing the previous PostgreSQL connection:', error);
      });
    }
    if (this.DATABASE_CONFIG) this.connection = mysql.createPool(this.DATABASE_CONFIG);
    this.pgSqlConnection = new pg.Pool(this.PGSQL_CONFIG);
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
        paramString += `"${key}":${typeof value === 'string' ? `"${value}"` : value}`;
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
    } catch (error) {
      console.error('=====================================');
      console.error('[Error] ', error.message);
      console.error('=====================================');
      return null;
    }
  }

  private async genericFillHistory(
    args: { lt: number; increment: number; tableName: string; query: string; levelCategorySize: number },
    date: Date,
    eventName: string,
    successCallback: () => void,
  ): Promise<void> {
    try {
      if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
      let clickhouse: any;
      try {
        clickhouse = new ClickHouse(this.CLICKHOUSE_CONFIG);
      } catch (error) {
        Utils.logMessage('Error while connecting to ClickHouse');
        Utils.logMessage('========== BEGIN STACK TRACE ============');
        Utils.logMessage('Identifier: 006');
        Utils.logMessage(error);
        Utils.logMessage('=========== END STACK TRACE =============');
      }
      let { lt, tableName, levelCategorySize } = args;
      let i: number;
      let j: number;
      let c: boolean = true;
      const entities: {
        [key: string]: {
          playerId: number;
          playerName: string;
          category: number;
          point: number;
          allianceId: number;
          allianceName: string;
        };
      } = {};
      Utils.logMessage('Database connection successful (' + eventName + ')');
      const currentDateFormatted = format(date, 'yyyy-MM-dd HH:mm:ss');

      for (let levelCategory = 1; levelCategory <= levelCategorySize; levelCategory++) {
        Utils.logMessage('Starting to retrieve statistics for category', levelCategory, '(of', levelCategorySize + ')');
        c = true;
        j = 0;
        let data = await this.fetchDataAndReturn(lt, levelCategory, 1);
        if (!data || data['return_code'] != '0') {
          if (j === 0 && levelCategory == 1) {
            Utils.logMessage(' [info] No event active (0)');
            return;
          } else {
            const tentatives = 3;
            let k = 0;
            while (k < tentatives && (!data || data['return_code'] != '0')) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
              data = await this.fetchDataAndReturn(lt, levelCategory, i);
              k++;
            }
          }
        }
        if (!data || data['return_code'] != '0' || !data?.content?.LR) {
          /*
           * [PATCH #2512091]
           * In some cases, levelCategorySize can start at 2 (issue observed with bloodcrows)
           * Thus, we need to skip levelCategory 1 to avoid missing the entire event data...
           * [PATCH #2512161]
           * Same for war realms
           */
          if ((eventName === 'bloodcrows' || eventName === 'war realms') && levelCategory <= 2) {
            continue;
          }
          Utils.logMessage(' [info] No event active (1)');
          return;
        }
        const contentList = data?.content?.L ?? [];
        const increment = contentList.length;
        i = Math.ceil(increment / 2);

        const max = data?.content?.LR ?? 50000;
        if (max && Number(max) >= 0) {
          if (data?.content?.L) {
            while (c) {
              let p = await this.fetchDataAndReturn(lt, levelCategory, i);
              let fetchData = p?.content?.L ?? [];
              const tryTentatives = 7;
              let currentTry = 0;
              while (
                currentTry < tryTentatives &&
                (!p || p['return_code'] != '0' || !fetchData || fetchData.length === 0)
              ) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                p = await this.fetchDataAndReturn(lt, levelCategory, i);
                fetchData = p?.content?.L ?? [];
                currentTry++;
              }
              if (!fetchData || fetchData.length === 0) {
                Utils.logMessage('/!\\ No players found, but status is OK');
                Utils.logMessage('========== BEGIN STACK TRACE ============');
                Utils.logMessage('Identifier: 002-' + eventName);
                Utils.logMessage('Url :', this.BASE_API_URL + 'hgh' + `/"LT":${lt},"LID":${levelCategory},"SV":"${i}"`);
                Utils.logMessage('Nb:', j + ' players found on', max);
                Utils.logMessage('p:', JSON.stringify(p));
                Utils.logMessage('=========== END STACK TRACE =============');
                this.DB_UPDATES.criticalErrors++;
                return;
              } else {
                const ids: number[] = [];
                for (const singleData of fetchData) {
                  if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
                  try {
                    ids.push(singleData[0]);
                    const playerId = singleData[2]['OID'];
                    const category = levelCategory;
                    const point = singleData[1];
                    entities[playerId.toString()] = {
                      playerId: playerId,
                      playerName: singleData[2]['N'],
                      category: category,
                      point: point,
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
            }
            Utils.logMessage(
              'Finished searching for this category, starting insertion into the database for',
              eventName,
            );
            const batchSize = 500;
            let batch: string[] = [];

            try {
              for (const entity of Object.values(entities)) {
                if (entity && entity.playerId) {
                  const ltString = lt.toString();
                  this.playerEventPointHistoryList[entity.playerId.toString()] =
                    this.playerEventPointHistoryList[entity.playerId.toString()] || {};
                  this.playerEventPointHistoryList[entity.playerId.toString()][ltString] = entity.point;

                  batch.push(`(${entity.playerId}, ${entity.point}, '${currentDateFormatted}')`);

                  if (batch.length >= batchSize) {
                    const clickhouseQuery = `
                      INSERT INTO ${tableName} (player_id, point, created_at)
                      VALUES ${batch.join(', ')}
                    `;
                    await clickhouse.query(clickhouseQuery).toPromise();
                    batch = [];
                  }
                }
              }
              if (batch.length > 0) {
                const clickhouseQuery = `
                  INSERT INTO ${tableName} (player_id, point, created_at)
                  VALUES ${batch.join(', ')}
                `;
                await clickhouse.query(clickhouseQuery).toPromise();
              }
            } catch (error) {
              Utils.logMessage('Error while inserting into player table for', eventName);
              Utils.logMessage('========== BEGIN STACK TRACE ============');
              Utils.logMessage('Identifier: 004');
              Utils.logMessage(error);
              Utils.logMessage('=========== END STACK TRACE =============');
              console.error(error);
              this.DB_UPDATES.criticalErrors++;
            }
          } else {
            Utils.logMessage('No players found for category', levelCategory);
            Utils.logMessage('========== BEGIN STACK TRACE ============');
            Utils.logMessage('Identifier: 005');
            Utils.logMessage('Url :', this.BASE_API_URL + 'hgh' + `/"LT":${lt},"LID":${levelCategory},"SV":"${i}"`);
            Utils.logMessage(JSON.stringify(data));
            Utils.logMessage('=========== END STACK TRACE =============');
            this.DB_UPDATES.criticalErrors++;
          }
        }
      }
      Utils.logMessage('Finished searching for all categories');
      successCallback();
    } catch (error) {
      Utils.logMessage('Final error while processing statistics');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 007');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
    }
  }

  private async fillMightPointsHistory(): Promise<void> {
    try {
      if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
      let i: number;
      let j: number;
      let c: boolean = true;
      let increment: number = this.isE4KServer ? 6 : 10;
      const levelCategorySize: number = 6;
      const playerList: {
        [key: string]: { uid: number; name: string; allianceID: number; allianceName?: string; mightPoints: number };
      } = {};
      const currentDate = new Date();
      const currentDateFormatted = format(currentDate, 'yyyy-MM-dd HH:mm:ss');
      const clickhouse = new ClickHouse(this.CLICKHOUSE_CONFIG);
      for (let levelCategory = 1; levelCategory <= levelCategorySize; levelCategory++) {
        Utils.logMessage(
          'Starting to retrieve statistics for category',
          levelCategory + '(out of ' + levelCategorySize + ')',
        );
        c = true;
        j = 0;
        i = increment / 2;
        let data = await this.fetchDataAndReturn(6, levelCategory, i);
        if (!data || data['return_code'] != '0') {
          const tentatives = 10;
          let k = 0;
          while (k < tentatives && (!data || data['return_code'] != '0')) {
            await new Promise((resolve) => setTimeout(resolve, 10000));
            data = await this.fetchDataAndReturn(6, levelCategory, i);
            k++;
          }
          if (!data || data['return_code'] != '0') {
            Utils.logMessage(' [KO] Request failed for category', levelCategory);
            const identifier = '008';
            const messages = [
              'Url : ' + this.BASE_API_URL + 'hgh' + `/"LT":6,"LID":${levelCategory},"SV":"${i}"`,
              JSON.stringify(data),
            ];
            void this.stackTraceError(identifier, true, messages);
            return;
          }
        }
        const max = data?.content?.LR ?? 50000;
        Utils.logMessage('Request succeeded:', max, 'players found');
        if (data?.content?.L) {
          while (c) {
            let p = await this.fetchDataAndReturn(6, levelCategory, i);
            let players = p?.content?.L ?? [];
            const tentatives = 10;
            let k = 0;
            while (k < tentatives && (!p || p['return_code'] != '0' || !players || players.length === 0)) {
              await new Promise((resolve) => setTimeout(resolve, 10000));
              p = await this.fetchDataAndReturn(6, levelCategory, i);
              players = p?.content?.L ?? [];
              k++;
            }
            if (!players || players.length === 0) {
              Utils.logMessage(' [KO] No players found, but status is OK');
              Utils.logMessage('========== BEGIN STACK TRACE ============');
              Utils.logMessage('Identifier: 009');
              Utils.logMessage('Url : ', this.BASE_API_URL + 'hgh' + `/"LT":6,"LID":${levelCategory},"SV":"${i}"`);
              Utils.logMessage('Nb:', j + 'players found out of', max);
              if (players) Utils.logMessage('Players.length:' + players.length);
              Utils.logMessage(JSON.stringify(p));
              Utils.logMessage('=========== END STACK TRACE =============');
              this.DB_UPDATES.criticalErrors++;
            } else {
              const ids: number[] = [];
              for (const player of players) {
                if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
                try {
                  ids.push(player[0]);
                  const infos: any = player[2];
                  const uid: number = infos['OID'];
                  const mightPoints: number = infos['MP'];
                  if (mightPoints && mightPoints > 0) {
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
                    this.playerLootAndMightPointHistoryList[uid.toString()] =
                      this.playerLootAndMightPointHistoryList[uid.toString()] || [];
                    this.playerLootAndMightPointHistoryList[uid.toString()][1] = mightPoints;
                    this.playerLootAndMightPointHistoryList[uid.toString()][2] = infos['AID'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][3] = infos['AN'];
                    if (AP && AP.length > 0) {
                      const AP = infos['AP'].filter((ap) => ap[0] === 0).map((ap) => [ap[2], ap[3], ap[4]]);
                      const APRealms = infos['AP']
                        .filter((ap) => [1, 2, 3, 4].includes(ap[0]))
                        .map((ap) => [ap[0], ap[2], ap[3], ap[4]]);
                      this.playerLootAndMightPointHistoryList[uid.toString()][4] = AP
                        ? JSON.parse(JSON.stringify(AP))
                        : [];
                      this.playerLootAndMightPointHistoryList[uid.toString()][13] = APRealms
                        ? JSON.parse(JSON.stringify(APRealms))
                        : [];
                    }
                    this.playerLootAndMightPointHistoryList[uid.toString()][5] = infos['H'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][6] = infos['RPT'];
                    const now = new Date();
                    const targetDate = new Date(now.getTime() + Number(infos['RPT']) * 1000);
                    const targetDateISO = targetDate.toISOString();
                    this.playerLootAndMightPointHistoryList[uid.toString()][14] = targetDateISO;
                    this.playerLootAndMightPointHistoryList[uid.toString()][7] = infos['N'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][8] = infos['L'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][9] = infos['LL'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][10] = infos['HF'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][11] = infos['CF'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][12] = infos['RRD'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][15] = infos['AR'];
                  }
                } catch (error) {
                  Utils.logMessage(' [KO] Error while storing in playerMightHistoryList', JSON.stringify(player));
                  Utils.logMessage('========== BEGIN STACK TRACE ============');
                  Utils.logMessage('Identifier: 052');
                  Utils.logMessage(error);
                  Utils.logMessage('=========== END STACK TRACE =============');
                  this.DB_UPDATES.criticalErrors++;
                }
                j++;
              }
              i += increment;
              if (j >= max || ids.includes(max)) {
                Utils.logMessage(
                  'Finished searching for category',
                  levelCategory + ', ' + j + ' players found out of',
                  max,
                );
                c = false;
              }
              if (j % 100 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
            }
          }
        } else {
          Utils.logMessage(' [KO] No players found for category', levelCategory);
          Utils.logMessage('========== BEGIN STACK TRACE ============');
          Utils.logMessage('Identifier: 011');
          Utils.logMessage('Url : ', this.BASE_API_URL + 'hgh' + `/"LT":6,"LID":${levelCategory},"SV":"${i}"`);
          Utils.logMessage(JSON.stringify(data));
          Utils.logMessage('=========== END STACK TRACE =============');
        }
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
      const BATCH_SIZE = 25;
      const players = Object.values(playerList);
      for (let i = 0; i < players.length; i += BATCH_SIZE) {
        const batch = players.slice(i, i + BATCH_SIZE);
        const queryValues: (string | number | Date)[] = [];
        const clickhouseValues: string[] = [];
        for (const player of batch) {
          if (player && player.uid && player.name) {
            queryValues.push(player.uid, player.mightPoints, currentDate);
            clickhouseValues.push(`(${player.uid}, ${player.mightPoints}, '${currentDateFormatted}')`);
          }
        }
        try {
          if (queryValues.length > 0) {
            try {
              const clickhouseQuery = `INSERT INTO player_might_history (player_id, point, created_at) VALUES ${clickhouseValues.join(', ')}`;
              await clickhouse.query(clickhouseQuery).toPromise();
            } catch (error) {
              Utils.logMessage(' [KO] Error while adding mightPoints to ClickHouse', error);
              Utils.logMessage('========== BEGIN STACK TRACE ============');
              Utils.logMessage('Identifier: 728');
              Utils.logMessage(error);
              Utils.logMessage('=========== END STACK TRACE =============');
            }
          }
        } catch (error) {
          Utils.logMessage(
            ' [KO] Another error occurred while inserting into the player_might_history table at batch level',
            i,
          );
          Utils.logMessage('========== BEGIN STACK TRACE ============');
          Utils.logMessage('Identifier: 725');
          Utils.logMessage(JSON.stringify(batch));
          Utils.logMessage(error);
          Utils.logMessage('=========== END STACK TRACE =============');
          this.DB_UPDATES.criticalErrors++;
          console.error(error);
        }
      }
    } catch (error) {
      Utils.logMessage(' [KO] Final error occurred while processing statistics');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 012');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async fillLootHistory(): Promise<void> {
    try {
      if (!this.CLICKHOUSE_CONFIG) throw new Error('ClickHouse configuration is missing.');
      let i: number;
      let j: number;
      let c: boolean = true;
      let increment: number = this.isE4KServer ? 6 : 10;
      const levelCategorySize: number = 1;

      const playerList: {
        [key: string]: {
          uid: number;
          rank: number;
          name: string;
          points: number;
          allianceID: number;
          allianceName?: string;
          mightPoints: number;
        };
      } = {};
      Utils.logMessage(' Database connection successful (Loot Points)');
      let clickhouse: any;
      try {
        clickhouse = new ClickHouse(this.CLICKHOUSE_CONFIG);
        Utils.logMessage(' ClickHouse connection successful');
      } catch (error) {
        Utils.logMessage('Error while connecting to ClickHouse');
        Utils.logMessage('========== BEGIN STACK TRACE ============');
        Utils.logMessage('Identifier: 013');
        Utils.logMessage(error);
        Utils.logMessage('=========== END STACK TRACE =============');
      }
      const currentDate = new Date();
      const currentDateFormatted = format(currentDate, 'yyyy-MM-dd HH:mm:ss');

      for (let levelCategory = 1; levelCategory <= levelCategorySize; levelCategory++) {
        Utils.logMessage(
          ' Beginning retrieval of statistics for category ',
          levelCategory + '(out of ' + levelCategorySize + ')',
        );
        c = true;
        j = 0;
        i = increment / 2;
        let data = await this.fetchDataAndReturn(2, levelCategory, i);
        const max = data?.content?.LR ?? 50000;
        Utils.logMessage(' Request successful: ', max, 'players found');
        if (data?.content?.L) {
          while (c) {
            let p = await this.fetchDataAndReturn(2, levelCategory, i);
            let players = p?.content?.L ?? [];
            const tentatives = 10;
            let k = 0;
            while (k < tentatives && (!p || p['return_code'] != '0' || !players || players.length === 0)) {
              if (this.CURRENT_ENV === 'development') Utils.logMessage('Debug:');
              if (this.CURRENT_ENV === 'development')
                Utils.logMessage('Try n°', k + 1, 'for category', levelCategory, 'with i =', i);
              if (this.CURRENT_ENV === 'development')
                Utils.logMessage('Url :', this.BASE_API_URL + 'hgh' + `/"LT":2,"LID":${levelCategory},"SV":"${i}"`);
              if (this.CURRENT_ENV === 'development') Utils.logMessage('Data :', JSON.stringify(p));

              await new Promise((resolve) => setTimeout(resolve, 3000));
              p = await this.fetchDataAndReturn(2, levelCategory, i);
              players = p?.content?.L ?? [];
              k++;
            }
            if (!players || players.length === 0) {
              Utils.logMessage(' /!\\ There are no players found, but the status is OK');
              Utils.logMessage('========== BEGIN STACK TRACE ============');
              Utils.logMessage('Identifier: 014');
              Utils.logMessage('Url : ', this.BASE_API_URL + 'hgh' + `/"LT":2,"LID":${levelCategory},"SV":"${i}"`);
              Utils.logMessage(JSON.stringify(p));
              Utils.logMessage('=========== END STACK TRACE =============');
              this.DB_UPDATES.criticalErrors++;
              return;
            } else {
              const ids: number[] = [];
              const OVERFLOW_OFFSET = 2 ** 32;
              for (const player of players) {
                if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
                try {
                  ids.push(player[0]);
                  const rank: number = player[0];
                  const points: number =
                    Number(player[1]) >= 0 ? Number(player[1]) : Number(player[1]) + OVERFLOW_OFFSET;
                  const infos: any = player[2];
                  const uid: number = infos['OID'];
                  const mightPoints: number = infos['MP'];
                  if (mightPoints && mightPoints >= 0) {
                    const AP = infos['AP'];
                    if (AP && AP.length > 0 && mightPoints && mightPoints > 0) {
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
                    this.playerLootAndMightPointHistoryList[uid.toString()] =
                      this.playerLootAndMightPointHistoryList[uid.toString()] || [];
                    this.playerLootAndMightPointHistoryList[uid.toString()][0] = points;
                    this.playerLootAndMightPointHistoryList[uid.toString()][2] = infos['AID'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][3] = infos['AN'];
                    if (AP && AP.length > 0) {
                      const AP = infos['AP'].filter((ap) => ap[0] === 0).map((ap) => [ap[2], ap[3], ap[4]]);
                      const APRealms = infos['AP']
                        .filter((ap) => [1, 2, 3, 4].includes(ap[0]))
                        .map((ap) => [ap[0], ap[2], ap[3], ap[4]]);
                      this.playerLootAndMightPointHistoryList[uid.toString()][4] = AP
                        ? JSON.parse(JSON.stringify(AP))
                        : [];
                      this.playerLootAndMightPointHistoryList[uid.toString()][13] = APRealms
                        ? JSON.parse(JSON.stringify(APRealms))
                        : [];
                    }
                    this.playerLootAndMightPointHistoryList[uid.toString()][5] = infos['H'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][6] = infos['RPT'];
                    const now = new Date();
                    const targetDate = new Date(now.getTime() + Number(infos['RPT']) * 1000);
                    const targetDateISO = targetDate.toISOString();
                    this.playerLootAndMightPointHistoryList[uid.toString()][14] = targetDateISO;
                    this.playerLootAndMightPointHistoryList[uid.toString()][7] = infos['N'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][8] = infos['L'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][9] = infos['LL'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][10] = infos['HF'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][11] = infos['CF'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][12] = infos['RRD'];
                    this.playerLootAndMightPointHistoryList[uid.toString()][15] = infos['AR'];
                  }
                } catch (error) {
                  Utils.logMessage(' [KO] Error while storing in playerLootHistoryList', JSON.stringify(player));
                  Utils.logMessage('========== BEGIN STACK TRACE ============');
                  Utils.logMessage('Identifier: 063');
                  Utils.logMessage(error);
                  Utils.logMessage('=========== END STACK TRACE =============');
                  this.DB_UPDATES.criticalErrors++;
                }
                j++;
              }
              if (
                players.length <= 0 ||
                !players[players.length - 1] ||
                !players[players.length - 1][1] ||
                players[players.length - 1][1] == 0
              ) {
                c = false;
                Utils.logMessage('Search for loot stopped due to a player with 0 points, players: ', j);
              }
              i += increment;
              if (j >= max || ids.includes(max)) {
                Utils.logMessage(' End of search for category', levelCategory + ', ' + j + 'players found out of', max);
                c = false;
              }
              if (j % 50 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 150));
              }
            }
          }
          try {
            Utils.logMessage(' [Info] Processing loot for players with negative points');
            c = true;
            let data = await this.fetchDataAndReturn(2, levelCategory, 1);
            let maxNegative = data?.content?.LR;
            if (!data || data['return_code'] != '0') {
              const tentatives = 3;
              let k = 0;
              while (k < tentatives && (!data || data['return_code'] != '0')) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                data = await this.fetchDataAndReturn(2, levelCategory, 1);
                k++;
              }
            }
            maxNegative = data?.content?.LR;
            if (!data || data['return_code'] != '0' || !maxNegative) {
              Utils.logMessage(' [KO] The request failed for category', levelCategory);
              Utils.logMessage('========== BEGIN STACK TRACE ============');
              Utils.logMessage('Identifier: 026');
              Utils.logMessage(
                'Url : ',
                this.BASE_API_URL + 'hgh' + `/"LT":2,"LID":${levelCategory},"SV":"${maxNegative}"`,
              );
              Utils.logMessage(JSON.stringify(data));
              Utils.logMessage('=========== END STACK TRACE =============');
              console.error('[KO] The request failed for category', levelCategory);
              c = false;
            }
            while (c) {
              let data = await this.fetchDataAndReturn(2, levelCategory, maxNegative);
              let players = data?.content?.L ?? [];
              const tentatives = 3;
              let k = 0;
              while (k < tentatives && (!data || data['return_code'] != '0' || !players || players.length === 0)) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                data = await this.fetchDataAndReturn(2, levelCategory, maxNegative);
                players = data?.content?.L ?? [];
                k++;
              }
              if (!players || players.length === 0) {
                c = false;
                Utils.logMessage(' [KO] No players found');
                Utils.logMessage('========== BEGIN STACK TRACE ============');
                Utils.logMessage('Identifier: 023');
                Utils.logMessage(
                  'Url : ',
                  this.BASE_API_URL + 'hgh' + `/"LT":2,"LID":${levelCategory},"SV":"${maxNegative}"`,
                );
                Utils.logMessage(JSON.stringify(data));
                Utils.logMessage('=========== END STACK TRACE =============');
              } else {
                const ids: number[] = [];
                const OVERFLOW_OFFSET = 2 ** 32;
                for (const player of players) {
                  if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, maxNegative);
                  try {
                    if (Number(player[1]) < 0) {
                      ids.push(player[0]);
                      const points: number =
                        Number(player[1]) >= 0 ? Number(player[1]) : Number(player[1]) + OVERFLOW_OFFSET;
                      const infos: any = player[2];
                      const uid: number = infos['OID'];
                      const mightPoints: number = infos['MP'];
                      Utils.logMessage(' [Info] Player with negative points found', uid, '(', infos['N'], ')');
                      if (mightPoints && mightPoints >= 0) {
                        const AP = infos['AP'];
                        if (AP && AP.length > 0 && mightPoints && mightPoints > 0) {
                          playerList[uid.toString()] = {
                            rank: -1,
                            uid: uid,
                            name: infos['N'],
                            points: points,
                            allianceID: infos['AID'],
                            allianceName: infos['AN'],
                            mightPoints: mightPoints,
                          };
                        }
                        this.playerLootAndMightPointHistoryList[uid.toString()] =
                          this.playerLootAndMightPointHistoryList[uid.toString()] || [];
                        this.playerLootAndMightPointHistoryList[uid.toString()][0] = points;
                        this.playerLootAndMightPointHistoryList[uid.toString()][2] = infos['AID'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][3] = infos['AN'];
                        if (AP && AP.length > 0) {
                          const AP = infos['AP'].filter((ap) => ap[0] === 0).map((ap) => [ap[2], ap[3], ap[4]]);
                          const APRealms = infos['AP']
                            .filter((ap) => [1, 2, 3, 4].includes(ap[0]))
                            .map((ap) => [ap[0], ap[2], ap[3], ap[4]]);
                          this.playerLootAndMightPointHistoryList[uid.toString()][4] = AP
                            ? JSON.parse(JSON.stringify(AP))
                            : [];
                          this.playerLootAndMightPointHistoryList[uid.toString()][13] = APRealms
                            ? JSON.parse(JSON.stringify(APRealms))
                            : [];
                        }
                        this.playerLootAndMightPointHistoryList[uid.toString()][5] = infos['H'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][6] = infos['RPT'];
                        const now = new Date();
                        const targetDate = new Date(now.getTime() + Number(infos['RPT']) * 1000);
                        const targetDateISO = targetDate.toISOString();
                        this.playerLootAndMightPointHistoryList[uid.toString()][14] = targetDateISO;
                        this.playerLootAndMightPointHistoryList[uid.toString()][7] = infos['N'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][8] = infos['L'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][9] = infos['LL'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][10] = infos['HF'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][11] = infos['CF'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][12] = infos['RRD'];
                        this.playerLootAndMightPointHistoryList[uid.toString()][15] = infos['AR'];
                      }
                    } else if (c === true) {
                      c = false;
                      Utils.logMessage('Stopping search for negative loot due to player with 0 points: ', j);
                    }
                  } catch (error) {
                    Utils.logMessage(' [KO] Error while storing in playerLootHistoryList', JSON.stringify(player));
                    Utils.logMessage('========== BEGIN STACK TRACE ============');
                    Utils.logMessage('Identifier: 064');
                    Utils.logMessage(error);
                    Utils.logMessage('=========== END STACK TRACE =============');
                  }
                }
                maxNegative -= increment;
              }
            }
          } catch (error) {
            Utils.logMessage('Error while retrieving negative loot points');
            Utils.logMessage('========== BEGIN STACK TRACE ============');
            Utils.logMessage('Identifier: 027');
            Utils.logMessage(error);
            Utils.logMessage('=========== END STACK TRACE =============');
          }
          Utils.logMessage(' Beginning insertion of loot for players into the database');
          for (const player of Object.values(playerList)) {
            try {
              if (player && player.uid && player.name) {
                try {
                  const clickhouseQuery = `INSERT INTO player_loot_history (player_id, point, created_at) VALUES (${player.uid}, ${player.points}, '${currentDateFormatted}')`;
                  await clickhouse.query(clickhouseQuery).toPromise();
                } catch (error) {
                  Utils.logMessage(' [KO] Error while adding loot to ClickHouse', error);
                  Utils.logMessage('========== BEGIN STACK TRACE ============');
                  Utils.logMessage('Identifier: 726');
                  Utils.logMessage(error);
                  Utils.logMessage('=========== END STACK TRACE =============');
                }
              }
            } catch (error) {
              Utils.logMessage(
                ' [KO] Error while inserting into player_loot_history table for player',
                player.uid + ' (name:',
                player.name,
                ')',
              );
              Utils.logMessage('========== BEGIN STACK TRACE ============');
              Utils.logMessage('Identifier: 515');
              Utils.logMessage(error);
              Utils.logMessage('=========== END STACK TRACE =============');
              this.DB_UPDATES.criticalErrors++;
              console.error(error);
            }
          }
        } else {
          Utils.logMessage(' [KO] No players found for category', levelCategory);
          Utils.logMessage('========== BEGIN STACK TRACE ============');
          Utils.logMessage('Identifier: 017');
          Utils.logMessage('Url : ', this.BASE_API_URL + 'hgh' + `/"LT":2,"LID":${levelCategory},"SV":"${i}"`);
          Utils.logMessage(JSON.stringify(data));
          Utils.logMessage('=========== END STACK TRACE =============');
        }
      }
      Utils.logMessage(' End of search for all categories for loot');
    } catch (error) {
      Utils.logMessage(' [KO] Final error while processing statistics');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 018');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async removePlayerFromDatabase(playerId: number): Promise<void> {
    const pgSqlQuery = "UPDATE players SET castles = '[]'::jsonb, alliance_id = NULL WHERE id = $1";
    Utils.logMessage(' [Info] Deleting player', playerId);
    try {
      await this.pgSqlQuery(pgSqlQuery, [playerId]);
      Utils.logMessage(' [OK] Player deletion successful', playerId);
    } catch (error) {
      Utils.logMessage(' [KO] Error while deleting player', playerId);
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 019');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
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
    await Promise.all([this.pgSqlQuery(pgSqlQueryUpdateAllianceName, [allianceName, allianceId])]);
    const pgSqlQueryInsertAllianceUpdateHistory = `
            INSERT INTO alliance_update_history (alliance_id, old_name, new_name)
            VALUES ($1, $2, $3)
        `;
    await Promise.all([
      this.pgSqlQuery(pgSqlQueryInsertAllianceUpdateHistory, [allianceId, currentAllianceName, allianceName]),
    ]);
    this.customPlayersAttributesList['alliance_name_update_count'] =
      this.customPlayersAttributesList['alliance_name_update_count'] || 0;
    this.customPlayersAttributesList['alliance_name_update_count']++;
  }

  private async updatePlayerAlliance(playerId: number, allianceId: any, currentAllianceId: any): Promise<void> {
    const pgSqlQueryUpdatePlayerAlliance = 'UPDATE players SET alliance_id = $1 WHERE id = $2';
    await Promise.all([this.pgSqlQuery(pgSqlQueryUpdatePlayerAlliance, [allianceId, playerId])]);
    const pgSqlQueryInsertAllianceUpdateHistory = `
            INSERT INTO player_alliance_update (player_id, old_alliance_id, new_alliance_id)
            VALUES ($1, $2, $3)
        `;
    await Promise.all([
      this.pgSqlQuery(pgSqlQueryInsertAllianceUpdateHistory, [playerId, currentAllianceId, allianceId]),
    ]);
    this.customPlayersAttributesList['player_alliance_update_count'] =
      this.customPlayersAttributesList['player_alliance_update_count'] || 0;
    this.customPlayersAttributesList['player_alliance_update_count']++;
    this.DB_UPDATES.playersAllianceUpdated++;
  }

  private async addPlayerInDatabase(
    playerId: number,
    playerName: string,
    allianceId: any,
    allianceName: any,
    might_current: any,
    might_all_time: any,
    loot_current: any,
    loot_all_time: any,
    castles: any = null,
    minimalist = false,
  ): Promise<void> {
    if (!allianceId || Number(allianceId) <= 0) {
      allianceId = null;
    }
    if (!might_current || Number(might_current) <= 0) {
      might_current = null;
    }
    if (!might_all_time || Number(might_all_time) <= 0) {
      might_all_time = null;
    }
    if (!loot_current || Number(loot_current) <= 0) {
      loot_current = null;
    }
    if (!loot_all_time || Number(loot_all_time) <= 0) {
      loot_all_time = null;
    }
    const pgSqlQueryPlayer = `
      INSERT INTO players (id, name, alliance_id, might_current, might_all_time, loot_current, loot_all_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const player = this.currentPlayers.find((p) => p.playerId == playerId);
    if (!player) {
      try {
        await this.pgSqlQuery(pgSqlQueryPlayer, [
          playerId,
          playerName,
          allianceId,
          might_current,
          might_all_time,
          loot_current,
          loot_all_time,
        ]);
        this.DB_UPDATES.playersCreated++;
      } catch (error) {
        if (error.code == '23503') {
          try {
            await this.addAllianceInDatabase(allianceId, allianceName);
            await this.pgSqlQuery(pgSqlQueryPlayer, [
              playerId,
              playerName,
              allianceId,
              might_current,
              might_all_time,
              loot_current,
              loot_all_time,
            ]);
            this.DB_UPDATES.playersCreated++;
          } catch (error) {
            Utils.logMessage(' [KO] Error while adding player', playerId, '(name :', playerName, ')');
            Utils.logMessage('========== BEGIN STACK TRACE ============');
            Utils.logMessage('Identifier: 838');
            Utils.logMessage('PlayerId:', playerId);
            Utils.logMessage('PlayerName:', playerName);
            Utils.logMessage(error);
            Utils.logMessage('=========== END STACK TRACE =============');
            this.DB_UPDATES.criticalErrors++;
          }
        }
      }
    } else {
      // If the player already exists, update their information
      let currentAllianceId = player.allianceId;
      let currentAllianceName = player.allianceName;
      let currentCastles: Castle[] | [] = player.castles;
      const currentPlayerName = player.playerName;
      if (!currentAllianceId || Number(currentAllianceId) <= 0) {
        currentAllianceId = null;
      }
      if (!currentAllianceName) {
        currentAllianceName = null;
      }
      if (!castles) {
        castles = null;
      }
      // 1. Update player castles
      try {
        const parsedCurrentCastles: Castle[] = currentCastles;
        const parsedNewCastles: Castle[] = castles ? castles : [];
        await this.updatePlayerCastles(playerId, parsedCurrentCastles, parsedNewCastles);
      } catch (error) {
        Utils.logMessage(' [KO] Error while updating player castles', playerId, '(name :', playerName, ')');
        Utils.logMessage('========== BEGIN STACK TRACE ============');
        Utils.logMessage('Identifier: 077');
        Utils.logMessage('PlayerId:', playerId);
        Utils.logMessage('PlayerName:', playerName);
        Utils.logMessage('currentCastles:', currentCastles);
        Utils.logMessage('castles:', castles);
        Utils.logMessage(error);
        Utils.logMessage('=========== END STACK TRACE =============');
        this.DB_UPDATES.criticalErrors++;
      }
      // 2. Update player name if it has changed
      if (currentPlayerName != playerName && !this.playerRenamedList[playerId]) {
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
          Utils.logMessage(' [KO] Error while updating player name', playerId, '(name :', playerName, ')');
          Utils.logMessage('========== BEGIN STACK TRACE ============');
          Utils.logMessage('Identifier: 010');
          Utils.logMessage('PlayerId:', playerId);
          Utils.logMessage('PlayerName:', playerName);
          Utils.logMessage('currentPlayerName:', currentPlayerName);
          Utils.logMessage(error);
          Utils.logMessage('=========== END STACK TRACE =============');
          this.DB_UPDATES.criticalErrors++;
        }
      }
      // 3. Update player alliance if it has changed
      if (minimalist) return;
      if (currentAllianceId != allianceId) {
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
          await this.updatePlayerAlliance(playerId, allianceId, currentAllianceId);
        } catch (error) {
          if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code == '23503') {
            try {
              await this.addAllianceInDatabase(allianceId, allianceName);
              await this.updatePlayerAlliance(playerId, allianceId, currentAllianceId);
            } catch (error) {
              if (error.code !== 'ER_NO_REFERENCED_ROW_2' && error.code !== '23503') {
                // Do nothing
              } else {
                Utils.logMessage(' [KO] Error while updating player alliance', playerId, '(name :', playerName, ')');
                Utils.logMessage('========== BEGIN STACK TRACE ============');
                Utils.logMessage('Identifier: 091');
                Utils.logMessage('PlayerId:', playerId);
                Utils.logMessage('PlayerName:', playerName);
                Utils.logMessage('OldAllianceId:', currentAllianceId);
                Utils.logMessage('NewAllianceId:', allianceId);
                Utils.logMessage(error);
                Utils.logMessage('=========== END STACK TRACE =============');
              }
            }
          } else {
            this.DB_UPDATES.criticalErrors++;
            Utils.logMessage(' [KO] Error while updating player alliance', playerId, '(name :', playerName, ')');
            Utils.logMessage('========== BEGIN STACK TRACE ============');
            Utils.logMessage('Identifier: 019');
            Utils.logMessage('PlayerId:', playerId);
            Utils.logMessage('PlayerName:', playerName);
            Utils.logMessage('OldAllianceId:', currentAllianceId);
            Utils.logMessage('NewAllianceId:', allianceId);
            Utils.logMessage(error);
            Utils.logMessage('=========== END STACK TRACE =============');
          }
        }
      }
      // 4. Update alliance name if it has changed
      if (
        allianceId &&
        currentAllianceId == allianceId &&
        currentAllianceName != allianceName &&
        !this.allianceUpdated[allianceId]
      ) {
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
          Utils.logMessage(' [KO] Error while updating alliance name', playerId, '(name :', playerName, ')');
          Utils.logMessage('========== BEGIN STACK TRACE ============');
          Utils.logMessage('Identifier: 020');
          Utils.logMessage('PlayerId:', playerId);
          Utils.logMessage('PlayerName:', playerName);
          Utils.logMessage('currentAllianceId:', currentAllianceId);
          Utils.logMessage('allianceId:', allianceId);
          Utils.logMessage('currentAllianceName:', currentAllianceName);
          Utils.logMessage('allianceName:', allianceName);
          Utils.logMessage(error);
          Utils.logMessage('=========== END STACK TRACE =============');
          this.DB_UPDATES.criticalErrors++;
        }
      }
    }
  }

  private async addAllianceInDatabase(allianceId, allianceName): Promise<void> {
    const pgSqlQueryAlliance = 'INSERT INTO alliances (id, name) VALUES ($1, $2)';
    try {
      await Promise.all([this.pgSqlQuery(pgSqlQueryAlliance, [allianceId, allianceName])]);
    } catch (error) {
      if (error.code != '23505') {
        this.DB_UPDATES.criticalErrors++;
        Utils.logMessage(' [KO] Error while inserting alliance', allianceId, '(name :', allianceName, ')');
        Utils.logMessage('========== BEGIN STACK TRACE ============');
        Utils.logMessage('Identifier: 021');
        Utils.logMessage(error);
        Utils.logMessage('=========== END STACK TRACE =============');
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
    let clickhouse = new ClickHouse(this.CLICKHOUSE_CONFIG);
    const currentDateFormatted = format(date, 'yyyy-MM-dd HH:mm:ss');
    const clickhouseQuery = `INSERT INTO event_dates (table_name, created_at) VALUES ('${tableName}', '${currentDateFormatted}')`;
    try {
      await clickhouse.query(clickhouseQuery).toPromise();
    } catch (error) {
      Utils.logMessage('Error while adding event timestamp for table', tableName);
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 467');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async bulkUpdatePlayers(updates: Record<number, any[]>): Promise<void> {
    await this.pgSqlQuery(`
      CREATE TEMP TABLE tmp_players_update (
        id INTEGER PRIMARY KEY,
        might_current BIGINT,
        loot_current BIGINT,
        might_all_time BIGINT,
        loot_all_time BIGINT,
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
    const CHUNK_SIZE = 4000;
    const columns = [
      'id',
      'might_current',
      'loot_current',
      'might_all_time',
      'loot_all_time',
      //'alliance_rank',
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
    function chunkArray<T>(array: T[], chunkSize: number): T[][] {
      const result: T[][] = [];
      for (let i = 0; i < array.length; i += chunkSize) {
        result.push(array.slice(i, i + chunkSize));
      }
      return result;
    }
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
      const alliance_rank =
        Number(data[15]) && Number(data[15]) >= 0 && Number(data[15]) <= 100 ? Number(data[15]) : -1;
      insertValues.push([
        playerId,
        might_current,
        loot_current,
        might_current,
        loot_current,
        //alliance_rank,
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
    const chunks = chunkArray(insertValues, CHUNK_SIZE);
    Utils.logMessage('Loop chunks...');
    for (const chunk of chunks) {
      const valuesClause = chunk
        .map((_, rowIndex) => {
          const start = rowIndex * nbColumns + 1;
          const placeholders = Array(nbColumns)
            .fill(0)
            .map((_, colIndex) => `$${start + colIndex}`);
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
      const dbConnectionLimit = Number(this.DATABASE_CONFIG?.['connectionLimit']) || 5;
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
      for (const key of keys) {
        const playerId = Number(key);
        const loot_current = this.playerLootAndMightPointHistoryList[key][0] || 0;
        const might_current = this.playerLootAndMightPointHistoryList[key][1] || 0;
        const allianceId = this.playerLootAndMightPointHistoryList[key][2] || null;
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
        const allianceRank = this.playerLootAndMightPointHistoryList[key][15] || null;
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
            this.addPlayerInDatabase(
              playerId,
              playerName,
              allianceId,
              allianceName,
              might_current,
              null,
              loot_current,
              null,
              ap,
            ),
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
    } catch (error) {
      Utils.logMessage('Error updating player power and loot points');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 099');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
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
      const pgSqlQuery = `
        SELECT id
        FROM players
        WHERE updated_at < NOW() - INTERVAL '24 hours'
        AND castles IS NOT NULL
      `;
      const result = await this.pgSqlQuery(pgSqlQuery);
      //const ids = rows.map((row) => row.id);
      const ids = result.rows.map((row) => row.id);
      Utils.logMessage('Number of inactive players to update:', ids.length);
      for (const id of ids) {
        try {
          const url: string = encodeURI(this.BASE_API_URL + 'gdi' + `/"PID":${id}`);
          const response = await axios.get(url);
          const data = response.data;
          if (data && data.content && data.content) {
            const player = data.content;
            if (player && player['O']) {
              const allianceId = player['O']['AID'] || null;
              const allianceName = player['O']['AN'] || null;
              const might_current = player['O']['MP'] || 0;
              const loot_current = player['O']['P'] || 0;
              const playerName = player['O']['N'];
              const rpt = player['O']['RPT'] || 0;
              const level = player['O']['L'] || 0;
              const legendaryLevel = player['O']['LL'] || 0;
              const honor = player['O']['H'] || 0;
              const now = new Date();
              const targetDate = new Date(now.getTime() + rpt * 1000);
              const targetDateISO = targetDate.toISOString();
              let ap = player['O']['AP'] || null;
              if (ap && ap.length > 0) {
                ap = player['O']['AP'].filter((ap) => ap[0] === 0).map((ap) => [ap[2], ap[3], ap[4]]);
              }
              if (!ap) ap = null;
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
              await this.addPlayerInDatabase(
                id,
                playerName,
                allianceId,
                allianceName,
                might_current,
                null,
                loot_current,
                null,
                ap,
              );
              const params = [
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
              ];
              await this.pgSqlQuery(pgQuery, params);
            } else {
              await this.removePlayerFromDatabase(id);
            }
          } else if (data && data.error === 'Timeout') {
            // Player is not found, remove from database
            Utils.logMessage(' [Info] Player data timeout, removing player from database', id);
            await this.removePlayerFromDatabase(id);
          }
        } catch (error) {
          Utils.logMessage(' [KO] Error', id);
          Utils.logMessage('========== BEGIN STACK TRACE ============');
          Utils.logMessage('Identifier: 104');
          Utils.logMessage(error);
          Utils.logMessage('=========== END STACK TRACE =============');
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
            Utils.logMessage(' [KO] Error while updating player', id);
            Utils.logMessage('========== BEGIN STACK TRACE ============');
            Utils.logMessage('Identifier: 105');
            Utils.logMessage(error);
            Utils.logMessage('=========== END STACK TRACE =============');
            this.DB_UPDATES.criticalErrors++;
          }
        }
      }
    } catch (error) {
      Utils.logMessage('Error updating inactive players');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 100');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
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
        Object.entries(this.playerLootAndMightPointHistoryList).filter(([, val]) => val[4] && val[4].length > 1),
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
      // We get the number of players who are in protection and who are not new players (level >= 30)
      const playersInPeace = playerLootMightEntries.filter(
        ([, val]) => val[6] && val[6] > 0 && val[6] < 60 * 60 * 24 * 63 && val[8] && val[8] >= 30,
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
          point: player.point === null ? 0 : player.point,
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
      Utils.logMessage('MariaDB: Updating server statistics...');
      await this.pgSqlQuery(pgServerStatsQuery, params);
      Utils.logMessage('PostgreSQL: Updating server statistics...');
    } catch (error) {
      Utils.logMessage('Error updating server statistics');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 103');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
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
    const movements: CastleMovement[] = [];
    const currentMainCastle = parsedCurrentCastles.find((c) => c[2] === 1);
    const newMainCastle = parsedNewCastles.find((c) => c[2] === 1);
    let mainCastleMoved = false;

    if (currentMainCastle && newMainCastle) {
      const [xOld, yOld] = currentMainCastle;
      const [xNew, yNew] = newMainCastle;

      if (xOld !== xNew || yOld !== yNew) {
        movements.push({
          player_id: playerId,
          castle_type: 1,
          movement_type: 'move',
          position_x_old: xOld,
          position_y_old: yOld,
          position_x_new: xNew,
          position_y_new: yNew,
        });
        mainCastleMoved = true;
      }
    }

    for (const [key, castle] of currentCastlesMap) {
      const [xOld, yOld, type] = castle;
      if (type === 1 && mainCastleMoved) continue;
      if (!newCastlesMap.has(key) && !parsedNewCastles.some((c) => c[2] === type)) {
        movements.push({
          player_id: playerId,
          castle_type: type,
          movement_type: 'remove',
          position_x_old: xOld,
          position_y_old: yOld,
        });
      }
    }

    for (const [key, castle] of newCastlesMap) {
      const [xNew, yNew, type] = castle;
      if (type === 1 && mainCastleMoved) continue;
      if (!currentCastlesMap.has(key)) {
        movements.push({
          player_id: playerId,
          castle_type: type,
          movement_type: 'add',
          position_x_new: xNew,
          position_y_new: yNew,
        });
      }
    }
    return movements;
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
      Utils.logMessage('Error inserting castle movements');
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 104');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
    }
  }

  private async getDatabasePlayers(): Promise<PlayerDatabase[]> {
    if (this.DB_UPDATES.criticalErrors > 0) {
      Utils.logMessage(' [KO] There are critical errors, stopping the process getDatabasePlayers');
      return [];
    }
    Utils.logMessage('Database connection successful');
    const pgQuery = `
      SELECT P.id as player_id, P.alliance_id, P.name AS player_name, A.name AS alliance_name, P.castles
      FROM players P LEFT JOIN alliances A
      ON P.alliance_id = A.id
    `;
    const result = await this.pgSqlQuery(pgQuery);
    const rows = result.rows;
    return rows.map((row) => {
      const playerId = row.player_id;
      const allianceId = row.alliance_id;
      const playerName = row.player_name;
      const allianceName = row.alliance_name;
      const castles = row.castles;
      const parsedCastles: Castle[] = castles ?? [];
      return {
        playerId: playerId,
        allianceId: allianceId,
        playerName: playerName,
        allianceName: allianceName,
        castles: parsedCastles,
      };
    });
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
  ): Promise<void> {
    try {
      Utils.logMessage(' Executing custom event history for', eventName);
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
      let i = Math.ceil(increment / 2);
      let j = 0;
      const entities: Record<string, any> = {};
      let c = true;
      let data = await this.fetchDataAndReturn(lt, levelCategory, i);
      if (!data || data['return_code'] != '0') {
        if (i < 10) {
          Utils.logMessage(' [info] Invalid event (0)');
          return;
        } else {
          const tentatives = 3;
          let k = 0;
          while (k < tentatives && (!data || data['return_code'] != '0')) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            data = await this.fetchDataAndReturn(lt, levelCategory, i);
            k++;
          }
        }
      }
      if (!data || data['return_code'] != '0' || !data?.content?.LR) {
        Utils.logMessage(' [info] Invalid event (1)');
        return;
      }
      const max = data?.content?.LR ?? 50000;
      if (max && Number(max) >= 0) {
        const fr = data?.content?.FR;
        const igh = data?.content?.IGH;
        if (data?.content?.L) {
          const content = data.content.L;
          if (await this.checkEventAlreadyExists(content, result.rows, 'trace')) {
            Utils.logMessage(' [info] No new event to fill');
            return;
          }
          // Insert the new event
          Utils.logMessage(' [info] New event to fill');
          const firstPlayerId = content[0][2]['OID'];
          const firstPlayerScore = content[0][1];
          const collectDate = new Date();
          await this.pgSqlQuery(
            `
            INSERT INTO ${tableEventName} (event_num, collect_date, fr, igh, top1_player_id, top1_player_score)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
            [lastEventNum + 1, collectDate, fr, igh, firstPlayerId, firstPlayerScore],
          );
          while (c) {
            let p = await this.fetchDataAndReturn(lt, levelCategory, i);
            let fetchData = p?.content?.L ?? [];
            const tryTentatives = 7;
            let currentTry = 0;
            while (
              currentTry < tryTentatives &&
              (!p || p['return_code'] != '0' || !fetchData || fetchData.length === 0)
            ) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              p = await this.fetchDataAndReturn(lt, levelCategory, i);
              fetchData = p?.content?.L ?? [];
              currentTry++;
            }
            if (!fetchData || fetchData.length === 0) {
              Utils.logMessage('/!\\ No players found, but status OK');
              Utils.logMessage('========== BEGIN STACK TRACE ============');
              Utils.logMessage('Identifier: 002-' + eventName);
              Utils.logMessage('Url :', this.BASE_API_URL + 'hgh' + `/"LT":${lt},"LID":${levelCategory},"SV":"${i}"`);
              Utils.logMessage('Nb:', j + 'players found on', max);
              Utils.logMessage('p:', JSON.stringify(p));
              Utils.logMessage('=========== END STACK TRACE =============');
              this.DB_UPDATES.criticalErrors++;
              return;
            } else {
              const ids: number[] = [];
              for (const singleData of fetchData) {
                if (this.CURRENT_ENV === 'development') Utils.stdoudInfo(j, max);
                try {
                  ids.push(singleData[0]);
                  const playerId = singleData[2]['OID'];
                  const point = singleData[1];
                  const parts = String(singleData[2]['N']).split('_');
                  const server = parts[parts.length - 1];
                  const playerName = parts.slice(0, -1).join('_');
                  const rank = singleData[0];
                  entities[playerId.toString()] = {
                    rank: rank,
                    playerId: playerId,
                    playerName: playerName,
                    point: point,
                    server: server,
                    level: singleData[2]['L'],
                    legendaryLevel: singleData[2]['LL'],
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
          }
          Utils.logMessage(' [info] Total players found for the event of ' + eventName + ': ' + j);
          const batchSize = 3000;
          const entries = Object.entries(entities);

          const serverEntities = new Map();
          for (const [, entity] of entries) {
            if (!serverEntities.has(entity.server)) {
              serverEntities.set(entity.server, []);
            }
            serverEntities.get(entity.server).push(entity);
          }
          for (const [server, entitiesForServer] of serverEntities.entries()) {
            let dbConn;
            let dbName;
            Utils.logMessage(' [info] Processing server:', server);
            if (server === 'FR1') {
              dbConn = this.pgSqlConnection;
            } else {
              dbName =
                server === 'LIVE'
                  ? 'empire-ranking-world1'
                  : server === 'HANT'
                    ? 'empire-ranking-hant1'
                    : `empire-ranking-${server.toLowerCase()}`;
              const exists = await this.pgSqlQuery('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
              if (!exists.rowCount) continue; // skip if nonexistent
              // Create a temporary connection (or use a global pool if already created)
              dbConn = new pg.Pool({
                user: this.PGSQL_CONFIG.user,
                password: this.PGSQL_CONFIG.password,
                host: this.PGSQL_CONFIG.host,
                port: this.PGSQL_CONFIG.port,
                database: dbName,
              });
              await dbConn.connect();
              Utils.logMessage(' [info] Connected to database for server:', server);
            }
            // Retrieve all real player_ids at once
            const names = entitiesForServer.map((e) => e.playerName);
            Utils.logMessage(' [info] Count: ' + names.length + ' players to process for server ' + server);
            const res = await dbConn.query(
              `SELECT n AS name, MIN(p.id) AS id FROM unnest($1::text[]) n LEFT JOIN players p ON p.name = n GROUP BY n;`,
              [names],
            );
            Utils.logMessage(' [info] Retrieval of real player_ids completed');
            const nameToId = new Map(res.rows.map((r) => [r.name, r.id]));
            Utils.logMessage(' [info] Number of real player_ids retrieved:', nameToId.size);
            // Update each entity with the real player_id
            for (const entity of entitiesForServer) {
              entity.realPlayerId = nameToId.get(entity.playerName);
            }
          }
          Utils.logMessage(' [info] Insertion of players into the database for event ' + eventName);
          // Adding players
          for (let i = 0; i < entries.length; i += batchSize) {
            const chunk = entries.slice(i, i + batchSize);
            const insertValues: any[] = [];
            const valuesPlaceholders: string[] = [];
            let paramIndex = 1;
            for (const [playerId, entity] of chunk) {
              const playerIdNum = Number(playerId);
              if (Number.isNaN(playerIdNum)) {
                Utils.logMessage(' [info] Invalid player ID:', playerId);
                continue;
              }
              const { server, level, legendaryLevel, point, rank, realPlayerId, playerName } = entity;
              valuesPlaceholders.push(
                `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`,
              );
              insertValues.push(lastEventNum + 1, realPlayerId, server, level, legendaryLevel, point, rank, playerName);
              paramIndex += 8;
            }
            // Check if there are values to insert
            if (insertValues.length > 0) {
              const insertQuery = `
                INSERT INTO ${tableEventHistoryName}
                  (event_num, player_id, server, level, legendary_level, point, rank, player_name)
                VALUES
                  ${valuesPlaceholders.join(',\n')}
              `;
              Utils.logMessage(
                ` [info] Insertion of batch of ${insertValues.length / 8} players (batch ${Math.floor(i / batchSize) + 1})`,
              );
              await this.pgSqlQuery(insertQuery, insertValues);
            }
          }
          Utils.logMessage(' [info] Insertion of event data for ' + eventName + ' completed successfully');
        } else {
          Utils.logMessage(' [info] No data found for event ' + eventName);
          return;
        }
      } else {
        Utils.logMessage(' [info] No data found for event ' + eventName);
        return;
      }
    } catch (error) {
      Utils.logMessage('Error while filling event history for ' + eventName);
      Utils.logMessage('========== BEGIN STACK TRACE ============');
      Utils.logMessage('Identifier: 099');
      Utils.logMessage(error);
      Utils.logMessage('=========== END STACK TRACE =============');
      this.DB_UPDATES.criticalErrors++;
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

  private async pgSqlQuery(query: string, params: any[] = []): Promise<any> {
    try {
      if (!this.pgSqlConnection) {
        this.createNewPool();
      }
      return await this.pgSqlConnection.query(query, params);
    } catch (error) {
      const message = error?.message || '';
      if (
        message.includes('Connection terminated unexpectedly') ||
        message.includes('ECONNRESET') ||
        message.includes('timeout')
      ) {
        try {
          Utils.logMessage(' [WARN] Lost connection to PostgreSQL, attempting to reconnect...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          this.createNewPool();
        } catch {
          try {
            await new Promise((resolve) => setTimeout(resolve, 20000));
            this.createNewPool();
          } catch (err) {
            Utils.logMessage(' [CRITICAL] Error occurred while reconnecting to the database');
            Utils.logMessage('========== BEGIN STACK TRACE ============');
            Utils.logMessage('Identifier: 999');
            Utils.logMessage(err);
            Utils.logMessage('=========== END STACK TRACE =============');
            this.DB_UPDATES.criticalErrors++;
            throw new Error(`Error occurred while executing PostgreSQL query: ${error}`);
          }
        }
      } else {
        throw error;
      }
    }
  }

  private async logToLoki(message: string, labels = {}, level = 'info'): Promise<void> {
    const logEntry = {
      message,
      timestamp: new Date().toISOString(),
      ...labels,
    };
    const payload = {
      streams: [
        {
          stream: {
            job: 'cron-scraper',
            level,
            ...labels,
          },
          values: [[`${Date.now()}000000`, JSON.stringify(logEntry)]],
        },
      ],
    };
    try {
      const LOKI_URL = 'http://loki:3100/loki/api/v1/push';
      await axios.post(LOKI_URL, payload);
    } catch (err) {
      console.error('Error sending log to Loki:', err.message);
    }
  }

  private async stackTraceError(identifier: string, criticalError = false, error: string | string[]): Promise<void> {
    Utils.logMessage('========== BEGIN STACK TRACE ============');
    Utils.logMessage('Identifier: ' + identifier);
    if (Array.isArray(error)) {
      error.forEach((err) => Utils.logMessage(err));
    } else {
      Utils.logMessage(error);
    }
    Utils.logMessage('=========== END STACK TRACE =============');
    if (criticalError) this.DB_UPDATES.criticalErrors++;
  }
}
