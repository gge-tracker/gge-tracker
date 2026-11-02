/// <reference types="@angular/localize" />

import { CommonModule } from '@angular/common';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { APP_INITIALIZER, LOCALE_ID, importProvidersFrom, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withNavigationErrorHandler, withPreloading } from '@angular/router';
import { ServiceWorkerModule } from '@angular/service-worker';
import { myIcons } from '@ggetracker-components/icon/icon.component';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { LUCIDE_ICONS, LucideAngularModule, LucideIconProvider, Spline } from 'lucide-angular';
import 'bootstrap/js/dist/modal';
import { AppComponent } from './app/app.component';
import { DynamicTranslateLoaderFactory } from './app/app.module';
import { routes } from './app/app.routes';
import { CoreRoutePreloading } from './app/core-route-preloading';
import { reloadOnStaleChunk } from './app/stale-chunk-reload';

void bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }),
    importProvidersFrom(
      BrowserModule,
      CommonModule,
      LucideAngularModule.pick({ Spline }),
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: DynamicTranslateLoaderFactory,
          deps: [HttpClient],
        },
        fallbackLang: 'en',
      }),
      ServiceWorkerModule.register('ngsw-worker.js', {
        enabled: !isDevMode(),
        registrationStrategy: 'registerWhenStable:30000',
      }),
    ),
    { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(myIcons) },
    {
      provide: APP_INITIALIZER,
      useFactory: (serverService: ServerService) => (): Promise<void> => serverService.init(),
      deps: [ServerService],
      multi: true,
    },
    { provide: LOCALE_ID, useValue: 'en-GB' },
    provideHttpClient(withInterceptorsFromDi()),
    provideRouter(routes, withNavigationErrorHandler(reloadOnStaleChunk), withPreloading(CoreRoutePreloading)),
  ],
}).then(() => {
  document.querySelector('app-loader')?.remove();
  (document.querySelector('app-root') as HTMLElement)?.style.removeProperty('display');
});
