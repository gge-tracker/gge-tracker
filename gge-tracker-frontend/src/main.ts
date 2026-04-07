/// <reference types="@angular/localize" />

import { CommonModule } from '@angular/common';
import { HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { APP_INITIALIZER, LOCALE_ID, importProvidersFrom, isDevMode } from '@angular/core';
import { BrowserModule, bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ServiceWorkerModule } from '@angular/service-worker';
import { myIcons } from '@ggetracker-components/icon/icon.component';
import { ServerService } from '@ggetracker-services/server.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { LUCIDE_ICONS, LucideAngularModule, LucideIconProvider, Spline } from 'lucide-angular';
import { AppComponent } from './app/app.component';
import { DynamicTranslateLoaderFactory } from './app/app.module';
import { routes } from './app/app.routes';

void bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(
      BrowserModule,
      CommonModule,
      NgSelectModule,
      LucideAngularModule.pick({ Spline }),
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: DynamicTranslateLoaderFactory,
          deps: [HttpClient],
        },
        defaultLanguage: 'en',
      }),
      ServiceWorkerModule.register('ngsw-worker.js', {
        enabled: !isDevMode(),
        registrationStrategy: 'registerWhenStable:30000',
      }),
    ),
    provideClientHydration(),
    { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(myIcons) },
    {
      provide: APP_INITIALIZER,
      useFactory: (serverService: ServerService) => (): Promise<void> => serverService.init(),
      deps: [ServerService],
      multi: true,
    },
    { provide: LOCALE_ID, useValue: 'en-GB' },
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimations(),
    provideRouter(routes),
  ],
}).then(() => {
  document.querySelector('app-loader')?.remove();
  (document.querySelector('app-root') as HTMLElement)?.style.removeProperty('display');
});
