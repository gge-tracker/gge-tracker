import { inject, Injectable } from '@angular/core';

import { LanguageService } from './language.service';
import { LocalStorageService } from './local-storage.service';

/**
 * Service for managing server selection and mapping in the gge-tracker frontend.
 *
 * @remarks
 * This service provides functionality to select, store, and retrieve the current server,
 * as well as mapping between server codes, language codes, display names, and flag URLs.
 * It interacts with `LanguageService` to determine the user's language and with
 * `LocalStorageService` to persist the selected server.
 *
 * @example
 * ```typescript
 * serverService.changeServer('DE1');
 * ```
 *
 * @property currentServer - The currently selected server code.
 * @property choosedServer - The server code chosen by the user.
 * @property servers - List of all available server codes.
 * @property mappedLangsToServers - Mapping from language codes to server codes.
 * @property mappedServersToGgeServerName - Mapping from server codes to display names.
 * @property flagsUrl - Mapping from server codes to flag image URLs.
 *
 * @method changeServer - Changes the current server and reloads the page.
 */
@Injectable({
  providedIn: 'root',
})
export class ServerService {
  public currentServer = 'FR1';
  public choosedServer = 'FR1';
  public servers = [
    'FR1',
    'DE1',
    'RO1',
    'CZ1',
    'NL1',
    'WORLD1',
    'INT3',
    'US1',
    'TR1',
    'PT1',
    'BR1',
    'IN1',
    'IT1',
    'PL1',
    'AU1',
    'ARAB1',
    'HANT1',
    'HU1',
    'HU2',
    'ES1',
    'SA1',
    'INT1',
    'RU1',
    'CN1',
    'GR1',
    'E4K_BR1',
    'E4K_HANT1',
    'E4K_FR1',
    'E4K_DE1',
    'E4K_DE2',
    'E4K_US1',
    'E4K_INT2',
  ];
  public mappedLangsToServers: Record<string, string[]> = {
    fr: ['FR1'],
    de: ['DE1'],
    nl: ['NL1'],
    en: ['WORLD1', 'INT3', 'US1'],
    ro: ['RO1'],
    cz: ['CZ1'],
    tr: ['TR1'],
    br: ['BR1'],
    in: ['IN1'],
    it: ['IT1'],
    pl: ['PL1'],
    pt: ['PT1'],
    au: ['AU1'],
    ar: ['AR1'],
    hant1: ['HANT1'],
    hu: ['HU1', 'HU2'],
    es: ['ES1'],
    sa: ['SA1'],
    ru: ['RU1'],
    cn: ['CN1'],
  };
  public mappedServersToGgeServerName: Record<string, string> = {
    FR1: 'France',
    DE1: 'Germany',
    RO1: 'Romania',
    CZ1: 'Czech Republic',
    NL1: 'Netherlands',
    WORLD1: 'World',
    INT3: 'International: 3',
    US1: 'United States',
    TR1: 'Turkey',
    BR1: 'Brazil',
    IN1: 'India',
    IT1: 'Italy',
    PL1: 'Poland',
    ARAB1: 'Arab League',
    PT1: 'Portugal',
    AU1: 'Australia',
    HANT1: 'Chinese (Traditional)',
    HU1: 'Hungary: 1',
    HU2: 'Hungary: 2',
    ES1: 'Spain',
    SA1: 'Saudi Arabia',
    INT1: 'International: 1',
    RU1: 'Russia',
    CN1: 'China',
    GR1: 'Greece',
    E4K_BR1: 'Empire Four Kingdoms - Brazil 1',
    E4K_HANT1: 'Empire Four Kingdoms - Chinese (Traditional)',
    E4K_FR1: 'Empire Four Kingdoms - France 1',
    E4K_DE1: 'Empire Four Kingdoms - Germany 1',
    E4K_DE2: 'Empire Four Kingdoms - Germany 2',
    E4K_US1: 'Empire Four Kingdoms - United States 1',
    E4K_INT2: 'Empire Four Kingdoms - International 2',
  };

  public flagsUrl: Record<string, string> = {
    FR1: 'https://flagsapi.com/FR/flat/64.png',
    DE1: 'https://flagsapi.com/DE/flat/64.png',
    RO1: 'https://flagsapi.com/RO/flat/64.png',
    CZ1: 'https://flagsapi.com/CZ/flat/64.png',
    NL1: 'https://flagsapi.com/NL/flat/64.png',
    WORLD1: '/assets/int_flag.png',
    INT3: '/assets/int_flag.png',
    US1: 'https://flagsapi.com/US/flat/64.png',
    TR1: 'https://flagsapi.com/TR/flat/64.png',
    PT1: 'https://flagsapi.com/PT/flat/64.png',
    BR1: 'https://flagsapi.com/BR/flat/64.png',
    IN1: 'https://flagsapi.com/IN/flat/64.png',
    IT1: 'https://flagsapi.com/IT/flat/64.png',
    PL1: 'https://flagsapi.com/PL/flat/64.png',
    AU1: 'https://flagsapi.com/AU/flat/64.png',
    ARAB1: '/assets/arab_flag.png',
    HANT1: 'https://flagsapi.com/CN/flat/64.png',
    HU1: 'https://flagsapi.com/HU/flat/64.png',
    HU2: 'https://flagsapi.com/HU/flat/64.png',
    ES1: 'https://flagsapi.com/ES/flat/64.png',
    SA1: 'https://flagsapi.com/SA/flat/64.png',
    INT1: '/assets/int_flag.png',
    RU1: 'https://flagsapi.com/RU/flat/64.png',
    CN1: 'https://flagsapi.com/CN/flat/64.png',
    GR1: 'https://flagsapi.com/GR/flat/64.png',
    E4K_BR1: 'https://flagsapi.com/BR/flat/64.png',
    E4K_HANT1: 'https://flagsapi.com/CN/flat/64.png',
    E4K_FR1: 'https://flagsapi.com/FR/flat/64.png',
    E4K_DE1: 'https://flagsapi.com/DE/flat/64.png',
    E4K_DE2: 'https://flagsapi.com/DE/flat/64.png',
    E4K_US1: 'https://flagsapi.com/US/flat/64.png',
    E4K_INT2: '/assets/int_flag.png',
  };
  private languageService = inject(LanguageService);
  private localStorage = inject(LocalStorageService);

  constructor() {
    let lang = this.mappedLangsToServers[this.languageService.currentLang.trim().toLowerCase()][0];
    if (lang == null) {
      lang = 'FR1';
    }
    this.currentServer = this.localStorage.getItem('server') || lang;
    if (this.servers.includes(this.currentServer)) {
      this.choosedServer = this.currentServer;
    }
  }

  public changeServer(server: string): void {
    this.localStorage.setItem('server', server);
    globalThis.location.reload();
  }
}
