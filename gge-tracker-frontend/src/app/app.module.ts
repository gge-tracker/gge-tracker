import { registerLocaleData } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import localeDe from '@angular/common/locales/de';
import localeEnGb from '@angular/common/locales/en-GB';
import localeFr from '@angular/common/locales/fr';
import localeNl from '@angular/common/locales/nl';
import localePl from '@angular/common/locales/pl';
import localeRo from '@angular/common/locales/ro';
import { TranslateLoader } from '@ngx-translate/core';
import { environment } from 'environments/environment';
import { Observable } from 'rxjs/internal/Observable';
import { LocalStorageTranslateLoader } from './local-storage-loader';

registerLocaleData(localeFr, 'fr-FR');
registerLocaleData(localeEnGb, 'en-GB');
registerLocaleData(localeNl, 'nl-NL');
registerLocaleData(localePl, 'pl-PL');
registerLocaleData(localeRo, 'ro-RO');
registerLocaleData(localeDe, 'de-DE');

export class CustomHttpLoader implements TranslateLoader {
  constructor(private http: HttpClient) {}

  public getTranslation(lang: string): Observable<any> {
    if (localStorage.getItem('lang_dev')) {
      const localData = localStorage.getItem(`lang_${lang}`);
      if (localData) {
        return new Observable((observer) => {
          observer.next(JSON.parse(localData));
          observer.complete();
        });
      }
    }
    return this.http.get(`${environment.i18nBaseUrl}${lang}.json`);
  }
}

export function DynamicTranslateLoaderFactory(http: HttpClient): TranslateLoader {
  const isBrowser = globalThis.window !== undefined;
  if (isBrowser && localStorage.getItem('lang_dev')) {
    return new LocalStorageTranslateLoader();
  } else {
    return new CustomHttpLoader(http);
  }
}
