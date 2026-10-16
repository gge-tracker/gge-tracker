import express from 'express';

export interface RequestContext {
  country: string;
  origin: string;
  referer: string;
  page: string;
}

export abstract class RequestContextReader {
  private static readonly COUNTRY_PATTERN = /^(?:[A-Z]{2}|T1)$/;
  private static readonly PAGE_PATTERN = /^\/[\w/:\-]{0,80}$/;
  private static readonly MAX_ORIGIN_LENGTH = 100;
  private static readonly MAX_REFERER_LENGTH = 200;

  public static read(request: express.Request): RequestContext {
    return {
      country: this.country(request),
      origin: this.origin(request),
      referer: this.referer(request),
      page: this.page(request),
    };
  }

  private static country(request: express.Request): string {
    const value = this.header(request, 'cf-ipcountry').toUpperCase();
    return this.COUNTRY_PATTERN.test(value) ? value : '';
  }

  private static origin(request: express.Request): string {
    return this.toOrigin(this.header(request, 'origin'));
  }

  private static referer(request: express.Request): string {
    const value = this.header(request, 'referer');
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return (url.origin + url.pathname).slice(0, this.MAX_REFERER_LENGTH);
    } catch {
      return '';
    }
  }

  private static page(request: express.Request): string {
    const value = this.header(request, 'x-gge-page');
    return this.PAGE_PATTERN.test(value) ? value : '';
  }

  private static toOrigin(value: string): string {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.origin.slice(0, this.MAX_ORIGIN_LENGTH);
    } catch {
      return '';
    }
  }

  private static header(request: express.Request, name: string): string {
    const value = request.headers[name];
    return ((Array.isArray(value) ? value[0] : value) ?? '').trim();
  }
}
