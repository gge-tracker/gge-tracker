/**
 * environment.production.beta.ts
 * This file contains environment variables for the production beta environment.
 * It is used during the build process when the `--configuration=production-beta` flag is provided.
 * For development builds, `environment.ts` is used instead.
 */
export const environment = {
  production: true,
  apiUrl: 'https://api-beta.gge-tracker.com/api/v1/',
  i18nBaseUrl: 'https://ggetracker.github.io/i18n-beta/',
};
console.clear();
const myColor = 'color:#e65045; font-size:15px;';
console.log(
  "%cHello there! 👋  If you're interested to contribute to this project, feel free to visit the 'about' page",
  myColor,
);
