import * as express from 'express';
import * as crypto from 'node:crypto';

interface CachingOptions {
  etag: string;
  dataVersion?: string | number | null;
  maxAgeSeconds?: number;
  lastModified?: Date | string | null;
}

export abstract class HttpCache {
  public static readonly DEFAULT_MAX_AGE_SECONDS = 300;

  public static etagFromCacheKey(key: string): string {
    return `W/"${crypto.createHash('sha1').update(key).digest('hex').slice(0, 32)}"`;
  }

  public static etagFromPayload(payload: unknown): string {
    return `W/"${crypto
      .createHash('sha1')
      .update(JSON.stringify(payload) ?? '')
      .digest('hex')
      .slice(0, 32)}"`;
  }

  public static isNotModified(request: express.Request, etag: string): boolean {
    const header = request.headers['if-none-match'];
    if (!header) return false;
    const expected = this.normaliseTag(etag);
    const candidates = Array.isArray(header) ? header : header.split(',');
    return candidates.some((candidate) => candidate.trim() === '*' || this.normaliseTag(candidate) === expected);
  }

  public static apply(response: express.Response, options: CachingOptions): void {
    response.setHeader('ETag', options.etag);
    response.setHeader('Cache-Control', `public, max-age=${options.maxAgeSeconds ?? this.DEFAULT_MAX_AGE_SECONDS}`);
    if (options.dataVersion !== undefined && options.dataVersion !== null) {
      response.setHeader('X-Data-Version', String(options.dataVersion));
    }
    if (options.lastModified) {
      response.setHeader('Last-Modified', new Date(options.lastModified).toUTCString());
    }
  }

  public static handleConditional(
    request: express.Request,
    response: express.Response,
    options: CachingOptions,
  ): boolean {
    this.apply(response, options);
    if (!this.isNotModified(request, options.etag)) return false;
    response.status(304).end();
    return true;
  }

  private static normaliseTag(value: string): string {
    return value.trim().replaceAll('\\', '').replace(/^W\//, '');
  }
}
