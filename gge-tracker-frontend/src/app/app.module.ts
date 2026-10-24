import { isPlatformBrowser, isPlatformServer, registerLocaleData } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import localeAr from '@angular/common/locales/ar';
import localeDe from '@angular/common/locales/de';
import localeEnGb from '@angular/common/locales/en-GB';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import localeIt from '@angular/common/locales/it';
import localeNl from '@angular/common/locales/nl';
import localePl from '@angular/common/locales/pl';
import localePt from '@angular/common/locales/pt';
import localeRo from '@angular/common/locales/ro';
import localeTr from '@angular/common/locales/tr';
import { makeStateKey, TransferState } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { environment } from 'environments/environment';
import { catchError, Observable, of, shareReplay, tap, throwError, timeout } from 'rxjs';
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

const SERVER_TRANSLATIONS_TTL_MS = 10 * 60 * 1000;
const SERVER_TRANSLATIONS_TIMEOUT_MS = 3000;
const serverTranslations = new Map<string, { loadedAt: number; translations: Observable<TranslationObject> }>();

export class CustomHttpLoader implements TranslateLoader {
  constructor(
    private readonly http: HttpClient,
    private readonly transferState: TransferState,
    private readonly onServer: boolean,
  ) {}

  public getTranslation(lang: string): Observable<TranslationObject> {
    if (!this.onServer && localStorage.getItem('lang_dev')) {
      const localData = localStorage.getItem(`lang_${lang}`);
      if (localData) {
        return of(JSON.parse(localData) as TranslationObject);
      }
    }
    const key = makeStateKey<TranslationObject>(`i18n ${lang}`);
    const rendered = this.transferState.get(key, null);
    if (rendered) {
      this.transferState.remove(key);
      return of(rendered);
    }
    if (!this.onServer) return this.http.get<TranslationObject>(`${environment.i18nBaseUrl}${lang}.json`);
    return this.cachedOnServer(lang).pipe(tap((translations) => this.transferState.set(key, translations)));
  }

  private cachedOnServer(lang: string): Observable<TranslationObject> {
    const cached = serverTranslations.get(lang);
    if (cached && Date.now() - cached.loadedAt < SERVER_TRANSLATIONS_TTL_MS) return cached.translations;
    const translations = this.http.get<TranslationObject>(`${environment.i18nBaseUrl}${lang}.json`).pipe(
      timeout(SERVER_TRANSLATIONS_TIMEOUT_MS),
      catchError((error: unknown) => {
        serverTranslations.delete(lang);
        return throwError(() => error);
      }),
      shareReplay(1),
    );
    serverTranslations.set(lang, { loadedAt: Date.now(), translations });
    return translations;
  }
}

export function DynamicTranslateLoaderFactory(
  http: HttpClient,
  transferState: TransferState,
  platformId: object,
): TranslateLoader {
  if (isPlatformBrowser(platformId) && localStorage.getItem('lang_dev')) {
    return new LocalStorageTranslateLoader();
  }
  return new CustomHttpLoader(http, transferState, isPlatformServer(platformId));
}
