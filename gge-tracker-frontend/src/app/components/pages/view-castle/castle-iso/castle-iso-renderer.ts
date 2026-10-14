import {
  Container,
  createGameSymbol,
  CreateJs,
  DisplayObject,
  gameAssetUrl,
  loadCreateJs,
  loadGameLibrary,
  loadImage,
  MovieClip,
  Shape,
  Stage,
} from '@ggetracker-services/game-library.utilities';
import { CastleGround, GridPoint } from './castle-defence-layout';
import { CastleIsoScene, compareIsoDepth, GridRect, IsoLayer, IsoSprite } from './castle-iso-scene';

export type CastleIsoMode = 'render' | 'plan';

interface SpriteNode<T> {
  sprite: IsoSprite<T>;
  container: Container;
  clips: MovieClip[];
  flames: MovieClip[];
}

interface AtlasFrame {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface TerrainAtlas {
  image: HTMLImageElement;
  frames: Map<string, AtlasFrame>;
  grass: AtlasFrame[];
}

const HALF_TILE_WIDTH = 40;
const HALF_TILE_HEIGHT = 20;
const MIN_ZOOM = 0.04;
const MAX_ZOOM = 2;
const LIBRARY_CONCURRENCY = 6;
const FLAME_FILE = 'fxroofflame';
const FLAME_SYMBOL = 'FX_RoofFlame';
const LAYER_ORDER: IsoLayer[] = ['moat', 'back', 'main', 'front'];
const KINGDOM_TERRAIN: Record<number, string> = {
  0: 'backgroundsclassic',
  1: 'backgroundsdessert',
  2: 'backgroundsicecream',
  3: 'backgroundsvolcano',
};
export const KINGDOM_GROUND_COLORS: Record<number, { outer: string; inner: string }> = {
  0: { outer: '#566b2d', inner: '#789342' },
  1: { outer: '#8f7950', inner: '#c3a96e' },
  2: { outer: '#8f969b', inner: '#c8c9c9' },
  3: { outer: '#352820', inner: '#5f4534' },
};
export const CATEGORY_COLORS: Record<string, string> = {
  CIVIL: '#d9a441',
  MILITARY: '#c2453a',
  DEFENCE: '#7d8a99',
  DECO: '#8d5ea0',
};
const FALLBACK_CATEGORY_COLOR = '#5f88b8';

export function isoProject(x: number, y: number): GridPoint {
  return { x: (x - y) * HALF_TILE_WIDTH, y: (x + y) * HALF_TILE_HEIGHT };
}

export class CastleIsoRenderer<T> {
  public onChange: (() => void) | null = null;
  private readonly stage: Stage;
  private readonly camera: Container;
  private readonly terrainLayer: Container;
  private readonly planLayer: Container;
  private readonly spriteLayer: Container;
  private readonly spriteLayers = new Map<IsoLayer, Container>();
  private readonly markerLayer: Container;
  private readonly labelLayer: Container;
  private readonly nodes = new Map<string, SpriteNode<T>>();
  private readonly containers = new Map<Container, SpriteNode<T>>();
  private scene: CastleIsoScene<T> | null = null;
  private fireIcon: HTMLImageElement | null = null;
  private hovered: SpriteNode<T> | null = null;
  private highlighted: Set<T> | null = null;
  private mode: CastleIsoMode = 'render';
  private labels = false;
  private animated = false;
  private zoom = 0.4;
  private panX = 0;
  private panY = 0;
  private viewWidth = 1;
  private viewHeight = 1;
  private pixelRatio = 1;
  private pendingFrame = 0;
  private sceneVersion = 0;

  private constructor(
    private readonly createjs: CreateJs,
    private readonly canvas: HTMLCanvasElement,
    private readonly labelOf: (reference: T) => string,
  ) {
    this.stage = new createjs.Stage(canvas);
    this.stage.tickOnUpdate = false;
    this.camera = new createjs.Container();
    this.terrainLayer = new createjs.Container();
    this.planLayer = new createjs.Container();
    this.spriteLayer = new createjs.Container();
    for (const name of LAYER_ORDER) {
      const layer = new createjs.Container();
      this.spriteLayers.set(name, layer);
      this.spriteLayer.addChild(layer);
    }
    this.markerLayer = new createjs.Container();
    this.labelLayer = new createjs.Container();
    for (const layer of [this.terrainLayer, this.planLayer, this.markerLayer, this.labelLayer]) {
      layer.mouseEnabled = false;
    }
    for (const layer of [this.terrainLayer, this.planLayer, this.spriteLayer, this.markerLayer, this.labelLayer]) {
      this.camera.addChild(layer);
    }
    this.stage.addChild(this.camera);
    createjs.Ticker.framerate = 24;
    createjs.Ticker.addEventListener('tick', this.tick);
  }

