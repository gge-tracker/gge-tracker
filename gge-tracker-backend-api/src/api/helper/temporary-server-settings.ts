import * as fs from 'node:fs';
import path from 'node:path';
import { ApiHelper } from './api-helper';

export interface TemporaryServerSetting {
  settingID: string;
  scoringSystem: string;
  peaceDuration?: string;
  hasDailyRanking?: string;
  [field: string]: string | undefined;
}

interface TemporaryServerSettingsCatalog {
  itemsVersion: string;
  settings: TemporaryServerSetting[];
}

/**
 * The Outer Realms settings of items.json `tempServerSettings`, extracted next to items.json
 * Redis carries a copy for gge-tracker-internal-scraping/src/temp-server-settings.ts, put back every sync since Redis evicts
 */
export abstract class TemporaryServerSettings {
  public static readonly REDIS_KEY = 'temp-server-settings';
  private static readonly CHECKED_KEY = 'temp-server-settings:checked-at';
  private static readonly SYNC_INTERVAL_MS = 60 * 1000;
  private static readonly REMOTE_CHECK_INTERVAL_SECONDS = 3600;
  private static readonly ASSETS_DIRECTORY = path.join(__dirname, './../assets/');
  private static readonly FILE = path.join(this.ASSETS_DIRECTORY, 'temporary-server-settings.json');
  private static readonly ITEMS_FILE = path.join(this.ASSETS_DIRECTORY, 'items.json');

  private static catalog: TemporaryServerSettingsCatalog | null = null;
  private static timer: ReturnType<typeof setInterval> | null = null;

