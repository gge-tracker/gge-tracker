import { randomBytes } from 'node:crypto';
import { ApiHelper } from '../helper/api-helper';
import { CatalogProfile, StoreCatalogClient, StoreOffer } from './store-catalog-client';

interface PriceTier {
  base: number;
  price: number;
  currency: string;
}

export interface PriceTable {
  currency: string;
  base: string;
  learnedAt: number;
  fixedCategories: string[];
  tiers: Record<string, PriceTier>;
}

type RefreshOutcome = 'learned' | 'failed' | 'budget';

/**
 * Learns, through the proxy and in the background, how each currency prices the reference catalog
 */
export abstract class OfferPriceTables {
  private static readonly TABLE_KEY_PREFIX = 'offers:price-table:v1:';
  private static readonly WANTED_KEY_PREFIX = 'offers:price-table:wanted:';
  private static readonly FAILED_KEY_PREFIX = 'offers:price-table:failed:';
  private static readonly SESSION_KEY_PREFIX = 'offers:price-table:session:';
  private static readonly CALLS_KEY_PREFIX = 'offers:price-table:calls:';
  private static readonly LOCK_KEY = 'offers:price-table:lock';
  private static readonly LOCK_SECONDS = 1800;
  private static readonly WANTED_SECONDS = 24 * 3600;
  private static readonly FAILED_SECONDS = 3 * 3600;
  private static readonly SESSION_SECONDS = 30 * 24 * 3600;
  private static readonly CALLS_SECONDS = 2 * 24 * 3600;
  private static readonly CHECK_INTERVAL_MS = 10 * 60 * 1000;
  private static readonly FIRST_CHECK_DELAY_MS = 90_000;
  private static readonly REFRESH_AFTER_MS = 24 * 3600 * 1000;
  private static readonly WANTED_REFRESH_AFTER_MS = 3600 * 1000;
  private static readonly MAX_DAILY_PROXY_CALLS = 60;
  private static readonly ATTEMPTS_PER_CURRENCY = 3;
  private static readonly MIN_LOCALIZED_OFFERS = 5;
  private static readonly PROFILE: CatalogProfile = { locale: 'en', level: 70, legendaryLevel: 950 };

  private static timer: ReturnType<typeof setInterval> | null = null;

  public static start(): void {
    if (this.timer || !StoreCatalogClient.isEgressConfigured()) return;
    this.timer = setInterval(() => void this.runOnce(), this.CHECK_INTERVAL_MS);
    setTimeout(() => void this.runOnce(), this.FIRST_CHECK_DELAY_MS);
  }

  public static async read(currency: string): Promise<PriceTable | null> {
    const stored = await ApiHelper.redisClient.get(this.TABLE_KEY_PREFIX + currency);
    if (!stored) return null;
    try {
      const table = JSON.parse(stored) as PriceTable;
      return table?.tiers && table.currency === currency ? table : null;
    } catch {
      return null;
    }
  }

  public static requestRefresh(currency: string): void {
    void ApiHelper.redisClient
      .set(this.WANTED_KEY_PREFIX + currency, '1', { EX: this.WANTED_SECONDS })
      .catch(() => null);
  }

  public static apply(catalog: unknown, table: PriceTable): { catalog: unknown; approximate: boolean } {
    const priced = structuredClone(catalog);
    const fixed = new Set(table.fixedCategories);
    const byPrice = this.indexByBasePrice(table);
    const ratio = this.medianRatio(table);
    const localCurrency = this.readLocalCurrency(table);
    let approximate = false;
    StoreCatalogClient.forEachOffer(priced, (category, offer) => {
      if (fixed.has(category) || StoreCatalogClient.readOfferCurrency(offer) !== table.base) return;
      const base = Number(offer.price);
      if (!Number.isFinite(base)) return;
      const tier = table.tiers[this.tierKey(category, base)] ?? byPrice.get(base);
      if (tier) {
        this.setPrice(offer, tier.price, tier.currency);
        return;
      }
      approximate = true;
      if (ratio === null || localCurrency === null) return;
      this.setPrice(offer, Math.round(base * ratio), localCurrency);
      offer.approximatePrice = true;
    });
    return { catalog: priced, approximate };
  }

