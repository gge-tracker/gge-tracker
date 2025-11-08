import express from 'express';
import { promisify } from 'node:util';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import axios from 'axios';
import zlib from 'node:zlib';
import morgan from 'morgan';
import { GgeTrackerApiGuardActivityDefaultParameters } from './ggetracker-guard-activity.parameters';
import { RoutesManager, sortBySpecificity } from '../managers/routes.manager';

interface LogEntry {
  labels: Record<string, string>;
  line: any;
  timestamp: number;
}

/**
 * Centralized singleton for request guarding, lightweight abuse detection, and
 * buffered logging to a Loki-compatible endpoint.
 *
 * Responsibilities
 * - Provide a single shared instance via getInstance() to coordinate rate limiting,
 *   in-memory activity tracking and batched log delivery
 * - Enforce Redis-backed rate limits via an injected RateLimiterRedis instance
 * - Buffer structured log/metric entries (produced by recordMorganRequest and checkAbuse)
 *   and periodically flush them to a Loki HTTP push endpoint with gzip compression
 *   and configurable retry/backoff
 *
 */
export class GgeTrackerApiGuardActivity extends GgeTrackerApiGuardActivityDefaultParameters {
  public static gzip = promisify(zlib.gzip);
  public static NODE_ENV = process.env.NODE_ENV || 'development';

  private static instance: GgeTrackerApiGuardActivity;
  private totalRequests: number = 0;
  private ipHits: { [key: string]: number } = {};
  private ipMap: Map<string, { count: number; lastTick: number }> = new Map();
  private logBuffer: LogEntry[] = [];
  private approxBufferBytes: number = 0;
  private rateLimiter: RateLimiterRedis;

  /**
   * Returns the singleton instance of GgeTrackerApiGuardActivity.
   *
   * Implements lazy initialization of the singleton: if an instance does not
   * yet exist, it is created on the first call and the same instance is
   * returned on subsequent calls.
   *
   * @returns The single shared GgeTrackerApiGuardActivity instance.
   */
  public static getInstance(): GgeTrackerApiGuardActivity {
    if (!GgeTrackerApiGuardActivity.instance) {
      GgeTrackerApiGuardActivity.instance = new GgeTrackerApiGuardActivity();
    }
    return GgeTrackerApiGuardActivity.instance;
  }

  /**
   * Configure the guard with a Redis-backed rate limiter.
   *
   * Sets the internal RateLimiterRedis instance that will be used to track and enforce
   * rate limits for incoming requests. This method is chainable and returns the current
   * instance to support fluent configuration.
   *
   * @param rateLimiter - An initialized RateLimiterRedis instance to use for rate limiting.
   * @returns The current instance (GgeTrackerApiGuardActivity) to allow method chaining.
   */
  public setUpRateLimiter(rateLimiter: RateLimiterRedis): this {
    this.rateLimiter = rateLimiter;
    return this;
  }

  public getLogFlushInterval(): number {
    return this.LOG_FLUSH_INTERVAL_MS;
  }

  public getDecayInterval(): number {
    return this.DECAY_INTERVAL_MS;
  }

