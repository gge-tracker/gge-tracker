import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { LocalStorageService } from './local-storage.service';

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  public currentLang = 'en';
  public langs = [
    { code: 'en', label: 'English', flagUrl: 'https://flagsapi.com/GB/flat/32.png' },
    { code: 'fr', label: 'Français', flagUrl: 'https://flagsapi.com/FR/flat/32.png' },
    { code: 'nl', label: 'Nederlands', flagUrl: 'https://flagsapi.com/NL/flat/32.png' },
    { code: 'pl', label: 'Polski', flagUrl: 'https://flagsapi.com/PL/flat/32.png' },
    { code: 'ro', label: 'Română', flagUrl: 'https://flagsapi.com/RO/flat/32.png' },
    { code: 'de', label: 'Deutsch', flagUrl: 'https://flagsapi.com/DE/flat/32.png' },
  ];

  // @ts-expect-error Property 'userLanguage' does not exist on type 'Navigator'.
  private language = (navigator.language || navigator['userLanguage']).toLowerCase();
  private localStorage = inject(LocalStorageService);
  private readonly defaultLang = 'en';

  constructor(private translate: TranslateService) {
    if (!this.localStorage.getItem('lang')) {
      this.localStorage.setItem('lang', this.getPreferredLanguage());
    }
    this.currentLang = this.localStorage.getItem('lang') || this.defaultLang;
    this.translate.setDefaultLang(this.defaultLang);
    this.translate.use(this.currentLang);
  }

  public getFlagUrlForLang(lang: string): string {
    const langObject = this.langs.find((l) => l.code === lang);
    return langObject ? langObject.flagUrl : '';
  }

  public getCurrentLang(): string {
    return this.currentLang;
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
    for (const lang of this.langs) {
      if (this.language.startsWith(lang.code)) {
        return lang.code;
      }
    }
    return this.defaultLang;
  }
}
