//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import * as embedded from './definitions/temp-server-settings.json';
import Utils from './utils';

export interface TempServerSetting {
  settingID: string;
  scoringSystem: string;
  [field: string]: string | undefined;
}

interface SettingsStore {
  get(key: string): Promise<string | null>;
}

// Published by the API (helper/temporary-server-settings.ts), which extracts it from items.json
export const TEMP_SERVER_SETTINGS_KEY = 'temp-server-settings';

export const EMBEDDED_TEMP_SERVER_SETTINGS: TempServerSetting[] = embedded.settings;

// The embedded copy only backs up a missing or unreadable key: a published row always wins
export async function findTempServerSetting(
  settingId: string,
  store: SettingsStore,
): Promise<TempServerSetting | null> {
  const published = await readPublishedSettings(store);
  const matches = (setting: TempServerSetting): boolean => Number(setting.settingID) === Number(settingId);
  const found = published?.find((setting) => matches(setting));
  if (found) return found;
  const fallback = EMBEDDED_TEMP_SERVER_SETTINGS.find((setting) => matches(setting)) ?? null;
  if (fallback) {
    Utils.logWarning(
      ` Temporary server setting ${settingId} read from the embedded items.json ${embedded.itemsVersion} copy:`,
      published ? 'the published settings lack it.' : `Redis holds no readable '${TEMP_SERVER_SETTINGS_KEY}'.`,
    );
  }
  return fallback;
}

async function readPublishedSettings(store: SettingsStore): Promise<TempServerSetting[] | null> {
  try {
    const catalog = JSON.parse((await store.get(TEMP_SERVER_SETTINGS_KEY)) ?? 'null') as {
      settings?: TempServerSetting[];
    } | null;
    return Array.isArray(catalog?.settings) ? catalog.settings : null;
  } catch {
    return null;
  }
}
