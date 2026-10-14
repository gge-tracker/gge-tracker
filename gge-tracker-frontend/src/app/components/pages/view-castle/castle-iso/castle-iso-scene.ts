import { CastleDefenceLayout, CastleGround, DefencePosition, GridPoint, MoatLayout } from './castle-defence-layout';

export type IsoRotationType = 'none' | 'mirrored' | 'twoFramesMirrored';

export type IsoLayer = 'moat' | 'back' | 'main' | 'front';

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IsoSprite<T> {
  key: string;
  file: string;
  symbols?: string[];
  anchor: GridPoint;
  footprint: GridRect;
  rot: number;
  rotationType: IsoRotationType;
  layer: IsoLayer;
  kingdomArt: boolean;
  category: string;
  damage: number;
  ref: T | null;
}

export interface IsoBuildingInput<T> {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  rotateType: string | null;
  file: string;
  category: string;
  damage: number;
  ref: T;
}

export interface IsoDefenceOwner<T> {
  ref: T;
  damage: number;
}

export interface IsoDefenceInput<T> {
  wallLevel: number;
  gateType: string | null;
  towerType: string | null;
  ownedTowers: number;
  moat: { name: string; type: string } | null;
  wall: IsoDefenceOwner<T> | null;
  gate: IsoDefenceOwner<T> | null;
  moatOwner: IsoDefenceOwner<T> | null;
  towers: IsoDefenceOwner<T>[];
}

export interface CastleIsoScene<T> {
  kingdomId: number;
  grounds: CastleGround[];
  sprites: IsoSprite<T>[];
}

const DEFENCE_FILE = 'castlewall';
const KINGDOM_NAMES: Record<number, string> = { 0: 'Classic', 1: 'Dessert', 2: 'Icecream', 3: 'Volcano' };
const BACK_RAY_LENGTH = 120;

function rotationTypeOf(rotateType: string | null): IsoRotationType {
  switch (rotateType ?? '2') {
    case '2': {
      return 'mirrored';
    }
    case '3': {
      return 'twoFramesMirrored';
    }
    default: {
      return 'none';
    }
  }
}

export function buildingAssetFile(data: Record<string, unknown>, appearanceName?: string | null): string {
  const name = String(data['name'] ?? '');
  const group = String(data['group'] ?? '');
  const variant = appearanceName ?? String(data['type'] ?? '');
  return `${name}${group}${variant}`.toLowerCase().replaceAll(/[^\da-z]/g, '');
}

class SimpleRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = 3_740_067_437 ^ seed;
  }

  public nextInt(bound: number): number {
    return Math.abs(this.next()) % bound;
  }

  private next(): number {
    let value = this.toInt32(this.seed, 16_807) % 2_147_483_647;
    value = (this.toInt32(value, 14_903_917) + 11) % 2_147_483_647;
    this.seed = value;
    return value;
  }

  private toInt32(value: number, factor: number): number {
    const product = value * factor;
    let correction = (((value % 255) * factor) % 255) - (product % 255);
    if (Math.abs(correction) > 3) correction = Math.sign(correction) * (Math.abs(correction) - 255);
    return Math.trunc(product) + correction;
  }
}

export class CastleIsoSceneBuilder<T> {
  private layout: CastleDefenceLayout | null = null;

  public build(
    kingdomId: number,
    areaId: number,
    grounds: CastleGround[],
    buildings: IsoBuildingInput<T>[],
    defences: IsoDefenceInput<T>,
  ): CastleIsoScene<T> {
    const sprites: IsoSprite<T>[] = buildings.map((building) => ({
      key: `building-${building.id}`,
      file: building.file,
      anchor: { x: building.x, y: building.y },
      footprint: { x: building.x, y: building.y, width: building.width, height: building.height },
      rot: building.rotation,
      rotationType: rotationTypeOf(building.rotateType),
      layer: 'main',
      kingdomArt: false,
      category: building.category,
      damage: building.damage,
      ref: building.ref,
    }));
    if (defences.wallLevel > 0) sprites.push(...this.defenceSprites(kingdomId, areaId, grounds, defences));
    return { kingdomId, grounds, sprites };
  }

  private defenceSprites(
    kingdomId: number,
    areaId: number,
    grounds: CastleGround[],
    defences: IsoDefenceInput<T>,
  ): IsoSprite<T>[] {
    this.layout = new CastleDefenceLayout(grounds, defences.ownedTowers);
    const layout = this.layout.generate();
    const wallLevel = defences.wallLevel;
    const sprites: IsoSprite<T>[] = layout.walls.map((wall, index) =>
      this.defenceSprite(
        `wall-${index}`,
        [`Basic_Castlewall_Level${wallLevel}`],
        wall,
        'twoFramesMirrored',
        defences.wall,
      ),
    );
    layout.emptyTowers.forEach((tower, index) => {
      const direction = { 0: 0, 1: 3, 2: 1, 3: 2 }[tower.rot] ?? 0;
      sprites.push(
        this.defenceSprite(`corner-${index}`, [`Basic_Tower_CornerLevel${wallLevel}_${direction}`], tower, 'none'),
      );
    });
    if (defences.towerType) {
      const symbols = [`Basic_Towerbase_Level${wallLevel}`, `Guard_Tower_${defences.towerType}`];
      layout.ownedTowers.forEach((tower, index) => {
        sprites.push(this.defenceSprite(`tower-${index}`, symbols, tower, 'mirrored', defences.towers[index] ?? null));
      });
    }
    if (layout.gate && defences.gateType) {
      sprites.push(
        this.defenceSprite('gate', [`Basic_Gate_${defences.gateType}`], layout.gate, 'mirrored', defences.gate),
      );
    }
    if (defences.moat) {
      sprites.push(...this.moatSprites(layout.moat, defences.moat, kingdomId, areaId, defences.moatOwner));
    }
    return sprites;
  }

