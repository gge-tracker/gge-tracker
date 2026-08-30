import { Pt } from '@ggetracker-interfaces/view-castle';

interface FloorBounds {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export class ViewCastleUtilities {
  public static drawFloorPerimeter(
    context: CanvasRenderingContext2D,
    castleObject: any,
    offsetX: number,
    offsetY: number,
    minX: number,
    minY: number,
    cellSize: number,
  ): void {
    const floors = castleObject?.data.grounds || [];
    if (floors.length === 0) return;

    const bounds = this.floorBounds(floors);
    const gridW = Math.max(1, bounds.xMax - bounds.xMin);
    const gridH = Math.max(1, bounds.yMax - bounds.yMin);
    const grid = this.rasterizeFloors(floors, bounds, gridW, gridH);
    const polygons = this.tracePolygons(this.boundaryEdges(grid, gridW, gridH));
    if (polygons.length === 0) return;

    const pointsPx = this.largestPolygon(polygons).map((pt) => ({
      x: offsetX + (bounds.xMin + pt.x - minX) * cellSize,
      y: offsetY + (bounds.yMin + pt.y - minY) * cellSize,
    }));
    if (pointsPx.length < 2) return;

    this.strokePerimeter(context, pointsPx);
  }

  public static readonly edgeKey = (sx: number, sy: number, ex: number, ey: number): string =>
    `${sx},${sy}->${ex},${ey}`;

  public static getItemColor(name: string): [string, string] {
    if (name === 'Castle') {
      return ['rgb(0,0,0)', 'rgb(0,0,0)'];
    }
    if (name === 'Deco') {
      return ['rgba(155, 135, 160)', 'rgb(109,68,119)'];
    }

    let hash = 0;
    for (let index = 0; index < name.length; index++) {
      hash = (name.codePointAt(index) || 0) + ((hash << 5) - hash);
    }

    let r1 = (hash >> 16) & 255;
    let g1 = (hash >> 8) & 255;
    let b1 = hash & 255;

    let r2 = Math.max(0, r1 - 30);
    let g2 = Math.max(0, g1 - 30);
    let b2 = Math.max(0, b1 - 30);

    if (r1 < 100 && g1 < 100 && b1 < 100) {
      r1 += 30;
      g1 += 30;
      b1 += 30;
      r2 += 30;
      g2 += 30;
      b2 += 30;
    }

    return [`rgb(${r1},${g1},${b1})`, `rgb(${r2},${g2},${b2})`];
  }

  public static parseToRgb(color: string): [number, number, number] {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const h = (length: number, index: number): number =>
        Number.parseInt(
          length === 3 || length === 4 ? hex[index] + hex[index] : hex.slice(index * 2, index * 2 + 2),
          16,
        );
      const length = hex.length;
      if (length === 3 || length === 4 || length === 6 || length === 8)
        return [h(length, 0), h(length, 1), h(length, 2)];
    }
    const m = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return [128, 128, 128];
  }
  public static readonly rgbString = (r: number, g: number, b: number): string => `rgb(${r},${g},${b})`;

  public static roundedTo2Decimals(value: number): number {
    return Math.round(value * 100) / 100;
  }

  public static upperAllKeys(object: { [key: string]: string | string[] }): { [key: string]: string | string[] } {
    if (typeof object !== 'object' || object === null) return object;
    const uppercasedObject: { [key: string]: string | string[] } = {};
    for (const key of Object.keys(object)) {
      const upperKey = key.toUpperCase();
      uppercasedObject[upperKey] = object[key];
    }
    return uppercasedObject;
  }

