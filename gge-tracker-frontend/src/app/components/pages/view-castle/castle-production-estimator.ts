import { ConstructionItem, IMappedBuildingElement } from '@ggetracker-interfaces/empire-ranking';

export type ProducedResource = 'wood' | 'stone' | 'food' | 'honey' | 'beef';

export interface ResourceEstimate {
  base: number;
  boostPercent: number;
  flatBonus: number;
  perHour: number;
}

export interface MeadEstimate {
  breweryLevel: number;
  boostPercent: number;
  flatBonus: number;
  maxWorkloadPercent: number;
  limitedBy: 'honey' | 'food' | null;
  perHourAtMax: number;
  perHourAtFull: number;
  honeyUsedAtMax: number;
  foodUsedAtMax: number;
}

export interface CastleProductionEstimate {
  publicOrderFactor: number;
  resources: Record<ProducedResource, ResourceEstimate>;
  mead: MeadEstimate | null;
  meadWithoutBrewery: number;
}

export interface CastleProductionContext {
  publicOrder: number;
  kingdomId: number;
  castleType: number;
  effects: Record<string, string>[];
  effectCaps: Record<string, string>[];
}

type Resource = ProducedResource | 'mead';

interface ResourceRule {
  buildingField: string;
  boostField: string;
  primaryItemField?: string;
  unboostedItemField?: string;
}

interface Brewery {
  level: number;
  capacity: number;
  primaryBonus: number;
  honeyRatio: number;
  foodRatio: number;
}

const RESOURCES: ProducedResource[] = ['wood', 'stone', 'food', 'honey', 'beef'];

const RULES: Record<Resource, ResourceRule> = {
  wood: {
    buildingField: 'Woodproduction',
    boostField: 'Woodboost',
    primaryItemField: 'Woodproduction',
    unboostedItemField: 'unboostedWoodProduction',
  },
  stone: {
    buildingField: 'Stoneproduction',
    boostField: 'Stoneboost',
    primaryItemField: 'Stoneproduction',
    unboostedItemField: 'unboostedStoneProduction',
  },
  food: {
    buildingField: 'Foodproduction',
    boostField: 'Foodboost',
    primaryItemField: 'Foodproduction',
    unboostedItemField: 'unboostedFoodProduction',
  },
  honey: { buildingField: 'Honeyproduction', boostField: 'Honeyboost' },
  beef: { buildingField: 'Beefproduction', boostField: 'Beefboost' },
  mead: { buildingField: 'meadProduction', boostField: 'Meadboost' },
};

const PERCENT_EFFECT_TYPES: Record<string, Resource> = {
  '92': 'wood',
  '93': 'stone',
  '80': 'food',
  '165': 'honey',
  '191': 'beef',
  '164': 'mead',
};
const FLAT_EFFECT_TYPES: Record<string, Resource> = {
  '112': 'wood',
  '113': 'stone',
  '69': 'food',
  '163': 'honey',
  '190': 'beef',
  '161': 'mead',
};
const PRIMARY_EFFECT_TYPES: Record<string, Resource> = {
  '162': 'honey',
  '189': 'beef',
  '160': 'mead',
};

function isUnrestrictedOrListed(list: string | undefined, value: number): boolean {
  return !list || list.split(',').map(Number).includes(value);
}

class CappedSum {
  private readonly byCap = new Map<string, number>();

  constructor(private readonly caps: Map<string, number>) {}

  public add(capId: string, value: number): void {
    this.byCap.set(capId, (this.byCap.get(capId) ?? 0) + value);
  }

  public total(): number {
    let sum = 0;
    for (const [capId, value] of this.byCap) sum += Math.min(value, this.caps.get(capId) ?? Infinity);
    return sum;
  }
}

class ResourceAccumulator {
  public base = 0;
  public buildingBoost = 0;
  public unboostedItems = 0;
  public readonly boostEffects: CappedSum;
  public readonly flatEffects: CappedSum;

