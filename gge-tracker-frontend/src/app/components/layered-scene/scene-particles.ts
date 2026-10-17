import { Container, CreateJs, DisplayObject } from './scene-libraries';
import { TAU, moonlight } from './scene-motion';

export interface Beam {
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Mote {
  node: DisplayObject;
  x: number;
  y: number;
  driftX: number;
  driftY: number;
  sway: number;
  born: number;
  life: number;
}

interface Ember {
  node: DisplayObject;
  x: number;
  y: number;
  rise: number;
  sway: number;
  born: number;
  life: number;
}

const MOTE_COUNT = 70;
const EMBERS_PER_FLAME = 2;
const MASK_SCALE = 1 / 8;

function glowDot(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 24;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(12, 12, 0, 12, 12, 12);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.3, color.replace(', 1)', ', 0.55)'));
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 24, 24);
  return canvas;
}

class BeamMask {
  private readonly alpha: Uint8ClampedArray;
  private readonly peak: number;
  private readonly width: number;
  private readonly height: number;

  constructor(sceneWidth: number, sceneHeight: number, beams: Beam[]) {
    this.width = Math.ceil(sceneWidth * MASK_SCALE);
    this.height = Math.ceil(sceneHeight * MASK_SCALE);
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    for (const beam of beams) {
      context.drawImage(
        beam.image,
        beam.x * MASK_SCALE,
        beam.y * MASK_SCALE,
        beam.width * MASK_SCALE,
        beam.height * MASK_SCALE,
      );
    }
    this.alpha = context.getImageData(0, 0, this.width, this.height).data;
    let peak = 1;
    for (let index = 3; index < this.alpha.length; index += 4) peak = Math.max(peak, this.alpha[index]);
    this.peak = peak;
  }

  public strength(x: number, y: number): number {
    const column = Math.floor(x * MASK_SCALE);
    const row = Math.floor(y * MASK_SCALE);
    if (column < 0 || row < 0 || column >= this.width || row >= this.height) return 0;
    return this.alpha[(row * this.width + column) * 4 + 3] / this.peak;
  }
}

export class SceneParticles {
  public readonly layer: Container;
  private readonly mask: BeamMask;
  private readonly motes: Mote[] = [];
  private readonly embers: Ember[] = [];

  constructor(
    createjs: CreateJs,
    private readonly scene: { width: number; height: number },
    beams: Beam[],
    flames: { x: number; y: number }[],
  ) {
    this.layer = new createjs.Container();
    this.layer.compositeOperation = 'lighter';
    this.mask = new BeamMask(scene.width, scene.height, beams);
    const dust = glowDot('rgba(255, 244, 214, 1)');
    const spark = glowDot('rgba(255, 170, 70, 1)');
    for (let index = 0; index < MOTE_COUNT; index++) {
      const mote = this.spawnMote(new createjs.Bitmap(dust), -Math.random() * 12);
      this.motes.push(mote);
      this.layer.addChild(mote.node);
    }
    for (const flame of flames) {
      for (let index = 0; index < EMBERS_PER_FLAME; index++) {
        const ember = this.spawnEmber(new createjs.Bitmap(spark), flame, 1.5 + Math.random() * 6);
        this.embers.push(ember);
        this.layer.addChild(ember.node);
      }
    }
  }

  public update(seconds: number): void {
    const sun = moonlight(seconds);
    for (const mote of this.motes) this.moveMote(mote, seconds, sun);
    for (const ember of this.embers) this.moveEmber(ember, seconds);
  }

  private spawnMote(node: DisplayObject, born: number): Mote {
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      x = Math.random() * this.scene.width;
      y = Math.random() * this.scene.height;
      if (this.mask.strength(x, y) > 0.25) break;
    }
    node.regX = node.regY = 12;
    node.scaleX = node.scaleY = 0.2 + Math.random() * 0.3;
    node.alpha = 0;
    return {
      node,
      x,
      y,
      driftX: (Math.random() - 0.5) * 8,
      driftY: 1 + Math.random() * 4,
      sway: Math.random() * TAU,
      born,
      life: 7 + Math.random() * 9,
    };
  }

  private moveMote(mote: Mote, seconds: number, sun: number): void {
    const age = seconds - mote.born;
    if (age > mote.life) {
      Object.assign(mote, this.spawnMote(mote.node, seconds));
      return;
    }
    const x = mote.x + mote.driftX * age + 6 * Math.sin(age * 0.7 + mote.sway);
    const y = mote.y + mote.driftY * age + 4 * Math.sin(age * 0.5 + mote.sway * 1.3);
    const fade = Math.min(1, age / 2, (mote.life - age) / 2);
    const twinkle = 0.65 + 0.35 * Math.sin(age * 2.3 + mote.sway);
    mote.node.x = x;
    mote.node.y = y;
    mote.node.alpha = Math.min(1, Math.max(0, fade) * twinkle * sun * this.mask.strength(x, y) * 1.4);
  }

  private spawnEmber(node: DisplayObject, flame: { x: number; y: number }, delay: number): Ember {
    node.regX = node.regY = 12;
    node.scaleX = node.scaleY = 0.14 + Math.random() * 0.1;
    node.alpha = 0;
    return {
      node,
      x: flame.x + (Math.random() - 0.5) * 6,
      y: flame.y - 10,
      rise: 26 + Math.random() * 24,
      sway: Math.random() * TAU,
      born: delay,
      life: 1.3 + Math.random(),
    };
  }

  private moveEmber(ember: Ember, seconds: number): void {
    const age = seconds - ember.born;
    if (age < 0) return;
    if (age > ember.life) {
      ember.born = seconds + 2 + Math.random() * 7;
      ember.node.alpha = 0;
      return;
    }
    const progress = age / ember.life;
    ember.node.x = ember.x + 4 * Math.sin(age * 5 + ember.sway) * progress;
    ember.node.y = ember.y - ember.rise * (1 - (1 - progress) * (1 - progress));
    ember.node.alpha = (1 - progress) * (0.75 + 0.25 * Math.sin(age * 23));
  }
}
