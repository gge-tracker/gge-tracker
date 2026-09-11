/**
 * Represents an API token with associated database connection strings and metadata.
 *
 * @property databases - An object containing connection strings for SQL and OLAP databases.
 * @property databases.sql - The connection string for the SQL database.
 * @property databases.olap - The connection string for the OLAP database.
 * @property outer_name - The outer name associated with the token.
 * @property code - The unique code identifying the token.
 * @property zone - The zone or region associated with the token.
 */
export interface IApiToken {
  databases: {
    sql: string;
    olap: string;
  };
  outer_name: string;
  zoneId?: number;
  code: string;
  zone: string;
  serverResetOffset?: number;
}

export interface ILimitedApiToken {
  outer_name: string;
  zone: string;
  zoneId?: number;
  disabled: boolean;
}

export type ServerKind = 'ep' | 'e4k' | 'partner' | 'global' | 'internal';

export interface IServerDefinition {
  name: string;
  kind: ServerKind;
  enabled: boolean;
  featured: boolean;
  special: boolean;
  ggeServerName: string;
  outerName: string;
  country: string;
  code: string;
  zone: string;
  zoneId?: number;
  resetOffset?: number;
  databases: {
    sql: string;
    olap: string;
  };
  scraping?: {
    section: string;
    connectionLimit: number;
    dungeon: boolean;
    storm: boolean;
  };
}

export type SqlPrimitive = string | number | boolean | Date | null;

export type SqlValue = SqlPrimitive | readonly SqlPrimitive[];

export interface SqlCondition {
  sql: string;
  value?: SqlValue;
}

export type ParsedValue = number | string | boolean | number[] | string[] | undefined;

export interface QueryField<T> {
  parse: (value: unknown) => T;
}
