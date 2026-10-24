import { CommonModule } from '@angular/common';
import { HttpClient, provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import {
  APP_INITIALIZER,
  ApplicationConfig,
  LOCALE_ID,
  PLATFORM_ID,
  TransferState,
  importProvidersFrom,
  isDevMode,
} from '@angular/core';
import { BrowserModule, provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { ServiceWorkerModule } from '@angular/service-worker';
import { myIcons } from '@ggetracker-components/icon/icon.component';
import { ServerService } from '@ggetracker-services/server.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { LUCIDE_ICONS, LucideAngularModule, LucideIconProvider, Spline } from 'lucide-angular';
import { DynamicTranslateLoaderFactory } from './app.module';
import { routes } from './app.routes';
import { reloadOnStaleChunk } from './stale-chunk-reload';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    importProvidersFrom(
      BrowserModule,
      CommonModule,
      NgSelectModule,
      LucideAngularModule.pick({ Spline }),
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: DynamicTranslateLoaderFactory,
          deps: [HttpClient, TransferState, PLATFORM_ID],
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
    provideHttpClient(withFetch(), withInterceptorsFromDi()),
    provideAnimations(),
    provideRouter(routes, withNavigationErrorHandler(reloadOnStaleChunk)),
  ],
};
