import islesConfig from '../../assets/storm-tracker/isles.json';

export type StormResource = 'aquamarine' | 'stone' | 'wood';

export interface StormFortDefinition {
  isleId: number;
  level: number;
  guards: number;
  units: { min: number; max: number } | null;
  isLowGarrison: boolean;
  cargoPoints: number;
  aquamarine: number;
}

export interface StormIsleDefinition {
  isleId: number;
  resource: StormResource;
  guards: number;
  fixedLoot: number;
  tier: 1 | 2;
  occupationTime: number;
  cargoPoints: number | null;
}

interface RawIsleConfig {
  IsleID: string;
  type: string;
  dungeonlevel: string;
  guards: string;
  occupationTime?: string;
  lootCargoPoints?: string;
  lootAquamarine?: string;
  fixedLootWood?: string;
  fixedLootStone?: string;
  fixedLootAquamarine?: string;
}

const FORT_UNITS: Record<number, { min: number; max: number }> = {
  7: { min: 10, max: 20 }, // level 60, 60 guards
  8: { min: 40, max: 50 }, // level 70, 65 guards
  9: { min: 70, max: 80 }, // level 80, 75 guards
  10: { min: 154, max: 154 }, // level 40, 35 guards
  11: { min: 227, max: 227 }, // level 50, 40 guards
  12: { min: 400, max: 450 }, // level 60, 50 guards
  13: { min: 450, max: 500 }, // level 70, 55 guards
  14: { min: 500, max: 600 }, // level 80, 60 guards
};

const LOW_GARRISON_FORT_IDS = new Set([7, 8, 9]);

const RAW: RawIsleConfig[] = islesConfig as RawIsleConfig[];

function resourceOfType(type: string): StormResource | null {
  switch (type) {
    case 'VILLAGEAQUAMARINE': {
      return 'aquamarine';
    }
    case 'VILLAGESTONE': {
      return 'stone';
    }
    case 'VILLAGEWOOD': {
      return 'wood';
    }
    default: {
      return null;
    }
  }
}

function fixedLootOf(entry: RawIsleConfig): number {
  return Number(entry.fixedLootAquamarine ?? entry.fixedLootStone ?? entry.fixedLootWood ?? 0);
}

const FORT_DEFINITIONS = new Map<number, StormFortDefinition>(
  RAW.filter((entry) => entry.type === 'DUNGEON').map((entry) => {
    const isleId = Number(entry.IsleID);
    return [
      isleId,
      {
        isleId,
        level: Number(entry.dungeonlevel),
        guards: Number(entry.guards),
        units: FORT_UNITS[isleId] ?? null,
        isLowGarrison: LOW_GARRISON_FORT_IDS.has(isleId),
        cargoPoints: Number(entry.lootCargoPoints ?? 0),
        aquamarine: Number(entry.lootAquamarine ?? 0),
      },
    ];
  }),
);

const ISLE_DEFINITIONS = new Map<number, StormIsleDefinition>(
  ((): [number, StormIsleDefinition][] => {
    const villages = RAW.map((entry) => ({ entry, resource: resourceOfType(entry.type) })).filter(
      (candidate): candidate is { entry: RawIsleConfig; resource: StormResource } => candidate.resource !== null,
    );
    const richestByResource = new Map<StormResource, number>();
    for (const { entry, resource } of villages) {
      const loot = fixedLootOf(entry);
      if (loot > (richestByResource.get(resource) ?? 0)) richestByResource.set(resource, loot);
    }

    return villages.map(({ entry, resource }): [number, StormIsleDefinition] => {
      const isleId = Number(entry.IsleID);
      const fixedLoot = fixedLootOf(entry);
      return [
        isleId,
        {
          isleId,
          resource,
          guards: Number(entry.guards),
          fixedLoot,
          tier: fixedLoot === richestByResource.get(resource) ? 1 : 2,
          occupationTime: Number(entry.occupationTime ?? 0),
          cargoPoints: entry.lootCargoPoints ? Number(entry.lootCargoPoints) : null,
        },
      ];
    });
  })(),
);

export function getStormFortDefinition(isleId: number): StormFortDefinition | null {
  return FORT_DEFINITIONS.get(isleId) ?? null;
}

export const STORM_FORT_LEVELS: number[] = [...new Set([...FORT_DEFINITIONS.values()].map((f) => f.level))].sort(
  (a, b) => a - b,
);

export const STORM_RESOURCES: StormResource[] = ['aquamarine', 'stone', 'wood'];

export function resolveFortIsleIds(levels: number[], lowGarrisonOnly: boolean): number[] {
  return [...FORT_DEFINITIONS.values()]
    .filter((fort) => (levels.length === 0 || levels.includes(fort.level)) && (!lowGarrisonOnly || fort.isLowGarrison))
    .map((fort) => fort.isleId)
    .sort((a, b) => a - b);
}

export function resolveIsleIsleIds(resources: StormResource[]): number[] {
  return [...ISLE_DEFINITIONS.values()]
    .filter((isle) => resources.length === 0 || resources.includes(isle.resource))
    .map((isle) => isle.isleId)
    .sort((a, b) => a - b);
}

export function getStormIsleDefinition(isleId: number): StormIsleDefinition | null {
  return ISLE_DEFINITIONS.get(isleId) ?? null;
}

export const STORM_FORT_IMAGE = 'assets/storm-tracker/fort.png';

export function getStormIsleImage(isleId: number): string {
  return `assets/storm-tracker/village/${isleId}.png`;
}

export function getStormResourceLabel(resource: StormResource): string {
  switch (resource) {
    case 'aquamarine': {
      return 'Aigue-marine';
    }
    case 'stone': {
      return 'Pierre';
    }
    default: {
      return 'Bois';
    }
  }
}
