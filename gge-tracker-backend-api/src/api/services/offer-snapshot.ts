import { ApiHelper } from '../helper/api-helper';
import { ApiOffers } from '../routes/api-offers';

interface CatalogProfile {
  currency: string;
  level: number;
  legendaryLevel: number;
}

interface OfferRow {
  snapshot_date: string;
  currency: string;
  level: number;
  legendary_level: number;
  category: string;
  offer_id: string;
  name: string;
  price: number;
  bonus: number;
  rewards: string;
  collected_at: string;
}

interface StoreOffer {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  price?: unknown;
  bonus?: unknown;
  rewards?: { id?: unknown; type?: unknown; name?: unknown; qty?: unknown; title?: unknown }[];
}

/**
 * Stores one copy of the store catalogue per day
 */
export abstract class OfferSnapshot {
  private static readonly TABLE = 'ggetracker_global.store_offer_snapshots';
  private static readonly CHECK_INTERVAL_MS = 3600 * 1000;
  private static readonly LOCK_KEY = 'offers:snapshot:lock';
  private static readonly LOCK_SECONDS = 3600;
  private static readonly DONE_KEY_PREFIX = 'offers:snapshot:done:';
  private static readonly DONE_SECONDS = 3 * 24 * 3600;
  private static readonly LOCALE = 'en';
  private static readonly REFERENCE_CURRENCY = 'EUR';

  private static timer: ReturnType<typeof setInterval> | null = null;

  public static start(): void {
    if (this.timer || process.env.OFFERS_SNAPSHOT !== '1') return;
    this.timer = setInterval(() => void this.runOnce(), this.CHECK_INTERVAL_MS);
    setTimeout(() => void this.runOnce(), 60_000);
  }

  public static profiles(): CatalogProfile[] {
    const profiles: CatalogProfile[] = Object.keys(ApiOffers.CURRENCY_REGIONS).map((currency) => ({
      currency,
      level: ApiOffers.MAX_LEVEL,
      legendaryLevel: ApiOffers.MAX_LEGEND_LEVEL,
    }));
    for (const level of ApiOffers.LEVEL_RANGE_BOUNDS) {
      profiles.push({ currency: this.REFERENCE_CURRENCY, level, legendaryLevel: 0 });
    }
    for (const legendaryLevel of ApiOffers.LEGENDARY_RANGE_BOUNDS) {
      profiles.push({ currency: this.REFERENCE_CURRENCY, level: ApiOffers.MAX_LEVEL, legendaryLevel });
    }
    const unique = new Map(
      profiles.map((profile) => [`${profile.currency}:${profile.level}:${profile.legendaryLevel}`, profile]),
    );
    return [...unique.values()];
  }

  public static toRows(catalog: unknown, profile: CatalogProfile, collectedAt: Date): OfferRow[] {
    if (catalog === null || typeof catalog !== 'object') return [];
    const rows: OfferRow[] = [];
    for (const [category, entry] of Object.entries(catalog as Record<string, { data?: { offers?: unknown } }>)) {
      const offers = entry?.data?.offers;
      if (!Array.isArray(offers)) continue;
      for (const offer of offers as StoreOffer[]) {
        if (offer?.id === undefined || offer.id === null) continue;
        rows.push({
          snapshot_date: collectedAt.toISOString().slice(0, 10),
          currency: profile.currency,
          level: profile.level,
          legendary_level: profile.legendaryLevel,
          category,
          offer_id: String(offer.id),
          name: String(offer.name ?? offer.title ?? ''),
          price: Number(offer.price) || 0,
          bonus: Number(offer.bonus) || 0,
          rewards: JSON.stringify(
            (offer.rewards ?? []).map((reward) => ({
              id: reward.id ?? null,
              type: reward.type ?? reward.name ?? null,
              qty: reward.qty ?? null,
              title: reward.title ?? null,
            })),
          ),
          collected_at: collectedAt.toISOString().slice(0, 19).replace('T', ' '),
        });
      }
    }
    return rows;
  }

  private static async runOnce(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (await ApiHelper.redisClient.get(this.DONE_KEY_PREFIX + today)) return;
      const locked = await ApiHelper.redisClient.set(this.LOCK_KEY, today, { NX: true, EX: this.LOCK_SECONDS });
      if (!locked) return;
      const { stored, failed } = await this.collect(new Date());
      if (stored > 0)
        await ApiHelper.redisClient.setEx(this.DONE_KEY_PREFIX + today, this.DONE_SECONDS, String(stored));
      console.log(`[offers-snapshot] ${today}: ${stored} offers stored, ${failed} catalogues unreadable`);
    } catch (error) {
      ApiHelper.logError(error, 'OfferSnapshot.runOnce');
    } finally {
      await ApiHelper.redisClient.del(this.LOCK_KEY).catch(() => null);
    }
  }

  private static async collect(collectedAt: Date): Promise<{ stored: number; failed: number }> {
    const clickhouse = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    let stored = 0;
    let failed = 0;
    for (const profile of this.profiles()) {
      const priced = await ApiOffers.readPricedCatalog(
        profile.currency,
        this.LOCALE,
        profile.level,
        profile.legendaryLevel,
      );
      const rows = priced?.pricedIn === profile.currency ? this.toRows(priced.catalog, profile, collectedAt) : [];
      if (rows.length === 0) {
        failed++;
        continue;
      }
      await clickhouse.insert({ table: this.TABLE, values: rows, format: 'JSONEachRow' });
      stored += rows.length;
    }
    return { stored, failed };
  }
}
