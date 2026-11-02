import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LocalStorageService } from './local-storage.service';

export interface SiteLanguage {
  code: string;
  label: string;
  englishName: string;
  flagUrl: string;
  locale: string;
  homeServer?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  public currentLang = 'en';
  public readonly langs: SiteLanguage[] = [
    { code: 'ar', label: 'العربية', englishName: 'Arabic', flagUrl: '/assets/flags/SA.png', locale: 'ar-SA' },
    { code: 'bg', label: 'Български', englishName: 'Bulgarian', flagUrl: '/assets/flags/BG.png', locale: 'bg-BG' },
    {
      code: 'cs',
      label: 'Čeština',
      englishName: 'Czech',
      flagUrl: '/assets/flags/CZ.png',
      locale: 'cs-CZ',
      homeServer: 'CZ1',
    },
    { code: 'de', label: 'Deutsch', englishName: 'German', flagUrl: '/assets/flags/DE.png', locale: 'de-DE' },
    {
      code: 'el',
      label: 'Ελληνικά',
      englishName: 'Greek',
      flagUrl: '/assets/flags/GR.png',
      locale: 'el-GR',
      homeServer: 'GR1',
    },
    { code: 'en', label: 'English', englishName: 'English', flagUrl: '/assets/flags/GB.png', locale: 'en-GB' },
    { code: 'es', label: 'Español', englishName: 'Spanish', flagUrl: '/assets/flags/ES.png', locale: 'es-ES' },
    { code: 'fr', label: 'Français', englishName: 'French', flagUrl: '/assets/flags/FR.png', locale: 'fr-FR' },
    { code: 'hu', label: 'Magyar', englishName: 'Hungarian', flagUrl: '/assets/flags/HU.png', locale: 'hu-HU' },
    { code: 'it', label: 'Italiano', englishName: 'Italian', flagUrl: '/assets/flags/IT.png', locale: 'it-IT' },
    { code: 'nl', label: 'Nederlands', englishName: 'Dutch', flagUrl: '/assets/flags/NL.png', locale: 'nl-NL' },
    { code: 'pl', label: 'Polski', englishName: 'Polish', flagUrl: '/assets/flags/PL.png', locale: 'pl-PL' },
    { code: 'pt', label: 'Português', englishName: 'Portuguese', flagUrl: '/assets/flags/BR.png', locale: 'pt-BR' },
    { code: 'ro', label: 'Română', englishName: 'Romanian', flagUrl: '/assets/flags/RO.png', locale: 'ro-RO' },
    { code: 'ru', label: 'Русский', englishName: 'Russian', flagUrl: '/assets/flags/RU.png', locale: 'ru-RU' },
    { code: 'tr', label: 'Türkçe', englishName: 'Turkish', flagUrl: '/assets/flags/TR.png', locale: 'tr-TR' },
  ];

  private readonly browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  private readonly localStorage = inject(LocalStorageService);
  private readonly defaultLang = 'en';

  constructor(private readonly translate: TranslateService) {
    if (!this.acceptLangs.includes(this.localStorage.getItem('lang') ?? '')) {
      this.localStorage.setItem('lang', this.getPreferredLanguage());
    }
    this.currentLang = this.localStorage.getItem('lang') || this.defaultLang;
    this.translate.setDefaultLang(this.defaultLang);
    this.translate.use(this.currentLang);
    document.documentElement.lang = this.currentLang;
  }

  public getFlagUrlForLang(lang: string): string {
    return this.findLang(lang)?.flagUrl ?? '';
  }

  public getCurrentLang(): string {
    return this.currentLang;
  }

  public getCurrentLanguage(): SiteLanguage | undefined {
    return this.findLang(this.currentLang);
  }

  public getCurrentLocale(): string {
    return this.findLang(this.currentLang)?.locale ?? 'en-GB';
  }

  public getHomeServer(): string {
    return this.findLang(this.currentLang)?.homeServer ?? this.currentLang.toUpperCase() + '1';
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

  public get browserSuggestedLangs(): SiteLanguage[] {
    const codes = new Set(this.browserLanguages.map((language) => (language || '').toLowerCase().split('-')[0]));
    return this.langs.filter((lang) => codes.has(lang.code) && lang.code !== this.currentLang);
  }

  public searchLangs(query: string): SiteLanguage[] {
    const needle = this.normalize(query);
    if (!needle) return this.langs;
    return this.langs.filter((lang) =>
      [lang.label, lang.englishName, lang.code].some((name) => this.normalize(name).includes(needle)),
    );
  }

  private findLang(code: string): SiteLanguage | undefined {
    return this.langs.find((l) => l.code === code);
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replaceAll(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
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
