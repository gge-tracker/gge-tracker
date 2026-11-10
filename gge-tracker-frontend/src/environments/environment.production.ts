/**
 * environment.production.ts
 * This file contains environment variables for the production environment.
 * It is used during the build process when the `--configuration=production` flag is provided.
 * For development builds, `environment.ts` is used instead.
 */
export const environment = {
  production: true,
  apiUrl: 'https://api.gge-tracker.com/api/v1/',
  chronicleApiUrl: 'https://api.gge-tracker.com/api/v1/',
  chronicleEnabled: false,
  i18nBaseUrl: 'https://ggetracker.github.io/i18n/',
};
console.clear();
const myColor = 'color:#e65045; font-size:15px;';
console.log(
  "%cHello there! 👋  If you're interested to contribute to this project, feel free to visit the 'about' page",
  myColor,
);
