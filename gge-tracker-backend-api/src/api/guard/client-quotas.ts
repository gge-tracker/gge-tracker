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

export interface GameCommandLimits {
  perMinute: number;
  perDay: number;
}

export interface GameCommandOverride {
  perMinute: number | null;
  perDay: number | null;
}

export type Bridge = 'standard' | 'realtime';

export interface QuotaClient {
  key: string;
  isPartner: boolean;
  gameCommands?: GameCommandOverride;
}

interface Quota {
  name: string;
  window: QuotaWindow;
  limiter: RateLimiterRedis;
}

const DAY_SECONDS = 86_400;
const MINUTE_SECONDS = 60;
const REFUSAL_LOG_INTERVAL_MS = 3_600_000;
// Castle routes that send a command from a game account on a cache miss
const GAME_COMMAND_ROUTE = /^\/api\/v1\/castle\/(analysis|player|search)\//i;
const CASTLE_ANALYSIS_ROUTE = /^\/api\/v1\/castle\/analysis\//i;

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export class ClientQuotas {
  public static readonly DEFAULT_LIMITS: Record<Bridge, { anonymous: GameCommandLimits; partner: GameCommandLimits }> =
    {
      standard: {
        anonymous: {
          perMinute: positiveInteger(process.env.GAME_COMMANDS_PER_MINUTE, 60),
          perDay: positiveInteger(process.env.GAME_COMMANDS_PER_DAY, 600),
        },
        partner: {
          perMinute: positiveInteger(process.env.PARTNER_GAME_COMMANDS_PER_MINUTE, 240),
          perDay: positiveInteger(process.env.PARTNER_GAME_COMMANDS_PER_DAY, 10_000),
        },
      },
      realtime: {
        anonymous: {
          perMinute: positiveInteger(process.env.REALTIME_GAME_COMMANDS_PER_MINUTE, 30),
          perDay: positiveInteger(process.env.REALTIME_GAME_COMMANDS_PER_DAY, 300),
        },
        partner: {
          perMinute: positiveInteger(process.env.PARTNER_REALTIME_GAME_COMMANDS_PER_MINUTE, 120),
          perDay: positiveInteger(process.env.PARTNER_REALTIME_GAME_COMMANDS_PER_DAY, 5000),
        },
      },
    };

  public static readonly ANONYMOUS_DAILY_REQUESTS = positiveInteger(process.env.ANONYMOUS_DAILY_REQUESTS, 25_000);

  private readonly anonymousDaily = this.quota('anonymous-daily', ClientQuotas.ANONYMOUS_DAILY_REQUESTS, DAY_SECONDS);
  private readonly quotas = new Map<string, Quota>();
  private readonly lastRefusalLog = new Map<string, number>();

  public static isGameCommandRoute(path: string): boolean {
    return GAME_COMMAND_ROUTE.test(path);
  }

  public static bridgeOf(path: string, kingdomId: unknown): Bridge | null {
    if (!this.isGameCommandRoute(path)) return null;
    if (!CASTLE_ANALYSIS_ROUTE.test(path)) return 'standard';
    const kingdom = Number.parseInt(String(kingdomId ?? '0'));
    return kingdom >= 1 && kingdom <= 3 ? 'realtime' : 'standard';
  }

  public static gameCommandLimits(bridge: Bridge, client: Omit<QuotaClient, 'key'>): GameCommandLimits {
    const defaults = this.DEFAULT_LIMITS[bridge][client.isPartner ? 'partner' : 'anonymous'];
    if (bridge === 'realtime' || !client.gameCommands) return defaults;
    return {
      perMinute: client.gameCommands.perMinute ?? defaults.perMinute,
      perDay: client.gameCommands.perDay ?? defaults.perDay,
    };
  }

  public async consume(client: QuotaClient, bridge: Bridge | null, userAgent: string): Promise<QuotaOutcome> {
    const outcome: QuotaOutcome = { refusal: null, daily: null };
    if (!client.isPartner) {
      const state = await this.consumeOne(this.anonymousDaily, client.key, userAgent);
      if (state instanceof RateLimiterRes) {
        outcome.daily = { window: this.anonymousDaily.window, remaining: Math.max(0, state.remainingPoints) };
      } else if (state) {
        outcome.refusal = state;
        outcome.daily = { window: this.anonymousDaily.window, remaining: 0 };
        return outcome;
      }
    }
    if (!bridge) return outcome;
    for (const quota of this.gameCommandQuotas(bridge, client)) {
      const state = await this.consumeOne(quota, client.key, userAgent);
      if (state && !(state instanceof RateLimiterRes)) {
        outcome.refusal = state;
        return outcome;
      }
    }
    return outcome;
  }

  private gameCommandQuotas(bridge: Bridge, client: QuotaClient): Quota[] {
    const limits = ClientQuotas.gameCommandLimits(bridge, client);
    const prefix = `${client.isPartner ? 'partner-' : ''}${bridge === 'realtime' ? 'realtime-' : ''}game-commands`;
    return [
      this.sharedQuota(`${prefix}-minute`, limits.perMinute, MINUTE_SECONDS),
      this.sharedQuota(`${prefix}-day`, limits.perDay, DAY_SECONDS),
    ];
  }

  private sharedQuota(name: string, points: number, windowSeconds: number): Quota {
    const id = `${name}|${points}`;
    let quota = this.quotas.get(id);
    if (!quota) {
      quota = this.quota(name, points, windowSeconds);
      this.quotas.set(id, quota);
    }
    return quota;
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
