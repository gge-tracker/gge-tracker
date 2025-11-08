import { RedisClientType } from 'redis';
import { ApiGgeTrackerManager } from '../managers/api.manager';
import * as crypto from 'node:crypto';
import * as express from 'express';
import { Status } from '../enums/http-status.enums';
import { ApiInputErrorType, ApiInvalidInputType, ApiUndefinedInputType } from '../types/parameter.types';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';

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
  /**
   * Application-wide timezone used for parsing, formatting and displaying dates/times.
   * @deprecated @todo Remove this constant and migrate to using UTC everywhere.
   */
  public static readonly APPLICATION_TIMEZONE = 'Europe/Paris';
  public static readonly API_VERSION = '25.11.02-beta';
  public static readonly API_VERSION_RELEASE_DATE = this.formatReleaseDate(this.API_VERSION);

  /**
   * Supported language codes for the official Goodgame Empire assets and translations.
   */
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
    [Status.OK]: RouteErrorMessagesEnum.GenericOk,
    [Status.CREATED]: RouteErrorMessagesEnum.GenericCreated,
    [Status.BAD_REQUEST]: RouteErrorMessagesEnum.GenericBadRequest,
    [Status.UNAUTHORIZED]: RouteErrorMessagesEnum.GenericUnauthorized,
    [Status.FORBIDDEN]: RouteErrorMessagesEnum.GenericForbidden,
    [Status.NOT_FOUND]: RouteErrorMessagesEnum.GenericNotFound,
    [Status.INTERNAL_SERVER_ERROR]: RouteErrorMessagesEnum.GenericInternalServerError,
  };

  private static _file: Buffer | null = null;
  private static _redisClient: RedisClientType<any>;
  private static _ggeTrackerManager: ApiGgeTrackerManager;

  public static set file(file: Buffer) {
    this._file = file;
  }

  public static get file(): Buffer | null {
    return this._file;
  }

  public static set redisClient(client: RedisClientType<any>) {
    this._redisClient = client;
  }

  public static get redisClient(): RedisClientType<any> {
    return this._redisClient;
  }

  public static set ggeTrackerManager(api: ApiGgeTrackerManager) {
    this._ggeTrackerManager = api;
  }

  public static get ggeTrackerManager(): ApiGgeTrackerManager {
    return this._ggeTrackerManager;
  }

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
      message: this.HTTP_MESSAGE[status as Status] || RouteErrorMessagesEnum.GenericUnknownStatus,
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
    this.file = await fs.promises.readFile(path.join(__dirname, './../assets/assets.json'));
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
  public static async updateCache(key: string, data: any, cacheTTL = 3600, noJsonMode = false): Promise<void> {
    try {
      await (noJsonMode
        ? this.redisClient.setEx(key, cacheTTL, data)
        : this.redisClient.setEx(key, cacheTTL, JSON.stringify(data)));
    } catch (error) {
      const date = new Date().toISOString();
      console.error('[%s] Redis cache update error for key %s: %s', date, key, error);
    }
  }

  /**
   * Generates a SHA256 hash of the provided string value.
   * If the input string exceeds 50 characters, it is truncated to the
   * first 50 characters before hashing.
   *
   * @param value - The input string to hash.
   * @returns The hexadecimal representation of the SHA256 hash.
   */
  public static hashValue(value: string): string {
    const MAX_SEARCH_LEN = 50;
    if (value.length > MAX_SEARCH_LEN) value = value.slice(0, MAX_SEARCH_LEN);
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Verifies that the provided ID is a valid number within the acceptable range
   *
   * @param id - The ID to verify (allianceId, playerId, ...), as a string or number.
   * @returns The numeric ID if valid; otherwise, `false`.
   */
  public static verifyIdWithCountryCode(id: unknown): false | number {
    if (typeof id !== 'string' && typeof id !== 'number') return false;
    if (Number.isNaN(Number(id)) || Number(id) < 0 || Number(id) > 99_999_999_999 || String(id).length <= 3) {
      return false;
    }
    return Number(id);
  }

  /**
   * Verifies and sanitizes a username or alliance name for search operations.
   *
   * @param name - The name to verify and sanitize.
   * @param parameters - Optional parameters for sanitization. Possible options:
   *                     - toLowerCase: If true, converts the name to lowercase. (default is true).
   *                     - maxLength: Maximum allowed length for the name (default is 40).
   * @returns The sanitized name as a string, or an ApiInputErrorType if invalid.
   */
  public static validateSearchAndSanitize(
    name: unknown,
    parameters?: { toLowerCase?: boolean; maxLength?: number },
  ): ApiInputErrorType | string {
    const maxLength = parameters?.maxLength ?? 40;
    const toLowerCase = parameters?.toLowerCase ?? true;
    if (!name) return ApiUndefinedInputType;
    if (typeof name !== 'string' || name.length > maxLength) return ApiInvalidInputType;
    const sanitized = String(name).trim();
    return toLowerCase ? sanitized.toLowerCase() : sanitized;
  }

  /**
   * Checks if the provided value is an invalid input type.
   * @param value - The value to check.
   * @returns True if the value is an invalid input type; otherwise, false.
   */
  public static isInvalidInput(value: unknown): value is ApiInputErrorType {
    return value === ApiUndefinedInputType || value === ApiInvalidInputType;
  }

  /**
   * Checks if the provided value is a valid string input.
   * @param value - The value to check.
   * @returns True if the value is a valid string; otherwise, false.
   */
  public static isValidInput(value: unknown): value is string {
    return !this.isInvalidInput(value);
  }

  /**
   * Parses the provided value into a string.
   * @param value - The value to parse.
   * @param defaultValue - The default value to return if the input value is falsy (default is null).
   * @returns The parsed string or the default value.
   */
  public static getParsedString(value: unknown, defaultValue: string | null = null): string | null {
    if (!value) return defaultValue;
    return String(value);
  }

  /**
   * Validates and sanitizes a page number for pagination.
   * @param page - The page number to validate.
   * @param defaultValue - The default page number to return if validation fails (default is 1).
   * @returns The validated page number or the default value.
   */
  public static validatePageNumber(page: unknown, defaultValue: number = 1): number {
    const pageNumber = Number.parseInt(String(page)) || defaultValue;
    if (Number.isNaN(pageNumber) || pageNumber < 1 || pageNumber > ApiHelper.MAX_RESULT_PAGE) {
      return defaultValue;
    }
    return pageNumber;
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
   * If the URL starts with "https://empire-html5.goodgamestudios.com/default/", or "https://discord.com", it rewrites the URL
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
    if (
      url?.startsWith('https://empire-html5.goodgamestudios.com/default/') ||
      url?.startsWith('https://discord.com')
    ) {
      url = 'https://cdn.gge-tracker.com?url=' + url;
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
        console.error('Fetch error on %s: %s', url, error);
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
