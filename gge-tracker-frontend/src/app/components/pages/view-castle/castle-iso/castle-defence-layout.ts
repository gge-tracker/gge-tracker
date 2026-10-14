export interface GridPoint {
  x: number;
  y: number;
}

export interface CastleGround {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DefencePosition {
  pos: GridPoint;
  rot: number;
  dimension: GridPoint;
  collisionPos?: GridPoint;
}

export interface MoatLayout {
  walls: DefencePosition[];
  outerCorners: DefencePosition[];
  innerCorners: DefencePosition[];
  gate: DefencePosition | null;
}

export interface DefenceLayout {
  gate: DefencePosition | null;
  ownedTowers: DefencePosition[];
  emptyTowers: DefencePosition[];
  walls: DefencePosition[];
  moat: MoatLayout;
}

interface GroundBounds {
  x: number;
  y: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
}

// Client sorts corner candidates by their distance to this grid point
const VIEW_LOOK_POINT: GridPoint = { x: 300, y: 300 };
const TOWER_DIMENSION: GridPoint = { x: 2, y: 2 };
const GATE_DIMENSION: GridPoint = { x: 3, y: 4 };

function collides(a: DefencePosition, b: DefencePosition): boolean {
  const pa = a.collisionPos ?? a.pos;
  const pb = b.collisionPos ?? b.pos;
  return (
    pa.x < pb.x + b.dimension.x &&
    pa.x + a.dimension.x > pb.x &&
    pa.y < pb.y + b.dimension.y &&
    pa.y + a.dimension.y > pb.y
  );
}

function distanceToLookPoint(point: GridPoint): number {
  return (point.x - VIEW_LOOK_POINT.x) ** 2 + (point.y - VIEW_LOOK_POINT.y) ** 2;
}

export class CastleDefenceLayout {
  private readonly cells = new Set<string>();
  private readonly grounds: GroundBounds[];

  constructor(
    grounds: CastleGround[],
    private readonly ownedTowerCount: number,
  ) {
    this.grounds = grounds
      .map((ground) => ({
        x: ground.x,
        y: ground.y,
        x2: ground.x + ground.width - 1,
        y2: ground.y + ground.height - 1,
        width: ground.width,
        height: ground.height,
      }))
      .sort((a, b) => a.x2 - b.x2 || a.y2 - b.y2);
    for (const ground of this.grounds) {
      for (let x = ground.x; x <= ground.x2; x++) {
        for (let y = ground.y; y <= ground.y2; y++) this.cells.add(`${x},${y}`);
      }
    }
  }

  public generate(): DefenceLayout {
    if (this.grounds.length === 0) {
      return {
        gate: null,
        ownedTowers: [],
        emptyTowers: [],
        walls: [],
        moat: { walls: [], outerCorners: [], innerCorners: [], gate: null },
      };
    }
    const { candidates, groundCorners } = this.cornerCandidates();
    const outerCorners = this.collect(candidates, (point) => this.outerCorner(point));
    const innerCorners = this.collect(candidates, (point) => this.innerCorner(point));
    const sides = this.collect(candidates, (point) => this.side(point));
    const groundCornerSides = this.collect(groundCorners, (point) => this.side(point));
    const gate = this.gatePosition();
    const towers = this.placeTowers(gate, outerCorners, innerCorners, groundCornerSides, sides);
    const walls = this.placeWalls([gate, ...towers.ownedTowers, ...towers.emptyTowers]);
    const moat = this.placeMoat(gate, outerCorners, innerCorners);
    return { gate, ...towers, walls, moat };
  }

  public hasGroundAt(x: number, y: number): boolean {
    return this.has(x, y);
  }

  private has(x: number, y: number): boolean {
    return this.cells.has(`${x},${y}`);
  }

