import * as express from 'express';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { Status } from '../enums/http-status.enums';

const STATUS_FALLBACK_CODES: Record<number, string> = {
  [Status.BAD_REQUEST]: 'BAD_REQUEST',
  [Status.UNAUTHORIZED]: 'UNAUTHORIZED',
  [Status.FORBIDDEN]: 'FORBIDDEN',
  [Status.NOT_FOUND]: 'NOT_FOUND',
  [Status.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
  [Status.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

const toScreamingSnakeCase = (key: string): string =>
  key
    .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();

const MESSAGE_TO_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(RouteErrorMessagesEnum).map(([key, message]) => [message as string, toScreamingSnakeCase(key)]),
);

/** Longest first, so "Invalid level" cannot claim a message starting with "Invalid legendary level" */
const MESSAGE_PREFIXES: readonly [string, string][] = [...MESSAGE_TO_CODE.entries()].sort(
  (a, b) => b[0].length - a[0].length,
);

export const errorCodeFor = (message: string, statusCode: number): string => {
  const exact = MESSAGE_TO_CODE.get(message);
  if (exact) return exact;
  // Handlers append the offending value after the message, so the code is matched on the prefix
  // rather than falling back to the status
  const prefixed = MESSAGE_PREFIXES.find(
    ([candidate]) => message.startsWith(candidate) && /^[.:]\s/.test(message.slice(candidate.length)),
  );
  return prefixed?.[1] ?? STATUS_FALLBACK_CODES[statusCode] ?? 'ERROR';
};

const shouldAnnotate = (statusCode: number, body: unknown): body is { error: string; code?: string } =>
  statusCode >= Status.BAD_REQUEST &&
  typeof body === 'object' &&
  body !== null &&
  !Array.isArray(body) &&
  typeof (body as { error?: unknown }).error === 'string' &&
  (body as { code?: unknown }).code === undefined;

export const errorCodeMiddleware = (
  _request: express.Request,
  response: express.Response,
  next: express.NextFunction,
): void => {
  const send = response.send.bind(response);
  response.send = (body?: unknown): express.Response => {
    if (shouldAnnotate(response.statusCode, body)) {
      body.code = errorCodeFor(body.error, response.statusCode);
    }
    return send(body);
  };
  next();
};
