import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LocalStorageService } from './local-storage.service';

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  public currentLang = 'en';
  public langs = [
    { code: 'en', label: 'English', flagUrl: '/assets/flags/GB.png', locale: 'en-GB' },
    { code: 'fr', label: 'Français', flagUrl: '/assets/flags/FR.png', locale: 'fr-FR' },
    { code: 'nl', label: 'Nederlands', flagUrl: '/assets/flags/NL.png', locale: 'nl-NL' },
    { code: 'pl', label: 'Polski', flagUrl: '/assets/flags/PL.png', locale: 'pl-PL' },
    { code: 'ro', label: 'Română', flagUrl: '/assets/flags/RO.png', locale: 'ro-RO' },
    { code: 'de', label: 'Deutsch', flagUrl: '/assets/flags/DE.png', locale: 'de-DE' },
    { code: 'ar', label: 'العربية', flagUrl: '/assets/flags/SA.png', locale: 'ar-SA' },
    { code: 'pt', label: 'Português', flagUrl: '/assets/flags/BR.png', locale: 'pt-BR' },
    { code: 'es', label: 'Español', flagUrl: '/assets/flags/ES.png', locale: 'es-ES' },
    { code: 'it', label: 'Italiano', flagUrl: '/assets/flags/IT.png', locale: 'it-IT' },
    { code: 'tr', label: 'Türkçe', flagUrl: '/assets/flags/TR.png', locale: 'tr-TR' },
  ];

  private readonly browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  private readonly localStorage = inject(LocalStorageService);
  private readonly defaultLang = 'en';

  constructor(private readonly translate: TranslateService) {
    if (!this.localStorage.getItem('lang')) {
      this.localStorage.setItem('lang', this.getPreferredLanguage());
    }
    this.currentLang = this.localStorage.getItem('lang') || this.defaultLang;
    this.translate.setDefaultLang(this.defaultLang);
    this.translate.use(this.currentLang);
    document.documentElement.lang = this.currentLang;
  }

  public getFlagUrlForLang(lang: string): string {
    const langObject = this.langs.find((l) => l.code === lang);
    return langObject ? langObject.flagUrl : '';
  }

  public getCurrentLang(): string {
    return this.currentLang;
  }

  public getCurrentLocale(): string {
    const langObject = this.langs.find((l) => l.code === this.currentLang);
    return langObject ? langObject.locale : 'en-GB';
  }

  public setCurrentLang(lang: string): void {
    if (this.acceptLangs.includes(lang)) {
      this.localStorage.setItem('lang', lang);
      globalThis.location.reload();
    }
  }

  public get acceptLangs(): string[] {
    return this.langs.map((l) => l.code);
  }

  private getPreferredLanguage(): string {
    for (const language of this.browserLanguages) {
      const baseCode = (language || '').toLowerCase().split('-')[0];
      if (this.acceptLangs.includes(baseCode)) {
        return baseCode;
      }
    }
    return this.defaultLang;
  }
}
