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

interface LogEntryRow {
  timestamp: string;
  job: string;
  server: string;
  method: string;
  status: string;
  route: string;
  url: any;
  response_time: any;
  user_agent: any;
  ip: any;
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
  public recordMorganRequest(tokens: morgan.TokenIndexer, request: express.Request, response: express.Response): void {
    try {
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
    } catch (error) {
      console.error('Error recording morgan request:', error);
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

  /**
   * Transforms a LogEntry into a flat object suitable for insertion into ClickHouse, extracting and normalizing relevant fields.
   * @param logEntry - The structured log entry containing labels and line data.
   * @returns A flat object with normalized fields for ClickHouse insertion.
   */
  private generateRowsFromLogEntry(logEntry: LogEntry): LogEntryRow {
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
  }

  /**
   * Flushes an array of log entries to ClickHouse by converting them into the appropriate format, batching them, and sending them with retry logic.
   * @param toSend - An array of LogEntry objects to be sent to ClickHouse.
   * @returns A promise that resolves when the flush operation is complete.
   */
  private async flushToClickhouse(toSend: LogEntry[]): Promise<void> {
    const rows = this.buildRows(toSend);
    const batches = this.chunkRows(rows, 3000);
    const baseUrl = this.buildClickhouseUrl();
    for (const [index, batch] of batches.entries()) {
      const payload = this.buildPayload(batch);
      const error = await this.sendWithRetry(payload, baseUrl, index);
      if (error) {
        console.error('Failed to insert batch into ClickHouse after retries:', error?.message ?? error);
      }
    }
  }

  /**
   * Converts an array of LogEntry objects into a format suitable for ClickHouse insertion by generating rows and batching them.
   * @param toSend - An array of LogEntry objects to be transformed into ClickHouse rows.
   * @returns An array of objects representing rows to be inserted into ClickHouse, with fields extracted and normalized from the original LogEntry structure.
   */
  private buildRows(toSend: LogEntry[]): LogEntryRow[] {
    return toSend.map((logEntry) => this.generateRowsFromLogEntry(logEntry));
  }

  /**
   * Splits an array of log entry rows into smaller batches of a specified size for processing or transmission.
   * @param rows - The array of log entry rows to be divided into batches.
   * @param batchSize - The maximum number of log entry rows to include in each batch.
   * @returns An array of batches, where each batch is an array of log entry rows with a length up to batchSize.
   */
  private chunkRows(rows: any[], batchSize: number): any[][] {
    const batches: any[][] = [];
    for (let index = 0; index < rows.length; index += batchSize) {
      batches.push(rows.slice(index, index + batchSize));
    }
    return batches;
  }

  /**
   * Converts an array of log entry objects into a newline-delimited string format suitable for ClickHouse's JSONEachRow input.
   * @param batch - An array of log entry objects to be stringified and concatenated.
   * @returns A single string where each log entry is JSON-stringified and separated by a newline character, ready for ClickHouse ingestion.
   */
  private buildPayload(batch: any[]): string {
    return batch.map((r) => JSON.stringify(r)).join('\n');
  }

  /**
   * Constructs the ClickHouse HTTP endpoint URL for log insertion, including the SQL query as a URL parameter.
   * @returns The full URL to which log data should be POSTed for ClickHouse insertion.
   */
  private buildClickhouseUrl(): string {
    const sql = `INSERT INTO logs.logs FORMAT JSONEachRow`;
    return this.managerInstance.getClickHouseUrl() + `/?query=${encodeURIComponent(sql)}`;
  }

  /**
   * Attempts to send a batch of log entries to ClickHouse with retry logic and exponential backoff.
   * @param payload - The stringified log batch to send in the POST request body.
   * @param baseUrl - The ClickHouse endpoint URL to which the payload should be sent.
   * @param batchIndex - The index of the current batch (used for logging purposes).
   * @returns A promise that resolves to null on success or an error object if all retry attempts fail.
   */
  private async sendWithRetry(payload: string, baseUrl: string, batchIndex: number): Promise<any | null> {
    const maxRetries = 3;
    const baseDelayMs = 200;
    let lastError: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.sendRequest(payload, baseUrl);
        return null;
      } catch (error: any) {
        lastError = error;
        const message = error?.response?.data ?? error?.message ?? String(error);
        console.warn(`Attempt ${attempt} failed for batch ${batchIndex + 1}:`, message);
        await this.delay(baseDelayMs * Math.pow(2, attempt - 1));
      }
    }
    return lastError;
  }

  /**
   * Sends a POST request to the specified ClickHouse endpoint with the given payload, including necessary headers and authentication.
   * @param payload - The stringified log data to be sent in the request body.
   * @param baseUrl - The ClickHouse endpoint URL to which the request should be sent.
   */
  private async sendRequest(payload: string, baseUrl: string): Promise<void> {
    const response = await axios.post(baseUrl, payload, {
      headers: {
        'Content-Type': 'text/plain',
        Accept: 'text/plain, */*',
        'Accept-Encoding': 'gzip,deflate',
      },
      auth: this.managerInstance.getClickHouseCredentials(),
      timeout: 30_000,
    });
    if (response.status < 200 || response.status >= 300) {
      const txt = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      throw new Error(`ClickHouse returned ${response.status}: ${txt}`);
    }
  }

  /**
   * Utility function to create a delay for a specified number of milliseconds, used for implementing backoff between retry attempts.
   * @param ms - The number of milliseconds to wait before resolving the returned promise.
   * @returns A promise that resolves after the specified delay.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
