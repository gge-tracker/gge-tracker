import { ApiHelper } from '../helper/api-helper';
import { ApiOffers, PricedCatalog } from '../routes/api-offers';
import { StoreCatalogClient, StoreOffer } from './store-catalog-client';

interface SnapshotProfile {
  currency: string;
  level: number;
  legendaryLevel: number;
}

interface OfferRow {
  snapshot_at: string;
  currency: string;
  level: number;
  legendary_level: number;
  category: string;
  offer_id: string;
  name: string;
  price: number;
  price_currency: string;
  price_source: 'store' | 'table';
  approximate_price: number;
  bonus: number;
  rewards: string;
  offer: string;
  reference_fetched_at: string;
  collected_at: string;
}

interface OfferReward {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  qty?: unknown;
  title?: unknown;
}

/**
 * Stores the store catalogue of every profile every few hours
 */
export abstract class OfferSnapshot {
  private static readonly TABLE = 'ggetracker_global.store_offer_history';
  private static readonly CHECK_INTERVAL_MS = 3600 * 1000;
  private static readonly FIRST_CHECK_DELAY_MS = 60_000;
  private static readonly SLOT_HOURS = 6;
  private static readonly LOCK_KEY = 'offers:snapshot:lock';
  private static readonly LOCK_SECONDS = 3600;
  private static readonly DONE_KEY_PREFIX = 'offers:snapshot:done:';
  private static readonly DONE_SECONDS = 2 * 24 * 3600;
  private static readonly LOCALE = 'en';

  private static timer: ReturnType<typeof setInterval> | null = null;

  public static start(): void {
    if (this.timer || process.env.OFFERS_SNAPSHOT !== '1') return;
    this.timer = setInterval(() => void this.runOnce(), this.CHECK_INTERVAL_MS);
    setTimeout(() => void this.runOnce(), this.FIRST_CHECK_DELAY_MS);
  }

  public static profiles(): SnapshotProfile[] {
    const base = StoreCatalogClient.REFERENCE_CURRENCY;
    const profiles: SnapshotProfile[] = Object.keys(ApiOffers.CURRENCY_REGIONS).map((currency) => ({
      currency,
      level: ApiOffers.MAX_LEVEL,
      legendaryLevel: ApiOffers.MAX_LEGEND_LEVEL,
    }));
    for (const level of ApiOffers.LEVEL_RANGE_BOUNDS) {
      profiles.push({ currency: base, level, legendaryLevel: 0 });
    }
    for (const legendaryLevel of ApiOffers.LEGENDARY_RANGE_BOUNDS) {
      profiles.push({ currency: base, level: ApiOffers.MAX_LEVEL, legendaryLevel });
    }
    const unique = new Map(profiles.map((profile) => [this.profileKey(profile), profile]));
    return [...unique.values()];
  }

  public static toRows(priced: PricedCatalog, profile: SnapshotProfile, slot: Date, collectedAt: Date): OfferRow[] {
    const rows: OfferRow[] = [];
    StoreCatalogClient.forEachOffer(priced.catalog, (category, offer) => {
      if (offer.id === undefined || offer.id === null) return;
      const priceCurrency = StoreCatalogClient.readOfferCurrency(offer) ?? '';
      const observed =
        priced.pricedIn === StoreCatalogClient.REFERENCE_CURRENCY ||
        priceCurrency === StoreCatalogClient.REFERENCE_CURRENCY;
      rows.push({
        snapshot_at: this.toDateTime(slot),
        currency: profile.currency,
        level: profile.level,
        legendary_level: profile.legendaryLevel,
        category,
        offer_id: String(offer.id),
        name: String(offer.name ?? offer.title ?? ''),
        price: Number(offer.price) || 0,
        price_currency: priceCurrency,
        price_source: observed ? 'store' : 'table',
        approximate_price: offer.approximatePrice === true ? 1 : 0,
        bonus: Number(offer.bonus) || 0,
        rewards: JSON.stringify(this.summarizeRewards(offer)),
        offer: JSON.stringify(offer),
        reference_fetched_at: this.toDateTime(new Date(priced.fetchedAt)),
        collected_at: this.toDateTime(collectedAt),
      });
    });
    return rows;
  }

  private static summarizeRewards(offer: StoreOffer): object[] {
    const rewards = Array.isArray(offer.rewards) ? (offer.rewards as OfferReward[]) : [];
    return rewards.map((reward) => ({
      id: reward.id ?? null,
      type: reward.type ?? reward.name ?? null,
      qty: reward.qty ?? null,
      title: reward.title ?? null,
    }));
  }

  private static async runOnce(): Promise<void> {
    const slot = this.currentSlot();
    const doneKey = this.DONE_KEY_PREFIX + this.toDateTime(slot);
    try {
      const locked = await ApiHelper.redisClient.set(this.LOCK_KEY, '1', { NX: true, EX: this.LOCK_SECONDS });
      if (!locked) return;
      const done = new Set(await ApiHelper.redisClient.sMembers(doneKey));
      const due = this.profiles().filter((profile) => !done.has(this.profileKey(profile)));
      if (due.length === 0) return;
      const { stored, missing } = await this.collect(due, slot, doneKey);
      console.log(
        '[offers-snapshot] %s: %d offers stored, %d profiles left for the next check',
        this.toDateTime(slot),
        stored,
        missing,
      );
    } catch (error) {
      ApiHelper.logError(error, 'OfferSnapshot.runOnce');
    } finally {
      await ApiHelper.redisClient.del(this.LOCK_KEY).catch(() => null);
    }
  }

  private static async collect(
    profiles: SnapshotProfile[],
    slot: Date,
    doneKey: string,
  ): Promise<{ stored: number; missing: number }> {
    const clickhouse = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    let stored = 0;
    let missing = 0;
    for (const profile of profiles) {
      const priced = await ApiOffers.readPricedCatalog(
        profile.currency,
        this.LOCALE,
        profile.level,
        profile.legendaryLevel,
        { requireFresh: true },
      );
      // A currency whose prices are not learned yet is retried at the next check
      const rows = priced?.pricedIn === profile.currency ? this.toRows(priced, profile, slot, new Date()) : [];
      if (rows.length === 0) {
        missing++;
        continue;
      }
      await clickhouse.insert({ table: this.TABLE, values: rows, format: 'JSONEachRow' });
      await ApiHelper.redisClient.sAdd(doneKey, this.profileKey(profile));
      await ApiHelper.redisClient.expire(doneKey, this.DONE_SECONDS);
      stored += rows.length;
    }
    return { stored, missing };
  }

  private static currentSlot(): Date {
    const slotMs = this.SLOT_HOURS * 3600 * 1000;
    return new Date(Math.floor(Date.now() / slotMs) * slotMs);
  }

  private static profileKey(profile: SnapshotProfile): string {
    return `${profile.currency}:${profile.level}:${profile.legendaryLevel}`;
  }

  private static toDateTime(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }
}
