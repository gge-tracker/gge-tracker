/**
 * environment.production-local.ts
 * Production build served on localhost:4201, against the mocked backend and the local i18n files
 * Used by the Dockerfile when BUILD_ENV=local
 */
export const environment = {
  production: true,
  apiUrl: 'http://localhost:3002/api/v1/',
  chronicleApiUrl: 'http://localhost:3002/api/v1/',
  chronicleEnabled: true,
  i18nBaseUrl: '/i18n-local/',
};