  public static async create<T>(
    canvas: HTMLCanvasElement,
    labelOf: (reference: T) => string,
  ): Promise<CastleIsoRenderer<T>> {
    const createjs = await loadCreateJs();
    return new CastleIsoRenderer<T>(createjs, canvas, labelOf);
  }

  public destroy(): void {
    this.createjs.Ticker.removeEventListener('tick', this.tick);
    cancelAnimationFrame(this.pendingFrame);
    this.sceneVersion++;
    this.stage.removeAllChildren();
    this.stage.update();
  }

  public async setScene(scene: CastleIsoScene<T>, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const version = ++this.sceneVersion;
    this.scene = scene;
    this.reset();
    this.canvas.style.backgroundColor = (KINGDOM_GROUND_COLORS[scene.kingdomId] ?? KINGDOM_GROUND_COLORS[0]).outer;
    this.fitToView();
    this.fireIcon ??= await loadImage('/assets/fire2.png').catch(() => null);
    const atlas = await this.loadTerrain(scene.kingdomId).catch(() => null);
    if (version !== this.sceneVersion) return;
    this.drawTerrain(scene.grounds, atlas, scene.kingdomId);
    this.requestRender();
    const files = [...new Set(scene.sprites.map((sprite) => sprite.file))];
    let loaded = 0;
    onProgress?.(loaded, files.length);
    await this.forEachConcurrently(files, async (file) => {
      const library = await loadGameLibrary(file).catch(() => null);
      if (version !== this.sceneVersion) return;
      for (const sprite of scene.sprites.filter((candidate) => candidate.file === file)) {
        this.addSprite(sprite, library);
      }
      this.sortSprites();
      this.refreshDecorations();
      onProgress?.(++loaded, files.length);
    });
  }

  public resize(width: number, height: number, pixelRatio: number): void {
    const previousWidth = this.viewWidth;
    const previousHeight = this.viewHeight;
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.round(this.viewWidth * pixelRatio);
    this.canvas.height = Math.round(this.viewHeight * pixelRatio);
    this.panX += (this.viewWidth - previousWidth) / 2;
    this.panY += (this.viewHeight - previousHeight) / 2;
    this.requestRender();
  }

  public fitToView(): void {
    const bounds = this.sceneBounds();
    if (!bounds) return;
    const margin = 40;
    this.zoom = this.clampZoom(
      Math.min((this.viewWidth - margin) / bounds.width, (this.viewHeight - margin) / bounds.height),
    );
    this.panX = this.viewWidth / 2 - (bounds.x + bounds.width / 2) * this.zoom;
    this.panY = this.viewHeight / 2 - (bounds.y + bounds.height / 2) * this.zoom;
    this.requestRender();
  }

  public zoomBy(factor: number, anchorX = this.viewWidth / 2, anchorY = this.viewHeight / 2): void {
    const zoom = this.clampZoom(this.zoom * factor);
    const worldX = (anchorX - this.panX) / this.zoom;
    const worldY = (anchorY - this.panY) / this.zoom;
    this.zoom = zoom;
    this.panX = anchorX - worldX * zoom;
    this.panY = anchorY - worldY * zoom;
    this.requestRender();
  }

  public panBy(deltaX: number, deltaY: number): void {
    this.panX += deltaX;
    this.panY += deltaY;
    this.requestRender();
  }

  public get zoomLevel(): number {
    return this.zoom;
  }

  public pick(viewX: number, viewY: number): T | null {
    return this.nodeAt(viewX, viewY)?.sprite.ref ?? null;
  }

  public hover(viewX: number | null, viewY: number | null): T | null {
    const node = viewX === null || viewY === null ? null : this.nodeAt(viewX, viewY);
    if (node !== this.hovered) {
      if (this.hovered) this.setGlow(this.hovered.sprite.ref, null);
      this.hovered = node;
      if (node) this.setGlow(node.sprite.ref, new this.createjs.Shadow('rgba(255,244,214,0.95)', 0, 0, 14));
      this.requestRender();
    }
    return node?.sprite.ref ?? null;
  }

