import { NodeClickHouseClient } from '@clickhouse/client/dist/client';
import * as pg from 'pg';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { ApiHelper } from '../helper/api-helper';
import { IApiToken, ILimitedApiToken, IServerDefinition } from '../interfaces/interfaces';
import { DatabaseManager } from './database.manager';
import { ServersCatalog } from './servers-catalog';

/**
 * Manages server configurations, database pools, and utility methods for the GGE Tracker API
 *
 * The `ApiGgeTrackerManager` class extends `DatabaseManager` and provides:
 * - Centralized access to server metadata and database names for all supported GGE Tracker servers
 * - Management of PostgreSQL connection pools for each server
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
   * A mapping of unique string keys to PostgreSQL connection pools
   * Each key represents a distinct database configuration or tenant,
   * allowing the service to manage multiple database connections efficiently
   */
  private readonly postgresPools: { [key: string]: pg.Pool } = {};

  /**
   * Configuration settings for connecting to the ClickHouse OLAP database
   */
  private readonly configuration = {
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
  private readonly clickhouseClient: NodeClickHouseClient;

  /**
   * The catalog of every GGE server, read from config/servers.xml
   */
  private readonly catalog = new ServersCatalog();

  /**
   * The catalog projected onto the shape the routes consume
   */
  private servers: { [serverName: string]: IApiToken | ILimitedApiToken } = {};

  /**
   * Reads the servers file, opens a pool per activated server and follows the file from then on
   */
  constructor() {
    super();
    try {
      this.catalog.load();
      this.servers = this.buildServers();
      const { postgres, clickhouse } = this.createConnectionPools(this.poolTargets());
      this.postgresPools = postgres;
      this.clickhouseClient = clickhouse;
      this.catalog.onReload(() => this.applyCatalog());
      this.catalog.watch();
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
    return (this.servers[serverName] as IApiToken) || null;
  }

  /**
   * Checks if the provided server name exists in the list of available servers
   *
   * @param serverName - The name of the server to validate
   * @returns `true` if the API serves that server; otherwise, `false`
   */
  public isValidServer(serverName: string): boolean {
    return serverName in this.servers && 'code' in this.servers[serverName];
  }

  /**
   * Retrieves a list of all activated server API tokens
   *
   * @returns An array of `IApiToken` objects representing the activated servers
   */
  public getActivatedServerValues(): IApiToken[] {
    return Object.values(this.servers).filter((server) => 'code' in server);
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

  public getServerResetOffsetByCode(code: string): number | null {
    const server = this.getServerByCode(code);
    if (server && 'serverResetOffset' in server && typeof server.serverResetOffset === 'number') {
      return server.serverResetOffset;
    }
    return null;
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

  public getZoneIdFromCode(code: string): number | null {
    const server = this.getServerByCode(code);
    return server ? server.zoneId : null;
  }

  /**
   * Retrieves the server code associated with a given outer server name
   * @param outerName - The outer name of the server to search for
   * @returns The server code as a string if a matching server is found; otherwise, `null`
   */
  public getCodeFromOuterName(outerName: string): string | null {
    const server = this.getActivatedServerValues().find((server) => server.outer_name === outerName);
    return server ? server.code : null;
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

  public getServerNameFromCode(code: string): string | null {
    const entry = this.getActivatedServerEntries().find((token) => token[1].code === code);
    if (entry) {
      return entry[0];
    }
    return null;
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
   * Retrieves the OLAP database name associated with a given server code
   *
   * This method searches through the available servers to find the one whose code matches the provided code
   *
   * @param code - The unique code identifying the server
   * @returns The name of the OLAP database if a matching server is found; otherwise, `null`
   */
  public getOlapDatabaseFromCode(code: string): string | null {
    const server = this.getServerByCode(code);
    return server ? server.databases.olap : null;
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
  public getAllSqlDatabases(): Record<string, string> {
    return Object.fromEntries(this.getActivatedServerEntries().map(([key, server]) => [key, server.databases.sql]));
  }

  /**
   * Retrieves a mapping of all OLAP database connection strings for each server defined in `GgeTrackerServersEnum`
   *
   * @returns An object where each key corresponds to a server name from `GgeTrackerServersEnum` and each value is the associated OLAP database connection string
   */
  public getAllOlapDatabases(): Record<string, string> {
    return Object.fromEntries(this.getActivatedServerEntries().map(([key, server]) => [key, server.databases.olap]));
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
   * Retrieves the full description of a server as config/servers.xml declares it
   *
   * @param serverName - The name of the server to look up
   * @returns The `IServerDefinition` if the file describes it; otherwise, `null`
   */
  public getServerDefinition(serverName: string): IServerDefinition | null {
    return this.catalog.getDefinition(serverName);
  }

  /**
   * Retrieves the servers the public catalog advertises, in the order the file declares them
   *
   * @returns The `IServerDefinition` list of every playable server, scraping jobs excluded
   */
  public getPublicServerDefinitions(): IServerDefinition[] {
    return this.catalog
      .getDefinitions()
      .filter((definition) => definition.kind === 'ep' || definition.kind === 'e4k' || definition.kind === 'partner');
  }

  /**
   * Checks whether a server carries the kingdoms data the castle, dungeons and storms routes need
   *
   * @param serverName - The name of the server to check
   * @returns `true` when the file marks it special; otherwise, `false`
   */
  public isSpecialServer(serverName: string): boolean {
    return this.catalog.getDefinition(serverName)?.special === true;
  }

  /**
   * Retrieves the names of the servers the kingdoms routes accept, for the messages that list them
   *
   * @returns {string[]} An array containing the names of all special servers
   */
  public getSpecialServerNames(): string[] {
    return this.catalog
      .getDefinitions()
      .filter((definition) => definition.special)
      .map((definition) => definition.name);
  }

  /**
   * Retrieves the path of the servers file this instance reads
   *
   * @returns {string} The absolute path of config/servers.xml
   */
  public getServersFile(): string {
    return this.catalog.getFile();
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
   * A server enabled on the host mid-flight has no pool yet, so the reload opens the missing ones
   */
  private applyCatalog(): void {
    this.servers = this.buildServers();
    for (const [serverName, database] of Object.entries(this.poolTargets())) {
      if (this.postgresPools[serverName]) continue;
      this.postgresPools[serverName] = this.createPostgresPool(database);
      console.log(`[DB] Postgres connection pool created for ${serverName} with database ${database}`);
    }
  }

  /**
   * Every provisioned database, disabled servers included: GLOBAL is never served but is queried,
   * and a server enabled on the host is then ready without waiting for a pool
   */
  private poolTargets(): Record<string, string> {
    return Object.fromEntries(
      this.catalog
        .getDefinitions()
        .filter((definition) => ServersCatalog.isProvisioned(definition))
        .map((definition) => [definition.name, definition.databases.sql]),
    );
  }

  private buildServers(): { [serverName: string]: IApiToken | ILimitedApiToken } {
    const servers: { [serverName: string]: IApiToken | ILimitedApiToken } = {};
    for (const definition of this.catalog.getDefinitions()) {
      if (definition.kind === 'internal') continue;
      servers[definition.name] = ServersCatalog.isServable(definition)
        ? {
            databases: { ...definition.databases },
            outer_name: definition.outerName,
            zoneId: definition.zoneId,
            code: definition.code,
            zone: definition.zone,
            serverResetOffset: definition.resetOffset,
          }
        : {
            outer_name: definition.outerName,
            zone: definition.zone,
            zoneId: definition.zoneId,
            disabled: true,
          };
    }
    console.log(
      `[SERVERS] ${Object.values(servers).filter((server) => 'code' in server).length} served, ` +
        `${Object.keys(servers).length} known`,
    );
    return servers;
  }
}
