import axios, { AxiosResponse } from 'axios';
import * as express from 'express';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';

/**
 * Abstract class providing API endpoints related to offers
 *
 * @implements {ApiHelper}
 */
export abstract class ApiOffers implements ApiHelper {
  /** Official GGS endpoint serving the cash offers catalogs */
  private static readonly CASH_OFFERS_URL = 'https://api-ggs-canvas.public.ggs-ep.com/cashoffers/catalogs';
  private static readonly TOKEN_CACHE_KEY = 'offers:token';
  private static readonly TOKEN_EXPIRATION_MARGIN = 60;
  private static readonly OFFERS_CACHE_TTL = 1800;
  private static readonly CATALOG_TIMEOUT = 15_000;
  private static readonly REGION_SYNC_ATTEMPTS = 6;
  private static readonly REGION_SYNC_DELAY = 3000;
  private static readonly REGION_SYNC_BUDGET = 30_000;
  private static readonly MAX_LEVEL = 70;
  private static readonly MAX_LEGEND_LEVEL = 950;

  private static readonly CATALOG_SERVERS: GgeTrackerServersEnum[] = [
    GgeTrackerServersEnum.ASIA,
    GgeTrackerServersEnum.NL1,
  ];

  private static readonly LEVEL_RANGE_BOUNDS = [6, 9, 10, 13, 17, 19, 29, 49, 55, 69, 70];
  private static readonly LEGENDARY_RANGE_BOUNDS = [0, 9, 29, 149, 199, 349, 399, 549, 659, 949, 950];

  private static readonly CURRENCY_REGIONS: Record<string, string> = {
    EUR: 'de',
    USD: 'us',
    GBP: 'gb',
    BRL: 'br',
    TRY: 'tr',
    PLN: 'pl',
    CZK: 'cz',
    HUF: 'hu',
    RON: 'ro',
    SEK: 'se',
    AUD: 'au',
    JPY: 'jp',
    KRW: 'kr',
    INR: 'in',
    SAR: 'sa',
    AED: 'ae',
    TWD: 'tw',
  };

  private static readonly DEFAULT_CURRENCY = 'EUR';

  private static readonly PRIVATE_FIELDS = new Set([
    'customer',
    'transactionId',
    'settings',
    '_failed',
    'header',
    'hardCurrencyBalance',
  ]);

  private static readonly pendingTokens = new Map<string, Promise<string | null>>();
  private static readonly egressRoutes = new Map<string, HttpsProxyAgent<string>>();
  private static upstreamReads: Promise<unknown> = Promise.resolve();

