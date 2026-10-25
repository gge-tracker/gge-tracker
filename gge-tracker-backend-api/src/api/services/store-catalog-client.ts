import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { ApiHelper } from '../helper/api-helper';

export interface CatalogProfile {
  locale: string;
  level: number;
  legendaryLevel: number;
}

export interface StoreOffer {
  id?: unknown;
  price?: unknown;
  currencyCode?: unknown;
  currency?: unknown;
  [field: string]: unknown;
}

type StoreCatalog = Record<string, { data?: { offers?: unknown } } | undefined>;

/**
 * Reads the GGS cash offers catalog, with one reference account per role
 */
export abstract class StoreCatalogClient {
  public static readonly REFERENCE_SERVER = GgeTrackerServersEnum.NL1;
  public static readonly PRICE_SERVER = GgeTrackerServersEnum.ASIA;
  public static readonly REFERENCE_CURRENCY = 'EUR';
  // Mock, dev only
  public static readonly MOCK_CURRENCY = 'GGS-mock';
  public static readonly CURRENCY_REGIONS: Readonly<Record<string, string>> = {
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

  private static readonly CASH_OFFERS_URL = 'https://api-ggs-canvas.public.ggs-ep.com/cashoffers/catalogs';
  private static readonly TOKEN_CACHE_KEY = 'offers:token';
  private static readonly TOKEN_EXPIRATION_MARGIN = 60;
  private static readonly CATALOG_TIMEOUT = 15_000;
  private static readonly PRIVATE_FIELDS = new Set([
    'customer',
    'transactionId',
    'settings',
    '_failed',
    'header',
    'hardCurrencyBalance',
  ]);

  // Measured: the country the store reports changes at most every ~10s, whichever account asks
  private static readonly REGION_SETTLE_MS = 15_000;
  private static readonly REFERENCE_ATTEMPTS = 2;

  private static lastRegionalCallAt = 0;
  private static readonly pendingTokens = new Map<string, Promise<string | null>>();
  private static readonly egressAgents = new Map<string, { session: string; agent: HttpsProxyAgent<string> }>();

  public static isEgressConfigured(): boolean {
    const { STORE_EGRESS_HOST, STORE_EGRESS_PORT, STORE_EGRESS_USER, STORE_EGRESS_PASSWORD } = process.env;
    return Boolean(STORE_EGRESS_HOST && STORE_EGRESS_PORT && STORE_EGRESS_USER && STORE_EGRESS_PASSWORD);
  }

  public static async fetchReferenceCatalog(profile: CatalogProfile): Promise<unknown> {
    for (let attempt = 0; attempt < this.REFERENCE_ATTEMPTS; attempt++) {
      if (attempt > 0) await this.wait(this.REGION_SETTLE_MS);
      const catalog = await this.fetchCatalog(this.REFERENCE_SERVER, profile, null);
      if (!catalog) return null;
      if (this.readCurrency(catalog) === this.REFERENCE_CURRENCY) return catalog;
    }
    return null;
  }

  public static async fetchRegionalCatalog(profile: CatalogProfile, region: string, session: string): Promise<unknown> {
    if (!this.isEgressConfigured()) return null;
    await this.wait(this.lastRegionalCallAt + this.REGION_SETTLE_MS - Date.now());
    try {
      return await this.fetchCatalog(this.PRICE_SERVER, profile, { region, session });
    } finally {
      this.lastRegionalCallAt = Date.now();
    }
  }

  public static readCountry(catalog: unknown): string | null {
    if (catalog === null || typeof catalog !== 'object') return null;
    for (const entry of Object.values(catalog as Record<string, { data?: { customer?: { country?: unknown } } }>)) {
      const country = entry?.data?.customer?.country;
      if (typeof country === 'string' && country.length > 0) return country.toUpperCase();
    }
    return null;
  }

  public static readCurrency(catalog: unknown): string | null {
    const counts = new Map<string, number>();
    this.forEachOffer(catalog, (_category, offer) => {
      const currency = this.readOfferCurrency(offer);
      if (currency && currency !== this.MOCK_CURRENCY) counts.set(currency, (counts.get(currency) ?? 0) + 1);
    });
    let best: string | null = null;
    for (const [currency, count] of counts) {
      if (best === null || count > (counts.get(best) ?? 0)) best = currency;
    }
    return best;
  }

  public static readOfferCurrency(offer: StoreOffer): string | null {
    const currency = offer.currencyCode ?? offer.currency;
    return typeof currency === 'string' && currency.length > 0 ? currency : null;
  }

  public static forEachOffer(catalog: unknown, visit: (category: string, offer: StoreOffer) => void): void {
    if (catalog === null || typeof catalog !== 'object') return;
    for (const [category, entry] of Object.entries(catalog as StoreCatalog)) {
      const offers = entry?.data?.offers;
      if (!Array.isArray(offers)) continue;
      for (const offer of offers as StoreOffer[]) {
        if (offer && typeof offer === 'object') visit(category, offer);
      }
    }
  }

  public static stripPrivateFields(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.stripPrivateFields(entry));
    if (value === null || typeof value !== 'object') return value;
    const stripped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (this.PRIVATE_FIELDS.has(key)) continue;
      stripped[key] = this.stripPrivateFields(entry);
    }
    return stripped;
  }

  private static async wait(milliseconds: number): Promise<void> {
    if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private static async fetchCatalog(
    serverName: GgeTrackerServersEnum,
    profile: CatalogProfile,
    egress: { region: string; session: string } | null,
  ): Promise<unknown> {
    const server = ApiHelper.ggeTrackerManager.get(serverName);
    if (!server?.zone || !server?.zoneId) return null;
    const url = this.buildCatalogUrl(profile, server.zoneId);
    const agent = egress ? this.getEgressAgent(egress.region, egress.session) : undefined;
    let token = await this.getBearerToken(server.zone);
    if (!token) return null;
    let response = await this.request(url, token, agent);
    if (response?.status === ApiHelper.HTTP_UNAUTHORIZED || response?.status === ApiHelper.HTTP_FORBIDDEN) {
      token = await this.getBearerToken(server.zone, true);
      if (!token) return null;
      response = await this.request(url, token, agent);
    }
    return response?.status === ApiHelper.HTTP_OK && response.data ? response.data : null;
  }

  private static async request(
    url: string,
    token: string,
    agent: HttpsProxyAgent<string> | undefined,
  ): Promise<{ status: number; data: unknown } | null> {
    try {
      return await axios.get(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        httpsAgent: agent,
        proxy: false,
        timeout: this.CATALOG_TIMEOUT,
        validateStatus: () => true,
      });
    } catch {
      return null;
    }
  }

  private static buildCatalogUrl(profile: CatalogProfile, zoneId: number): string {
    const criteria = {
      legendaryLevel: profile.legendaryLevel,
      level: profile.level,
      gamePlatform: ['web'],
      gameDistributionChannel: ['goodgamestudios'],
      storePaymentService: 'ggs_payment',
      storeIntegrationType: 'embedded',
    };
    const parameters = new URLSearchParams({
      locale: profile.locale,
      category: 'cashoffers',
      zoneId: String(zoneId),
      criteria: JSON.stringify(criteria),
    });
    return `${this.CASH_OFFERS_URL}?${parameters.toString()}`;
  }

  private static getEgressAgent(region: string, session: string): HttpsProxyAgent<string> {
    const cached = this.egressAgents.get(region);
    if (cached?.session === session) return cached.agent;
    const { STORE_EGRESS_HOST, STORE_EGRESS_PORT, STORE_EGRESS_USER, STORE_EGRESS_PASSWORD } = process.env;
    const account = String(STORE_EGRESS_USER).replace(/(-country-[a-z]{2}|-session-\w+)+$/i, '');
    const identity = `${account}-country-${region}-session-${session}`;
    const credentials = `${encodeURIComponent(identity)}:${encodeURIComponent(String(STORE_EGRESS_PASSWORD))}`;
    const agent = new HttpsProxyAgent<string>(`http://${credentials}@${STORE_EGRESS_HOST}:${STORE_EGRESS_PORT}`);
    cached?.agent.destroy();
    this.egressAgents.set(region, { session, agent });
    return agent;
  }

  private static async getBearerToken(zone: string, forceRefresh = false): Promise<string | null> {
    const cacheKey = `${this.TOKEN_CACHE_KEY}:${zone}`;
    if (forceRefresh) {
      await ApiHelper.redisClient.del(cacheKey);
    } else {
      const cachedToken = await ApiHelper.redisClient.get(cacheKey);
      if (cachedToken) return cachedToken;
    }
    let pending = this.pendingTokens.get(zone);
    if (!pending) {
      pending = this.requestBearerToken(zone, cacheKey).finally(() => this.pendingTokens.delete(zone));
      this.pendingTokens.set(zone, pending);
    }
    return pending;
  }

  private static async requestBearerToken(zone: string, cacheKey: string): Promise<string | null> {
    const response = await fetch(`${process.env.GGE_API_URL_REALTIME}/${zone}/ato/null`, {
      headers: { Accept: 'application/json' },
    }).catch(() => null);
    if (!response?.ok) return null;
    const data = await response.json().catch(() => null);
    const token = data?.content?.ABT;
    if (typeof token !== 'string' || token.length === 0) return null;
    const cacheTTL = this.getTokenTimeToLive(token);
    if (cacheTTL > 0) void ApiHelper.updateCache(cacheKey, token, cacheTTL, true);
    return token;
  }

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
