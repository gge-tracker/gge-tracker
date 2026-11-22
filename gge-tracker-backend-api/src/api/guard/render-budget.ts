import * as express from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { ApiHelper } from '../helper/api-helper';
import { ClientIp } from '../helper/client-ip';
import { ApiKey } from '../services/api-key-registry';

interface RenderBudgetOptions {
  name: string;
  anonymousPerMinute: number;
  partnerPerMinute: number;
  keyOverride?: (apiKey: ApiKey) => number | null;
}

const MINUTE_SECONDS = 60;

export class RenderBudget {
  private readonly limiters = new Map<number, RateLimiterRedis>();

  constructor(private readonly options: RenderBudgetOptions) {}

  public static perMinute(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  public perMinuteFor(apiKey: ApiKey | null | undefined): number {
    if (!apiKey) return this.options.anonymousPerMinute;
    return this.partnerPerMinute(this.options.keyOverride?.(apiKey) ?? null);
  }

  public partnerPerMinute(keyOverride: number | null): number {
    return keyOverride ?? this.options.partnerPerMinute;
  }

  public get anonymousPerMinute(): number {
    return this.options.anonymousPerMinute;
  }

  public async allows(request: express.Request, response: express.Response): Promise<boolean> {
    const apiKey = response.locals.apiKey as ApiKey | undefined;
    const client = apiKey ? `key:${apiKey.id}` : ClientIp.rateLimitKey(request);
    try {
      await this.limiter(this.perMinuteFor(apiKey)).consume(client);
      return true;
    } catch (error) {
      if (error instanceof RateLimiterRes) return false;
      throw error;
    }
  }

  // Limiters sharing a prefix share the counter: only the limit compared against it differs
  private limiter(points: number): RateLimiterRedis {
    let limiter = this.limiters.get(points);
    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: ApiHelper.redisClient,
        useRedisPackage: true,
        keyPrefix: this.options.name,
        points,
        duration: MINUTE_SECONDS,
      });
      this.limiters.set(points, limiter);
    }
    return limiter;
  }
}

const SEO_RENDERS_PER_MINUTE = RenderBudget.perMinute(process.env.SEO_RENDERS_PER_MINUTE, 60);

export const SHARE_CARD_RENDER_BUDGET = new RenderBudget({
  name: 'seo-render',
  anonymousPerMinute: SEO_RENDERS_PER_MINUTE,
  partnerPerMinute: SEO_RENDERS_PER_MINUTE,
});

export const CHRONICLE_RENDER_BUDGET = new RenderBudget({
  name: 'chronicle-render',
  anonymousPerMinute: RenderBudget.perMinute(process.env.CHRONICLE_RENDERS_PER_MINUTE, 10),
  partnerPerMinute: RenderBudget.perMinute(process.env.PARTNER_CHRONICLE_RENDERS_PER_MINUTE, 30),
  keyOverride: (apiKey): number | null => apiKey.chronicleRendersPerMinute,
});
