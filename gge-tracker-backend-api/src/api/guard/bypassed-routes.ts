import { RoutesManager } from '../managers/routes.manager';

export const BYPASSED_ROUTES: { label: string; rule: RoutesManager }[] = [
  { label: '/api/v1 (exact)', rule: RoutesManager.fromExact('/api/v1', true) },
  { label: '/api/v1/assets/*', rule: RoutesManager.fromPrefix('/api/v1/assets', true) },
  { label: '/api/v1/languages/*', rule: RoutesManager.fromPrefix('/api/v1/languages', true) },
  { label: '/api/v2/view/<id>', rule: RoutesManager.fromRegExp(String.raw`^/api/v2/view/\d+`, true) },
];
