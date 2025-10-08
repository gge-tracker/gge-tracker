import { RedisClientType } from 'redis';
import { ApiGgeTrackerManager } from './services/empire-api-service';
import * as crypto from 'node:crypto';
import * as express from 'express';

/**
 * Represents standard HTTP status codes used in API responses.
 *
 * @enum {number}
 * @property {number} OK - The request has succeeded (200).
 * @property {number} CREATED - The request has been fulfilled and resulted in a new resource being created (201).
 * @property {number} BAD_REQUEST - The server could not understand the request due to invalid syntax (400).
 * @property {number} UNAUTHORIZED - The client must authenticate itself to get the requested response (401).
 * @property {number} FORBIDDEN - The client does not have access rights to the content (403).
 * @property {number} NOT_FOUND - The server can not find the requested resource (404).
 * @property {number} INTERNAL_SERVER_ERROR - The server has encountered a situation it doesn't know how to handle (500).
 */
enum Status {
  OK = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  INTERNAL_SERVER_ERROR = 500,
}

/**
 * Abstract utility class providing helper methods and constants for API operations.
 *
 * @remarks
 * This class includes app constants, configurations, and utility methods for error logging,
 * cache management, data validation, hashing, country code manipulation, etc.
 *
 * Most methods and properties are static and intended to be used without instantiation.
 *
 * @public
 * @abstract
 */
export abstract class ApiHelper {
  public static readonly PAGINATION_LIMIT = 15;
  public static readonly REDIS_KEY_GGE_VERSION = 'gge_build_version';
  public static readonly MAX_RESULT_PAGE = 999_999_999;
  public static readonly HTTP_OK = Status.OK;
  public static readonly HTTP_CREATED = Status.CREATED;
  public static readonly HTTP_BAD_REQUEST = Status.BAD_REQUEST;
  public static readonly HTTP_UNAUTHORIZED = Status.UNAUTHORIZED;
  public static readonly HTTP_FORBIDDEN = Status.FORBIDDEN;
  public static readonly HTTP_NOT_FOUND = Status.NOT_FOUND;
  public static readonly HTTP_INTERNAL_SERVER_ERROR = Status.INTERNAL_SERVER_ERROR;
  public static readonly GGE_BASE_URL = 'https://empire-html5.goodgamestudios.com';
  public static readonly ASSETS_BASE_URL = this.GGE_BASE_URL + '/default';
  public static readonly CONFIG_BASE_URL = this.GGE_BASE_URL + '/config';
  public static readonly APPLICATION_TIMEZONE = 'Europe/Paris';
  public static readonly API_VERSION = '25.09.14-beta';
  public static readonly API_VERSION_RELEASE_DATE = this.formatReleaseDate(this.API_VERSION);

  public static file: Buffer | null = null;
  public static redisClient: RedisClientType<any>;
  public static ggeTrackerManager: ApiGgeTrackerManager;
  public static readonly GGE_SUPPORTED_LANGUAGES = [
    'en',
    'ar',
    'pt',
    'es',
    'de',
    'nl',
    'sv',
    'bg',
    'fr',
    'zh_CN',
    'el',
    'cs',
    'da',
    'fi',
    'hu',
    'id',
    'it',
    'ja',
    'ko',
    'ru',
    'lt',
    'no',
    'pl',
    'ro',
    'sk',
    'tr',
    'zh_TW',
    'pt_PT',
    'uk',
    'lv',
    'hr',
    'ms',
    'sr',
    'th',
    'vn',
    'sl',
    'et',
  ];
  public static readonly HTTP_MESSAGE = {
    [Status.OK]: 'OK',
    [Status.CREATED]: 'Created',
    [Status.BAD_REQUEST]: 'Bad Request',
    [Status.UNAUTHORIZED]: 'Unauthorized',
    [Status.FORBIDDEN]: 'Forbidden',
    [Status.NOT_FOUND]: 'Not Found',
    [Status.INTERNAL_SERVER_ERROR]: 'An internal server error occurred. Please try again later.',
  };

  /**
   * Returns an HTTP response object containing the status code and its corresponding message.
   *
   * @param status - The HTTP status code for which the response message is required.
   * @returns An object with the HTTP status code and its associated message. If the status code is not recognized,
   *          the message will be "Unknown Status".
   */
  public static getHttpMessageResponse(status: number): { code: number; message: string } {
    return {
      code: status,
      message: this.HTTP_MESSAGE[status as Status] || 'Unknown Status',
    };
  }