  constructor(caps: Map<string, number>) {
    this.boostEffects = new CappedSum(caps);
    this.flatEffects = new CappedSum(caps);
  }

  public get boostPercent(): number {
    return this.buildingBoost + this.boostEffects.total();
  }

  public get flatBonus(): number {
    return this.unboostedItems + this.flatEffects.total();
  }
}

export class CastleProductionEstimator {
  private readonly effectsById: Map<string, Record<string, string>>;
  private readonly accumulators: Record<Resource, ResourceAccumulator>;
  private brewery: Brewery | null = null;

  constructor(private readonly context: CastleProductionContext) {
    this.effectsById = new Map(context.effects.map((effect) => [String(effect['effectID']), effect]));
    const caps = new Map(
      context.effectCaps
        .filter((cap) => cap['maxTotalBonus'] !== undefined)
        .map((cap) => [String(cap['capID']), Number(cap['maxTotalBonus'])]),
    );
    this.accumulators = {
      wood: new ResourceAccumulator(caps),
      stone: new ResourceAccumulator(caps),
      food: new ResourceAccumulator(caps),
      honey: new ResourceAccumulator(caps),
      beef: new ResourceAccumulator(caps),
      mead: new ResourceAccumulator(caps),
    };
  }

  public static publicOrderFactor(publicOrder: number): number {
    if (publicOrder < 0) return 1 / (Math.sqrt(-publicOrder) / 50 + 1);
    return Math.sqrt(publicOrder) / 50 + 1;
  }

  public estimate(entries: IMappedBuildingElement[]): CastleProductionEstimate {
    for (const entry of entries) this.collect(entry);
    const factor = CastleProductionEstimator.publicOrderFactor(this.context.publicOrder);
    const resources = Object.fromEntries(
      RESOURCES.map((resource) => [resource, this.resourceEstimate(this.accumulators[resource], factor)]),
    ) as Record<ProducedResource, ResourceEstimate>;
    return {
      publicOrderFactor: factor,
      resources,
      mead: this.brewery ? this.meadEstimate(this.brewery, factor, resources) : null,
      meadWithoutBrewery: this.accumulators.mead.flatBonus,
    };
  }

  private collect(entry: IMappedBuildingElement): void {
    const items = Object.values(entry.constructionItems ?? {});
    this.collectEffects(String(entry.data['areaSpecificEffects'] ?? ''));
    for (const item of items) this.collectItem(item);
    for (const resource of RESOURCES) this.collectProducer(resource, entry, items);
    for (const resource of [...RESOURCES, 'mead'] as Resource[]) {
      this.accumulators[resource].buildingBoost += this.number(entry.data[RULES[resource].boostField]);
    }
    if (entry.data[RULES.mead.buildingField] !== undefined) this.collectBrewery(entry, items);
  }

  private collectProducer(resource: ProducedResource, entry: IMappedBuildingElement, items: ConstructionItem[]): void {
    const production = this.number(entry.data[RULES[resource].buildingField]);
    if (production === 0) return;
    const primary = items.reduce((sum, item) => sum + this.primaryItemBonus(resource, item), 0);
    this.accumulators[resource].base += (production + primary) * this.efficiency(entry);
  }

  private collectBrewery(entry: IMappedBuildingElement, items: ConstructionItem[]): void {
    this.brewery = {
      level: this.number(entry.data['level']),
      capacity: this.number(entry.data[RULES.mead.buildingField]),
      primaryBonus: items.reduce((sum, item) => sum + this.primaryItemBonus('mead', item), 0),
      honeyRatio: this.number(entry.data['honeyRatio']),
      foodRatio: this.number(entry.data['foodRatio']),
    };
  }

  private collectItem(item: ConstructionItem): void {
    for (const resource of RESOURCES) {
      const field = RULES[resource].unboostedItemField;
      if (field) this.accumulators[resource].unboostedItems += this.number(item[field]);
    }
    this.collectEffects(String(item['effects'] ?? ''));
  }