  /**
   * Flushes any buffered log entries to the configured Loki endpoint.
   *
   * @returns A promise that resolves when the flush completes (either successfully sent or after exhausting retries).
   */
  public async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;
    const toSend = this.logBuffer;
    this.logBuffer = [];
    this.approxBufferBytes = 0;
    const streams = new Map<string, { stream: any; values: [string, string][] }>();
    for (const logEntry of toSend) {
      const key = JSON.stringify(logEntry.labels);
      const ts = `${logEntry.timestamp}000000`;
      const value = JSON.stringify(logEntry.line);
      if (streams.has(key)) {
        streams.get(key)!.values.push([ts, value]);
      } else {
        streams.set(key, { stream: logEntry.labels, values: [[ts, value]] });
      }
    }
    const payload = { streams: [...streams.values()] };
    const data = await GgeTrackerApiGuardActivity.gzip(JSON.stringify(payload));
    for (let index = 0; index < this.LOKI_MAX_RETRIES; index++) {
      try {
        await axios.post(this.LOKI_URL, data, {
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
          timeout: 8000,
        });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, this.LOKI_RETRY_BASE_MS * 2 ** index));
      }
    }
  }

  /**
   * Middleware that enforces rate limiting and basic abuse detection for incoming requests.
   *
   * @param request - Express request object for the current HTTP request.
   * @param response - Express response object used to send a 429 on limit exceedance.
   * @param next - Express next function to continue request processing when allowed.
   * @returns A Promise that resolves when the middleware has finished processing.
   */
  public async guardActivityMiddleware(
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
    bypassRules: RoutesManager[],
  ): Promise<void> {
    const xff = request.headers['x-forwarded-for'];
    const ip =
      typeof xff === 'string' ? xff.split(',')[0].trim() : Array.isArray(xff) ? xff[0] : request.ip || 'unknown';
    const normalizedIp = ip.replace(/^::ffff:/, '');

    this.totalRequests++;
    this.ipHits[normalizedIp] = (this.ipHits[normalizedIp] || 0) + 1;

    try {
      const sortedBySpec = sortBySpecificity(bypassRules);
      const url = request.originalUrl || request.url || '/';
      const shouldBypass = sortedBySpec.some((r) => r.matches(url));

      if (shouldBypass) {
        return next();
      }

      await this.rateLimiter.consume(normalizedIp);

      next();
    } catch {
      response.status(429).json({ error: 'Too many requests, please try again later.' });
    }
  }

  /**
   * Record an access event for the given IP address and apply time-based decay to its stored counter.
   *
   * If an entry for the IP already exists in this.ipMap:
   * - Compute the time elapsed since the last recorded tick.
   * - If the elapsed time exceeds this.DECAY_INTERVAL_MS, compute how many whole
   *   decay intervals have passed and apply the decay factor that many times (each application uses
   *   Math.floor(count * DECAY_FACTOR)). After decaying, increment the count by 1 and update lastTick
   *   to the current time.
   * - If the elapsed time does not exceed the decay interval, simply increment the stored count by 1.
   *
   * If no entry exists for the IP, create one with count === 1 and lastTick set to the current time.
   *
   * @param ip - The IP address to record activity for.
   * @returns void
   */
  public recordIp(ip: string): void {
    const now = Date.now();
    const s = this.ipMap.get(ip);
    if (s) {
      const elapsed = now - s.lastTick;
      if (elapsed > this.DECAY_INTERVAL_MS) {
        const ticks = Math.floor(elapsed / this.DECAY_INTERVAL_MS);
        let count = s.count;
        for (let index = 0; index < ticks; index++) count = Math.floor(count * this.DECAY_FACTOR);
        count += 1;
        s.count = count;
        s.lastTick = now;
      } else s.count += 1;
    } else {
      this.ipMap.set(ip, { count: 1, lastTick: now });
    }
  }

  /**
   * Record details about an incoming HTTP request using morgan tokens and internal tracking.
   *
   * This method extracts metadata from the provided Express request/response pair (using the
   * supplied morgan TokenIndexer), normalizes the route, records the request IP, performs
   * abuse checks, and pushes a structured log/metrics entry into an internal buffer.
   *
   * @param tokens - A morgan TokenIndexer providing token functions (e.g. method, status, url, response-time, user-agent).
   * @param request - The Express request object for the incoming HTTP request.
   * @param response - The Express response object for the corresponding response.
   * @returns An empty string (to satisfy morgan's expected return type).
   */
  public recordMorganRequest(
    tokens: morgan.TokenIndexer,
    request: express.Request,
    response: express.Response,
  ): string {
    const now = Date.now();
    const server = (request.headers['gge-server'] as string) || 'none';
    const ip = (request.headers['x-forwarded-for'] as string) || request.ip;
    const route = this.normalizeRouteSafe(request);
    this.recordIp(ip);
    this.checkAbuse(ip, server, now);

    const labels = {
      job: 'ggetracker-api',
      env: this.NODE_ENV,
      server,
      method: tokens.method(request, response) || 'GET',
      status: tokens.status(request, response) || '0',
      route,
      level: 'info',
    };
    const line = {
      url: tokens.url(request, response),
      response_time: tokens['response-time'](request, response),
      user_agent: tokens['user-agent'](request, response),
      ip,
    };
    this.pushToBuffer({ labels, line, timestamp: now });
    return null;
  }

  /**
   * Checks whether a tracked IP has exceeded the configured abuse threshold and, if so,
   * records a "suspicious_rate" event and resets the tracked count for that IP.
   *
   * @param ip - The client IP address to evaluate.
   * @param server - Identifier of the server instance; included in the emitted event labels.
   * @param now - Current timestamp (milliseconds since epoch) used for the emitted event.
   * @returns void
   */
  public checkAbuse(ip: string, server: string, now: number): void {
    const s = this.ipMap.get(ip);
    if (!s) return;
    if (s.count >= this.IP_THRESHOLD) {
      s.count = 0;
      this.ipMap.set(ip, s);
      const labels = {
        job: 'ggetracker-api',
        env: this.NODE_ENV,
        server,
        level: 'warn',
        method: 'ABUSE',
        route: '/__abuse__',
      };
      const line = { event: 'suspicious_rate', ip, window_ms: this.IP_WINDOW_MS, ts: now };
      this.pushToBuffer({ labels, line, timestamp: now });
    }
  }

  /**
   * Normalize an Express request route into a generalized, safe string suitable for logging,
   * metrics aggregation, or grouping similar endpoints.
   *
   * @example
   *  /api/v1/users/12345/profile  --> /api/v1/users/:id/profile
   *
   * @param request - The Express request object containing route information.
   * @returns A normalized route string with variable segments replaced by placeholders.
   */
  public normalizeRouteSafe(request: express.Request): string {
    try {
      if (request.route?.path) return (request.baseUrl || '') + request.route.path;
    } catch {}
    const raw = request.path || '/';
    const segments = raw.split('/').map((seg) => {
      if (!seg) return '';
      if (/^\d+$/.test(seg)) return ':id';
      if (seg.length >= 8 && seg.includes('-')) return ':id';
      if (/^[\dA-Fa-f]{6,}$/.test(seg)) return ':id';
      return seg.length > 60 ? seg.slice(0, 60) : seg;
    });
    return segments.join('/');
  }

  /**
   * Adds a log entry to the in-memory buffer while enforcing maximum entry count and byte-size limits.
   *
   * @param entry - The log entry to append to the buffer.
   * @returns void
   */
  public pushToBuffer(entry: LogEntry): void {
    const size = JSON.stringify(entry).length;
    while (this.logBuffer.length >= this.LOG_MAX_ENTRIES || this.approxBufferBytes + size > this.LOG_MAX_BYTES) {
      const old = this.logBuffer.shift();
      if (!old) break;
      this.approxBufferBytes -= JSON.stringify(old).length;
    }
    this.logBuffer.push(entry);
    this.approxBufferBytes += size;
  }
}