  /**
   * Applies ANSI color codes to each line of the provided text for terminal output.
   *
   * @param text - The text to be colorized, potentially containing multiple lines.
   * @param color - The ANSI color code to apply at the start of each line (e.g., '\u001b[31m' for red).
   * @param reset - The ANSI reset code to apply at the end of each line (e.g., '\u001b[0m').
   * @returns The input text with ANSI color codes applied to each line.
   */
  public static colorize(text: string, color: string, reset: string): string {
    return text
      .split('\n')
      .map((line) => `${color}${line}${reset}`)
      .join('\n');
  }

  /**
   * Logs detailed error information to the console, including a unique identifier,
   * error message, stack trace, method name, request query, params, and body.
   *
   * @param error - The error object or value to log. If an instance of Error, its message and stack trace are included.
   * @param methodName - The name of the method where the error occurred.
   * @param request - The Express request object associated with the error, used to log query, params, and body.
   */
  public static logError(error: any, methodName: string, request: express.Request): void {
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const redColor = '\u001B[31m';
    const resetColor = '\u001B[0m';
    console.log('');
    const colorize = (text: string): string => this.colorize(text, redColor, resetColor);
    console.log(colorize(`----- ERROR LOG START #${uniqueId} -----`));
    console.log(colorize(`* Unique ID: ${uniqueId}`));
    if (error instanceof Error) {
      console.log(colorize(`* Error message: ${error.message}`));
      console.log(colorize(`* Stack trace:\n${error.stack || ''}`));
    } else {
      console.error(colorize(`* Error:\n${String(error)}`));
    }
    console.log(colorize(`* Method: ${methodName}`));
    if (request?.query) console.log(colorize(`* Query:\n${JSON.stringify(request.query, null, 2)}`));
    if (request?.params) console.log(colorize(`* Params:\n${JSON.stringify(request.params, null, 2)}`));
    console.log(colorize(`----- ERROR LOG END #${uniqueId} -----`));
  }

  /**
   * Asynchronously retrieves the contents of the `assets.json` file located in the `./assets` directory.
   * Utilizes a cached value if available to avoid redundant file system reads.
   *
   * @returns {Promise<Buffer>} A promise that resolves to the contents of the `assets.json` file as a Buffer.
   * @throws Will throw an error if the file cannot be read.
   */
  public static async getAssets(): Promise<Buffer> {
    if (this.file) return this.file;
    const fs = await import('node:fs');
    const path = await import('node:path');
    this.file = await fs.promises.readFile(path.join(__dirname, './assets/assets.json'));
    return this.file;
  }

  /**
   * Updates the Redis cache with the specified key and data.
   *
   * @param key - The cache key under which the data will be stored.
   * @param data - The data to be cached. If `noJsonMode` is false, this will be stringified as JSON.
   * @param cacheTTL - The time-to-live (TTL) for the cache entry in seconds. Defaults to 1200 seconds.
   * @param noJsonMode - If true, stores the data as-is without JSON stringification. Defaults to false.
   * @returns A promise that resolves when the cache has been updated.
   * @remarks
   * If an error occurs during the cache update, it will be logged to the console with a timestamp.
   */
  public static async updateCache(key: string, data: any, cacheTTL = 1200, noJsonMode = false): Promise<void> {
    try {
      await (noJsonMode
        ? this.redisClient.setEx(key, cacheTTL, data)
        : this.redisClient.setEx(key, cacheTTL, JSON.stringify(data)));
    } catch (error) {
      const date = new Date().toISOString();
      console.error(`[${date}] Redis cache update error for key "${key}":`, error);
    }
  }

  /**
   * Verifies and sanitizes a username for search purposes.
   *
   * - If the username is `null` or an empty string, returns an empty string.
   * - If the username exceeds 40 characters, returns `false`.
   * - Otherwise, returns the username as a trimmed, lowercase string.
   *
   * @param username - The username to verify and sanitize.
   * @returns `false` if the username is too long, an empty string if `null` or empty, or the sanitized username string.
   */
  public static verifySearch(username: string | null): false | string {
    if (!username) return '';
    return username && username.length > 40 ? false : String(username).trim().toLowerCase();
  }

  /**
   * Generates an MD5 hash of the provided string value.
   *
   * @param value - The input string to hash.
   * @returns The hexadecimal representation of the MD5 hash.
   */
  public static hashValue(value: string): string {
    return crypto.createHash('md5').update(value).digest('hex');
  }

