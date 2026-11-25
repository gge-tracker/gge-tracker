import * as fs from 'node:fs';
import path from 'node:path';
import { ApiHelper } from './api-helper';

export type VariantEventType = 'outer_realms' | 'beyond_the_horizon';

interface VariantMaps {
  outerRealms: Map<number, string>;
  beyondTheHorizon: Map<number, string>;
}

interface ItemsWithEventSettings {
  tempServerSettings?: unknown;
  allianceBattleGroundSettings?: unknown;
  allianceBattleGroundScorings?: unknown;
}

type RawRow = Record<string, string | number | undefined>;

function rows(value: unknown): RawRow[] {
  return Array.isArray(value) ? (value as RawRow[]) : [];
}

/**
 * The scoring an event edition ran with, from the settings row the game named for it (stored as setting_id)
 * E4K names the same rows, so the EP items file serves both games
 */
export abstract class EventVariants {
  private static readonly ITEMS_FILE = path.join(__dirname, './../assets/items.json');
  private static maps: VariantMaps | null = null;
  private static loading: Promise<VariantMaps> | null = null;

  public static async resolve(
    eventType: VariantEventType,
    settingId: string | number | null | undefined,
    storedScoring: string | null | undefined,
  ): Promise<string | null> {
    if (storedScoring) return storedScoring;
    const id = Number(settingId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const maps = await this.load();
    const byId = eventType === 'outer_realms' ? maps.outerRealms : maps.beyondTheHorizon;
    return byId.get(id) ?? null;
  }

  public static publishFromItems(items: ItemsWithEventSettings): void {
    this.maps = this.extract(items);
  }

  private static load(): Promise<VariantMaps> {
    if (this.maps) return Promise.resolve(this.maps);
    this.loading ??= this.readItemsFile().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private static async readItemsFile(): Promise<VariantMaps> {
    try {
      const itemsFile = await fs.promises.readFile(this.ITEMS_FILE);
      const items = JSON.parse(itemsFile.toString());
      this.maps = this.extract(items);
    } catch (error) {
      ApiHelper.logError(error, 'EventVariants.readItemsFile', null);
      this.maps = { outerRealms: new Map(), beyondTheHorizon: new Map() };
    }
    return this.maps;
  }

  private static extract(items: ItemsWithEventSettings): VariantMaps {
    const scoringNames = new Map(
      rows(items.allianceBattleGroundScorings).map((row) => [String(row.scoringID), String(row.scoring ?? '')]),
    );
    return {
      outerRealms: new Map(
        rows(items.tempServerSettings)
          .filter((row) => row.scoringSystem)
          .map((row) => [Number(row.settingID), String(row.scoringSystem)]),
      ),
      beyondTheHorizon: new Map(
        rows(items.allianceBattleGroundSettings)
          .filter((row) => scoringNames.get(String(row.scoringID)))
          .map((row) => [Number(row.settingID), scoringNames.get(String(row.scoringID))!]),
      ),
    };
  }
}
