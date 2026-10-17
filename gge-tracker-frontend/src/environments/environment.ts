/**
 * environment.ts
 * This file contains environment variables for the development environment.
 * It is used during the build process when the `--configuration=development` flag is provided.
 * For production builds, `environment.production.ts` is used instead.
 */
const useLocalI18n = true;

export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1/',
  i18nBaseUrl: useLocalI18n ? '/i18n-local/' : 'https://gge-tracker.github.io/i18n-beta/',
};

console.log('Using development environment');