  private cornerCandidates(): { candidates: GridPoint[]; groundCorners: GridPoint[] } {
    const candidates: GridPoint[] = [];
    const groundCorners: GridPoint[] = [];
    for (const ground of this.grounds) {
      const { x, y, x2, y2, width, height } = ground;
      if (width === 20 && height === 20) {
        candidates.push(
          { x, y: y + 9 },
          { x: x2, y: y + 9 },
          { x: x + 9, y },
          { x: x + 9, y: y2 },
          { x, y: y + 10 },
          { x: x2, y: y + 10 },
          { x: x + 10, y },
          { x: x + 10, y: y2 },
        );
      }
      const corners = [
        { x, y },
        { x, y: y2 },
        { x: x2, y },
        { x: x2, y: y2 },
      ];
      candidates.push(...corners);
      groundCorners.push(...corners);
    }
    for (const ground of this.grounds) {
      if (ground.width === 20 && ground.height === 20) continue;
      if (ground.width > ground.height) {
        candidates.push({ x: ground.x + 10, y: ground.y }, { x: ground.x + 10, y: ground.y2 });
      } else {
        candidates.push({ x: ground.x, y: ground.y + 10 }, { x: ground.x2, y: ground.y + 10 });
      }
    }
    const byView = (a: GridPoint, b: GridPoint): number => distanceToLookPoint(a) - distanceToLookPoint(b);
    return { candidates: candidates.sort(byView), groundCorners: groundCorners.sort(byView) };
  }

  private collect(points: GridPoint[], probe: (point: GridPoint) => DefencePosition | null): DefencePosition[] {
    return points.map(probe).filter((position): position is DefencePosition => position !== null);
  }

  private outerCorner(point: GridPoint): DefencePosition | null {
    const { x, y } = point;
    if (!this.has(x, y)) return null;
    let rot = -1;
    if (!(this.has(x, y + 1) || this.has(x - 1, y + 1) || this.has(x - 1, y))) rot = 1;
    else if (!(this.has(x, y - 1) || this.has(x - 1, y - 1) || this.has(x - 1, y))) rot = 3;
    else if (!(this.has(x, y - 1) || this.has(x + 1, y - 1) || this.has(x + 1, y))) rot = 2;
    else if (!(this.has(x, y + 1) || this.has(x + 1, y + 1) || this.has(x + 1, y))) rot = 0;
    return rot >= 0 ? { pos: point, rot, dimension: { x: 0, y: 0 } } : null;
  }

  private innerCorner(point: GridPoint): DefencePosition | null {
    const { x, y } = point;
    if (!this.has(x, y)) return null;
    const at = (pos: GridPoint, rot: number): DefencePosition => ({ pos, rot, dimension: { x: 0, y: 0 } });
    if (this.has(x, y - 1) && this.has(x + 1, y) && !this.has(x + 1, y - 1)) return at(point, 2);
    if (this.has(x, y + 1) && this.has(x + 1, y) && !this.has(x + 1, y + 1)) return at(point, 0);
    if (this.has(x - 1, y) && this.has(x - 1, y + 1) && !this.has(x, y + 1)) return at({ x: x - 1, y }, 0);
    if (this.has(x, y + 1) && this.has(x - 1, y) && !this.has(x - 1, y + 1)) return at(point, 1);
    if (this.has(x, y - 1) && this.has(x - 1, y) && !this.has(x - 1, y - 1)) return at(point, 3);
    return null;
  }

  private side(point: GridPoint): DefencePosition | null {
    const { x, y } = point;
    let rot = -1;
    const row = (dy: number): [number, number][] => [
      [x - 1, y + dy],
      [x, y + dy],
      [x + 1, y + dy],
    ];
    const column = (dx: number): [number, number][] => [
      [x + dx, y - 1],
      [x + dx, y],
      [x + dx, y + 1],
    ];
    if (this.hasAll([...row(0), ...row(-1)]) && this.hasNone(row(1))) rot = 1;
    if (this.hasAll([...column(0), ...column(-1)]) && this.hasNone(column(1))) rot = 0;
    if (this.hasAll([...row(0), ...row(1)]) && this.hasNone(row(-1))) rot = 3;
    if (this.hasAll([...column(0), ...column(1)]) && this.hasNone(column(-1))) rot = 2;
    return rot >= 0 ? { pos: point, rot, dimension: { x: 0, y: 0 } } : null;
  }

  private hasAll(cells: [number, number][]): boolean {
    return cells.every(([x, y]) => this.has(x, y));
  }

