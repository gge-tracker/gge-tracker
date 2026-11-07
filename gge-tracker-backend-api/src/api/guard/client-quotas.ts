import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';

export interface QuotaWindow {
  points: number;
  windowSeconds: number;
}

export interface QuotaRefusal {
  quota: string;
  error: RouteErrorMessagesEnum;
  window: QuotaWindow;
  retryAfterSeconds: number;
}

export interface QuotaOutcome {
  refusal: QuotaRefusal | null;
  daily: { window: QuotaWindow; remaining: number } | null;
}

interface Quota {
  name: string;
  window: QuotaWindow;
  limiter: RateLimiterRedis;
}

const DAY_SECONDS = 86_400;
const REFUSAL_LOG_INTERVAL_MS = 3_600_000;
// Castle routes that send a command from the game account on a cache miss
const GAME_COMMAND_ROUTE = /^\/api\/v1\/castle\/(analysis|player|search)\//i;

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export class ClientQuotas {
  private readonly anonymousDaily = this.quota(
    'anonymous-daily',
    positiveInteger(process.env.ANONYMOUS_DAILY_REQUESTS, 25_000),
    DAY_SECONDS,
  );
  private readonly anonymousGameCommands = [
    this.quota('game-commands-minute', positiveInteger(process.env.GAME_COMMANDS_PER_MINUTE, 30), 60),
    this.quota('game-commands-day', positiveInteger(process.env.GAME_COMMANDS_PER_DAY, 300), DAY_SECONDS),
  ];
  private readonly partnerGameCommands = [
    this.quota('partner-game-commands-minute', positiveInteger(process.env.PARTNER_GAME_COMMANDS_PER_MINUTE, 120), 60),
    this.quota(
      'partner-game-commands-day',
      positiveInteger(process.env.PARTNER_GAME_COMMANDS_PER_DAY, 5000),
      DAY_SECONDS,
    ),
  ];
  private readonly lastRefusalLog = new Map<string, number>();

  public static isGameCommandRoute(path: string): boolean {
    return GAME_COMMAND_ROUTE.test(path);
  }

  public async consume(clientKey: string, isPartner: boolean, path: string, userAgent: string): Promise<QuotaOutcome> {
    const outcome: QuotaOutcome = { refusal: null, daily: null };
    if (!isPartner) {
      const state = await this.consumeOne(this.anonymousDaily, clientKey, userAgent);
      if (state instanceof RateLimiterRes) {
        outcome.daily = { window: this.anonymousDaily.window, remaining: Math.max(0, state.remainingPoints) };
      } else if (state) {
        outcome.refusal = state;
        outcome.daily = { window: this.anonymousDaily.window, remaining: 0 };
        return outcome;
      }
    }
    if (!ClientQuotas.isGameCommandRoute(path)) return outcome;
    for (const quota of isPartner ? this.partnerGameCommands : this.anonymousGameCommands) {
      const state = await this.consumeOne(quota, clientKey, userAgent);
      if (state && !(state instanceof RateLimiterRes)) {
        outcome.refusal = state;
        return outcome;
      }
    }
    return outcome;
  }

  private quota(name: string, points: number, windowSeconds: number): Quota {
    return {
      name,
      window: { points, windowSeconds },
      limiter: new RateLimiterRedis({
        storeClient: ApiHelper.redisClient,
        useRedisPackage: true,
        keyPrefix: `quota:${name}`,
        points,
        duration: windowSeconds,
      }),
    };
  }

  // A quota store that cannot be read lets the request through: the per-window limiter still applies
  private async consumeOne(
    quota: Quota,
    clientKey: string,
    userAgent: string,
  ): Promise<RateLimiterRes | QuotaRefusal | null> {
    try {
      return await quota.limiter.consume(clientKey);
    } catch (error) {
      if (!(error instanceof RateLimiterRes)) return null;
      this.logRefusal(quota, clientKey, userAgent);
      return {
        quota: quota.name,
        error:
          quota === this.anonymousDaily
            ? RouteErrorMessagesEnum.DailyQuotaExceeded
            : RouteErrorMessagesEnum.GameCommandQuotaExceeded,
        window: quota.window,
        retryAfterSeconds: Math.max(1, Math.ceil(error.msBeforeNext / 1000)),
      };
    }
  }

  private logRefusal(quota: Quota, clientKey: string, userAgent: string): void {
    const logKey = `${quota.name}|${clientKey}`;
    const now = Date.now();
    if (now - (this.lastRefusalLog.get(logKey) ?? 0) < REFUSAL_LOG_INTERVAL_MS) return;
    this.lastRefusalLog.set(logKey, now);
    if (this.lastRefusalLog.size > 10_000) this.lastRefusalLog.clear();
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'client_quota_exceeded',
        quota: quota.name,
        limit: quota.window.points,
        window_seconds: quota.window.windowSeconds,
        client: clientKey,
        user_agent: userAgent.slice(0, 120),
      }),
    );
  }
}
