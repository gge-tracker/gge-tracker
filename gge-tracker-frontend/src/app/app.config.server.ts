import { DOCUMENT } from '@angular/common';
import { ApplicationConfig, inject, mergeApplicationConfig, provideEnvironmentInitializer } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { SERVER_API_URL } from '@ggetracker-services/server-api-url.token';
import { environment } from 'environments/environment';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

function showRenderedPageAtOnce(): void {
  const document = inject(DOCUMENT);
  document.querySelector('#startup-overlay')?.remove();
  document.querySelector('app-loader')?.remove();
  document.querySelector('app-root')?.removeAttribute('style');
}

export const serverConfig: ApplicationConfig = mergeApplicationConfig(appConfig, {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideEnvironmentInitializer(showRenderedPageAtOnce),
    { provide: SERVER_API_URL, useValue: process.env['SSR_API_URL'] ?? environment.apiUrl },
  ],
});
