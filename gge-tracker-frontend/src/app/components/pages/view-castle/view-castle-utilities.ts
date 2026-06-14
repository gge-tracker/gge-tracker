import { Pt } from '@ggetracker-interfaces/view-castle';

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
    if (!floors || floors.length === 0) return;
    let fxMin = Infinity,
      fyMin = Infinity,
      fxMax = -Infinity,
      fyMax = -Infinity;
    for (const f of floors) {
      const widthElement = f.data?.['width'] ?? '1';
      const heightElement = f.data?.['height'] ?? '1';
      let w = Number.parseInt(String(widthElement), 10);
      let h = Number.parseInt(String(heightElement), 10);
      if (f.building.rotation === 1) [w, h] = [h, w];
      const x1 = f.building.positionX;
      const y1 = f.building.positionY;
      const x2 = x1 + w;
      const y2 = y1 + h;
      fxMin = Math.min(fxMin, x1);
      fyMin = Math.min(fyMin, y1);
      fxMax = Math.max(fxMax, x2);
      fyMax = Math.max(fyMax, y2);
    }
    const gridW = Math.max(1, fxMax - fxMin);
    const gridH = Math.max(1, fyMax - fyMin);
    const grid: Uint8Array[] = Array.from({ length: gridH });
    for (let y = 0; y < gridH; y++) {
      grid[y] = new Uint8Array(gridW);
    }
    for (const f of floors) {
      const widthElement = f.data?.['width'] ?? '1';
      const heightElement = f.data?.['height'] ?? '1';
      let w = Number.parseInt(String(widthElement), 10);
      let h = Number.parseInt(String(heightElement), 10);
      if (f.building.rotation === 1) [w, h] = [h, w];
      const sx = f.building.positionX - fxMin;
      const sy = f.building.positionY - fyMin;
      for (let yy = 0; yy < h; yy++) {
        const gy = sy + yy;
        if (gy < 0 || gy >= gridH) continue;
        for (let xx = 0; xx < w; xx++) {
          const gx = sx + xx;
          if (gx < 0 || gx >= gridW) continue;
          grid[gy][gx] = 1;
        }
      }
    }
    const edges = new Map<string, Pt[]>();
    const pushEdge = (sx: number, sy: number, ex: number, ey: number): void => {
      const key = `${sx},${sy}`;
      const list = edges.get(key) ?? [];
      list.push({ x: ex, y: ey });
      edges.set(key, list);
    };
    const isFilled = (gx: number, gy: number): boolean => {
      if (gx < 0 || gy < 0 || gy >= gridH || gx >= gridW) return false;
      return grid[gy][gx] === 1;
    };
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (!isFilled(gx, gy)) continue;
        if (!isFilled(gx, gy - 1)) pushEdge(gx, gy, gx + 1, gy);
        if (!isFilled(gx + 1, gy)) pushEdge(gx + 1, gy, gx + 1, gy + 1);
        if (!isFilled(gx, gy + 1)) pushEdge(gx + 1, gy + 1, gx, gy + 1);
        if (!isFilled(gx - 1, gy)) pushEdge(gx, gy + 1, gx, gy);
      }
    }
    const edgeUsed = new Set<string>();
    const polygons: Pt[][] = [];
    for (const [startKey, ends] of edges) {
      const startPts = startKey.split(',').map(Number);
      const sx = startPts[0],
        sy = startPts[1];
      for (const end of ends) {
        const ex = end.x,
          ey = end.y;
        const k = this.edgeKey(sx, sy, ex, ey);
        if (edgeUsed.has(k)) continue;
        const poly: Pt[] = [];
        let currentX = sx,
          currentY = sy;
        let nextX = ex,
          nextY = ey;
        poly.push({ x: currentX, y: currentY });
        edgeUsed.add(k);
        while (true) {
          currentX = nextX;
          currentY = nextY;
          poly.push({ x: currentX, y: currentY });
          const currentKey = `${currentX},${currentY}`;
          const list = edges.get(currentKey) ?? [];
          let found = false;
          for (const candidate of list) {
            const k2 = this.edgeKey(currentX, currentY, candidate.x, candidate.y);
            if (!edgeUsed.has(k2)) {
              edgeUsed.add(k2);
              nextX = candidate.x;
              nextY = candidate.y;
              found = true;
              break;
            }
          }
          if (!found) break;
          if (nextX === sx && nextY === sy) break;
        }
        if (poly.length >= 3) polygons.push(poly);
      }
    }
    if (polygons.length === 0) return;
    const polygonArea = (poly: Pt[]): number => {
      let area = 0;
      for (let index = 0; index < poly.length; index++) {
        const a = poly[index];
        const b = poly[(index + 1) % poly.length];
        area += a.x * b.y - b.x * a.y;
      }
      return Math.abs(area) / 2;
    };
    let largest = polygons[0];
    let maxArea = polygonArea(largest);
    for (const p of polygons) {
      const a = polygonArea(p);
      if (a > maxArea) {
        maxArea = a;
        largest = p;
      }
    }
    const pointsPx = largest.map((pt) => {
      const worldX = fxMin + pt.x;
      const worldY = fyMin + pt.y;
      const px = offsetX + (worldX - minX) * cellSize;
      const py = offsetY + (worldY - minY) * cellSize;
      return { x: px, y: py };
    });
    if (pointsPx.length < 2) return;
    const borderSize = 15;
    context.save();
    context.lineJoin = 'miter';
    context.lineCap = 'butt';

    context.beginPath();
    context.moveTo(pointsPx[0].x, pointsPx[0].y);
    for (let index = 1; index < pointsPx.length; index++) context.lineTo(pointsPx[index].x, pointsPx[index].y);
    context.closePath();
    context.lineWidth = borderSize * 3;
    context.strokeStyle = 'rgba(34,169,187,0.42)';
    context.translate(-context.lineWidth / 2, -context.lineWidth / 2);
    context.stroke();
    context.translate(context.lineWidth / 2, context.lineWidth / 2);

    context.beginPath();
    context.moveTo(pointsPx[0].x, pointsPx[0].y);
    for (let index = 1; index < pointsPx.length; index++) context.lineTo(pointsPx[index].x, pointsPx[index].y);
    context.closePath();
    context.lineWidth = borderSize;
    context.strokeStyle = 'rgba(0,0,0,0.5)';
    context.translate(-context.lineWidth / 2, -context.lineWidth / 2);
    context.stroke();
    context.translate(context.lineWidth / 2, context.lineWidth / 2);

    context.restore();
  }

  public static edgeKey = (sx: number, sy: number, ex: number, ey: number): string => `${sx},${sy}->${ex},${ey}`;

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
    const m = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return [128, 128, 128];
  }
  public static rgbString = (r: number, g: number, b: number): string => `rgb(${r},${g},${b})`;

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
}
