import { inject, Injectable } from '@angular/core';

import { LanguageService } from './language.service';
import { LocalStorageService } from './local-storage.service';

export interface ServerEntry {
  enabled: boolean;
  featured: boolean;
  ggeServerName: string;
  name: string;
  flagUrl?: string;
}

/**
 * Service for managing server selection and mapping in the gge-tracker frontend.
 * This service provides functionality to select, store, and retrieve the current server,
 * as well as mapping between server codes, language codes, display names, and flag URLs.
 * It interacts with `LanguageService` to determine the user's language and with
 * `LocalStorageService` to persist the selected server.
 */
@Injectable({
  providedIn: 'root',
})
export class ServerService {
  public currentServer?: ServerEntry;
  public xmlServers: ServerEntry[] = [];
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

  public flagsUrl: Record<string, string> = {
    AE1: 'https://flagsapi.com/AE/flat/64.png',
    ARAB1: '/assets/arab_flag.png',
    ARAB: '/assets/arab_flag.png',
    ASIA: 'https://flagsapi.com/AS/flat/64.png',
    AU1: 'https://flagsapi.com/AU/flat/64.png',
    BG1: 'https://flagsapi.com/BG/flat/64.png',
    BR1: 'https://flagsapi.com/BR/flat/64.png',
    CN1: 'https://flagsapi.com/CN/flat/64.png',
    CZ1: 'https://flagsapi.com/CZ/flat/64.png',
    DE1: 'https://flagsapi.com/DE/flat/64.png',
    E4K_BR1: 'https://flagsapi.com/BR/flat/64.png',
    E4K_DE1: 'https://flagsapi.com/DE/flat/64.png',
    E4K_DE2: 'https://flagsapi.com/DE/flat/64.png',
    E4K_FR1: 'https://flagsapi.com/FR/flat/64.png',
    E4K_HANT1: 'https://flagsapi.com/CN/flat/64.png',
    E4K_INT2: '/assets/int_flag.png',
    E4K_US1: 'https://flagsapi.com/US/flat/64.png',
    EG1: 'https://flagsapi.com/EG/flat/64.png',
    ES1: 'https://flagsapi.com/ES/flat/64.png',
    ES2: 'https://flagsapi.com/ES/flat/64.png',
    FR1: 'https://flagsapi.com/FR/flat/64.png',
    GB1: 'https://flagsapi.com/GB/flat/64.png',
    GR1: 'https://flagsapi.com/GR/flat/64.png',
    HANT1: 'https://flagsapi.com/CN/flat/64.png',
    HANT: 'https://flagsapi.com/CN/flat/64.png',
    HIS1: 'https://flagsapi.com/MX/flat/64.png',
    HU1: 'https://flagsapi.com/HU/flat/64.png',
    HU2: 'https://flagsapi.com/HU/flat/64.png',
    IN1: 'https://flagsapi.com/IN/flat/64.png',
    INT1: '/assets/int_flag.png',
    INT2: '/assets/int_flag.png',
    INT3: '/assets/int_flag.png',
    IT1: 'https://flagsapi.com/IT/flat/64.png',
    JP1: 'https://flagsapi.com/JP/flat/64.png',
    LIVE: '/assets/int_flag.png',
    LT1: 'https://flagsapi.com/LT/flat/64.png',
    NL1: 'https://flagsapi.com/NL/flat/64.png',
    PL1: 'https://flagsapi.com/PL/flat/64.png',
    PT1: 'https://flagsapi.com/PT/flat/64.png',
    RO1: 'https://flagsapi.com/RO/flat/64.png',
    RU1: 'https://flagsapi.com/RU/flat/64.png',
    SA1: 'https://flagsapi.com/SA/flat/64.png',
    SK1: 'https://flagsapi.com/SK/flat/64.png',
    SKN1: 'https://flagsapi.com/DK/flat/64.png',
    TR1: 'https://flagsapi.com/TR/flat/64.png',
    US1: 'https://flagsapi.com/US/flat/64.png',
    WORLD1: '/assets/int_flag.png',
  };
  public ggeEmpireActiveServerPrefixes = [
    'AE1',
    'ARAB',
    'ASIA',
    'AU1',
    'BG1',
    'BR1',
    'CN1',
    'CZ1',
    'DE1',
    'EG1',
    'ES1',
    'ES2',
    'FR1',
    'GB1',
    'GR1',
    'HANT',
    'HIS1',
    'HU1',
    'HU2',
    'IN1',
    'INT1',
    'INT2',
    'INT3',
    'IT1',
    'JP1',
    'LIVE',
    'LT1',
    'NL1',
    'PL1',
    'PT1',
    'RO1',
    'RU1',
    'SA1',
    'SK1',
    'SKN1',
    'TR1',
    'US1',
  ];
  private languageService = inject(LanguageService);
  private localStorage = inject(LocalStorageService);

  public changeServer(server: string): void {
    this.localStorage.setItem('server', server);
    globalThis.location.reload();
  }

  public getFlagUrl(server: string): string {
    return this.flagsUrl[server] || '/assets/default_flag.png';
  }

  public get servers(): string[] {
    return this.xmlServers.filter((s) => s.enabled).map((s) => s.name);
  }

  public get mappedServersToGgeServerName(): Record<string, string> {
    const mapping: Record<string, string> = {};
    this.xmlServers.forEach((server) => {
      mapping[server.name] = server.ggeServerName;
    });
    return mapping;
  }

  public async init(): Promise<void> {
    const url = 'https://ggetracker.github.io/i18n/servers.xml';
    await fetch(url)
      .then((response) => response.text())
      .then((xml) => {
        this.xmlServers = this.parseServers(xml);
      })
      .catch((error) => console.error('Error loading servers:', error));
    const lang = this.mappedLangsToServers[this.languageService.currentLang.trim().toLowerCase()][0];
    const defaultServer = this.xmlServers.find((s) => s.name === 'WORLD1' && s.enabled) || this.xmlServers[0];
    const storedServer = this.localStorage.getItem('server');
    const target = this.xmlServers.find((s) => s.name === storedServer && s.enabled);
    if (storedServer && target) {
      this.currentServer = target;
    } else {
      this.currentServer = this.xmlServers.find((s) => s.name === lang && s.enabled) || defaultServer;
    }
  }

  private parseServers(xml: string): ServerEntry[] {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const parserError = document.querySelector('parsererror');
    if (parserError) {
      console.error('XML parse error:', parserError.textContent);
      return [];
    }
    const nodes = [...(document.querySelectorAll('root > servers > server') as unknown as Iterable<Element>)];
    return nodes.map((node) => {
      const enabled = node.querySelector('enabled')?.textContent?.trim() === 'true';
      const featured = node.querySelector('featured')?.textContent?.trim() === 'false' ? false : true;
      const ggeServerName = node.querySelector('gge-server-name')?.textContent?.trim() ?? '';
      const name = node.querySelector('name')?.textContent?.trim() ?? '';
      const flagUrl = this.getFlagUrl(name);
      return {
        enabled,
        featured,
        ggeServerName,
        name,
        flagUrl,
      };
    });
  }
}