  private hasNone(cells: [number, number][]): boolean {
    return cells.every(([x, y]) => !this.has(x, y));
  }

  private gatePosition(): DefencePosition {
    let ground = this.grounds[0];
    for (const candidate of this.grounds) {
      if (ground.x2 + ground.y2 < candidate.x2 + candidate.y2 || candidate.x2 > ground.x2) ground = candidate;
    }
    const pos =
      ground.width > ground.height
        ? { x: ground.x2 + 1, y: ground.y }
        : { x: ground.x2 + 1, y: ground.y + ground.height / 2 };
    return { pos, rot: 0, dimension: GATE_DIMENSION };
  }

  private placeTowers(
    gate: DefencePosition,
    outerCorners: DefencePosition[],
    innerCorners: DefencePosition[],
    groundCornerSides: DefencePosition[],
    sides: DefencePosition[],
  ): { ownedTowers: DefencePosition[]; emptyTowers: DefencePosition[] } {
    const placed: DefencePosition[] = [gate];
    const ownedTowers: DefencePosition[] = [];
    const emptyTowers: DefencePosition[] = [];
    let added = 0;
    const tryAdd = (target: DefencePosition[], tower: DefencePosition): void => {
      if (placed.some((other) => collides(other, tower))) return;
      placed.push(tower);
      target.push(tower);
      added++;
    };
    for (const corner of [...outerCorners, ...innerCorners]) {
      tryAdd(added < this.ownedTowerCount ? ownedTowers : emptyTowers, this.cornerTower(corner));
    }
    for (const side of [...groundCornerSides, ...sides]) {
      if (added >= this.ownedTowerCount) break;
      tryAdd(ownedTowers, this.sideTower(side));
    }
    return { ownedTowers, emptyTowers };
  }

  private cornerTower(corner: DefencePosition): DefencePosition {
    const { x, y } = corner.pos;
    const offsets: Record<number, GridPoint> = {
      0: { x: x + 1, y: y + 1 },
      1: { x: x - 2, y: y + 1 },
      2: { x: x + 1, y: y - 2 },
      3: { x: x - 2, y: y - 2 },
    };
    return { pos: offsets[corner.rot], rot: corner.rot, dimension: TOWER_DIMENSION };
  }

  private sideTower(side: DefencePosition): DefencePosition {
    const { x, y } = side.pos;
    const offsets: Record<number, GridPoint> = {
      0: { x: x + 1, y },
      1: { x, y: y + 1 },
      2: { x: x - 2, y },
      3: { x, y: y - 2 },
    };
    return { pos: offsets[side.rot], rot: side.rot, dimension: TOWER_DIMENSION };
  }

  private placeWalls(occupied: DefencePosition[]): DefencePosition[] {
    const placed = [...occupied];
    const walls: DefencePosition[] = [];
    const tryAdd = (wall: DefencePosition): void => {
      if (placed.some((other) => collides(other, wall))) return;
      placed.push(wall);
      walls.push(wall);
    };
    for (const ground of this.grounds) {
      for (let x = ground.x; x <= ground.x2; x++) {
        for (const wall of [...this.wallsAt(x, ground.y), ...this.wallsAt(x, ground.y2)]) tryAdd(wall);
      }
      for (let y = ground.y; y <= ground.y2; y++) {
        for (const wall of [...this.wallsAt(ground.x, y), ...this.wallsAt(ground.x2, y)]) tryAdd(wall);
      }
    }
    return walls;
  }

