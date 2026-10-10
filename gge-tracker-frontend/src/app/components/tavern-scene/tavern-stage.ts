import { Container, DisplayObject, MovieClip, Stage, createCharacter, loadImage } from './tavern-libraries';
import { cameraDrift, lightAlpha, lightOffset, animateObject as moveProperty, pivotOf } from './tavern-motion';
import { Beam, TavernParticles } from './tavern-particles';

export interface TavernLayer {
  kind: 'image' | 'light' | 'prop' | 'character' | 'flame';
  id?: string;
  library?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface TavernScene {
  width: number;
  height: number;
  layers: TavernLayer[];
}

export interface Framing {
  focusX: number;
  focusY: number;
  zoom: number;
}

interface Placed {
  layer: TavernLayer;
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

const ASSET_ROOT = '/assets/tavern/';
const FRAME_INTERVAL_MS = 1000 / 30;
const ANIMATION_FRAMERATE = 24;
const PARALLAX_X = 14;
const PARALLAX_Y = 8;
const BACK_DEPTH = 0.55;
const FRONT_DEPTH = 1.5;
const PARTICLE_DEPTH = 1.2;
const SUNBEAMS = new Set(['beam-back', 'lightbeams-middle', 'beam-front-1', 'beam-front-2']);

function depthsOf(layers: TavernLayer[]): number[] {
  const characters = layers.flatMap((layer, index) => (layer.kind === 'character' ? [index] : []));
  const first = characters[0] ?? 0;
  const last = characters.at(-1) ?? layers.length;
  return layers.map((_, index) => (index < first ? BACK_DEPTH : index > last ? FRONT_DEPTH : 1));
}

export class TavernStage {
  private readonly placed: Placed[] = [];
  private particles: TavernParticles | null = null;
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
    private readonly scene: TavernScene,
  ) {}

  public static async create(canvas: HTMLCanvasElement, scene: TavernScene): Promise<TavernStage> {
    const createjs = globalThis.createjs!;
    const images = await Promise.all(
      scene.layers.map((layer) => (layer.id ? loadImage(`${ASSET_ROOT}${layer.id}.webp`) : null)),
    );
    const stage = new createjs.Stage(canvas);
    const root = new createjs.Container();
    stage.addChild(root);
    const tavern = new TavernStage(canvas, stage, root, scene);
    const depths = depthsOf(scene.layers);
    const lastCharacter = scene.layers.map((layer) => layer.kind).lastIndexOf('character');
    scene.layers.forEach((layer, index) => {
      const image = images[index];
      const node = image ? new createjs.Bitmap(image) : tavern.animated(layer);
      const pivot = layer.kind === 'prop' && image ? pivotOf(layer.id!, image.naturalWidth, image.naturalHeight) : null;
      if (pivot) {
        node.regX = pivot.x;
        node.regY = pivot.y;
      }
      const x = layer.x + (pivot?.x ?? 0);
      const y = layer.y + (pivot?.y ?? 0);
      root.addChild(node);
      tavern.placed.push({ layer, node, x, y, depth: depths[index], tempo: 1 + (index % 5) * 0.13 });
      if (index === lastCharacter) tavern.addParticles(images);
    });
    tavern.render(performance.now());
    return tavern;
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
      return image && SUNBEAMS.has(layer.id ?? '') ? [{ image, x: layer.x, y: layer.y }] : [];
    });
    const flames = this.scene.layers.filter((layer) => layer.kind === 'flame');
    this.particles = new TavernParticles(globalThis.createjs!, this.scene, beams, flames);
    this.root.addChild(this.particles.layer);
  }

  private animated(layer: TavernLayer): MovieClip {
    const clip = createCharacter(layer.kind === 'flame' ? 'Candlelight_Animation' : layer.library!);
    clip.framerate = ANIMATION_FRAMERATE;
    if (layer.kind === 'flame') clip.gotoAndPlay(Math.floor(Math.random() * clip.totalFrames));
    return clip;
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
      if (item.layer.kind !== 'light') continue;
      const offset = lightOffset(id, seconds);
      item.node.x += offset.x;
      item.node.y += offset.y;
      item.node.alpha = lightAlpha(id, seconds, item.tempo);
    }
    if (this.particles) {
      this.particles.update(seconds);
      this.particles.layer.x = -this.pointer.x * PARALLAX_X * PARTICLE_DEPTH;
      this.particles.layer.y = -this.pointer.y * PARALLAX_Y * PARTICLE_DEPTH;
    }
    this.stage.update({ delta });
  }
}
