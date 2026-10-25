import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { OfferPriceTables } from '../services/offer-price-tables';
import { CatalogProfile, StoreCatalogClient } from '../services/store-catalog-client';

interface StoredReference {
  fetchedAt: number;
  catalog: unknown;
}

export interface PricedCatalog {
  catalog: unknown;
  pricedIn: string;
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

  private static readonly pendingReferences = new Map<string, Promise<unknown>>();

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
  ): Promise<PricedCatalog | null> {
    const profile: CatalogProfile = {
      locale,
      level: this.roundUpToRange(level, this.LEVEL_RANGE_BOUNDS),
      legendaryLevel: this.roundUpToRange(legendaryLevel, this.LEGENDARY_RANGE_BOUNDS),
    };
    const reference = await this.readReference(profile);
    if (!reference) return null;
    const base = StoreCatalogClient.REFERENCE_CURRENCY;
    if (currency === base) return { catalog: reference, pricedIn: base };
    const table = await OfferPriceTables.read(currency);
    if (!table || table.base !== base) {
      OfferPriceTables.requestRefresh(currency);
      return { catalog: reference, pricedIn: base };
    }
    const { catalog, approximate } = OfferPriceTables.apply(reference, table);
    if (approximate) OfferPriceTables.requestRefresh(currency);
    return { catalog, pricedIn: currency };
  }

  private static async readReference(profile: CatalogProfile): Promise<unknown> {
    const key = `${this.REFERENCE_KEY_PREFIX}${profile.locale}:${profile.level}:${profile.legendaryLevel}`;
    const stored = await this.readStoredReference(key);
    if (stored && Date.now() - stored.fetchedAt < this.REFERENCE_FRESH_MS) return stored.catalog;
    const refreshing = this.refreshReference(key, profile);
    if (stored) return stored.catalog;
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

  private static refreshReference(key: string, profile: CatalogProfile): Promise<unknown> {
    const pending = this.pendingReferences.get(key);
    if (pending) return pending;
    const refresh = StoreCatalogClient.fetchReferenceCatalog(profile)
      .then(async (catalog) => {
        if (!catalog) {
          console.warn('[offers] reference catalog unreadable for %s', key);
          return null;
        }
        const stripped = StoreCatalogClient.stripPrivateFields(catalog);
        const stored: StoredReference = { fetchedAt: Date.now(), catalog: stripped };
        await ApiHelper.updateCache(key, stored, this.REFERENCE_KEEP_SECONDS);
        return stripped;
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