  public screenPositionOf(reference: T): GridPoint | null {
    const node = [...this.nodes.values()].find((candidate) => candidate.sprite.ref === reference);
    if (!node) return null;
    const center = this.footprintCenter(node.sprite.footprint);
    return { x: this.panX + center.x * this.zoom, y: this.panY + center.y * this.zoom };
  }

  public focus(reference: T): void {
    const node = [...this.nodes.values()].find((candidate) => candidate.sprite.ref === reference);
    if (!node) return;
    const center = this.footprintCenter(node.sprite.footprint);
    this.zoom = Math.max(this.zoom, 0.8);
    this.panX = this.viewWidth / 2 - center.x * this.zoom;
    this.panY = this.viewHeight / 2 - center.y * this.zoom;
    this.hover(this.viewWidth / 2, this.viewHeight / 2);
    this.requestRender();
  }

  public setHighlighted(references: T[] | null): void {
    this.highlighted = references ? new Set(references) : null;
    this.applyVisibility();
  }

  public setMode(mode: CastleIsoMode): void {
    this.mode = mode;
    this.drawPlan();
    this.applyVisibility();
  }

  public setLabels(visible: boolean): void {
    this.labels = visible;
    this.drawLabels();
    this.requestRender();
  }

  public setAnimated(animated: boolean): void {
    this.animated = animated;
    this.stage.tickOnUpdate = animated;
    this.requestRender();
  }

  public snapshot(): string {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  private reset(): void {
    for (const layer of [this.terrainLayer, this.planLayer, this.markerLayer, this.labelLayer])
      layer.removeAllChildren();
    for (const layer of this.spriteLayers.values()) layer.removeAllChildren();
    this.nodes.clear();
    this.containers.clear();
    this.hovered = null;
  }

  private setGlow(reference: T | null, shadow: unknown): void {
    if (reference === null) return;
    // A wall or a moat is many sprites sharing one entry, so
    // hovering one segment lights the whole defence.
    for (const node of this.nodes.values()) {
      if (node.sprite.ref === reference) node.container.shadow = shadow;
    }
  }

  private async forEachConcurrently(items: string[], work: (item: string) => Promise<void>): Promise<void> {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(LIBRARY_CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    });
    await Promise.all(workers);
  }

  private readonly tick = (event: { delta: number }): void => {
    if (this.animated) this.stage.update(event);
  };

  private async loadTerrain(kingdomId: number): Promise<TerrainAtlas> {
    const file = KINGDOM_TERRAIN[kingdomId] ?? KINGDOM_TERRAIN[0];
    const [data, image] = await Promise.all([
      fetch(gameAssetUrl(file, 'json')).then((response) => response.json()),
      loadImage(gameAssetUrl(file, 'webp'), true),
    ]);
    const frames = new Map<string, AtlasFrame>();
    for (const [name, animation] of Object.entries<{ frames: number[] }>(data.animations ?? {})) {
      const frame = data.frames?.[animation.frames?.[0]];
      if (Array.isArray(frame)) frames.set(name, { sx: frame[0], sy: frame[1], sw: frame[2], sh: frame[3] });
    }
    const grass = [...frames.values()].filter(
      (frame) => frame.sw >= 700 && frame.sw <= 900 && frame.sh >= 350 && frame.sh <= 450,
    );
    return { image, frames, grass };
  }

  private drawTerrain(grounds: CastleGround[], atlas: TerrainAtlas | null, kingdomId: number): void {
    const colors = KINGDOM_GROUND_COLORS[kingdomId] ?? KINGDOM_GROUND_COLORS[0];
    if (atlas && atlas.grass.length > 0) this.terrainLayer.addChild(this.grassShape(atlas));
    const base = new this.createjs.Shape();
    base.graphics.beginFill(colors.inner);
    for (const ground of grounds) this.traceRect(base.graphics, ground);
    this.terrainLayer.addChild(base);
    if (!atlas) return;
    grounds.forEach((ground, index) => {
      const piece = this.groundPiece(ground, index);
      const frame = piece ? atlas.frames.get(piece.name) : undefined;
      if (!piece || !frame) return;
      const bitmap = new this.createjs.Bitmap(atlas.image);
      bitmap.sourceRect = new this.createjs.Rectangle(frame.sx, frame.sy, frame.sw, frame.sh);
      const origin = isoProject(ground.x, ground.y);
      bitmap.x = origin.x + piece.offsetX - frame.sw;
      bitmap.y = origin.y + piece.offsetY - frame.sh;
      this.terrainLayer.addChild(bitmap);
    });
  }

