import { inject, Injectable } from '@angular/core';

import { LanguageService } from './language.service';
import { LocalStorageService } from './local-storage.service';
import { environment } from 'environments/environment';
import { stripTrailingDigits } from './text-format.utilities';

export interface ServerEntry {
  enabled: boolean;
  storm: boolean;
  fortress: boolean;
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

  public flagsUrl: Record<string, string> = {
    AE: '/assets/flags/AE.png',
    AR: '/assets/flags/AR.png',
    ARAB: '/assets/arab_flag.png',
    ASIA: '/assets/flags/AS.png',
    AU: '/assets/flags/AU.png',
    BG: '/assets/flags/BG.png',
    BR: '/assets/flags/BR.png',
    CN: '/assets/flags/CN.png',
    CZ: '/assets/flags/CZ.png',
    DE: '/assets/flags/DE.png',
    EG: '/assets/flags/EG.png',
    ES: '/assets/flags/ES.png',
    FR: '/assets/flags/FR.png',
    GB: '/assets/flags/GB.png',
    GR: '/assets/flags/GR.png',
    HANT: '/assets/flags/CN.png',
    HIS: '/assets/flags/MX.png',
    HU: '/assets/flags/HU.png',
    IN: '/assets/flags/IN.png',
    IT: '/assets/flags/IT.png',
    JP: '/assets/flags/JP.png',
    LT: '/assets/flags/LT.png',
    NL: '/assets/flags/NL.png',
    PL: '/assets/flags/PL.png',
    PT: '/assets/flags/PT.png',
    RO: '/assets/flags/RO.png',
    RU: '/assets/flags/RU.png',
    SA: '/assets/flags/SA.png',
    SK: '/assets/flags/SK.png',
    SKN: '/assets/flags/SE.png',
    TR: '/assets/flags/TR.png',
    US: '/assets/flags/US.png',
    PARTNER: '/assets/icons/icon-72x72.png',
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
    'WLD1',
    'WLD2',
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
  private readonly languageService = inject(LanguageService);
  private readonly localStorage = inject(LocalStorageService);

  public changeServer(server: string): void {
    this.localStorage.setItem('server', server);
    globalThis.location.reload();
  }

  public isE4kServer(server: string | undefined = this.currentServer?.name): boolean {
    return server?.startsWith('E4K_') ?? false;
  }

  public getFlagUrl(server: string): string {
    if (server.startsWith('E4K_')) {
      server = server.slice(4);
    } else if (server.startsWith('PARTNER')) {
      server = 'PARTNER';
    }
    server = stripTrailingDigits(server.replaceAll('_BETA', ''));
    return this.flagsUrl[server] || '/assets/int_flag.png';
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
    const url = environment.apiUrl + 'servers/catalog';
    await fetch(url)
      .then((response) => response.text())
      .then((xml) => {
        this.xmlServers = this.parseServers(xml);
      })
      .catch((error) => console.error('Error loading servers:', error));
    const lang = this.languageService.currentLang.trim().toUpperCase() + '1';
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
      const storm = node.querySelector('storm')?.textContent?.trim() !== 'false';
      const fortress = node.querySelector('fortress')?.textContent?.trim() !== 'false';
      const ggeServerName = node.querySelector('gge-server-name')?.textContent?.trim() ?? '';
      const name = node.querySelector('name')?.textContent?.trim() ?? '';
      const flagUrl = this.getFlagUrl(name);
      return {
        enabled,
        storm,
        fortress,
        ggeServerName,
        name,
        flagUrl,
      };
    });
  }
}
