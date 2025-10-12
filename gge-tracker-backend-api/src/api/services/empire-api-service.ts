import * as mysql from 'mysql';
import * as pg from 'pg';
import { ClickHouse } from 'clickhouse';
import { DatabaseManager } from './../databases';
import { ApiHelper } from './../api-helper';
import { IApiToken } from './../interfaces/interfaces';

/**
 * Enum representing the available GGE Tracker server identifiers.
 *
 * Each value corresponds to a specific game server region or type.
 * These identifiers are used to specify which server to interact with
 * when making API requests or handling server-specific logic.
 *
 * @enum {string}
 */
export enum GgeTrackerServers {
  ARAB1 = 'ARAB1',
  AU1 = 'AU1',
  BR1 = 'BR1',
  CZ1 = 'CZ1',
  DE1 = 'DE1',
  ES1 = 'ES1',
  FR1 = 'FR1',
  GLOBAL = 'GLOBAL',
  HANT1 = 'HANT1',
  CN1 = 'CN1',
  HU1 = 'HU1',
  HU2 = 'HU2',
  IN1 = 'IN1',
  INT1 = 'INT1',
  INT3 = 'INT3',
  IT1 = 'IT1',
  NL1 = 'NL1',
  PL1 = 'PL1',
  PT1 = 'PT1',
  RO1 = 'RO1',
  RU1 = 'RU1',
  SA1 = 'SA1',
  TR1 = 'TR1',
  US1 = 'US1',
  WORLD1 = 'WORLD1',
}

/**
 * The base name for all SQL databases used by the GGE Tracker servers.
 * This constant is used as a prefix when constructing full database names for each server.
 * The project first name is "empire-ranking", changed to "gge-tracker" for rebranding.
 * But SQL database name is not changed for legacy reason.
 */
export const BASE_SQL_DB_NAME = 'empire-ranking';
/** The base name for all OLAP databases used by the GGE Tracker servers.
 * This constant is used as a prefix when constructing full OLAP database names for each server.
 * The project first name is "empire-ranking", changed to "gge-tracker" for rebranding.
 * But OLAP database name is not changed for legacy reason.
 */
export const BASE_OLAP_DB_NAME = 'empire_ranking';

/**
 * Manages server configurations, database pools, and utility methods for the GGE Tracker API.
 *
 * The `ApiGgeTrackerManager` class extends `DatabaseManager` and provides:
 * - Centralized access to server metadata and database names for all supported GGE Tracker servers.
 * - Management of MySQL and PostgreSQL connection pools for each server.
 * - Utility methods to retrieve server information by name, code, or player ID.
 * - Methods to validate server names and codes.
 * - Access to OLAP and SQL database names, as well as ClickHouse instances.
 * - Helper methods for mapping between player IDs, server codes, zones, and database pools.
 *
 * @remarks
 * This class is intended to be a singleton or long-lived instance in the main script, as it manages connection pools.
 *
 */
export class ApiGgeTrackerManager extends DatabaseManager {
  /**
   * A mapping of connection pool instances for MySQL databases, keyed by a unique string identifier.
   * Each key corresponds to a specific database or configuration, allowing for efficient management
   * and reuse of multiple MySQL connection pools within the application.
   */
  private mysqlPools: { [key: string]: mysql.Pool } = {};
  /**
   * A mapping of unique string keys to PostgreSQL connection pools.
   * Each key represents a distinct database configuration or tenant,
   * allowing the service to manage multiple database connections efficiently.
   */
  private postgresPools: { [key: string]: pg.Pool } = {};