  private groundPiece(ground: CastleGround, index: number): { name: string; offsetX: number; offsetY: number } | null {
    if (ground.width === 20 && ground.height === 20) return { name: 'BMP_b', offsetX: 800, offsetY: 800 };
    if (ground.width === 10 && ground.height === 20) {
      return { name: ['BMP_7', 'BMP_8', 'BMP_9', 'BMP_a'][index % 4], offsetX: 400, offsetY: 600 };
    }
    if (ground.width === 20 && ground.height === 10) {
      return { name: ['BMP_3', 'BMP_4', 'BMP_5', 'BMP_6'][index % 4], offsetX: 800, offsetY: 600 };
    }
    return null;
  }

  private grassShape(atlas: TerrainAtlas): Shape {
    const tile = document.createElement('canvas');
    tile.width = atlas.grass.reduce((width, frame) => width + frame.sw, 0);
    tile.height = Math.max(...atlas.grass.map((frame) => frame.sh));
    const context = tile.getContext('2d')!;
    let offset = 0;
    for (const frame of atlas.grass) {
      context.drawImage(atlas.image, frame.sx, frame.sy, frame.sw, frame.sh, offset, 0, frame.sw, frame.sh);
      offset += frame.sw;
    }
    context.fillStyle = 'rgba(10, 16, 6, 0.25)';
    context.fillRect(0, 0, tile.width, tile.height);
    const shape = new this.createjs.Shape();
    const bounds = this.sceneBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    const reach = 4000;
    shape.graphics
      .beginBitmapFill(tile, 'repeat')
      .drawRect(bounds.x - reach, bounds.y - reach, bounds.width + reach * 2, bounds.height + reach * 2);
    return shape;
  }

  private addSprite(sprite: IsoSprite<T>, library: string | null): void {
    const container = new this.createjs.Container();
    const anchor = isoProject(sprite.anchor.x, sprite.anchor.y);
    container.x = anchor.x;
    container.y = anchor.y;
    const clips = (sprite.symbols ?? [library ?? '']).map((symbol) =>
      library ? createGameSymbol(library, symbol || library) : null,
    );
    for (const clip of clips) {
      if (!clip) continue;
      this.orientClip(clip, sprite);
      container.addChild(clip);
    }
    if (!clips.some(Boolean) && sprite.layer !== 'moat') container.addChild(this.placeholder(sprite));
    container.mouseEnabled = sprite.ref !== null;
    const node: SpriteNode<T> = {
      sprite,
      container,
      clips: clips.filter((clip): clip is MovieClip => clip !== null),
      flames: [],
    };
    this.nodes.set(sprite.key, node);
    this.containers.set(container, node);
    if (sprite.damage > 0 && node.clips.length > 0) void this.ignite(node);
  }

  private async ignite(node: SpriteNode<T>): Promise<void> {
    const version = this.sceneVersion;
    const library = await loadGameLibrary(FLAME_FILE).catch(() => null);
    if (!library || version !== this.sceneVersion) return;
    for (const holder of node.clips.flatMap((clip) => this.findNamed(clip, 'damageHolder'))) {
      const flame = createGameSymbol(library, FLAME_SYMBOL);
      if (!flame) continue;
      const point = holder.localToLocal(0, 0, node.container);
      flame.x = point.x;
      flame.y = point.y;
      flame.scaleX = flame.scaleY = this.flameScale(node.sprite);
      flame.visible = this.mode === 'render';
      node.container.addChild(flame);
      node.flames.push(flame);
    }
    this.drawMarkers();
    this.requestRender();
  }

  private flameScale(sprite: IsoSprite<T>): number {
    if (this.isDefence(sprite)) return (1 + sprite.damage) / 2;
    const sizeFactors: Record<number, number> = { 2: 0.25, 3: 0.5, 4: 0.75 };
    const size = Math.min(sprite.footprint.width, sprite.footprint.height);
    return ((1 + sprite.damage) * (sizeFactors[size] ?? 1)) / 2;
  }

  private findNamed(root: DisplayObject, name: string): DisplayObject[] {
    const found: DisplayObject[] = root.name === name ? [root] : [];
    for (const child of (root as Container).children ?? []) found.push(...this.findNamed(child, name));
    return found;
  }