  private static async runOnce(): Promise<void> {
    try {
      const locked = await ApiHelper.redisClient.set(this.LOCK_KEY, '1', { NX: true, EX: this.LOCK_SECONDS });
      if (!locked) return;
      try {
        await this.refreshDueCurrencies();
      } finally {
        await ApiHelper.redisClient.del(this.LOCK_KEY).catch(() => null);
      }
    } catch (error) {
      ApiHelper.logError(error, 'OfferPriceTables.runOnce');
    }
  }

  private static async refreshDueCurrencies(): Promise<void> {
    const due = await this.findDueCurrencies();
    if (due.length === 0) return;
    const reference = await StoreCatalogClient.fetchReferenceCatalog(this.PROFILE);
    if (!reference) {
      console.warn('[offers-prices] reference catalog unreadable, %d currencies left for later', due.length);
      return;
    }
    const pending = new Set(due);
    for (const currency of due) {
      if (!pending.has(currency)) continue;
      if ((await this.refresh(currency, reference, pending)) === 'budget') {
        console.warn('[offers-prices] daily proxy budget of %d calls spent', this.MAX_DAILY_PROXY_CALLS);
        return;
      }
    }
  }

  private static async findDueCurrencies(): Promise<string[]> {
    const due: string[] = [];
    for (const currency of Object.keys(StoreCatalogClient.CURRENCY_REGIONS)) {
      if (currency === StoreCatalogClient.REFERENCE_CURRENCY) continue;
      if (await ApiHelper.redisClient.get(this.FAILED_KEY_PREFIX + currency)) continue;
      const table = await this.read(currency);
      const age = table ? Date.now() - table.learnedAt : Infinity;
      const wanted = await ApiHelper.redisClient.get(this.WANTED_KEY_PREFIX + currency);
      if (age > this.REFRESH_AFTER_MS || (wanted && age > this.WANTED_REFRESH_AFTER_MS)) due.push(currency);
    }
    return due;
  }

  private static async refresh(currency: string, reference: unknown, pending: Set<string>): Promise<RefreshOutcome> {
    const region = StoreCatalogClient.CURRENCY_REGIONS[currency];
    let session = (await ApiHelper.redisClient.get(this.SESSION_KEY_PREFIX + region)) ?? this.createSession();
    let answered: string | null = null;
    for (let attempt = 0; attempt < this.ATTEMPTS_PER_CURRENCY; attempt++) {
      if (!(await this.spendProxyCall())) return 'budget';
      const regional = await StoreCatalogClient.fetchRegionalCatalog(this.PROFILE, region, session);
      answered = regional ? StoreCatalogClient.readCountry(regional) : null;
      // The store reports a country change late, so an answer is learned for the country it is priced in
      const learned = regional ? await this.learnFromAnswer(reference, regional, session) : null;
      if (learned) pending.delete(learned);
      if (learned === currency) return 'learned';
      if (answered === null || attempt > 0) session = this.createSession();
    }
    await ApiHelper.redisClient.setEx(this.FAILED_KEY_PREFIX + currency, this.FAILED_SECONDS, '1');
    console.warn('[offers-prices] %s: not learned, last answer priced for %s', currency, answered ?? 'nothing');
    return 'failed';
  }

  private static async learnFromAnswer(reference: unknown, regional: unknown, session: string): Promise<string | null> {
    const country = StoreCatalogClient.readCountry(regional);
    const currency = Object.keys(StoreCatalogClient.CURRENCY_REGIONS).find(
      (candidate) =>
        candidate !== StoreCatalogClient.REFERENCE_CURRENCY &&
        StoreCatalogClient.CURRENCY_REGIONS[candidate].toUpperCase() === country,
    );
    if (!currency) return null;
    const table = this.learn(reference, regional, currency, await this.read(currency));
    if (!table) return null;
    await this.store(table, StoreCatalogClient.CURRENCY_REGIONS[currency], session);
    console.log('[offers-prices] %s: %d tiers learned', currency, Object.keys(table.tiers).length);
    return currency;
  }