  private collectEffects(raw: string): void {
    for (const { effect, value } of this.parseEffects(raw)) {
      const typeId = String(effect['effectTypeID']);
      if (!this.appliesToCastle(effect)) continue;
      const capId = String(effect['capID'] ?? '');
      const boosted = PERCENT_EFFECT_TYPES[typeId];
      if (boosted) this.accumulators[boosted].boostEffects.add(capId, value);
      const flat = FLAT_EFFECT_TYPES[typeId];
      if (flat) this.accumulators[flat].flatEffects.add(capId, value);
    }
  }

  private primaryItemBonus(resource: Resource, item: ConstructionItem): number {
    const field = RULES[resource].primaryItemField;
    let bonus = field ? this.number(item[field]) : 0;
    for (const { effect, value } of this.parseEffects(String(item['effects'] ?? ''))) {
      if (PRIMARY_EFFECT_TYPES[String(effect['effectTypeID'])] === resource) bonus += value;
    }
    return bonus;
  }

  private appliesToCastle(effect: Record<string, string>): boolean {
    return (
      isUnrestrictedOrListed(effect['spaceIDs'], this.context.kingdomId) &&
      isUnrestrictedOrListed(effect['areaTypeID'], this.context.castleType)
    );
  }

  private parseEffects(raw: string): { effect: Record<string, string>; value: number }[] {
    const parsed: { effect: Record<string, string>; value: number }[] = [];
    for (const pair of raw.split(',')) {
      const [id, value] = pair.split('&');
      const effect = this.effectsById.get(id);
      const amount = Number(value);
      if (effect && Number.isFinite(amount)) parsed.push({ effect, value: amount });
    }
    return parsed;
  }

  private efficiency(entry: IMappedBuildingElement): number {
    const efficiency = Number(entry.building.efficiency);
    return efficiency < 0 || !Number.isFinite(efficiency) ? 1 : efficiency / 100;
  }

  private resourceEstimate(accumulator: ResourceAccumulator, factor: number): ResourceEstimate {
    const boostPercent = accumulator.boostPercent;
    const flatBonus = accumulator.flatBonus;
    return {
      base: accumulator.base,
      boostPercent,
      flatBonus,
      perHour: accumulator.base * factor * this.boostModifier(boostPercent) + flatBonus,
    };
  }

  private meadEstimate(
    brewery: Brewery,
    factor: number,
    resources: Record<ProducedResource, ResourceEstimate>,
  ): MeadEstimate {
    const accumulator = this.accumulators.mead;
    const honeyAtFull = brewery.capacity * brewery.honeyRatio;
    const foodAtFull = brewery.capacity * brewery.foodRatio;
    const honeyLimit = honeyAtFull > 0 ? resources.honey.perHour / honeyAtFull : 1;
    const foodLimit = foodAtFull > 0 ? resources.food.perHour / foodAtFull : 1;
    const workload = Math.max(0, Math.min(1, honeyLimit, foodLimit));
    const limitedBy = workload >= 1 ? null : honeyLimit <= foodLimit ? 'honey' : 'food';
    const maxLoad = Math.floor(workload * 100) / 100;
    const meadAt = (load: number): number =>
      load > 0
        ? (brewery.capacity * load + brewery.primaryBonus) * factor * this.boostModifier(accumulator.boostPercent) +
          accumulator.flatBonus
        : 0;
    return {
      breweryLevel: brewery.level,
      boostPercent: accumulator.boostPercent,
      flatBonus: accumulator.flatBonus,
      maxWorkloadPercent: Math.round(maxLoad * 100),
      limitedBy,
      perHourAtMax: meadAt(maxLoad),
      perHourAtFull: meadAt(1),
      honeyUsedAtMax: honeyAtFull * maxLoad,
      foodUsedAtMax: foodAtFull * maxLoad,
    };
  }

  private boostModifier(boostPercent: number): number {
    return Math.max(0, 1 + boostPercent / 100);
  }

  private number(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