  /**
   * A mapping of all supported GGE Tracker servers to their respective API token configurations.
   *
   * Each key corresponds to a server identifier from `GgeTrackerServers`, and the value is an `IApiToken`
   * object containing database names, display names, server codes, and zone identifiers.
   *
   * This configuration is used to route API requests and database operations to the correct server context.
   *
   * @remarks
   * - The `databases` property includes both SQL and OLAP database names for each server.
   * - The `outer_name` is the display name or shorthand for the server.
   * - The `code` is a internal unique string identifier for the server. It must be exactly 3 characters long.
   * - The `zone` specifies the GGE EmpireEx zone associated with the server, used to identify the GGE server websocket.
   * - The `GLOBAL` entry is a special case with empty values, used for global operations.
   *
   * @see GgeTrackerServers
   * @see IApiToken
   */
  private readonly servers: { [K in keyof typeof GgeTrackerServers]: IApiToken } = {
    [GgeTrackerServers.FR1]: {
      databases: { sql: BASE_SQL_DB_NAME, olap: BASE_OLAP_DB_NAME },
      outer_name: 'FR1',
      code: '020',
      zone: 'EmpireEx_3',
    },
    [GgeTrackerServers.DE1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-de1', olap: BASE_OLAP_DB_NAME + '_de1' },
      outer_name: 'DE1',
      code: '010',
      zone: 'EmpireEx_2',
    },
    [GgeTrackerServers.CZ1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-cz1', olap: BASE_OLAP_DB_NAME + '_cz1' },
      outer_name: 'CZ1',
      code: '030',
      zone: 'EmpireEx_4',
    },
    [GgeTrackerServers.RO1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-ro1', olap: BASE_OLAP_DB_NAME + '_ro1' },
      outer_name: 'RO1',
      code: '040',
      zone: 'EmpireEx_15',
    },
    [GgeTrackerServers.NL1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-nl1', olap: BASE_OLAP_DB_NAME + '_nl1' },
      outer_name: 'NL1',
      code: '050',
      zone: 'EmpireEx_11',
    },
    [GgeTrackerServers.WORLD1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-world1', olap: BASE_OLAP_DB_NAME + '_world1' },
      outer_name: 'LIVE',
      code: '060',
      zone: 'EmpireEx_46',
    },
    [GgeTrackerServers.INT3]: {
      databases: { sql: BASE_SQL_DB_NAME + '-int3', olap: BASE_OLAP_DB_NAME + '_int3' },
      outer_name: 'INT3',
      code: '070',
      zone: 'EmpireEx_43',
    },
    [GgeTrackerServers.US1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-us1', olap: BASE_OLAP_DB_NAME + '_us1' },
      outer_name: 'US1',
      code: '080',
      zone: 'EmpireEx_21',
    },
    [GgeTrackerServers.TR1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-tr1', olap: BASE_OLAP_DB_NAME + '_tr1' },
      outer_name: 'TR1',
      code: '090',
      zone: 'EmpireEx_10',
    },
    [GgeTrackerServers.BR1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-br1', olap: BASE_OLAP_DB_NAME + '_BR1' },
      outer_name: 'BR1',
      code: '095',
      zone: 'EmpireEx_20',
    },
    [GgeTrackerServers.IN1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-in1', olap: BASE_OLAP_DB_NAME + '_IN1' },
      outer_name: 'IN1',
      code: '085',
      zone: 'EmpireEx_26',
    },
    [GgeTrackerServers.IT1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-it1', olap: BASE_OLAP_DB_NAME + '_IT1' },
      outer_name: 'IT1',
      code: '075',
      zone: 'EmpireEx_9',
    },
    [GgeTrackerServers.PL1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-pl1', olap: BASE_OLAP_DB_NAME + '_PL1' },
      outer_name: 'PL1',
      code: '065',
      zone: 'EmpireEx_5',
    },
    [GgeTrackerServers.PT1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-pt1', olap: BASE_OLAP_DB_NAME + '_PT1' },
      outer_name: 'PT1',
      code: '055',
      zone: 'EmpireEx_6',
    },
    [GgeTrackerServers.AU1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-au1', olap: BASE_OLAP_DB_NAME + '_au1' },
      outer_name: 'AU1',
      code: '045',
      zone: 'EmpireEx_22',
    },
    [GgeTrackerServers.ARAB1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-ar1', olap: BASE_OLAP_DB_NAME + '_ar1' },
      outer_name: 'ARAB1',
      code: '035',
      zone: 'EmpireEx_35',
    },
    [GgeTrackerServers.HANT1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-hant1', olap: BASE_OLAP_DB_NAME + '_hant1' },
      outer_name: 'HANT',
      code: '025',
      zone: 'EmpireEx_37',
    },
    [GgeTrackerServers.HU1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-hu1', olap: BASE_OLAP_DB_NAME + '_hu1' },
      outer_name: 'HU1',
      code: '015',
      zone: 'EmpireEx_12',
    },
    [GgeTrackerServers.HU2]: {
      databases: { sql: BASE_SQL_DB_NAME + '-hu2', olap: BASE_OLAP_DB_NAME + '_hu2' },
      outer_name: 'HU2',
      code: '014',
      zone: 'EmpireEx_17',
    },
    [GgeTrackerServers.ES1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-es1', olap: BASE_OLAP_DB_NAME + '_es1' },
      outer_name: 'ES1',
      code: '074',
      zone: 'EmpireEx_8',
    },
    [GgeTrackerServers.SA1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-sa1', olap: BASE_OLAP_DB_NAME + '_sa1' },
      outer_name: 'SA1',
      code: '073',
      zone: 'EmpireEx_32',
    },
    [GgeTrackerServers.INT1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-int1', olap: BASE_OLAP_DB_NAME + '_int1' },
      outer_name: 'INT1',
      code: '071',
      zone: 'EmpireEx',
    },
    [GgeTrackerServers.RU1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-ru1', olap: BASE_OLAP_DB_NAME + '_ru1' },
      outer_name: 'RU1',
      code: '031',
      zone: 'EmpireEx_14',
    },
    [GgeTrackerServers.CN1]: {
      databases: { sql: BASE_SQL_DB_NAME + '-cn1', olap: BASE_OLAP_DB_NAME + '_cn1' },
      outer_name: 'CN1',
      code: '026',
      zone: 'EmpireEx_27',
    },
    [GgeTrackerServers.GLOBAL]: {
      databases: { sql: BASE_SQL_DB_NAME + '-global', olap: '' },
      outer_name: '',
      code: '',
      zone: '',
    },
  };

