import { NodeClickHouseClient } from '@clickhouse/client/dist/client';
import * as mysql from 'mysql';
import * as pg from 'pg';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { GgeTrackerSqlBaseNameEnum } from '../enums/gge-tracker-sql-base-name.enums';
import { ApiHelper } from '../helper/api-helper';
import { IApiToken, ILimitedApiToken } from '../interfaces/interfaces';
import { DatabaseManager } from './database.manager';

/**
 * Manages server configurations, database pools, and utility methods for the GGE Tracker API
 *
 * The `ApiGgeTrackerManager` class extends `DatabaseManager` and provides:
 * - Centralized access to server metadata and database names for all supported GGE Tracker servers
 * - Management of MySQL and PostgreSQL connection pools for each server
 * - Utility methods to retrieve server information by name, code, or player ID
 * - Methods to validate server names and codes
 * - Access to OLAP and SQL database names, as well as ClickHouse instances
 * - Helper methods for mapping between player IDs, server codes, zones, and database pools
 *
 * @remarks
 * This class is intended to be a singleton or long-lived instance in the main script, as it manages connection pools
 *
 */
export class ApiGgeTrackerManager extends DatabaseManager {
  /**
   * A mapping of connection pool instances for MySQL databases, keyed by a unique string identifier
   * Each key corresponds to a specific database or configuration, allowing for efficient management
   * and reuse of multiple MySQL connection pools within the application
   */
  private mysqlPools: { [key: string]: mysql.Pool } = {};
  /**
   * A mapping of unique string keys to PostgreSQL connection pools
   * Each key represents a distinct database configuration or tenant,
   * allowing the service to manage multiple database connections efficiently
   */
  private postgresPools: { [key: string]: pg.Pool } = {};

  /**
   * Configuration settings for connecting to the ClickHouse OLAP database
   */
  private configuration = {
    clickhouse: {
      scheme: 'http',
      port: 8123,
      host: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER,
      password: process.env.CLICKHOUSE_PASSWORD,
    },
  };
  /**
   * Instance of ClickHouse client for OLAP database interactions
   */
  private clickhouseClient: NodeClickHouseClient;

