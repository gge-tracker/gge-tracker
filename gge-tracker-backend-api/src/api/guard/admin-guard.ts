import * as express from 'express';
import * as crypto from 'node:crypto';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ApiHelper } from '../helper/api-helper';

const MIN_TOKEN_LENGTH = 32;

export abstract class AdminGuard {
  public static require(request: express.Request, response: express.Response, next: express.NextFunction): void {
    response.setHeader('Cache-Control', 'no-store');
    const expected = AdminGuard.configuredToken();
    if (!expected) {
      response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.GenericNotFound });
      return;
    }
    if (AdminGuard.matches(AdminGuard.bearerOf(request), expected)) {
      next();
      return;
    }
    response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(ApiHelper.HTTP_UNAUTHORIZED).send({ error: RouteErrorMessagesEnum.GenericUnauthorized });
  }

  private static configuredToken(): string | null {
    const token = process.env.ADMIN_API_TOKEN?.trim() ?? '';
    return token.length >= MIN_TOKEN_LENGTH ? token : null;
  }

  private static bearerOf(request: express.Request): string {
    const header = request.headers.authorization ?? '';
    return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  }

  private static matches(candidate: string, expected: string): boolean {
    const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(candidate), digest(expected));
  }
}
