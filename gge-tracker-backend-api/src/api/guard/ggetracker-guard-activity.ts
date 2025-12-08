import axios from 'axios';
import express from 'express';
import morgan from 'morgan';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { ApiGgeTrackerManager } from '../managers/api.manager';
import { RoutesManager, sortBySpecificity } from '../managers/routes.manager';
import { GgeTrackerApiGuardActivityDefaultParameters } from './ggetracker-guard-activity.parameters';

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
  private logBuffer: LogEntry[] = [];
  private approxBufferBytes: number = 0;
  private rateLimiter: RateLimiterRedis;
  private managerInstance: ApiGgeTrackerManager;

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

  public setUpManagerInstance(managerInstance: ApiGgeTrackerManager): this {
    this.managerInstance = managerInstance;
    return this;
  }

  public getLogFlushInterval(): number {
    return this.LOG_FLUSH_INTERVAL_MS;
  }

  public getDecayInterval(): number {
    return this.DECAY_INTERVAL_MS;
  }

  /**
   * Flushes any buffered log entries to the configured Loki and ClickHouse endpoints.
   * @returns A promise that resolves when the flush operation is initiated.
   */
  public async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;
    const toSend = this.logBuffer;
    this.logBuffer = [];
    this.flushLogsToLokiLogs(toSend).catch(() => {
      console.error('Error: Unable to flush Loki Logs');
    });
    this.flushToClickhouse(toSend).catch(() => {
      console.error('Error: Unable to flush ClickHouse Logs');
    });
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
   * Record details about an incoming HTTP request using morgan tokens and internal tracking.
   *
   * This method extracts metadata from the provided Express request/response pair (using the
   * supplied morgan TokenIndexer), normalizes the route, records the request IP, and
   * appends a structured log entry to the internal buffer for later flushing.
   *
   * @param tokens - A morgan TokenIndexer providing token functions (e.g. method, status, url, response-time, user-agent).
   * @param request - The Express request object for the incoming HTTP request.
   * @param response - The Express response object for the corresponding response.
   * @returns A string (always null) to satisfy morgan's expected return type.
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

  /**
   * Flushes buffered log entries to ClickHouse.
   * @param toSend - Array of log entries to send.
   * @returns A promise that resolves when the flush completes.
   */
  private async flushToClickhouse(toSend: LogEntry[]): Promise<void> {
    const logDatabaseName = 'logs';
    const logTableName = 'logs';
    const rows = toSend.map((logEntry) => {
      return {
        timestamp: new Date(logEntry.timestamp).toISOString().slice(0, 19).replace('T', ' ') || null,
        job: logEntry.labels.job ?? null,
        server: logEntry.labels.server ?? null,
        method: logEntry.labels.method ?? null,
        status: logEntry.labels.status ?? null,
        route: logEntry.labels.route ?? null,
        url: logEntry.line.url ?? null,
        response_time: logEntry.line.response_time ?? null,
        user_agent: logEntry.line.user_agent ?? null,
        ip: logEntry.line.ip ?? null,
      };
    });
    const batchSize = 3000;
    const maxRetries = 3;
    const baseDelayMs = 200;
    const sql = `INSERT INTO ${logDatabaseName}.${logTableName} FORMAT JSONEachRow`;
    const baseUrl = this.managerInstance.getClickHouseUrl() + `/?query=${encodeURIComponent(sql)}`;

    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);

      const payload = batch.map((r) => JSON.stringify(r)).join('\n');
      let attempt = 0;
      let lastError: any = null;
      while (attempt < maxRetries) {
        attempt++;
        try {
          const response = await axios.post(baseUrl, payload, {
            headers: {
              'Content-Type': 'text/plain',
              Accept: 'text/plain, */*',
              'Accept-Encoding': 'gzip,deflate',
            },
            auth: this.managerInstance.getClickHouseCredentials(),
            timeout: 30_000,
          });
          if (response.status >= 200 && response.status < 300) {
            lastError = null;
            break;
          } else {
            const txt = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            throw new Error(`ClickHouse returned ${response.status}: ${txt}`);
          }
        } catch (error: any) {
          lastError = error;
          const message = error?.response?.data ?? error?.message ?? String(error);
          console.warn(`Attempt ${attempt} failed for batch ${Math.floor(index / batchSize) + 1}:`, message);
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
        }
      }
      if (lastError) {
        console.error('Failed to insert batch into ClickHouse after retries:', lastError?.message ?? lastError);
      }
    }
  }

  /**
   * Flushes any buffered log entries to the configured Loki endpoint.
   * @param toSend - Array of log entries to send.
   * @returns A promise that resolves when the flush completes (either successfully sent or after exhausting retries).
   */
  private async flushLogsToLokiLogs(toSend: LogEntry[]): Promise<void> {
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
}
