import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { LocalStorageService } from './local-storage.service';

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  public currentLang = 'en';
  public langs = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'pl', label: 'Polski' },
    { code: 'ro', label: 'Română' },
    { code: 'de', label: 'Deutsch' },
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

  public getCurrentLang(): string {
    return this.currentLang;
  }

  public setCurrentLang(lang: string): void {
    if (this.acceptLangs.includes(lang)) {
      this.localStorage.setItem('lang', lang);
      window.location.reload();
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
