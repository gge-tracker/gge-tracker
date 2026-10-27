import { registerLocaleData } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import localeAr from '@angular/common/locales/ar';
import localeBg from '@angular/common/locales/bg';
import localeCs from '@angular/common/locales/cs';
import localeDe from '@angular/common/locales/de';
import localeEl from '@angular/common/locales/el';
import localeEnGb from '@angular/common/locales/en-GB';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import localeHu from '@angular/common/locales/hu';
import localeIt from '@angular/common/locales/it';
import localeNl from '@angular/common/locales/nl';
import localePl from '@angular/common/locales/pl';
import localePt from '@angular/common/locales/pt';
import localeRo from '@angular/common/locales/ro';
import localeRu from '@angular/common/locales/ru';
import localeTr from '@angular/common/locales/tr';
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
registerLocaleData(localeAr, 'ar-SA');
registerLocaleData(localePt, 'pt-BR');
registerLocaleData(localeEs, 'es-ES');
registerLocaleData(localeIt, 'it-IT');
registerLocaleData(localeTr, 'tr-TR');
registerLocaleData(localeBg, 'bg-BG');
registerLocaleData(localeCs, 'cs-CZ');
registerLocaleData(localeEl, 'el-GR');
registerLocaleData(localeHu, 'hu-HU');
registerLocaleData(localeRu, 'ru-RU');

export class CustomHttpLoader implements TranslateLoader {
  constructor(private readonly http: HttpClient) {}

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