  private static learn(
    reference: unknown,
    regional: unknown,
    currency: string,
    previous: PriceTable | null,
  ): PriceTable | null {
    const base = StoreCatalogClient.REFERENCE_CURRENCY;
    const regionalOffers = new Map<string, StoreOffer>();
    StoreCatalogClient.forEachOffer(regional, (category, offer) => {
      regionalOffers.set(`${category}:${String(offer.id)}`, offer);
    });
    const tiers: Record<string, PriceTier> = previous?.base === base ? { ...previous.tiers } : {};
    const localizedCategories = new Map<string, boolean>();
    let localizedOffers = 0;
    StoreCatalogClient.forEachOffer(reference, (category, offer) => {
      const match = regionalOffers.get(`${category}:${String(offer.id)}`);
      if (!match || StoreCatalogClient.readOfferCurrency(offer) !== base) return;
      const basePrice = Number(offer.price);
      const price = Number(match.price);
      const matchCurrency = StoreCatalogClient.readOfferCurrency(match);
      if (!Number.isFinite(basePrice) || !Number.isFinite(price) || !matchCurrency) return;
      const localized = matchCurrency !== base;
      if (localized) localizedOffers++;
      localizedCategories.set(category, (localizedCategories.get(category) ?? false) || localized);
      tiers[this.tierKey(category, basePrice)] = { base: basePrice, price, currency: matchCurrency };
    });
    if (localizedOffers < this.MIN_LOCALIZED_OFFERS) return null;
    const fixedCategories = new Set(
      (previous?.fixedCategories ?? []).filter((category) => !localizedCategories.has(category)),
    );
    for (const [category, localized] of localizedCategories) {
      if (!localized) fixedCategories.add(category);
    }
    return { currency, base, learnedAt: Date.now(), fixedCategories: [...fixedCategories], tiers };
  }

  private static async store(table: PriceTable, region: string, session: string): Promise<void> {
    await ApiHelper.redisClient.set(this.TABLE_KEY_PREFIX + table.currency, JSON.stringify(table));
    await ApiHelper.redisClient.setEx(this.SESSION_KEY_PREFIX + region, this.SESSION_SECONDS, session);
    await ApiHelper.redisClient.del(this.WANTED_KEY_PREFIX + table.currency);
  }

  private static async spendProxyCall(): Promise<boolean> {
    const key = this.CALLS_KEY_PREFIX + new Date().toISOString().slice(0, 10);
    const calls = await ApiHelper.redisClient.incr(key);
    if (calls === 1) await ApiHelper.redisClient.expire(key, this.CALLS_SECONDS);
    return calls <= this.MAX_DAILY_PROXY_CALLS;
  }

  private static indexByBasePrice(table: PriceTable): Map<number, PriceTier> {
    const candidates = new Map<number, PriceTier | null>();
    for (const tier of Object.values(table.tiers)) {
      if (tier.currency === table.base) continue;
      const known = candidates.get(tier.base);
      if (known === undefined) candidates.set(tier.base, tier);
      else if (known && known.price !== tier.price) candidates.set(tier.base, null);
    }
    const index = new Map<number, PriceTier>();
    for (const [base, tier] of candidates) {
      if (tier) index.set(base, tier);
    }
    return index;
  }

  private static medianRatio(table: PriceTable): number | null {
    const ratios = Object.values(table.tiers)
      .filter((tier) => tier.currency !== table.base && tier.base > 0)
      .map((tier) => tier.price / tier.base)
      .sort((a, b) => a - b);
    return ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : null;
  }

  private static readLocalCurrency(table: PriceTable): string | null {
    const counts = new Map<string, number>();
    for (const tier of Object.values(table.tiers)) {
      if (tier.currency !== table.base) counts.set(tier.currency, (counts.get(tier.currency) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  private static setPrice(offer: StoreOffer, price: number, currency: string): void {
    offer.price = price;
    if (offer.currencyCode === undefined) offer.currency = currency;
    else offer.currencyCode = currency;
  }

  private static tierKey(category: string, basePrice: number): string {
    return `${category}:${basePrice}`;
  }

  private static createSession(): string {
    return randomBytes(6).toString('hex');
  }
}
