import * as express from 'express';

const SEARCH_CRAWLER = /googlebot|google-inspectiontool|bingbot|duckduckbot|yandexbot|applebot|qwantify/i;

export abstract class SearchCrawler {
  public static matches(request: express.Request): boolean {
    return SEARCH_CRAWLER.test(String(request.headers['user-agent'] ?? ''));
  }
}