  /**
   * A mapping of all supported GGE Tracker servers to their respective API token configurations
   *
   * Each key corresponds to a server identifier from `GgeTrackerServersEnum`, and the value is an `IApiToken`
   * object containing database names, display names, server codes, and zone identifiers
   *
   * This configuration is used to route API requests and database operations to the correct server context
   *
   * @remarks
   * - The `databases` property includes both SQL (MariaDB/PostgreSQL) and OLAP database names for each server
   * - The `outer_name` is the display name or shorthand for the server
   * - The `code` is a internal unique string identifier for the server. It must be exactly 3 characters long
   * - The `zone` specifies the GGE EmpireEx zone associated with the server, used to identify the GGE server websocket
   * - The `GLOBAL` entry is a special case with empty values, used for global operations
   *
   * @see GgeTrackerServersEnum
   * @see IApiToken
   */
  private readonly servers: { [K in keyof typeof GgeTrackerServersEnum]: IApiToken | ILimitedApiToken } = {
    [GgeTrackerServersEnum.INT1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-int1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_int1',
      },
      outer_name: 'INT1',
      code: '071',
      zone: 'EmpireEx',
    },
    [GgeTrackerServersEnum.DE1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-de1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_de1',
      },
      outer_name: 'DE1',
      code: '010',
      zone: 'EmpireEx_2',
    },
    [GgeTrackerServersEnum.FR1]: {
      databases: { sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME, olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME },
      outer_name: 'FR1',
      code: '020',
      zone: 'EmpireEx_3',
    },
    [GgeTrackerServersEnum.CZ1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-cz1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_cz1',
      },
      outer_name: 'CZ1',
      code: '030',
      zone: 'EmpireEx_4',
    },
    [GgeTrackerServersEnum.PL1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-pl1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_PL1',
      },
      outer_name: 'PL1',
      code: '065',
      zone: 'EmpireEx_5',
    },
    [GgeTrackerServersEnum.PT1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-pt1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_PT1',
      },
      outer_name: 'PT1',
      code: '055',
      zone: 'EmpireEx_6',
    },
    [GgeTrackerServersEnum.INT2]: {
      outer_name: 'INT2',
      zone: 'EmpireEx_7',
      disabled: true,
    },
    [GgeTrackerServersEnum.ES1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-es1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_es1',
      },
      outer_name: 'ES1',
      code: '074',
      zone: 'EmpireEx_8',
    },
    [GgeTrackerServersEnum.IT1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-it1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_IT1',
      },
      outer_name: 'IT1',
      code: '075',
      zone: 'EmpireEx_9',
    },
    [GgeTrackerServersEnum.TR1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-tr1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_tr1',
      },
      outer_name: 'TR1',
      code: '090',
      zone: 'EmpireEx_10',
    },
    [GgeTrackerServersEnum.NL1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-nl1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_nl1',
      },
      outer_name: 'NL1',
      code: '050',
      zone: 'EmpireEx_11',
    },
    [GgeTrackerServersEnum.HU1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-hu1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_hu1',
      },
      outer_name: 'HU1',
      code: '015',
      zone: 'EmpireEx_12',
    },
    [GgeTrackerServersEnum.SKN1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-skn1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_skn1',
      },
      outer_name: 'SKN1',
      zone: 'EmpireEx_13',
      code: '193',
    },
    [GgeTrackerServersEnum.RU1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-ru1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_ru1',
      },
      outer_name: 'RU1',
      code: '031',
      zone: 'EmpireEx_14',
    },
    [GgeTrackerServersEnum.RO1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-ro1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_ro1',
      },
      outer_name: 'RO1',
      code: '040',
      zone: 'EmpireEx_15',
    },
    [GgeTrackerServersEnum.BG1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-bg1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_bg1',
      },
      outer_name: 'BG1',
      code: '012',
      zone: 'EmpireEx_16',
    },
    [GgeTrackerServersEnum.HU2]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-hu2',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_hu2',
      },
      outer_name: 'HU2',
      code: '014',
      zone: 'EmpireEx_17',
    },
    [GgeTrackerServersEnum.SK1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-sk1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_sk1',
      },
      outer_name: 'SK1',
      zone: 'EmpireEx_18',
      code: '013',
    },
    [GgeTrackerServersEnum.GB1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-gb1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_gb1',
      },
      outer_name: 'GB1',
      zone: 'EmpireEx_19',
      code: '201',
    },
    [GgeTrackerServersEnum.BR1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-br1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_BR1',
      },
      outer_name: 'BR1',
      code: '095',
      zone: 'EmpireEx_20',
    },
    [GgeTrackerServersEnum.US1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-us1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_us1',
      },
      outer_name: 'US1',
      code: '080',
      zone: 'EmpireEx_21',
    },
    [GgeTrackerServersEnum.AU1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-au1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_au1',
      },
      outer_name: 'AU1',
      code: '045',
      zone: 'EmpireEx_22',
    },
    [GgeTrackerServersEnum.KR1]: {
      outer_name: 'KR1',
      zone: 'EmpireEx_23',
      disabled: true,
    },
    [GgeTrackerServersEnum.JP1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-jp1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_jp1',
      },
      outer_name: 'JP1',
      code: '087',
      zone: 'EmpireEx_24',
    },
    [GgeTrackerServersEnum.HIS1]: {
      outer_name: 'HIS1',
      zone: 'EmpireEx_25',
      disabled: true,
    },
    [GgeTrackerServersEnum.IN1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-in1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_IN1',
      },
      outer_name: 'IN1',
      code: '085',
      zone: 'EmpireEx_26',
    },
    [GgeTrackerServersEnum.CN1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-cn1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_cn1',
      },
      outer_name: 'CN1',
      code: '026',
      zone: 'EmpireEx_27',
    },
    [GgeTrackerServersEnum.GR1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-gr1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_gr1',
      },
      outer_name: 'GR1',
      code: '011',
      zone: 'EmpireEx_28',
    },
    [GgeTrackerServersEnum.LT1]: {
      outer_name: 'LT1',
      zone: 'EmpireEx_29',
      disabled: true,
    },
    // EmpireEx_30 does not exist
    // EmpireEx_31 does not exist
    [GgeTrackerServersEnum.SA1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-sa1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_sa1',
      },
      outer_name: 'SA1',
      code: '073',
      zone: 'EmpireEx_32',
    },
    [GgeTrackerServersEnum.AE1]: {
      outer_name: 'AE1',
      zone: 'EmpireEx_33',
      disabled: true,
    },
    [GgeTrackerServersEnum.EG1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-eg1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_eg1',
      },
      outer_name: 'EG1',
      zone: 'EmpireEx_34',
      code: '267',
    },
    [GgeTrackerServersEnum.ARAB1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-ar1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_ar1',
      },
      outer_name: 'ARAB1',
      code: '035',
      zone: 'EmpireEx_35',
    },
    [GgeTrackerServersEnum.ASIA]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-asia',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_asia',
      },
      outer_name: 'ASIA',
      zone: 'EmpireEx_36',
      code: '459',
    },
    [GgeTrackerServersEnum.HANT1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-hant1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_hant1',
      },
      outer_name: 'HANT',
      code: '025',
      zone: 'EmpireEx_37',
    },
    [GgeTrackerServersEnum.ES2]: {
      outer_name: 'ES2',
      zone: 'EmpireEx_38',
      disabled: true,
    },
    // EmpireEx_39 does not exist
    // EmpireEx_40 does not exist
    // EmpireEx_41 does not exist
    // EmpireEx_42 does not exist
    [GgeTrackerServersEnum.INT3]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-int3',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_int3',
      },
      outer_name: 'INT3',
      code: '070',
      zone: 'EmpireEx_43',
    },
    [GgeTrackerServersEnum.WORLD1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-world1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_DB_NAME + '_world1',
      },
      outer_name: 'LIVE',
      code: '060',
      zone: 'EmpireEx_46',
    },
    [GgeTrackerServersEnum.GLOBAL]: {
      databases: { sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_DB_NAME + '-global', olap: '' },
      outer_name: '',
      code: '',
      zone: '',
    },
    [GgeTrackerServersEnum.E4K_HANT1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-hant1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_hant1',
      },
      outer_name: 'E4K_HANT1',
      code: '462',
      zone: 'EmpirefourkingdomsExGG_30',
    },
    [GgeTrackerServersEnum.E4K_BR1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-br1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_br1',
      },
      outer_name: 'E4K_BR1',
      code: '202',
      zone: 'EmpirefourkingdomsExGG_13',
    },
    [GgeTrackerServersEnum.E4K_FR1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-fr1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_fr1',
      },
      outer_name: 'E4K_FR1',
      code: '164',
      zone: 'EmpirefourkingdomsExGG_2',
    },
    [GgeTrackerServersEnum.E4K_DE1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-de1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_de1',
      },
      outer_name: 'E4K_DE1',
      code: '121',
      zone: 'EmpirefourkingdomsExGG',
    },
    [GgeTrackerServersEnum.E4K_DE2]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-de2',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_de2',
      },
      outer_name: 'E4K_DE2',
      code: '192',
      zone: 'EmpirefourkingdomsExGG_28',
    },
    [GgeTrackerServersEnum.E4K_US1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-us1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_us1',
      },
      outer_name: 'E4K_US1',
      code: '203',
      zone: 'EmpirefourkingdomsExGG_4',
    },
    [GgeTrackerServersEnum.E4K_INT2]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-int2',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_int2',
      },
      outer_name: 'E4K_INT2',
      code: '186',
      zone: 'EmpirefourkingdomsExGG_21',
    },
    [GgeTrackerServersEnum.E4K_CN1]: {
      databases: {
        sql: GgeTrackerSqlBaseNameEnum.BASE_SQL_E4K_DB_NAME + '-cn1',
        olap: GgeTrackerSqlBaseNameEnum.BASE_OLAP_E4K_DB_NAME + '_cn1',
      },
      outer_name: 'E4K_CN1',
      code: '216',
      zone: 'EmpirefourkingdomsExGG_16',
    },
  };

  /**
   * Initializes a new instance of the service, creating connection pools for all configured SQL databases
   *
   * This constructor calls the parent class constructor, retrieves all SQL database configurations,
   * and initializes MySQL and PostgreSQL connection pools, assigning them to the respective properties
   */
  constructor() {
    super();
    try {
      this.checkServerConfig();
      const { mysql, postgres, clickhouse } = this.createConnectionPools(this.getAllSqlDatabases());
      this.mysqlPools = mysql;
      this.postgresPools = postgres;
      this.clickhouseClient = clickhouse;
    } catch (error) {
      console.error('Error initializing ApiGgeTrackerManager:', error);
      throw error;
    }
  }

  /**
   * Retrieves the API token associated with the specified server name
   *
   * @param serverName - The name of the server for which to retrieve the API token
   * @returns The `IApiToken` object if found; otherwise, `null` if the server name does not exist
   */
  public get(serverName: string): IApiToken | null {
    return this.servers[serverName] || null;
  }

  /**
   * Checks if the provided server name exists in the list of available servers
   *
   * @param serverName - The name of the server to validate
   * @returns `true` if the server name is valid and exists in the servers list; otherwise, `false`
   */
  public isValidServer(serverName: string): boolean {
    return serverName in this.servers;
  }

  /**
   * Retrieves a list of all activated server API tokens
   *
   * @returns An array of `IApiToken` objects representing the activated servers
   */
  public getActivatedServerValues(): IApiToken[] {
    return Object.values(this.servers).filter((server) => 'code' in server) as IApiToken[];
  }

  /**
   * Retrieves a list of all activated server entries as [serverName, IApiToken] tuples
   * @returns An array of tuples, each containing the server name and its corresponding `IApiToken` object
   */
  public getActivatedServerEntries(): [string, IApiToken][] {
    return Object.entries(this.servers).filter(([, server]) => 'code' in server) as [string, IApiToken][];
  }

  /**
   * Checks if the provided code is a valid server code
   * A valid code must be a non-empty string of length 3 and must match the code of one of the servers
   *
   * @param code - The server code to validate
   * @returns `true` if the code is valid; otherwise, `false`
   */
  public isValidCode(code: string): boolean {
    if (!code || typeof code !== 'string' || code.length !== 3) {
      return false;
    }
    return this.getActivatedServerValues().some((server) => server.code === code);
  }

  /**
   * Retrieves the API token object for the specified outer server name
   *
   * @param serverName - The name of the outer server to search for
   * @returns The corresponding `IApiToken` object if found; otherwise, `null`
   */
  public getOuterServer(serverName: GgeTrackerServersEnum): IApiToken | null {
    return this.getActivatedServerValues().find((server) => server.outer_name === serverName) || null;
  }

  /**
   * Retrieves the server information associated with the specified code
   *
   * @param code - The unique code identifying the server
   * @returns The corresponding `IApiToken` object if the code is valid and a matching server is found; otherwise, returns `null`
   */
  public getServerByCode(code: string): IApiToken | null {
    if (this.isValidCode(code)) {
      return this.getActivatedServerValues().find((server) => server.code === code) || null;
    }
    return null;
  }

  public getServerByZone(zone: string): IApiToken | ILimitedApiToken | null {
    return Object.values(this.servers).find((server) => server.zone === zone) || null;
  }

  /**
   * Retrieves the zone associated with a given player ID by matching the player's country code
   * to the corresponding server entry
   *
   * @param playerId - The unique identifier of the player whose zone is to be determined
   * @returns The zone string if a matching server entry is found; otherwise, returns null
   */
  public getZoneFromRequestId(playerId: number): string | null {
    const entry = this.getActivatedServerEntries().find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return entry[1].zone;
    }
    return null;
  }

  /**
   * Retrieves the zone associated with a given server code
   *
   * @param code - The unique code identifying the server
   * @returns The zone string if the server is found; otherwise, `null`
   */
  public getZoneFromCode(code: string): string | null {
    const server = this.getServerByCode(code);
    return server ? server.zone : null;
  }

  /**
   * Retrieves the server name associated with a given player ID
   *
   * This method searches through the available servers and returns the server name
   * whose code matches the country code derived from the provided player ID
   *
   * @param playerId - The unique identifier of the player
   * @returns The server name as a string if a matching server is found; otherwise, `null`
   */
  public getServerNameFromRequestId(playerId: number): string | null {
    const entry = this.getActivatedServerEntries().find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return entry[0];
    }
    return null;
  }

  /**
   * Retrieves the MySQL connection pool associated with the specified server name
   *
   * @param serverName - The name of the server for which to obtain the MySQL pool
   * @returns The MySQL pool instance if found; otherwise, `null`
   */
  public getSqlPool(serverName: string): mysql.Pool | null {
    return this.mysqlPools[serverName] || null;
  }

  /**
   * Retrieves the PostgreSQL connection pool associated with the specified server name
   *
   * @param serverName - The name of the server for which to obtain the PostgreSQL pool
   * @returns The `pg.Pool` instance for the given server name, or `null` if no pool exists
   */
  public getPgSqlPool(serverName: string): pg.Pool | null {
    return this.postgresPools[serverName] || null;
  }

  /**
   * Retrieves the PostgreSQL connection pool associated with the given player ID
   *
   * This method determines the appropriate server based on the player's country code,
   * then returns the corresponding PostgreSQL pool if available
   *
   * @param playerId - The unique identifier of the player
   * @returns The PostgreSQL pool associated with the player's server, or `null` if not found
   */
  public getPgSqlPoolFromRequestId(playerId: number): pg.Pool | null {
    const entry = this.getActivatedServerEntries().find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return this.postgresPools[entry[0]] || null;
    }
    return null;
  }

  /**
   * Retrieves the PostgreSQL connection pool associated with the global server
   *
   * @returns The `pg.Pool` instance for the global server if available; otherwise, `null`
   */
  public getGlobalPgSqlPool(): pg.Pool | null {
    return this.postgresPools[GgeTrackerServersEnum.GLOBAL] || null;
  }

  /**
   * Retrieves the OLAP database name associated with a given player ID
   *
   * This method searches through the available servers to find the one whose country code
   * matches the country code derived from the provided player ID. If a matching server is found,
   * it returns the corresponding OLAP database name; otherwise, it returns `null`
   *
   * @param playerId - The unique identifier of the player whose OLAP database is to be retrieved
   * @returns The name of the OLAP database if found; otherwise, `null`
   */
  public getOlapDatabaseFromRequestId(playerId: number): string | null {
    const entry = this.getActivatedServerEntries().find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return entry[1].databases.olap || null;
    }
    return null;
  }

  /**
   * Retrieves the SQL database name associated with the specified server
   *
   * @param serverName - The name of the server to look up
   * @returns The name of the SQL database if the server exists; otherwise, `null`
   */
  public getSqlDatabase(serverName: string): string | null {
    const server = this.get(serverName);
    return server ? server.databases.sql : null;
  }

  /**
   * Retrieves the OLAP database name associated with the specified server
   *
   * @param serverName - The name of the server to look up
   * @returns The OLAP database name if the server exists; otherwise, `null`
   */
  public getOlapDatabase(serverName: string): string | null {
    const server = this.get(serverName);
    return server ? server.databases.olap : null;
  }

  /**
   * Retrieves a mapping of all SQL database connection strings for each server defined in `GgeTrackerServersEnum`
   *
   * @returns An object where each key corresponds to a server name from `GgeTrackerServersEnum` and the value is the associated SQL database connection string
   */
  public getAllSqlDatabases(): { [K in keyof typeof GgeTrackerServersEnum]: string } {
    return Object.fromEntries(this.getActivatedServerEntries().map(([key, server]) => [key, server.databases.sql])) as {
      [K in keyof typeof GgeTrackerServersEnum]: string;
    };
  }

  /**
   * Retrieves a mapping of all OLAP database connection strings for each server defined in `GgeTrackerServersEnum`
   *
   * @returns An object where each key corresponds to a server name from `GgeTrackerServersEnum` and each value is the associated OLAP database connection string
   */
  public getAllOlapDatabases(): { [K in keyof typeof GgeTrackerServersEnum]: string } {
    return Object.fromEntries(
      this.getActivatedServerEntries().map(([key, server]) => [key, server.databases.olap]),
    ) as {
      [K in keyof typeof GgeTrackerServersEnum]: string;
    };
  }

  /**
   * Retrieves the names of all available servers
   *
   * @returns {string[]} An array containing the names of all servers
   */
  public getAllServerNames(): string[] {
    // A available server is any server defined in this.servers as IApiToken and not ILimitedApiToken
    return Object.keys(this.servers).filter((key) => 'code' in this.servers[key]);
  }

  /**
   * Constructs and returns the ClickHouse database connection URL based on the current configuration
   * @returns {string} The ClickHouse connection URL in the format: scheme://host:port
   */
  public getClickHouseUrl(): string {
    return `${this.configuration.clickhouse.scheme}://${this.configuration.clickhouse.host}:${this.configuration.clickhouse.port}`;
  }

  /**
   * Retrieves the ClickHouse database credentials from the configuration
   * @returns {{ username: string; password: string }} The ClickHouse credentials including username and password
   */
  public getClickHouseCredentials(): { username: string; password: string } {
    return {
      username: this.configuration.clickhouse.username || '',
      password: this.configuration.clickhouse.password || '',
    };
  }

  /**
   * Creates and returns a new instance of the ClickHouse client configured with environment variables
   *
   * @returns {Promise<NodeClickHouseClient>} A promise that resolves to a configured ClickHouse client instance
   *
   * The client is set to connect over HTTP on port 8123, with JSON format responses and no gzip compression
   * Additional configuration options such as session timeout and output formatting are also set
   */
  public async getClickHouseInstance(): Promise<NodeClickHouseClient> {
    return this.clickhouseClient;
  }

  /**
   * Retrieves the list of SQL event table names used for OLAP (Online Analytical Processing) operations
   *
   * @returns {string[]} An array of table names as strings
   */
  public getOlapEventTables(): string[] {
    return this.SQL_EVENT_TABLES;
  }

  /**
   * Validates the server configuration stored on this.servers
   *
   * Performs the following checks for each configured server:
   * 1. Ensures the server code is exactly 3 characters long, except for the special
   *    case identified by GgeTrackerServersEnum.GLOBAL
   * 2. Verifies that none of the configured database identifiers (SQL or OLAP)
   *    contain the literal string 'null', which indicates a misconfiguration
   * 3. Detects duplicate server codes across different server entries and reports
   *    all other server keys that share the same code
   *
   * If any of the above validations fail, an Error is thrown describing the
   * specific problem and the affected server(s)
   *
   * @throws {Error} If a non-global server has a code length different from 3
   * @throws {Error} If any database name (SQL or OLAP) contains the string 'null'
   * @throws {Error} If one or more other servers share the same server code (duplicates)
   * @returns {void} No return value; function will throw on invalid configuration
   */
  private checkServerConfig(): void {
    this.getActivatedServerEntries().forEach(([key, server]) => {
      if (server.code.length !== 3 && key !== GgeTrackerServersEnum.GLOBAL) {
        throw new Error(`Server code for ${key} must be exactly 3 characters long.`);
      } else if (server.databases.sql.includes('null') || server.databases.olap.includes('null')) {
        throw new Error(`Server ${key} has 'null' in its database name, please check the configuration.`);
      }
      const duplicates = this.getActivatedServerEntries().filter(
        ([otherKey, otherServer]) => otherKey !== key && otherServer.code === server.code,
      );
      if (duplicates.length > 0) {
        const duplicateKeys = duplicates.map(([dupKey]) => dupKey).join(', ');
        throw new Error(`Server code ${server.code} for ${key} is duplicated in servers: ${duplicateKeys}`);
      }
    });
  }
}