  private defenceSprite(
    key: string,
    symbols: string[],
    position: DefencePosition,
    rotationType: IsoRotationType,
    owner: IsoDefenceOwner<T> | null = null,
  ): IsoSprite<T> {
    const origin = position.collisionPos ?? position.pos;
    const footprint = { x: origin.x, y: origin.y, width: position.dimension.x, height: position.dimension.y };
    return {
      key,
      file: DEFENCE_FILE,
      symbols,
      anchor: position.pos,
      footprint,
      rot: position.rot,
      rotationType,
      layer: this.isBehindCastle(footprint) ? 'back' : 'front',
      kingdomArt: true,
      category: 'DEFENCE',
      damage: owner?.damage ?? 0,
      ref: owner?.ref ?? null,
    };
  }

  private isBehindCastle(rect: GridRect): boolean {
    const x = Math.floor(rect.x + rect.width / 2);
    const y = Math.floor(rect.y + rect.height / 2);
    for (let step = 1; step <= BACK_RAY_LENGTH; step++) {
      if (this.layout?.hasGroundAt(x + step, y) || this.layout?.hasGroundAt(x, y + step)) return true;
      if (this.layout?.hasGroundAt(x + step, y + step)) return true;
    }
    return false;
  }

  private moatSprites(
    moat: MoatLayout,
    definition: { name: string; type: string },
    kingdomId: number,
    areaId: number,
    owner: IsoDefenceOwner<T> | null,
  ): IsoSprite<T>[] {
    const kingdom = KINGDOM_NAMES[kingdomId] ?? KINGDOM_NAMES[0];
    const prefix = `${definition.name}_Moat`;
    const file = `${definition.name}moat${kingdom}`.toLowerCase();
    const part = (key: string, symbols: string[], position: DefencePosition, mirrored: boolean): IsoSprite<T> => ({
      key,
      file,
      symbols,
      anchor: position.pos,
      footprint: { x: position.pos.x, y: position.pos.y, width: 1, height: 1 },
      rot: mirrored ? 1 : 0,
      rotationType: mirrored ? 'mirrored' : 'none',
      layer: 'moat',
      kingdomArt: false,
      category: 'DEFENCE',
      damage: 0,
      ref: owner?.ref ?? null,
    });
    const sprites: IsoSprite<T>[] = [];
    moat.walls.forEach((wall, index) => {
      if (wall.rot !== 0 && wall.rot !== 1) return;
      const seed = areaId + wall.pos.x + wall.pos.y;
      const variation = new SimpleRandom(seed).nextInt(2);
      const detail = new SimpleRandom(seed).nextInt(10);
      const symbols = [`${prefix}_Part${variation}_Dir1_${definition.type}_${kingdom}`];
      if (detail <= 2) symbols.push(`${prefix}_${definition.type}_Detail${detail}_Dir1_${kingdom}`);
      sprites.push(part(`moat-wall-${index}`, symbols, wall, wall.rot === 1));
    });
    const outerNumbers: Record<number, number> = { 0: 0, 1: 3, 2: 2 };
    moat.outerCorners.forEach((corner, index) => {
      const number = outerNumbers[corner.rot];
      if (number === undefined) return;
      sprites.push(
        part(`moat-outer-${index}`, [`${prefix}_Corner${number}_${definition.type}_${kingdom}`], corner, false),
      );
    });
    moat.innerCorners.forEach((corner, index) => {
      sprites.push(part(`moat-inner-${index}`, [`${prefix}_Corner1_${definition.type}_${kingdom}`], corner, false));
    });
    if (moat.gate) {
      sprites.push(part('moat-bridge', [`${prefix}_Bridge_${definition.type}_${kingdom}`], moat.gate, false));
    }
    return sprites;
  }
}

export function compareIsoDepth(a: GridRect, b: GridRect): number {
  const aBehindB = a.x + a.width <= b.x || a.y + a.height <= b.y;
  const bBehindA = b.x + b.width <= a.x || b.y + b.height <= a.y;
  if (aBehindB !== bBehindA) return aBehindB ? -1 : 1;
  const aScreenX = a.x + a.width / 2 - a.y - a.height / 2;
  const bScreenX = b.x + b.width / 2 - b.y - b.height / 2;
  if (aBehindB && bBehindA && aScreenX !== bScreenX) return aScreenX - bScreenX;
  const depth = a.x + a.y + a.width + a.height - (b.x + b.y + b.width + b.height);
  return depth === 0 ? aScreenX - bScreenX : depth;
}
