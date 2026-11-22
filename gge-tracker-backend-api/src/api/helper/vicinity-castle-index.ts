import * as pg from 'pg';
import {
  KINGDOM_MAP_WIDTH,
  MapPoint,
  VicinityCastle,
  nearestOrigin,
  roundDistance,
  vicinityCastlesOf,
} from './vicinity-geometry';

export interface IndexedCastle extends VicinityCastle {
  distance: number;
  origin: number;
}

interface IndexEntry {
  version: string;
  index: Promise<CastleIndex>;
  usedAt: number;
}

const CELL_SIZE = 50;
const CELLS_PER_ROW = Math.ceil(KINGDOM_MAP_WIDTH / CELL_SIZE);
const IDLE_EVICTION_MS = 2 * 3_600_000;

export class CastleIndex {
  private static readonly entries = new Map<string, IndexEntry>();

  private readonly cells = new Map<number, number[]>();

  private constructor(
    private readonly playerIds: Int32Array,
    private readonly xs: Int16Array,
    private readonly ys: Int16Array,
    private readonly types: Int16Array,
  ) {
    for (let index = 0; index < playerIds.length; index++) {
      const cell = CastleIndex.cellOf(xs[index], ys[index]);
      const members = this.cells.get(cell);
      if (members) members.push(index);
      else this.cells.set(cell, [index]);
    }
  }

  public static async of(server: string, version: string, pool: pg.Pool): Promise<CastleIndex> {
    const now = Date.now();
    this.evictIdle(now);
    const entry = this.entries.get(server);
    if (entry?.version === version) {
      entry.usedAt = now;
      return entry.index;
    }
    const index = this.load(pool);
    this.entries.set(server, { version, index, usedAt: now });
    index.catch(() => {
      if (this.entries.get(server)?.index === index) this.entries.delete(server);
    });
    return index;
  }

  private static async load(pool: pg.Pool): Promise<CastleIndex> {
    const results = await pool.query(
      `SELECT id, castles FROM players WHERE castles IS NOT NULL AND castles <> '[]'::jsonb`,
    );
    const castles: { playerId: number; castle: VicinityCastle }[] = [];
    for (const row of results.rows) {
      for (const castle of vicinityCastlesOf(row.castles)) castles.push({ playerId: Number(row.id), castle });
    }
    const playerIds = new Int32Array(castles.length);
    const xs = new Int16Array(castles.length);
    const ys = new Int16Array(castles.length);
    const types = new Int16Array(castles.length);
    castles.forEach(({ playerId, castle }, index) => {
      playerIds[index] = playerId;
      xs[index] = castle.x;
      ys[index] = castle.y;
      types[index] = castle.castle_type;
    });
    return new CastleIndex(playerIds, xs, ys, types);
  }

  private static evictIdle(now: number): void {
    for (const [server, entry] of this.entries) {
      if (now - entry.usedAt > IDLE_EVICTION_MS) this.entries.delete(server);
    }
  }

  private static cellOf(x: number, y: number): number {
    const wrappedX = ((x % KINGDOM_MAP_WIDTH) + KINGDOM_MAP_WIDTH) % KINGDOM_MAP_WIDTH;
    return Math.floor(y / CELL_SIZE) * CELLS_PER_ROW + Math.floor(wrappedX / CELL_SIZE);
  }

  // Half a cell apart, so the narrower last column of the wrapping map is never stepped over
  private static steps(from: number, to: number): number[] {
    const values: number[] = [];
    for (let value = from; value < to; value += CELL_SIZE / 2) values.push(value);
    values.push(to);
    return values;
  }

  public get size(): number {
    return this.playerIds.length;
  }

  public near(origins: MapPoint[], radius: number, excludedPlayerId: number): Map<number, IndexedCastle[]> {
    const found = new Map<number, IndexedCastle[]>();
    for (const index of this.candidates(origins, radius)) {
      const playerId = this.playerIds[index];
      if (playerId === excludedPlayerId) continue;
      const castle = { x: this.xs[index], y: this.ys[index], castle_type: this.types[index] };
      const nearest = nearestOrigin(castle, origins);
      if (!nearest || nearest.distance > radius) continue;
      const castles = found.get(playerId) ?? [];
      castles.push({ ...castle, distance: roundDistance(nearest.distance), origin: nearest.origin });
      found.set(playerId, castles);
    }
    for (const castles of found.values()) castles.sort((a, b) => a.distance - b.distance);
    return found;
  }

  private candidates(origins: MapPoint[], radius: number): Set<number> {
    const cells = new Set<number>();
    for (const origin of origins) {
      for (const y of CastleIndex.steps(Math.max(0, origin.y - radius), origin.y + radius)) {
        for (const x of CastleIndex.steps(origin.x - radius, origin.x + radius)) cells.add(CastleIndex.cellOf(x, y));
      }
    }
    const indexes = new Set<number>();
    for (const cell of cells) for (const index of this.cells.get(cell) ?? []) indexes.add(index);
    return indexes;
  }
}
