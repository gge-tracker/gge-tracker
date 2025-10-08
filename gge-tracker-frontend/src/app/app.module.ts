import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule, provideClientHydration } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule } from '@angular/router';
import { NgSelectModule } from '@ng-select/ng-select';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { LucideAngularModule, Spline } from 'lucide-angular';

import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { FooterComponent } from '@ggetracker-components/footer/footer.component';
import { LoadingComponent } from '@ggetracker-components/loading/loading.component';
import { NavbarComponent } from '@ggetracker-components/navbar/navbar.component';
import { SkeletonComponent } from '@ggetracker-components/skeleton/skeleton.component';
import { LocalStorageTranslateLoader } from './local-storage-loader';

export function DynamicTranslateLoaderFactory(http: HttpClient): TranslateLoader {
  const isBrowser = globalThis.window !== undefined;
  if (isBrowser && localStorage.getItem('lang_dev')) {
    return new LocalStorageTranslateLoader();
  } else {
    return new TranslateHttpLoader(http, 'https://ggetracker.github.io/i18n/', '.json');
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
  ],
  bootstrap: [AppComponent],
  providers: [provideClientHydration()],
})
export class AppRoutingModule {}