  /**
   * Initializes a new instance of the service, creating connection pools for all configured SQL databases.
   *
   * This constructor calls the parent class constructor, retrieves all SQL database configurations,
   * and initializes MySQL and PostgreSQL connection pools, assigning them to the respective properties.
   */
  constructor() {
    super();
    try {
      this.checkServerConfig();
      const { mysql, postgres } = this.createConnectionPools(this.getAllSqlDatabases());
      this.mysqlPools = mysql;
      this.postgresPools = postgres;
    } catch (error) {
      console.error('Error initializing ApiGgeTrackerManager:', error);
      throw error;
    }
  }

  /**
   * Retrieves the API token associated with the specified server name.
   *
   * @param serverName - The name of the server for which to retrieve the API token.
   * @returns The `IApiToken` object if found; otherwise, `null` if the server name does not exist.
   */
  public get(serverName: string): IApiToken | null {
    return this.servers[serverName] || null;
  }

  /**
   * Checks if the provided server name exists in the list of available servers.
   *
   * @param serverName - The name of the server to validate.
   * @returns `true` if the server name is valid and exists in the servers list; otherwise, `false`.
   */
  public isValidServer(serverName: string): boolean {
    return serverName in this.servers;
  }

  /**
   * Checks if the provided code is a valid server code.
   *
   * A valid code must be a non-empty string of length 3 and must match the code of one of the servers.
   *
   * @param code - The server code to validate.
   * @returns `true` if the code is valid; otherwise, `false`.
   */
  public isValidCode(code: string): boolean {
    if (!code || typeof code !== 'string' || code.length !== 3) {
      return false;
    }
    return Object.values(this.servers).some((server) => server.code === code);
  }

  /**
   * Retrieves the API token object for the specified outer server name.
   *
   * @param serverName - The name of the outer server to search for.
   * @returns The corresponding `IApiToken` object if found; otherwise, `null`.
   */
  public getOuterServer(serverName: GgeTrackerServers): IApiToken | null {
    return Object.values(this.servers).find((server) => server.outer_name === serverName) || null;
  }

  /**
   * Retrieves the server information associated with the specified code.
   *
   * @param code - The unique code identifying the server.
   * @returns The corresponding `IApiToken` object if the code is valid and a matching server is found; otherwise, returns `null`.
   */
  public getServerByCode(code: string): IApiToken | null {
    if (this.isValidCode(code)) {
      return Object.values(this.servers).find((server) => server.code === code) || null;
    }
    return null;
  }