  // Port of IsoGeneratorDefenceMoat: a corner cell yields several parts, which skip the collision check.
  private placeMoat(
    gate: DefencePosition,
    outerCorners: DefencePosition[],
    innerCorners: DefencePosition[],
  ): MoatLayout {
    const placed: DefencePosition[] = [];
    const add = (
      target: DefencePosition[],
      part: DefencePosition | null,
      checkCollision: boolean,
      register: boolean,
    ): void => {
      if (!part || (checkCollision && placed.some((other) => collides(other, part)))) return;
      if (register) placed.push(part);
      target.push(part);
    };
    const moat: MoatLayout = { walls: [], outerCorners: [], innerCorners: [], gate: null };
    for (const corner of outerCorners) add(moat.outerCorners, this.moatOuterCorner(corner), false, true);
    for (const corner of innerCorners) add(moat.innerCorners, this.moatInnerCorner(corner), false, true);
    moat.gate = { pos: { ...gate.pos }, rot: gate.rot, dimension: { x: 5, y: 4 } };
    placed.push(moat.gate);
    const addCell = (x: number, y: number): void => {
      const parts = this.moatWallsAt(x, y);
      for (const part of parts) add(moat.walls, part, parts.length < 2, parts.length < 2);
    };
    for (const ground of this.grounds) {
      for (let x = ground.x; x <= ground.x2; x++) {
        addCell(x, ground.y);
        addCell(x, ground.y2);
      }
      for (let y = ground.y; y <= ground.y2; y++) {
        addCell(ground.x, y);
        addCell(ground.x2, y);
      }
    }
    return moat;
  }

  private moatOuterCorner(corner: DefencePosition): DefencePosition | null {
    const { x, y } = corner.pos;
    switch (corner.rot) {
      case 0: {
        return { pos: { x: x + 1, y: y + 1 }, rot: 0, dimension: { x: 6, y: 6 } };
      }
      case 1: {
        return { pos: { x: x - 2, y: y + 1 }, rot: 1, dimension: { x: 5, y: 5 }, collisionPos: { x: x - 5, y: y + 2 } };
      }
      case 2: {
        return { pos: { x: x + 1, y: y - 2 }, rot: 2, dimension: { x: 5, y: 6 }, collisionPos: { x: x + 3, y: y - 5 } };
      }
      case 3: {
        return { pos: { x: x - 2, y: y - 2 }, rot: 3, dimension: { x: 5, y: 5 }, collisionPos: { x: x - 5, y: y - 5 } };
      }
    }
    return null;
  }

  private moatInnerCorner(corner: DefencePosition): DefencePosition | null {
    if (corner.rot !== 0) return null;
    const { x, y } = corner.pos;
    return { pos: { x: x + 1, y: y + 1 }, rot: 0, dimension: { x: 6, y: 6 }, collisionPos: { x, y } };
  }

  private moatWallsAt(x: number, y: number): DefencePosition[] {
    if (!this.has(x, y)) return [];
    const parts: DefencePosition[] = [];
    if (!this.has(x - 1, y)) {
      parts.push({ pos: { x, y }, rot: 3, dimension: { x: 3, y: 1 }, collisionPos: { x: x - 3, y } });
    }
    if (!this.has(x + 1, y) && !this.has(x + 1, y + 2)) {
      parts.push({ pos: { x, y }, rot: 0, dimension: { x: 3, y: 1 } });
    }
    if (!this.has(x, y + 1) && !this.has(x + 2, y + 1)) {
      parts.push({ pos: { x, y }, rot: 1, dimension: { x: 1, y: 3 } });
    }
    if (!this.has(x, y - 1)) {
      parts.push({ pos: { x, y }, rot: 2, dimension: { x: 1, y: 3 }, collisionPos: { x, y: y - 3 } });
    }
    return parts;
  }

  private wallsAt(x: number, y: number): DefencePosition[] {
    if (!this.has(x, y)) return [];
    const walls: DefencePosition[] = [];
    if (!this.has(x - 1, y) && !this.has(x - 2, y)) {
      walls.push({ pos: { x: x - 1, y }, rot: 3, dimension: { x: 2, y: 1 }, collisionPos: { x: x - 3, y } });
    }
    if (!this.has(x, y + 1) && !this.has(x, y + 2)) {
      walls.push({ pos: { x, y: y + 1 }, rot: 1, dimension: { x: 1, y: 2 } });
    }
    if (!this.has(x, y - 1) && !this.has(x, y - 2)) {
      walls.push({ pos: { x, y: y - 1 }, rot: 2, dimension: { x: 1, y: 3 }, collisionPos: { x, y: y - 2 } });
    }
    if (!this.has(x + 1, y) && !this.has(x + 2, y)) {
      walls.push({ pos: { x: x + 1, y }, rot: 0, dimension: { x: 3, y: 1 } });
    }
    return walls;
  }
}
