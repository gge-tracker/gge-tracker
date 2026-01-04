import { inject, Injectable } from '@angular/core';

import { LanguageService } from './language.service';
import { LocalStorageService } from './local-storage.service';
import { environment } from 'environments/environment';

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
    gr: ['GR1'],
    asia: ['ASIA'],
    lt: ['LT1'],
    skn: ['SKN1'],
    sk: ['SK1'],
    bg: ['BG1'],
    gb: ['GB1'],
    kr: ['KR1'],
    jp: ['JP1'],
    his: ['HIS1'],
    ae: ['AE1'],
    eg: ['EG1'],
  };

  public flagsUrl: Record<string, string> = {
    AE: 'https://flagsapi.com/AE/flat/64.png',
    ARAB: '/assets/arab_flag.png',
    ASIA: 'https://flagsapi.com/AS/flat/64.png',
    AU: 'https://flagsapi.com/AU/flat/64.png',
    BG: 'https://flagsapi.com/BG/flat/64.png',
    BR: 'https://flagsapi.com/BR/flat/64.png',
    CN: 'https://flagsapi.com/CN/flat/64.png',
    CZ: 'https://flagsapi.com/CZ/flat/64.png',
    DE: 'https://flagsapi.com/DE/flat/64.png',
    EG: 'https://flagsapi.com/EG/flat/64.png',
    ES: 'https://flagsapi.com/ES/flat/64.png',
    FR: 'https://flagsapi.com/FR/flat/64.png',
    GB: 'https://flagsapi.com/GB/flat/64.png',
    GR: 'https://flagsapi.com/GR/flat/64.png',
    HANT: 'https://flagsapi.com/CN/flat/64.png',
    HIS: 'https://flagsapi.com/MX/flat/64.png',
    HU: 'https://flagsapi.com/HU/flat/64.png',
    IN: 'https://flagsapi.com/IN/flat/64.png',
    INT: '/assets/int_flag.png',
    IT: 'https://flagsapi.com/IT/flat/64.png',
    JP: 'https://flagsapi.com/JP/flat/64.png',
    LIVE: '/assets/int_flag.png',
    LT: 'https://flagsapi.com/LT/flat/64.png',
    NL: 'https://flagsapi.com/NL/flat/64.png',
    PL: 'https://flagsapi.com/PL/flat/64.png',
    PT: 'https://flagsapi.com/PT/flat/64.png',
    RO: 'https://flagsapi.com/RO/flat/64.png',
    RU: 'https://flagsapi.com/RU/flat/64.png',
    SA: 'https://flagsapi.com/SA/flat/64.png',
    SK: 'https://flagsapi.com/SK/flat/64.png',
    SKN: 'https://flagsapi.com/SE/flat/64.png',
    TR: 'https://flagsapi.com/TR/flat/64.png',
    US: 'https://flagsapi.com/US/flat/64.png',
    WORLD: '/assets/int_flag.png',
    SP: '/assets/int_flag.png',
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
    if (server.startsWith('E4K_')) {
      server = server.slice(4);
    } else if (server.startsWith('PARTNER_')) {
      server = 'SP';
    }
    const regex = /\d+$/g;
    server = server.replaceAll(regex, '');
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
    const url = environment.i18nBaseUrl + 'servers.xml';
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
