import { ApiHelper } from '../helper/api-helper';
import { StoreCatalogClient, StoreOffer } from './store-catalog-client';

export type PackagePrices = Record<string, number>;

/**
 * Prices E4K offers from their mobile price package, whose EUR price the EP catalog reveals
 */
export abstract class OfferPackagePrices {
  public static readonly PLACEHOLDER_PRICE = 9999;

  private static readonly KEY = 'offers:package-prices:v1';

  public static async read(): Promise<PackagePrices> {
    const stored = await ApiHelper.redisClient.get(this.KEY);
    if (!stored) return {};
    try {
      return JSON.parse(stored) as PackagePrices;
    } catch {
      return {};
    }
  }

  public static async learn(referenceCatalog: unknown): Promise<PackagePrices> {
    const candidates = new Map<string, number | null>();
    StoreCatalogClient.forEachOffer(referenceCatalog, (_category, offer) => {
      const packageId = this.readPackage(offer);
      const price = Number(offer.price);
      if (!packageId || !Number.isFinite(price) || price <= 0) return;
      const known = candidates.get(packageId);
      candidates.set(packageId, known === undefined || known === price ? price : null);
    });
    const prices = await this.read();
    for (const [packageId, price] of candidates) {
      if (price !== null) prices[packageId] = price;
    }
    await ApiHelper.redisClient.set(this.KEY, JSON.stringify(prices));
    return prices;
  }

  public static apply(catalog: unknown, prices: PackagePrices): unknown {
    const priced = structuredClone(catalog);
    StoreCatalogClient.forEachOffer(priced, (_category, offer) => {
      const packageId = this.readPackage(offer);
      if (!packageId || Number(offer.price) !== this.PLACEHOLDER_PRICE) return;
      const price = prices[packageId];
      if (price === undefined) {
        offer.priceUnknown = true;
        return;
      }
      offer.price = price;
      offer.approximatePrice = true;
    });
    return priced;
  }

  private static readPackage(offer: StoreOffer): string | null {
    const packageId = offer.mobilePricePackageID;
    if (packageId === undefined || packageId === null || packageId === '' || String(packageId) === '0') return null;
    return String(packageId);
  }
}
