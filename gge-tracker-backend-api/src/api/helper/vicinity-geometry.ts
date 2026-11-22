export const KINGDOM_MAP_WIDTH = 1287;

export const CastleType = {
  MAIN: 1,
  CAPITAL: 3,
  OUTPOST: 4,
  TRADE_METROPOLIS: 22,
} as const;

export const VICINITY_CASTLE_TYPES: number[] = Object.values(CastleType);

export interface MapPoint {
  x: number;
  y: number;
}

export interface VicinityCastle extends MapPoint {
  castle_type: number;
}

export interface NearestOrigin {
  origin: number;
  distance: number;
}

export function mapDistance(a: MapPoint, b: MapPoint): number {
  const dx = Math.abs(a.x - b.x);
  const wrappedDx = Math.min(dx, KINGDOM_MAP_WIDTH - dx);
  return Math.hypot(wrappedDx, a.y - b.y);
}

export function nearestOrigin(point: MapPoint, origins: MapPoint[]): NearestOrigin | null {
  let best: NearestOrigin | null = null;
  for (const [index, origin] of origins.entries()) {
    const distance = mapDistance(point, origin);
    if (!best || distance < best.distance) best = { origin: index, distance };
  }
  return best;
}

export function roundDistance(distance: number): number {
  return Math.round(distance * 10) / 10;
}

export function vicinityCastlesOf(castles: unknown): VicinityCastle[] {
  if (!Array.isArray(castles)) return [];
  return castles
    .filter((castle) => Array.isArray(castle) && VICINITY_CASTLE_TYPES.includes(Number(castle[2])))
    .map((castle) => ({ x: Number(castle[0]), y: Number(castle[1]), castle_type: Number(castle[2]) }))
    .sort((a, b) => originRank(a.castle_type) - originRank(b.castle_type));
}

function originRank(castleType: number): number {
  return castleType === CastleType.MAIN ? 0 : 1;
}