  private orientClip(clip: MovieClip, sprite: IsoSprite<T>): void {
    // Mirrors AIsoObjectVE: the clip sits half a tile left of the anchor
    // mirrored and shifted right for rotations 1 and 3.
    const mirrored = sprite.rotationType !== 'none' && (sprite.rot === 1 || sprite.rot === 3);
    clip.x = mirrored ? HALF_TILE_WIDTH : -HALF_TILE_WIDTH;
    clip.scaleX = mirrored ? -1 : 1;
    if (sprite.rotationType === 'mirrored' && clip.totalFrames > 1) this.showFrame(clip, 1);
    if (sprite.rotationType === 'twoFramesMirrored') this.showFrame(clip, sprite.rot === 0 || sprite.rot === 1 ? 2 : 1);
    if (sprite.kingdomArt && this.scene) {
      const art = clip.getChildByName('art') as MovieClip | null;
      if (art?.gotoAndStop) art.gotoAndStop(this.scene.kingdomId + 1);
    }
  }

  private showFrame(clip: MovieClip, frame: number): void {
    const index = Math.min(frame - 1, Math.max(0, clip.totalFrames - 1));
    clip.gotoAndStop(index);
  }

  private placeholder(sprite: IsoSprite<T>): Shape {
    const shape = new this.createjs.Shape();
    const { width, height } = sprite.footprint;
    const color = CATEGORY_COLORS[sprite.category] ?? FALLBACK_CATEGORY_COLOR;
    shape.graphics.beginFill(color).beginStroke('rgba(0,0,0,0.35)').setStrokeStyle(2);
    this.traceRect(shape.graphics, { x: 0, y: 0, width, height });
    shape.alpha = 0.75;
    return shape;
  }

  private sortSprites(): void {
    const ordered = [...this.nodes.values()].sort((a, b) => compareIsoDepth(a.sprite.footprint, b.sprite.footprint));
    for (const layer of this.spriteLayers.values()) layer.removeAllChildren();
    for (const node of ordered) this.spriteLayers.get(node.sprite.layer)?.addChild(node.container);
  }

  private refreshDecorations(): void {
    this.drawPlan();
    this.drawMarkers();
    this.drawLabels();
    this.applyVisibility();
  }

  private drawPlan(): void {
    this.planLayer.removeAllChildren();
    if (this.mode !== 'plan') return;
    for (const node of this.nodes.values()) {
      if (this.isDefence(node.sprite)) continue;
      const shape = new this.createjs.Shape();
      const color = CATEGORY_COLORS[node.sprite.category] ?? FALLBACK_CATEGORY_COLOR;
      shape.graphics.beginFill(color).beginStroke('rgba(20,14,8,0.55)').setStrokeStyle(1.5);
      this.traceRect(shape.graphics, node.sprite.footprint);
      shape.alpha = this.isDimmed(node) ? 0.2 : 0.85;
      this.planLayer.addChild(shape);
    }
  }

  private drawMarkers(): void {
    this.markerLayer.removeAllChildren();
    if (!this.fireIcon) return;
    for (const node of this.nodes.values()) {
      if (node.sprite.damage <= 0 || (this.mode === 'render' && node.flames.length > 0)) continue;
      const icon = new this.createjs.Bitmap(this.fireIcon);
      const center = this.footprintCenter(node.sprite.footprint);
      const top = node.container.getBounds();
      const size = this.markerSize(node.sprite.footprint);
      icon.scaleX = icon.scaleY = size / Math.max(1, this.fireIcon.naturalWidth);
      icon.x = center.x - size / 2;
      icon.y =
        this.mode === 'plan' ? center.y - size / 2 : (top ? node.container.y + top.y : center.y - 60) - size * 0.6;
      this.markerLayer.addChild(icon);
    }
  }

  private drawLabels(): void {
    this.labelLayer.removeAllChildren();
    if (!this.labels) return;
    for (const node of this.nodes.values()) {
      if (node.sprite.ref === null || this.isDefence(node.sprite) || this.isDimmed(node)) continue;
      const center = this.footprintCenter(node.sprite.footprint);
      const text = this.labelOf(node.sprite.ref);
      for (const outline of [true, false]) {
        const label = new this.createjs.Text(text, '600 22px system-ui, sans-serif', outline ? '#1d140c' : '#fff3d6');
        label.textAlign = 'center';
        label.textBaseline = 'middle';
        label.lineWidth = Math.max(80, (node.sprite.footprint.width + node.sprite.footprint.height) * 34);
        if (outline) label.outline = 5;
        label.x = center.x;
        label.y = center.y;
        this.labelLayer.addChild(label);
      }
    }
  }

