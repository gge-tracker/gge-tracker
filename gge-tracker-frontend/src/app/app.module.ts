import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { APP_INITIALIZER, LOCALE_ID, NgModule, isDevMode } from '@angular/core';
import { BrowserModule, provideClientHydration } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule } from '@angular/router';
import { NgSelectModule } from '@ng-select/ng-select';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { LUCIDE_ICONS, LucideAngularModule, LucideIconProvider, Spline } from 'lucide-angular';

import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { FooterComponent } from '@ggetracker-components/footer/footer.component';
import { LoadingComponent } from '@ggetracker-components/loading/loading.component';
import { NavbarComponent } from '@ggetracker-components/navbar/navbar.component';
import { SkeletonComponent } from '@ggetracker-components/skeleton/skeleton.component';
import { LocalStorageTranslateLoader } from './local-storage-loader';
import { SidebarComponent } from '@ggetracker-components/sidebar/sidebar.component';
import { TopBarComponent } from '@ggetracker-components/top-bar/top-bar.component';
import { myIcons } from '@ggetracker-components/icon/icon.component';
import { ServerService } from '@ggetracker-services/server.service';
import { environment } from 'environments/environment';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import localeEnGb from '@angular/common/locales/en-GB';
import localeNl from '@angular/common/locales/nl';
import localePl from '@angular/common/locales/pl';
import localeRo from '@angular/common/locales/ro';
import localeDe from '@angular/common/locales/de';
import { ServiceWorkerModule } from '@angular/service-worker';

registerLocaleData(localeFr, 'fr-FR');
registerLocaleData(localeEnGb, 'en-GB');
registerLocaleData(localeNl, 'nl-NL');
registerLocaleData(localePl, 'pl-PL');
registerLocaleData(localeRo, 'ro-RO');
registerLocaleData(localeDe, 'de-DE');

export function DynamicTranslateLoaderFactory(http: HttpClient): TranslateLoader {
  const isBrowser = globalThis.window !== undefined;
  if (isBrowser && localStorage.getItem('lang_dev')) {
    return new LocalStorageTranslateLoader();
  } else {
    return new TranslateHttpLoader(http, environment.i18nBaseUrl, '.json');
  }
}

@NgModule({
  declarations: [AppComponent, SkeletonComponent],
  imports: [
    BrowserModule,
    HttpClientModule,
    BrowserAnimationsModule,
    CommonModule,
    NgSelectModule,
    LucideAngularModule.pick({ Spline }),
    NavbarComponent,
    FooterComponent,
    RouterModule.forRoot(routes),
    LoadingComponent,
    TranslateModule.forRoot({
      loader: {
        provide: TranslateLoader,
        useFactory: DynamicTranslateLoaderFactory,
        deps: [HttpClient],
      },
      defaultLanguage: 'en',
    }),
    SidebarComponent,
    TopBarComponent,
    ServiceWorkerModule.register('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
  bootstrap: [AppComponent],
  providers: [
    provideClientHydration(),
    { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(myIcons) },
    {
      provide: APP_INITIALIZER,
      useFactory: (serverService: ServerService) => (): Promise<void> => serverService.init(),
      deps: [ServerService],
      multi: true,
    },
    { provide: LOCALE_ID, useValue: 'en-GB' },
  ],
})
export class AppRoutingModule {}