  /**
   * Retrieves the zone associated with a given player ID by matching the player's country code
   * to the corresponding server entry.
   *
   * @param playerId - The unique identifier of the player whose zone is to be determined.
   * @returns The zone string if a matching server entry is found; otherwise, returns null.
   */
  public getZoneFromRequestId(playerId: number): string | null {
    const entry = Object.entries(this.servers).find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return entry[1].zone;
    }
    return null;
  }

  /**
   * Retrieves the zone associated with a given server code.
   *
   * @param code - The unique code identifying the server.
   * @returns The zone string if the server is found; otherwise, `null`.
   */
  public getZoneFromCode(code: string): string | null {
    const server = this.getServerByCode(code);
    return server ? server.zone : null;
  }

  /**
   * Retrieves the server name associated with a given player ID.
   *
   * This method searches through the available servers and returns the server name
   * whose code matches the country code derived from the provided player ID.
   *
   * @param playerId - The unique identifier of the player.
   * @returns The server name as a string if a matching server is found; otherwise, `null`.
   */
  public getServerNameFromRequestId(playerId: number): string | null {
    const entry = Object.entries(this.servers).find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return entry[0];
    }
    return null;
  }

  /**
   * Retrieves the MySQL connection pool associated with the specified server name.
   *
   * @param serverName - The name of the server for which to obtain the MySQL pool.
   * @returns The MySQL pool instance if found; otherwise, `null`.
   */
  public getSqlPool(serverName: string): mysql.Pool | null {
    return this.mysqlPools[serverName] || null;
  }

  /**
   * Retrieves the PostgreSQL connection pool associated with the specified server name.
   *
   * @param serverName - The name of the server for which to obtain the PostgreSQL pool.
   * @returns The `pg.Pool` instance for the given server name, or `null` if no pool exists.
   */
  public getPgSqlPool(serverName: string): pg.Pool | null {
    return this.postgresPools[serverName] || null;
  }

  /**
   * Retrieves the PostgreSQL connection pool associated with the given player ID.
   *
   * This method determines the appropriate server based on the player's country code,
   * then returns the corresponding PostgreSQL pool if available.
   *
   * @param playerId - The unique identifier of the player.
   * @returns The PostgreSQL pool associated with the player's server, or `null` if not found.
   */
  public getPgSqlPoolFromRequestId(playerId: number): pg.Pool | null {
    const entry = Object.entries(this.servers).find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return this.postgresPools[entry[0]] || null;
    }
    return null;
  }

  /**
   * Retrieves the PostgreSQL connection pool associated with the global server.
   *
   * @returns The `pg.Pool` instance for the global server if available; otherwise, `null`.
   */
  public getGlobalPgSqlPool(): pg.Pool | null {
    return this.postgresPools[GgeTrackerServers.GLOBAL] || null;
  }

  /**
   * Retrieves the OLAP database name associated with a given player ID.
   *
   * This method searches through the available servers to find the one whose country code
   * matches the country code derived from the provided player ID. If a matching server is found,
   * it returns the corresponding OLAP database name; otherwise, it returns `null`.
   *
   * @param playerId - The unique identifier of the player whose OLAP database is to be retrieved.
   * @returns The name of the OLAP database if found; otherwise, `null`.
   */
  public getOlapDatabaseFromRequestId(playerId: number): string | null {
    const entry = Object.entries(this.servers).find(
      (token) => token[1].code === ApiHelper.getCountryCode(playerId.toString()),
    );
    if (entry) {
      return entry[1].databases.olap || null;
    }
    return null;
  }

  /**
   * Retrieves the SQL database name associated with the specified server.
   *
   * @param serverName - The name of the server to look up.
   * @returns The name of the SQL database if the server exists; otherwise, `null`.
   */
  public getSqlDatabase(serverName: string): string | null {
    const server = this.get(serverName);
    return server ? server.databases.sql : null;
  }

  /**
   * Retrieves the OLAP database name associated with the specified server.
   *
   * @param serverName - The name of the server to look up.
   * @returns The OLAP database name if the server exists; otherwise, `null`.
   */
  public getOlapDatabase(serverName: string): string | null {
    const server = this.get(serverName);
    return server ? server.databases.olap : null;
  }

  /**
   * Retrieves a mapping of all SQL database connection strings for each server defined in `GgeTrackerServers`.
   *
   * @returns An object where each key corresponds to a server name from `GgeTrackerServers` and the value is the associated SQL database connection string.
   */
  public getAllSqlDatabases(): { [K in keyof typeof GgeTrackerServers]: string } {
    return Object.fromEntries(Object.entries(this.servers).map(([key, server]) => [key, server.databases.sql])) as {
      [K in keyof typeof GgeTrackerServers]: string;
    };
  }

  /**
   * Retrieves a mapping of all OLAP database connection strings for each server defined in `GgeTrackerServers`.
   *
   * @returns An object where each key corresponds to a server name from `GgeTrackerServers` and each value is the associated OLAP database connection string.
   */
  public getAllOlapDatabases(): { [K in keyof typeof GgeTrackerServers]: string } {
    return Object.fromEntries(Object.entries(this.servers).map(([key, server]) => [key, server.databases.olap])) as {
      [K in keyof typeof GgeTrackerServers]: string;
    };
  }

  /**
   * Retrieves the names of all available servers.
   *
   * @returns {string[]} An array containing the names of all servers.
   */
  public getAllServerNames(): string[] {
    return Object.keys(this.servers);
  }

  /**
   * Creates and returns a new instance of the ClickHouse client configured with environment variables.
   *
   * @returns {Promise<ClickHouse>} A promise that resolves to a configured ClickHouse client instance.
   *
   * The client is set to connect over HTTP on port 8123, with JSON format responses and no gzip compression.
   * Additional configuration options such as session timeout and output formatting are also set.
   */
  public async getClickHouseInstance(): Promise<ClickHouse> {
    // Note : in the future, the port need to be extracted from env variable if needed
    return new ClickHouse({
      url: 'http://' + process.env.CLICKHOUSE_HOST + ':8123',
      port: 8123,
      basicAuth: { username: process.env.CLICKHOUSE_USER, password: process.env.CLICKHOUSE_PASSWORD },
      isUseGzip: false,
      format: 'json',
      config: {
        session_timeout: 60,
        output_format_json_quote_64bit_integers: 0,
        enable_http_compression: 0,
      },
    });
  }

  /**
   * Retrieves the list of SQL event table names used for OLAP (Online Analytical Processing) operations.
   *
   * @returns {string[]} An array of table names as strings.
   */
  public getOlapEventTables(): string[] {
    return this.SQL_EVENT_TABLES;
  }

  /**
   * Validates the server configuration stored on this.servers.
   *
   * Performs the following checks for each configured server:
   * 1. Ensures the server code is exactly 3 characters long, except for the special
   *    case identified by GgeTrackerServers.GLOBAL.
   * 2. Verifies that none of the configured database identifiers (SQL or OLAP)
   *    contain the literal string 'null', which indicates a misconfiguration.
   * 3. Detects duplicate server codes across different server entries and reports
   *    all other server keys that share the same code.
   *
   * If any of the above validations fail, an Error is thrown describing the
   * specific problem and the affected server(s).
   *
   * @throws {Error} If a non-global server has a code length different from 3.
   * @throws {Error} If any database name (SQL or OLAP) contains the string 'null'.
   * @throws {Error} If one or more other servers share the same server code (duplicates).
   * @returns {void} No return value; function will throw on invalid configuration.
   */
  private checkServerConfig(): void {
    Object.entries(this.servers).forEach(([key, server]) => {
      if (server.code.length !== 3 && key !== GgeTrackerServers.GLOBAL) {
        throw new Error(`Server code for ${key} must be exactly 3 characters long.`);
      } else if (server.databases.sql.includes('null') || server.databases.olap.includes('null')) {
        throw new Error(`Server ${key} has 'null' in its database name, please check the configuration.`);
      }
      const duplicates = Object.entries(this.servers).filter(
        ([otherKey, otherServer]) => otherKey !== key && otherServer.code === server.code,
      );
      if (duplicates.length > 0) {
        const duplicateKeys = duplicates.map(([dupKey]) => dupKey).join(', ');
        throw new Error(`Server code ${server.code} for ${key} is duplicated in servers: ${duplicateKeys}`);
      }
    });
  }
}
