import { Container, DisplayObject, Stage, loadImage } from './scene-libraries';
import { cameraDrift, flicker, hostsMotes, lightAlpha, animateObject as moveProperty, pivotOf } from './scene-motion';
import { Beam, SceneParticles, Volley } from './scene-particles';

export interface SceneLayer {
  kind: 'image' | 'light' | 'prop' | 'flame' | 'volley';
  id?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  depth?: number;
  scale?: number;
  alpha?: number;
  toX?: number;
  toY?: number;
  arc?: number;
  spread?: number;
}

export interface SceneDescription {
  width: number;
  height: number;
  layers: SceneLayer[];
}

export interface Framing {
  focusX: number;
  focusY: number;
  zoom: number;
}

interface Placed {
  layer: SceneLayer;
  node: DisplayObject;
  x: number;
  y: number;
  depth: number;
  tempo: number;
}

interface View {
  scale: number;
  x: number;
  y: number;
  focusX: number;
  focusY: number;
}

const FRAME_INTERVAL_MS = 1000 / 30;
const PARALLAX_X = 14;
const PARALLAX_Y = 8;
const PARTICLE_DEPTH = 1.2;
const FLAME_BASE = { x: 32, y: 120 };
const EMBER_MIN_SCALE = 0.2;

export class SceneStage {
  private readonly placed: Placed[] = [];
  private particles: SceneParticles | null = null;
  private view: View = { scale: 1, x: 0, y: 0, focusX: 0, focusY: 0 };
  private readonly pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  private frameRequest = 0;
  private lastFrame = 0;
  private startedAt = performance.now();
  private pixelRatio = 1;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stage: Stage,
    private readonly root: Container,
    private readonly scene: SceneDescription,
  ) {}

  public static async create(
    canvas: HTMLCanvasElement,
    scene: SceneDescription,
    assetRoot: string,
  ): Promise<SceneStage> {
    const createjs = globalThis.createjs!;
    const [flame, ...images] = await Promise.all([
      loadImage(`${assetRoot}flame.webp`),
      ...scene.layers.map((layer) => (layer.id ? loadImage(`${assetRoot}${layer.id}.webp`) : null)),
    ]);
    const stage = new createjs.Stage(canvas);
    const root = new createjs.Container();
    stage.addChild(root);
    const stageView = new SceneStage(canvas, stage, root, scene);
    scene.layers.forEach((layer, index) => {
      if (layer.kind === 'volley') return;
      const image = layer.kind === 'flame' ? flame : images[index]!;
      const node = new createjs.Bitmap(image);
      const pivot =
        layer.kind === 'flame'
          ? FLAME_BASE
          : layer.kind === 'prop'
            ? pivotOf(layer.id!, image.naturalWidth, image.naturalHeight)
            : null;
      if (pivot) {
        node.regX = pivot.x;
        node.regY = pivot.y;
      }
      if (layer.kind === 'light' || layer.kind === 'flame') node.compositeOperation = 'lighter';
      if (layer.kind === 'light') node.scaleX = node.scaleY = layer.scale ?? 1;
      const x = layer.x + (layer.kind === 'flame' ? 0 : (pivot?.x ?? 0));
      const y = layer.y + (layer.kind === 'flame' ? 0 : (pivot?.y ?? 0));
      root.addChild(node);
      stageView.placed.push({ layer, node, x, y, depth: layer.depth ?? 1, tempo: 1 + (index % 5) * 0.13 });
    });
    stageView.addParticles(images);
    stageView.render(performance.now());
    return stageView;
  }

  public resize(width: number, height: number, framing: Framing): void {
    const cover = Math.max(width / this.scene.width, height / this.scene.height) * framing.zoom;
    this.pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, 1 / cover));
    this.canvas.width = Math.round(width * this.pixelRatio);
    this.canvas.height = Math.round(height * this.pixelRatio);
    const scale = cover * this.pixelRatio;
    const x = (width - this.scene.width * cover) * framing.focusX * this.pixelRatio;
    const y = (height - this.scene.height * cover) * framing.focusY * this.pixelRatio;
    this.view = {
      scale,
      x,
      y,
      focusX: (width * this.pixelRatio * 0.5 - x) / scale,
      focusY: (height * this.pixelRatio * 0.5 - y) / scale,
    };
    this.render(performance.now());
  }

  public point(clientX: number, clientY: number): void {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.pointer.targetX = Math.max(-0.5, Math.min(0.5, (clientX - bounds.left) / bounds.width - 0.5));
    this.pointer.targetY = Math.max(-0.5, Math.min(0.5, (clientY - bounds.top) / bounds.height - 0.5));
  }

  public play(): void {
    if (this.frameRequest) return;
    this.lastFrame = performance.now();
    const loop = (now: number): void => {
      this.frameRequest = requestAnimationFrame(loop);
      if (now - this.lastFrame < FRAME_INTERVAL_MS) return;
      this.render(now);
    };
    this.frameRequest = requestAnimationFrame(loop);
  }

  public pause(): void {
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
  }

  public destroy(): void {
    this.pause();
    this.stage.clear();
  }

  private addParticles(images: (HTMLImageElement | null)[]): void {
    const beams: Beam[] = this.scene.layers.flatMap((layer, index) => {
      const image = images[index];
      if (!image || !hostsMotes(layer.id ?? '')) return [];
      return [{ image, x: layer.x, y: layer.y, width: layer.width!, height: layer.height! }];
    });
    const flames = this.scene.layers.filter((layer) => layer.kind === 'flame' && (layer.scale ?? 1) >= EMBER_MIN_SCALE);
    const volleys: Volley[] = this.scene.layers
      .filter((layer) => layer.kind === 'volley')
      .map((layer) => ({
        x: layer.x,
        y: layer.y,
        toX: layer.toX!,
        toY: layer.toY!,
        arc: layer.arc ?? 120,
        spread: layer.spread ?? 60,
      }));
    this.particles = new SceneParticles(globalThis.createjs!, this.scene, beams, flames, volleys);
    this.root.addChild(this.particles.layer);
  }

  private frame(seconds: number): void {
    const drift = cameraDrift(seconds);
    const scale = this.view.scale * drift.zoom;
    this.root.scaleX = this.root.scaleY = scale;
    this.root.x = this.view.x + this.view.focusX * (this.view.scale - scale) - drift.panX * scale;
    this.root.y = this.view.y + this.view.focusY * (this.view.scale - scale) - drift.panY * scale;
  }

  private render(now: number): void {
    const delta = Math.min(now - this.lastFrame, 100);
    this.lastFrame = now;
    const seconds = (now - this.startedAt) / 1000;
    this.pointer.x += (this.pointer.targetX - this.pointer.x) * 0.06;
    this.pointer.y += (this.pointer.targetY - this.pointer.y) * 0.06;
    this.frame(seconds);
    for (const item of this.placed) {
      item.node.x = item.x - this.pointer.x * PARALLAX_X * item.depth;
      item.node.y = item.y - this.pointer.y * PARALLAX_Y * item.depth;
      const id = item.layer.id ?? '';
      if (item.layer.kind === 'prop') moveProperty(id, item.node, seconds);
      if (item.layer.kind === 'flame')
        flicker(item.node, seconds, item.x, item.layer.scale ?? 1, item.layer.alpha ?? 1);
      if (item.layer.kind === 'light') item.node.alpha = lightAlpha(id, seconds, item.tempo);
    }
    if (this.particles) {
      this.particles.update(seconds);
      this.particles.layer.x = -this.pointer.x * PARALLAX_X * PARTICLE_DEPTH;
      this.particles.layer.y = -this.pointer.y * PARALLAX_Y * PARTICLE_DEPTH;
    }
    this.stage.update({ delta });
  }
}