  public static start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), this.SYNC_INTERVAL_MS);
    void this.sync();
  }

  public static async find(settingId: string | number | null): Promise<TemporaryServerSetting | null> {
    if (settingId === null || settingId === '') return null;
    const catalog = this.catalog ?? (await this.loadLocal());
    return catalog?.settings.find((setting) => Number(setting.settingID) === Number(settingId)) ?? null;
  }

  public static async publishFromItems(items: { versionInfo?: any; tempServerSettings?: unknown }): Promise<void> {
    const extracted = this.extract(items);
    if (extracted) await this.store(this.merge(this.catalog ?? (await this.loadLocal()), extracted));
  }

  private static async sync(): Promise<void> {
    try {
      const local = this.catalog ?? (await this.loadLocal());
      const shared = this.parseCatalog(JSON.parse((await ApiHelper.redisClient.get(this.REDIS_KEY)) ?? 'null'));
      let merged = this.merge(local, shared);
      const currentId = await ApiHelper.redisClient.get('temporaryServerData');
      if (currentId && !merged?.settings.some((setting) => Number(setting.settingID) === Number(currentId))) {
        merged = this.merge(merged, await this.fetchNewerFromGame(merged?.itemsVersion ?? null));
      }
      if (!merged) return;
      if (!this.sameCatalog(merged, local)) await this.writeFile(merged);
      if (!this.sameCatalog(merged, shared)) await ApiHelper.redisClient.set(this.REDIS_KEY, JSON.stringify(merged));
      this.catalog = merged;
    } catch (error) {
      ApiHelper.logError(error, 'TemporaryServerSettings.sync', null);
    }
  }

  private static async loadLocal(): Promise<TemporaryServerSettingsCatalog | null> {
    try {
      const stored = await fs.promises.readFile(this.FILE);
      this.catalog = this.parseCatalog(JSON.parse(stored.toString()));
    } catch {
      this.catalog = await this.extractFromLocalItems();
      if (this.catalog) await this.writeFile(this.catalog);
    }
    return this.catalog;
  }

  private static async extractFromLocalItems(): Promise<TemporaryServerSettingsCatalog | null> {
    try {
      const items = await fs.promises.readFile(this.ITEMS_FILE);
      return this.extract(JSON.parse(items.toString()));
    } catch {
      return null;
    }
  }

  /**
   * One version check per hour across every backend, and the full items file only when that version is newer
   */
  private static async fetchNewerFromGame(knownVersion: string | null): Promise<TemporaryServerSettingsCatalog | null> {
    const claimed = await ApiHelper.redisClient.set(this.CHECKED_KEY, String(Date.now()), {
      NX: true,
      EX: this.REMOTE_CHECK_INTERVAL_SECONDS,
    });
    if (!claimed) return null;
    const versionResponse = await ApiHelper.fetchWithFallback(
      `${ApiHelper.ASSETS_BASE_URL}/items/ItemsVersion.properties`,
    );
    const properties = await versionResponse.text();
    const remoteVersion = /CastleItemXMLVersion=(\d+\.\d+)/.exec(properties)?.[1];
    if (!remoteVersion || (knownVersion && this.compareVersions(remoteVersion, knownVersion) <= 0)) return null;
    const itemsResponse = await ApiHelper.fetchWithFallback(
      `${ApiHelper.ASSETS_BASE_URL}/items/items_v${remoteVersion}.json`,
    );
    const items = await itemsResponse.json();
    ApiHelper.logInfo('TemporaryServerSettings', `settings read from items.json ${remoteVersion}`);
    return this.extract(items);
  }

  private static async store(catalog: TemporaryServerSettingsCatalog | null): Promise<void> {
    if (!catalog) return;
    await this.writeFile(catalog);
    await ApiHelper.redisClient.set(this.REDIS_KEY, JSON.stringify(catalog));
    this.catalog = catalog;
  }

  private static async writeFile(catalog: TemporaryServerSettingsCatalog): Promise<void> {
    await fs.promises.mkdir(this.ASSETS_DIRECTORY, { recursive: true });
    const temporaryFile = `${this.FILE}.tmp`;
    await fs.promises.writeFile(temporaryFile, JSON.stringify(catalog, null, 2));
    await fs.promises.rename(temporaryFile, this.FILE);
  }

  private static extract(items: {
    versionInfo?: any;
    tempServerSettings?: unknown;
  }): TemporaryServerSettingsCatalog | null {
    const catalog = this.parseCatalog({
      itemsVersion: items?.versionInfo?.version?.['@value'],
      settings: items?.tempServerSettings,
    });
    return catalog && catalog.settings.length > 0 ? catalog : null;
  }

  private static merge(
    older: TemporaryServerSettingsCatalog | null,
    newer: TemporaryServerSettingsCatalog | null,
  ): TemporaryServerSettingsCatalog | null {
    if (!older || !newer) return older ?? newer;
    const byId = new Map<string, TemporaryServerSetting>();
    for (const setting of [...older.settings, ...newer.settings]) byId.set(String(setting.settingID), setting);
    const itemsVersion =
      this.compareVersions(newer.itemsVersion, older.itemsVersion) >= 0 ? newer.itemsVersion : older.itemsVersion;
    return {
      itemsVersion,
      settings: [...byId.values()].sort((a, b) => Number(a.settingID) - Number(b.settingID)),
    };
  }

  private static sameCatalog(
    a: TemporaryServerSettingsCatalog | null,
    b: TemporaryServerSettingsCatalog | null,
  ): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private static parseCatalog(raw: unknown): TemporaryServerSettingsCatalog | null {
    const candidate = raw as Partial<TemporaryServerSettingsCatalog> | null;
    if (typeof candidate?.itemsVersion !== 'string' || !Array.isArray(candidate.settings)) return null;
    const settings = candidate.settings.filter(
      (setting) => typeof setting?.settingID === 'string' && typeof setting.scoringSystem === 'string',
    );
    return { itemsVersion: candidate.itemsVersion, settings };
  }

  private static compareVersions(a: string, b: string): number {
    const [aMajor, aMinor] = a.split('.').map(Number);
    const [bMajor, bMinor] = b.split('.').map(Number);
    return aMajor - bMajor || aMinor - bMinor;
  }
}
