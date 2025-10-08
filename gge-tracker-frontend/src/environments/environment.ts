/**
 * environment.ts
 * This file contains environment variables for the development environment.
 * It is used during the build process when the `--configuration=development` flag is provided.
 * For production builds, `environment.production.ts` is used instead.
 */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1/',
};

console.log('Using development environment');