  private markerSize(footprint: GridRect): number {
    if (this.mode === 'render') return 56;
    const side = Math.min(footprint.width, footprint.height);
    return Math.min(90, Math.max(28, side * 22));
  }

  private applyVisibility(): void {
    for (const node of this.nodes.values()) {
      for (const flame of node.flames) flame.visible = this.mode === 'render';
      const isDefence = this.isDefence(node.sprite);
      if (this.mode === 'plan') {
        node.container.alpha = isDefence ? 0.35 : 0;
        node.container.mouseEnabled = !isDefence;
        continue;
      }
      node.container.alpha = this.isDimmed(node) ? 0.22 : 1;
      node.container.mouseEnabled = node.sprite.ref !== null;
    }
    this.drawPlan();
    this.drawMarkers();
    this.requestRender();
  }

  private isDefence(sprite: IsoSprite<T>): boolean {
    return sprite.layer !== 'main';
  }

  private isDimmed(node: SpriteNode<T>): boolean {
    if (!this.highlighted) return false;
    return node.sprite.ref === null || !this.highlighted.has(node.sprite.ref);
  }

  private nodeAt(viewX: number, viewY: number): SpriteNode<T> | null {
    this.applyCamera();
    let target: DisplayObject | null = this.stage.getObjectUnderPoint(
      viewX * this.pixelRatio,
      viewY * this.pixelRatio,
      1,
    );
    while (target) {
      const node = this.containers.get(target as Container);
      if (node) return node.sprite.ref === null ? null : node;
      target = target.parent;
    }
    return this.mode === 'plan' ? this.nodeAtFootprint(viewX, viewY) : null;
  }

  private nodeAtFootprint(viewX: number, viewY: number): SpriteNode<T> | null {
    const worldX = (viewX - this.panX) / this.zoom;
    const worldY = (viewY - this.panY) / this.zoom;
    const gridX = (worldX / HALF_TILE_WIDTH + worldY / HALF_TILE_HEIGHT) / 2;
    const gridY = (worldY / HALF_TILE_HEIGHT - worldX / HALF_TILE_WIDTH) / 2;
    const ordered = [...this.nodes.values()].reverse();
    return (
      ordered.find(({ sprite }) => {
        const { x, y, width, height } = sprite.footprint;
        return (
          sprite.ref !== null &&
          !this.isDefence(sprite) &&
          gridX >= x &&
          gridX < x + width &&
          gridY >= y &&
          gridY < y + height
        );
      }) ?? null
    );
  }

  private footprintCenter(rect: GridRect): GridPoint {
    return isoProject(rect.x + rect.width / 2, rect.y + rect.height / 2);
  }

  private traceRect(graphics: Shape['graphics'], rect: GridRect): void {
    const corners = [
      isoProject(rect.x, rect.y),
      isoProject(rect.x + rect.width, rect.y),
      isoProject(rect.x + rect.width, rect.y + rect.height),
      isoProject(rect.x, rect.y + rect.height),
    ];
    graphics.moveTo(corners[0].x, corners[0].y);
    for (const corner of corners.slice(1)) graphics.lineTo(corner.x, corner.y);
    graphics.closePath();
  }

  private sceneBounds(): GridRect | null {
    const grounds = this.scene?.grounds ?? [];
    if (grounds.length === 0) return null;
    const points = grounds.flatMap((ground) => [
      isoProject(ground.x, ground.y),
      isoProject(ground.x + ground.width, ground.y),
      isoProject(ground.x + ground.width, ground.y + ground.height),
      isoProject(ground.x, ground.y + ground.height),
    ]);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const top = Math.min(...ys) - 260;
    const bottom = Math.max(...ys) + 300;
    const left = Math.min(...xs) - 360;
    const right = Math.max(...xs) + 360;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  private clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }

  private applyCamera(): void {
    this.camera.scaleX = this.camera.scaleY = this.zoom * this.pixelRatio;
    this.camera.x = this.panX * this.pixelRatio;
    this.camera.y = this.panY * this.pixelRatio;
  }

  private requestRender(): void {
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = 0;
      this.render();
    });
  }

  private render(): void {
    this.applyCamera();
    this.stage.update();
    this.onChange?.();
  }
}
