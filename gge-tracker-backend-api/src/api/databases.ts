import * as mysql from 'mysql';
import * as pg from 'pg';

/**
 * Manages the creation and organization of MySQL and PostgreSQL connection pools for multiple databases.
 *
 * @remarks
 * This class provides utility methods to create and manage connection pools for both MySQL and PostgreSQL databases.
 * It also maintains a list of SQL event table names relevant to the application's domain.
 */
export class DatabaseManager {
  /**
   * List of SQL table names that store historical event data for players.
   *
   * These tables track various event histories such as Berimond Invasion, Berimond Kingdom,
   * Bloodcrow, Nomad, Samurai, War Realms, as well as player loot and might history.
   *
   * @readonly
   */
  public readonly SQL_EVENT_TABLES = [
    'player_event_berimond_invasion_history',
    'player_event_berimond_kingdom_history',
    'player_event_bloodcrow_history',
    'player_event_nomad_history',
    'player_event_samurai_history',
    'player_event_war_realms_history',
    'player_loot_history',
    'player_might_history',
  ];

  /**
   * Creates and returns a MySQL connection pool for the specified database.
   *
   * @param dbName - The name of the database to connect to.
   * @returns A MySQL connection pool instance configured with environment variables and the specified database.
   */
  protected createConnectionPool(dbName: string): mysql.Pool {
    return mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: dbName,
      connectionLimit: 15,
      timeout: 10 * 1000,
    });
  }

  /**
   * Creates and returns a new PostgreSQL connection pool for the specified database.
   *
   * @param dbName - The name of the PostgreSQL database to connect to.
   * @returns A new instance of `pg.Pool` configured with the provided database name and environment variables for connection details.
   *
   * @remarks
   * The pool is configured with a maximum of 100 connections, an idle timeout of 10 seconds,
   * and a connection timeout of 10 seconds. Connection details such as host, user, and password
   * are sourced from environment variables: `POSTGRES_HOST`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.
   */
  protected createPostgresPool(dbName: string): pg.Pool {
    return new pg.Pool({
      host: process.env.POSTGRES_HOST,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: dbName,
      port: 5432,
      max: 100,
      idleTimeoutMillis: 10 * 1000,
      connectionTimeoutMillis: 10 * 1000,
    });
  }

  /**
   * Creates and initializes MySQL and PostgreSQL connection pools for the provided database names.
   *
   * For each entry in the `dbNames` object, this method attempts to create a MySQL connection pool
   * (skipping the "GLOBAL" key) and a PostgreSQL connection pool. It logs the creation of each pool
   * and handles any errors that occur during pool creation.
   *
   * @param dbNames - An object mapping pool keys to database names.
   * @returns An object containing two properties:
   *   - `mysql`: An object mapping keys to MySQL connection pools.
   *   - `postgres`: An object mapping keys to PostgreSQL connection pools.
   */
  protected createConnectionPools(dbNames: { [key: string]: string }): {
    mysql: { [key: string]: mysql.Pool };
    postgres: { [key: string]: pg.Pool };
  } {
    const mysqlPools: { [key: string]: mysql.Pool } = {};
    const postgresPools: { [key: string]: pg.Pool } = {};
    console.log('[DB] Creating connection pools...');
    for (const [key, dbName] of Object.entries(dbNames)) {
      try {
        if (key !== 'GLOBAL') mysqlPools[key] = this.createConnectionPool(dbName);
        postgresPools[key] = this.createPostgresPool(dbName);
        console.log(`[DB] Connection pool created for ${key} with database ${dbName}`);
        console.log(`[DB] Postgres connection pool created for ${key} with database ${dbName}`);
      } catch (error) {
        console.error(`[DB] Error creating connection pools for ${key}:`, error);
      }
    }
    return {
      mysql: mysqlPools,
      postgres: postgresPools,
    };
  }
}