  /**
   * Verifies and converts a user ID to a number if it meets specific criteria.
   *
   * The user ID is considered valid if:
   * - It is a numeric value.
   * - It is greater than or equal to 0.
   * - It is less than or equal to 99,999,999,999.
   * - Its string representation has more than 3 characters.
   *
   * @param userId - The user ID to verify, as a string or number.
   * @returns The numeric user ID if valid; otherwise, `false`.
   */
  public static getVerifiedId(userId: string | number): false | number {
    if (
      Number.isNaN(Number(userId)) ||
      Number(userId) < 0 ||
      Number(userId) > 99_999_999_999 ||
      String(userId).length <= 3
    ) {
      return false;
    }
    return Number(userId);
  }

  /**
   * Removes the last three characters from the given term, which is assumed to represent a country code.
   *
   * @param term - The input string or number from which the country code should be removed.
   * @returns The input term as a string with the last three characters removed. If an error occurs, returns the original term as a string.
   */
  public static removeCountryCode(term: string | number): string {
    try {
      return `${term}`.slice(0, -3);
    } catch {
      return `${term}`;
    }
  }

  /**
   * Appends a country code to the given term.
   *
   * @param term - The base string to which the country code will be appended.
   * @param countryCode - The country code to append to the term.
   * @returns The concatenated string of term and countryCode, or null if term is falsy.
   *          If an error occurs, returns the original term.
   */
  public static addCountryCode(term: string, countryCode: string): string | null {
    try {
      if (!term) return null;
      return `${term}${countryCode}`;
    } catch {
      return term;
    }
  }

  /**
   * Extracts the last three characters from the provided string, which are assumed to represent a country code.
   *
   * @param term - The input string from which to extract the country code.
   * @returns The last three characters of the input string as the country code.
   * @throws {Error} If an error occurs while extracting the country code.
   */
  public static getCountryCode(term: string): string {
    try {
      return term.slice(-3);
    } catch {
      throw new Error('Error getting country code');
    }
  }

  /**
   * Attempts to fetch a resource from the specified URL, with up to three retries on failure.
   * If the URL starts with "https://empire-html5.goodgamestudios.com/default/", it rewrites the URL
   * to use a CDN proxy. If the URL ends with ".json", the response is parsed as JSON and returned
   * with the appropriate "Content-Type" header.
   *
   * @param url - The URL to fetch.
   * @returns A Promise that resolves to a Response object containing the fetched data.
   * @throws An error if all retry attempts fail or if the network response is not ok.
   */
  public static async fetchWithFallback(url: string): Promise<Response> {
    const retries = 3;
    // Rewrite URL to use CDN proxy if it matches the specified pattern
    if (url?.startsWith('https://empire-html5.goodgamestudios.com/default/')) {
      url = 'https://cdn.gge-tracker.com?url=' + url;
      console.log(`[CDN] Rewritten URL to use CDN proxy: ${url}`);
    }
    for (let index = 0; index < retries; index++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        if (url.endsWith('.json')) {
          const json = await response.json();
          return new Response(JSON.stringify(json), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return response;
      } catch (error) {
        console.error('Fetch error:', error);
        if (index === retries - 1) throw error;
      }
    }
    throw new Error('Max retries reached');
  }

  /**
   * Sets the Redis client instance to be used by the API helper.
   *
   * @param redisClient - An instance of `RedisClientType` to be used for Redis operations.
   */
  public static setRedisClient(redisClient: RedisClientType<any>): void {
    this.redisClient = redisClient;
  }

  /**
   * Sets the instance of the GGE Tracker Manager to be used by the API helper.
   *
   * @param ggeTrackerManager - An instance of {@link ApiGgeTrackerManager} to be assigned.
   */
  public static setGgeTrackerManager(ggeTrackerManager: ApiGgeTrackerManager): void {
    this.ggeTrackerManager = ggeTrackerManager;
  }

  /**
   * Formats a version string into a release date string in the format `YYYY-MM-DD`.
   *
   * The version string is expected to be in the format `YY.MM.DD-beta` or `YY.MM.DD-alpha`.
   * The method removes the `-beta` or `-alpha` suffix if present, then parses the year, month, and day.
   * The year is assumed to be in the 2000s (e.g., `25` becomes `2025`).
   *
   * @param version - The version string to format (e.g., "25.01.01-beta").
   * @returns The formatted release date string (e.g., "2025-01-01"), or "Unknown" if the input format is invalid.
   */
  private static formatReleaseDate(version: string): string {
    try {
      if (version.endsWith('-beta')) {
        version = version.slice(0, -5);
      } else if (version.endsWith('-alpha')) {
        version = version.slice(0, -6);
      }
      const parts = version.split('.');
      if (parts.length !== 3) {
        return 'Unknown';
      }
      const year = Number.parseInt(parts[0], 10) + 2000;
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return 'Unknown';
    }
  }
}
