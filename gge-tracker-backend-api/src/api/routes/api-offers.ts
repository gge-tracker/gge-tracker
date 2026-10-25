import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { OfferPriceTables } from '../services/offer-price-tables';
import { CatalogProfile, StoreCatalogClient } from '../services/store-catalog-client';

interface StoredReference {
  fetchedAt: number;
  catalog: unknown;
  hash?: string;
}

export interface PricedCatalog {
  catalog: unknown;
  pricedIn: string;
  fetchedAt: number;
  pricesLearnedAt: number | null;
  etag: string;
}

/**
 * Abstract class providing API endpoints related to offers
 *
 * @implements {ApiHelper}
 */
export abstract class ApiOffers implements ApiHelper {
  public static readonly MAX_LEVEL = 70;
  public static readonly MAX_LEGEND_LEVEL = 950;
  public static readonly LEVEL_RANGE_BOUNDS = [6, 9, 10, 13, 17, 19, 29, 49, 55, 69, 70];
  public static readonly LEGENDARY_RANGE_BOUNDS = [0, 9, 29, 149, 199, 349, 399, 549, 659, 949, 950];
  public static readonly CURRENCY_REGIONS = StoreCatalogClient.CURRENCY_REGIONS;

  private static readonly REFERENCE_KEY_PREFIX = 'offers:reference:v1:';
  private static readonly REFERENCE_FRESH_MS = 1800 * 1000;
  private static readonly REFERENCE_KEEP_SECONDS = 2 * 24 * 3600;
  private static readonly DEFAULT_CURRENCY = 'EUR';
  private static readonly CLIENT_MAX_AGE_SECONDS = 60;

  private static readonly pendingReferences = new Map<string, Promise<StoredReference | null>>();

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
       * Read the reference catalog and price it
       * --------------------------------- */
      const priced = await this.readPricedCatalog(currency, locale, level, legendaryLevel);
      if (!priced) {
        response
          .status(ApiHelper.HTTP_SERVICE_UNAVAILABLE)
          .send({ error: RouteErrorMessagesEnum.OffersStoreUnavailable });
        return;
      }

      /* ---------------------------------
       * Send response
       * --------------------------------- */
      this.setFreshnessHeaders(response, priced);
      const caching = { etag: priced.etag, maxAgeSeconds: this.CLIENT_MAX_AGE_SECONDS };
      if (HttpCache.handleConditional(request, response, caching)) return;
      response.status(ApiHelper.HTTP_OK).send(priced.catalog);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getOffers', request);
    }
  }

  /** Prices the reference catalog in the currency asked for, or in its own when that currency is not learned yet */
  public static async readPricedCatalog(
    currency: string,
    locale: string,
    level: number,
    legendaryLevel: number,
    requireFresh = false,
  ): Promise<PricedCatalog | null> {
    const profile: CatalogProfile = {
      locale,
      level: this.roundUpToRange(level, this.LEVEL_RANGE_BOUNDS),
      legendaryLevel: this.roundUpToRange(legendaryLevel, this.LEGENDARY_RANGE_BOUNDS),
    };
    const reference = await this.readReference(profile, requireFresh);
    if (!reference) return null;
    const { fetchedAt, hash, catalog: referenceCatalog } = reference;
    const referenceHash = hash ?? HttpCache.etagFromPayload(referenceCatalog);
    const base = StoreCatalogClient.REFERENCE_CURRENCY;
    const unpriced: PricedCatalog = {
      catalog: referenceCatalog,
      pricedIn: base,
      fetchedAt,
      pricesLearnedAt: null,
      etag: HttpCache.etagFromPayload([referenceHash, base]),
    };
    if (currency === base) return unpriced;
    const table = await OfferPriceTables.read(currency);
    if (!table || table.base !== base) {
      OfferPriceTables.requestRefresh(currency);
      return unpriced;
    }
    const { catalog, approximate } = OfferPriceTables.apply(referenceCatalog, table);
    if (approximate) OfferPriceTables.requestRefresh(currency, profile);
    // A relearned table with the same tiers prices the same catalog : it keeps the same ETag
    const etag = HttpCache.etagFromPayload([referenceHash, currency, table.fixedCategories, table.tiers]);
    return { catalog, pricedIn: currency, fetchedAt, pricesLearnedAt: table.learnedAt, etag };
  }

  private static setFreshnessHeaders(response: express.Response, priced: PricedCatalog): void {
    response.setHeader('X-Offers-Fetched-At', new Date(priced.fetchedAt).toISOString());
    response.setHeader('X-Offers-Currency', priced.pricedIn);
    if (priced.pricesLearnedAt !== null) {
      response.setHeader('X-Offers-Prices-Learned-At', new Date(priced.pricesLearnedAt).toISOString());
    }
  }

  private static async readReference(profile: CatalogProfile, requireFresh: boolean): Promise<StoredReference | null> {
    const key = `${this.REFERENCE_KEY_PREFIX}${profile.locale}:${profile.level}:${profile.legendaryLevel}`;
    const stored = await this.readStoredReference(key);
    if (stored && Date.now() - stored.fetchedAt < this.REFERENCE_FRESH_MS) return stored;
    const refreshing = this.refreshReference(key, profile);
    if (stored && !requireFresh) return stored;
    return refreshing;
  }

  private static async readStoredReference(key: string): Promise<StoredReference | null> {
    const stored = await ApiHelper.redisClient.get(key);
    if (!stored) return null;
    try {
      return JSON.parse(stored) as StoredReference;
    } catch {
      return null;
    }
  }

  private static refreshReference(key: string, profile: CatalogProfile): Promise<StoredReference | null> {
    const pending = this.pendingReferences.get(key);
    if (pending) return pending;
    const refresh = StoreCatalogClient.fetchReferenceCatalog(profile)
      .then(async (catalog) => {
        if (!catalog) {
          console.warn('[offers] reference catalog unreadable for %s', key);
          return null;
        }
        const stripped = StoreCatalogClient.stripPrivateFields(catalog);
        const stored: StoredReference = {
          fetchedAt: Date.now(),
          catalog: stripped,
          hash: HttpCache.etagFromPayload(stripped),
        };
        await ApiHelper.updateCache(key, stored, this.REFERENCE_KEEP_SECONDS);
        return stored;
      })
      .catch((error: unknown) => {
        ApiHelper.logError(error, 'ApiOffers.refreshReference');
        return null;
      })
      .finally(() => this.pendingReferences.delete(key));
    this.pendingReferences.set(key, refresh);
    return refresh;
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
}
