import * as express from 'express';
import * as pg from 'pg';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';
import { CacheKeyBuilder } from '../helper/cache/cache-key-builder';

/**
 * Name suggestions for the search boxes: a short list a caller can pick an id from,
 * so a typed name never has to be resolved by a second exact-match request
 */
export abstract class ApiSuggestions implements ApiHelper {
  public static readonly SUGGESTION_LIMIT = 10;
  public static readonly CACHE_TTL_SECONDS = 300;

  private static readonly MIN_QUERY_LENGTH = 2;

  public static async getPlayerSuggestions(request: express.Request, response: express.Response): Promise<void> {
    const term = this.readTerm(request, response, RouteErrorMessagesEnum.InvalidPlayerName);
    if (term === null) return;
    try {
      const cached = await this.serveFromCache(request, response, 'players', term);
      if (cached) return;

      const query = `
        SELECT P.id AS player_id, P.name AS player_name, P.might_current, P.level, P.legendary_level,
          A.name AS alliance_name
        FROM players P
        LEFT JOIN alliances A ON P.alliance_id = A.id
        WHERE P.name ILIKE $1 ESCAPE '\\'
          AND P.castles IS NOT NULL AND jsonb_array_length(P.castles) > 0
        ORDER BY (P.name ILIKE $2 ESCAPE '\\') DESC, P.might_current DESC, P.id ASC
        LIMIT ${this.SUGGESTION_LIMIT}`;
      const results = await (request['pg_pool'] as pg.Pool).query(query, this.patterns(term));
      const suggestions = results.rows.map((row: any) => ({
        id: ApiHelper.addCountryCode(row.player_id, request['code']),
        name: row.player_name,
        might_current: Number(row.might_current),
        level: Number(row.level),
        legendary_level: Number(row.legendary_level),
        alliance_name: row.alliance_name,
      }));
      await this.send(request, response, 'players', term, suggestions);
    } catch (error) {
      this.fail(request, response, error, 'getPlayerSuggestions');
    }
  }

  public static async getAllianceSuggestions(request: express.Request, response: express.Response): Promise<void> {
    const term = this.readTerm(request, response, RouteErrorMessagesEnum.InvalidAllianceName);
    if (term === null) return;
    try {
      const cached = await this.serveFromCache(request, response, 'alliances', term);
      if (cached) return;

      const query = `
        SELECT A.id AS alliance_id, A.name AS alliance_name,
          COALESCE(SUM(P.might_current), 0) AS might_current,
          COUNT(P.id) AS player_count
        FROM alliances A
        LEFT JOIN players P ON A.id = P.alliance_id
        WHERE A.name ILIKE $1 ESCAPE '\\'
        GROUP BY A.id, A.name
        ORDER BY (A.name ILIKE $2 ESCAPE '\\') DESC, might_current DESC, A.id ASC
        LIMIT ${this.SUGGESTION_LIMIT}`;
      const results = await (request['pg_pool'] as pg.Pool).query(query, this.patterns(term));
      const suggestions = results.rows.map((row: any) => ({
        id: ApiHelper.addCountryCode(row.alliance_id, request['code']),
        name: row.alliance_name,
        might_current: Number(row.might_current),
        player_count: Number(row.player_count),
      }));
      await this.send(request, response, 'alliances', term, suggestions);
    } catch (error) {
      this.fail(request, response, error, 'getAllianceSuggestions');
    }
  }

  private static readTerm(
    request: express.Request,
    response: express.Response,
    invalid: RouteErrorMessagesEnum,
  ): string | null {
    const term = ApiHelper.validateSearchAndSanitize(request.query.query, { toLowerCase: false });
    if (ApiHelper.isInvalidInput(term) || term.length < this.MIN_QUERY_LENGTH) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: invalid });
      return null;
    }
    return term;
  }

  private static patterns(term: string): string[] {
    const escaped = term.replaceAll(/[%\\_]/g, String.raw`\$&`);
    return [`%${escaped}%`, `${escaped}%`];
  }

  private static cacheKey(request: express.Request, subject: string, term: string, version: string): string {
    return new CacheKeyBuilder(request['language'])
      .with(version)
      .with('suggestions')
      .with(subject)
      .with(term.toLowerCase())
      .build();
  }

  private static async serveFromCache(
    request: express.Request,
    response: express.Response,
    subject: string,
    term: string,
  ): Promise<boolean> {
    const version = await ApiHelper.getCacheVersion(ApiHelper.redisClient, request['language']);
    const cached = await ApiHelper.redisClient.get(this.cacheKey(request, subject, term, version)).catch(() => null);
    if (!cached) return false;
    response.status(ApiHelper.HTTP_OK).send(JSON.parse(cached));
    return true;
  }

  private static async send(
    request: express.Request,
    response: express.Response,
    subject: string,
    term: string,
    suggestions: Record<string, unknown>[],
  ): Promise<void> {
    const version = await ApiHelper.getCacheVersion(ApiHelper.redisClient, request['language']);
    const body = { suggestions };
    void ApiHelper.updateCache(this.cacheKey(request, subject, term, version), body, this.CACHE_TTL_SECONDS);
    response.status(ApiHelper.HTTP_OK).send(body);
  }

  private static fail(request: express.Request, response: express.Response, error: unknown, route: string): void {
    response
      .status(ApiHelper.HTTP_INTERNAL_SERVER_ERROR)
      .send({ error: RouteErrorMessagesEnum.GenericInternalServerError });
    ApiHelper.logError(error, route, request);
  }
}