  public static async getOffers(request: express.Request, response: express.Response): Promise<void> {
    try {
      /* ---------------------------------
       * Validate parameters
       * --------------------------------- */
      const locale = ApiHelper.validateSearchAndSanitize(request.query.locale ?? 'en', {
        toLowerCase: false,
        maxLength: 5,
      });
      const currency = String(request.query.currency ?? this.DEFAULT_CURRENCY).toUpperCase();
      const level = Number.parseInt(String(request.query.level ?? this.MAX_LEVEL));
      const legendaryLevel = Number.parseInt(String(request.query.legendaryLevel ?? 0));
      if (ApiHelper.isInvalidInput(locale) || !ApiHelper.GGE_SUPPORTED_LANGUAGES.includes(locale)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidLanguage });
        return;
      } else if (!Object.hasOwn(this.CURRENCY_REGIONS, currency)) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidCurrency });
        return;
      } else if (Number.isNaN(level) || level < 1 || level > this.MAX_LEVEL) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidLevel });
        return;
      } else if (Number.isNaN(legendaryLevel) || legendaryLevel < 0 || legendaryLevel > this.MAX_LEGEND_LEVEL) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidLegendaryLevel });
        return;
      }

      /* ---------------------------------
       * Cache check
       * --------------------------------- */
      const region = this.CURRENCY_REGIONS[currency];
      const rangeLevel = this.roundUpToRange(level, this.LEVEL_RANGE_BOUNDS);
      const rangeLegendaryLevel = this.roundUpToRange(legendaryLevel, this.LEGENDARY_RANGE_BOUNDS);
      const cachedKey = `offers:catalog:v2:${currency}:${locale}:${rangeLevel}:${rangeLegendaryLevel}`;
      const cachedData = await ApiHelper.redisClient.get(cachedKey);
      if (cachedData) {
        response.status(ApiHelper.HTTP_OK).send(JSON.parse(cachedData));
        return;
      }

      /* ---------------------------------
       * Fetch from GGS API
       * --------------------------------- */
      const data = await this.readExclusively(async () => {
        const filled = await ApiHelper.redisClient.get(cachedKey);
        if (filled) return JSON.parse(filled);
        const catalog = await this.readCatalog(locale, region, rangeLevel, rangeLegendaryLevel);
        if (catalog) void ApiHelper.updateCache(cachedKey, catalog, this.OFFERS_CACHE_TTL);
        return catalog;
      });
      if (!data) {
        response
          .status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR)
          .send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
        return;
      }

      /* ---------------------------------
       * Send response
       * --------------------------------- */
      response.status(ApiHelper.HTTP_OK).send(data);
      return;
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getOffers', request);
      return;
    }
  }

  /**
   * Reads the catalog through the first reachable reference server
   *
   * @param locale The locale the offers are translated in
   * @param region The two-letter region the catalog is priced for
   * @param level The keep level, already rounded up to its range
   * @param legendaryLevel The legendary level, already rounded up to its range
   * @returns The catalog as the game returned it, or null when no reference server could answer
   */
  private static async readCatalog(
    locale: string,
    region: string,
    level: number,
    legendaryLevel: number,
  ): Promise<unknown | null> {
    const expected = region.toUpperCase();
    for (const serverName of this.CATALOG_SERVERS) {
      const server = ApiHelper.ggeTrackerManager.get(serverName);
      if (!server?.zone || !server?.zoneId) continue;
      const apiUrl = this.buildCatalogUrl(locale, server.zoneId, level, legendaryLevel);
      let token = await this.getBearerToken(server.zone);
      if (!token) continue;
      const deadline = Date.now() + this.REGION_SYNC_BUDGET;
      let answered = false;
      for (let attempt = 0; attempt < this.REGION_SYNC_ATTEMPTS && Date.now() < deadline; attempt++) {
        if (attempt > 0) await this.wait(this.REGION_SYNC_DELAY);
        let catalog = await this.fetchCatalog(apiUrl, token, region);
        if (catalog?.status === ApiHelper.HTTP_UNAUTHORIZED || catalog?.status === ApiHelper.HTTP_FORBIDDEN) {
          const refreshed = await this.getBearerToken(server.zone, true);
          if (!refreshed) break;
          token = refreshed;
          catalog = await this.fetchCatalog(apiUrl, token, region);
        }
        if (catalog?.status !== ApiHelper.HTTP_OK || !catalog.data) continue;
        answered = true;
        const served = this.readCatalogRegion(catalog.data);
        if (!served || served === expected) return this.stripPrivateFields(catalog.data);
      }
      if (answered) return null;
    }
    return null;
  }

  /**
   * Reads back the region the store actually priced a catalog for
   *
   * @param catalog The catalog as the game returned it, before its private fields are removed
   * @returns The two-letter region in upper case, or null when the answer does not carry one
   */
  private static readCatalogRegion(catalog: unknown): string | null {
    if (catalog === null || typeof catalog !== 'object') return null;
    for (const category of Object.values(catalog as Record<string, { data?: { customer?: { country?: unknown } } }>)) {
      const country = category?.data?.customer?.country;
      if (typeof country === 'string' && country.length > 0) return country.toUpperCase();
    }
    return null;
  }

  /**
   * Runs an upstream read on its own, after every read queued before it
   *
   * @param read The upstream read to run
   * @returns Whatever the read returned
   */
  private static readExclusively<T>(read: () => Promise<T>): Promise<T> {
    const result = this.upstreamReads.then(read, read);
    this.upstreamReads = result.catch(() => null);
    return result;
  }

  private static wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  /**
   * Removes every reference-account field from a catalog, at any depth
   *
   * @param value The catalog as the game returned it
   * @returns The same structure, without any of the `PRIVATE_FIELDS`
   */
  private static stripPrivateFields(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.stripPrivateFields(entry));
    if (value === null || typeof value !== 'object') return value;
    const stripped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (this.PRIVATE_FIELDS.has(key)) continue;
      stripped[key] = this.stripPrivateFields(entry);
    }
    return stripped;
  }

  /**
   * Rounds a level up to the highest level serving the same catalog
   *
   * @param value The level asked for
   * @param bounds The upper bound of every range, in ascending order
   * @returns The upper bound of the range the level falls in
   */
  private static roundUpToRange(value: number, bounds: number[]): number {
    return bounds.find((bound) => value <= bound) ?? bounds.at(-1) ?? value;
  }

  private static buildCatalogUrl(locale: string, zoneId: number, level: number, legendaryLevel: number): string {
    const criteria = {
      legendaryLevel,
      level,
      gamePlatform: ['web'],
      gameDistributionChannel: ['goodgamestudios'],
      storePaymentService: 'ggs_payment',
      storeIntegrationType: 'embedded',
    };
    const parameters = new URLSearchParams({
      locale,
      category: 'cashoffers',
      zoneId: String(zoneId),
      criteria: JSON.stringify(criteria),
    });
    return `${this.CASH_OFFERS_URL}?${parameters.toString()}`;
  }

  private static async fetchCatalog(
    apiUrl: string,
    token: string,
    region: string,
  ): Promise<AxiosResponse<unknown> | null> {
    const route = this.getEgressRoute(region);
    if (!route) return null;
    try {
      return await axios.get(apiUrl, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        httpsAgent: route,
        proxy: false,
        timeout: this.CATALOG_TIMEOUT,
        validateStatus: () => true,
      });
    } catch {
      return null;
    }
  }

  private static getEgressRoute(region: string): HttpsProxyAgent<string> | null {
    const cached = this.egressRoutes.get(region);
    if (cached) return cached;
    const host = process.env.STORE_EGRESS_HOST;
    const port = process.env.STORE_EGRESS_PORT;
    const account = process.env.STORE_EGRESS_USER;
    const password = process.env.STORE_EGRESS_PASSWORD;
    if (!host || !port || !account || !password) return null;
    const identity = `${account.replace(/-country-[a-z]{2}$/i, '')}-country-${region}`;
    const credentials = `${encodeURIComponent(identity)}:${encodeURIComponent(password)}`;
    const route = new HttpsProxyAgent<string>(`http://${credentials}@${host}:${port}`);
    this.egressRoutes.set(region, route);
    return route;
  }

  private static async getBearerToken(empireExToken: string, forceRefresh = false): Promise<string | null> {
    if (forceRefresh) {
      await ApiHelper.redisClient.del(this.TOKEN_CACHE_KEY + `:${empireExToken}`);
    } else {
      const cachedToken = await ApiHelper.redisClient.get(this.TOKEN_CACHE_KEY + `:${empireExToken}`);
      if (cachedToken) return cachedToken;
    }
    let pending = this.pendingTokens.get(empireExToken);
    if (!pending) {
      pending = this.requestBearerToken(empireExToken).finally(() => this.pendingTokens.delete(empireExToken));
      this.pendingTokens.set(empireExToken, pending);
    }
    return pending;
  }

  private static async requestBearerToken(empireExToken: string): Promise<string | null> {
    const basePath = process.env.GGE_API_URL_REALTIME;
    const responseData = await fetch(`${basePath}/${empireExToken}/ato/null`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }).catch(() => null);
    if (!responseData?.ok) return null;
    const data = await responseData.json();
    const token = data?.content?.ABT;
    if (typeof token !== 'string' || token.length === 0) return null;
    const cacheTTL = this.getTokenTimeToLive(token);
    if (cacheTTL > 0) void ApiHelper.updateCache(this.TOKEN_CACHE_KEY + `:${empireExToken}`, token, cacheTTL, true);
    return token;
  }

  /**
   * Reads the `exp` claim of a JWT and turns it into a cache lifetime
   *
   * @param token The JWT issued by the game
   * @returns The number of seconds the token can be cached, or 0 when its expiry is unreadable
   */
  private static getTokenTimeToLive(token: string): number {
    try {
      const payload = token.split('.')[1];
      if (!payload) return 0;
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const expiration = Number(claims?.exp);
      if (!Number.isFinite(expiration)) return 0;
      return Math.max(0, Math.floor(expiration - Date.now() / 1000 - this.TOKEN_EXPIRATION_MARGIN));
    } catch {
      return 0;
    }
  }
}