  /**
   * Snippet: Adjust color brightness by a factor
   *
   * @param param0 RGB color as an array
   * @param f Brightness factor
   * @returns Adjusted RGB color as an array
   */
  public static adjust([r, g, b]: [number, number, number], f: number): [number, number, number] {
    return [
      Math.min(255, Math.max(0, Math.round(r * f))),
      Math.min(255, Math.max(0, Math.round(g * f))),
      Math.min(255, Math.max(0, Math.round(b * f))),
    ];
  }
  /**
   * Snippet: Snap rectangle coordinates to integer values
   *
   * @param x X coordinate
   * @param y Y coordinate
   * @param w Width
   * @param h Height
   * @returns Snapped rectangle coordinates and dimensions
   */
  public static snapRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
    const sx = Math.round(x);
    const sy = Math.round(y);
    const sw = Math.max(1, Math.round(x + w) - sx);
    const sh = Math.max(1, Math.round(y + h) - sy);
    return { x: sx, y: sy, w: sw, h: sh };
  }
  /**
   * Snippet: Draw a cell with a modern gradient and border effect
   *
   * @param context_ Canvas rendering context
   * @param x X coordinate
   * @param y Y coordinate
   * @param w Width of the cell
   * @param h Height of the cell
   * @param baseColor Base color of the cell
   *
   * @returns void
   */
  public static drawCellModern(
    context_: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    baseColor: string,
  ): void {
    const { x: px, y: py, w: pw, h: ph } = ViewCastleUtilities.snapRect(x, y, w, h);
    const base = ViewCastleUtilities.parseToRgb(baseColor);
    const grad = context_.createLinearGradient(px, py, px, py + ph);
    const top = ViewCastleUtilities.adjust(base, 1.15);
    const bottom = ViewCastleUtilities.adjust(base, 0.85);
    grad.addColorStop(0, ViewCastleUtilities.rgbString(...top));
    grad.addColorStop(1, ViewCastleUtilities.rgbString(...bottom));
    context_.fillStyle = grad;
    context_.fillRect(px, py, pw, ph);
    if (pw >= 2 && ph >= 2) {
      context_.fillStyle = ViewCastleUtilities.rgbString(...ViewCastleUtilities.adjust(base, 1.25));
      context_.fillRect(px, py, pw, 1); // top
      context_.fillRect(px, py, 1, ph); // left
      context_.fillStyle = ViewCastleUtilities.rgbString(...ViewCastleUtilities.adjust(base, 0.7));
      context_.fillRect(px, py + ph - 1, pw, 1); // bottom
      context_.fillRect(px + pw - 1, py, 1, ph); // right
    }
  }

  private static floorSize(floor: any): { w: number; h: number } {
    const w = Number.parseInt(String(floor.data?.['width'] ?? '1'), 10);
    const h = Number.parseInt(String(floor.data?.['height'] ?? '1'), 10);
    return floor.building.rotation === 1 ? { w: h, h: w } : { w, h };
  }

  private static floorBounds(floors: any[]): FloorBounds {
    let xMin = Infinity,
      yMin = Infinity,
      xMax = -Infinity,
      yMax = -Infinity;
    for (const floor of floors) {
      const { w, h } = this.floorSize(floor);
      const x = floor.building.positionX;
      const y = floor.building.positionY;
      xMin = Math.min(xMin, x);
      yMin = Math.min(yMin, y);
      xMax = Math.max(xMax, x + w);
      yMax = Math.max(yMax, y + h);
    }
    return { xMin, yMin, xMax, yMax };
  }

  private static rasterizeFloors(floors: any[], bounds: FloorBounds, gridW: number, gridH: number): Uint8Array[] {
    const grid: Uint8Array[] = Array.from({ length: gridH }, () => new Uint8Array(gridW));
    for (const floor of floors) {
      const { w, h } = this.floorSize(floor);
      const sx = floor.building.positionX - bounds.xMin;
      const sy = floor.building.positionY - bounds.yMin;
      const yEnd = Math.min(gridH, sy + h);
      const xEnd = Math.min(gridW, sx + w);
      for (let gy = Math.max(0, sy); gy < yEnd; gy++) {
        for (let gx = Math.max(0, sx); gx < xEnd; gx++) grid[gy][gx] = 1;
      }
    }
    return grid;
  }

  private static boundaryEdges(grid: Uint8Array[], gridW: number, gridH: number): Map<string, Pt[]> {
    const edges = new Map<string, Pt[]>();
    const isFilled = (gx: number, gy: number): boolean =>
      gx >= 0 && gy >= 0 && gx < gridW && gy < gridH && grid[gy][gx] === 1;

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (isFilled(gx, gy)) this.pushCellEdges(edges, isFilled, gx, gy);
      }
    }
    return edges;
  }

  private static pushCellEdges(
    edges: Map<string, Pt[]>,
    isFilled: (gx: number, gy: number) => boolean,
    gx: number,
    gy: number,
  ): void {
    const pushEdge = (sx: number, sy: number, ex: number, ey: number): void => {
      const key = `${sx},${sy}`;
      const list = edges.get(key) ?? [];
      list.push({ x: ex, y: ey });
      edges.set(key, list);
    };

    if (!isFilled(gx, gy - 1)) pushEdge(gx, gy, gx + 1, gy);
    if (!isFilled(gx + 1, gy)) pushEdge(gx + 1, gy, gx + 1, gy + 1);
    if (!isFilled(gx, gy + 1)) pushEdge(gx + 1, gy + 1, gx, gy + 1);
    if (!isFilled(gx - 1, gy)) pushEdge(gx, gy + 1, gx, gy);
  }

  private static tracePolygons(edges: Map<string, Pt[]>): Pt[][] {
    const used = new Set<string>();
    const polygons: Pt[][] = [];
    for (const [startKey, ends] of edges) {
      const [sx, sy] = startKey.split(',').map(Number);
      for (const end of ends) {
        const polygon = this.traceRing(edges, used, sx, sy, end);
        if (polygon.length >= 3) polygons.push(polygon);
      }
    }
    return polygons;
  }

  private static traceRing(edges: Map<string, Pt[]>, used: Set<string>, sx: number, sy: number, first: Pt): Pt[] {
    const firstKey = this.edgeKey(sx, sy, first.x, first.y);
    if (used.has(firstKey)) return [];
    used.add(firstKey);

    const polygon: Pt[] = [{ x: sx, y: sy }];
    let current = first;
    while (true) {
      polygon.push({ x: current.x, y: current.y });
      const next = this.nextUnusedEdge(edges, used, current);
      if (!next) break;
      if (next.x === sx && next.y === sy) break;
      current = next;
    }
    return polygon;
  }

  private static nextUnusedEdge(edges: Map<string, Pt[]>, used: Set<string>, from: Pt): Pt | null {
    for (const candidate of edges.get(`${from.x},${from.y}`) ?? []) {
      const key = this.edgeKey(from.x, from.y, candidate.x, candidate.y);
      if (!used.has(key)) {
        used.add(key);
        return candidate;
      }
    }
    return null;
  }

  private static largestPolygon(polygons: Pt[][]): Pt[] {
    let largest = polygons[0];
    let maxArea = this.polygonArea(largest);
    for (const polygon of polygons) {
      const area = this.polygonArea(polygon);
      if (area > maxArea) {
        maxArea = area;
        largest = polygon;
      }
    }
    return largest;
  }

  private static polygonArea(polygon: Pt[]): number {
    let area = 0;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  }

  private static strokePerimeter(context: CanvasRenderingContext2D, pointsPx: Pt[]): void {
    const borderSize = 15;
    context.save();
    context.lineJoin = 'miter';
    context.lineCap = 'butt';
    this.strokeOutline(context, pointsPx, borderSize * 3, 'rgba(34,169,187,0.42)');
    this.strokeOutline(context, pointsPx, borderSize, 'rgba(0,0,0,0.5)');
    context.restore();
  }

  private static strokeOutline(
    context: CanvasRenderingContext2D,
    pointsPx: Pt[],
    lineWidth: number,
    strokeStyle: string,
  ): void {
    context.beginPath();
    context.moveTo(pointsPx[0].x, pointsPx[0].y);
    for (let index = 1; index < pointsPx.length; index++) context.lineTo(pointsPx[index].x, pointsPx[index].y);
    context.closePath();
    context.lineWidth = lineWidth;
    context.strokeStyle = strokeStyle;
    context.translate(-lineWidth / 2, -lineWidth / 2);
    context.stroke();
    context.translate(lineWidth / 2, lineWidth / 2);
  }
}
