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
  code: string;
  zone: string;
}

export interface ILimitedApiToken {
  outer_name: string;
  zone: string;
  disabled: boolean;
}
