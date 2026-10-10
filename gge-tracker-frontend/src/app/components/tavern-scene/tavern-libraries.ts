import { ApiRestService } from '@ggetracker-services/api-rest.service';

export interface DisplayObject {
  x: number;
  y: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  regX: number;
  regY: number;
  visible: boolean;
  compositeOperation: GlobalCompositeOperation | null;
}

export interface Container extends DisplayObject {
  addChild(child: DisplayObject): void;
}

export interface MovieClip extends DisplayObject {
  framerate: number | null;
  totalFrames: number;
  gotoAndPlay(frame: number): void;
}

export interface Stage extends Container {
  update(properties?: { delta: number }): void;
  clear(): void;
}

export interface CreateJs {
  Stage: new (canvas: HTMLCanvasElement) => Stage;
  Container: new () => Container;
  Bitmap: new (image: HTMLImageElement | HTMLCanvasElement) => DisplayObject;
  SpriteSheet: new (data: unknown) => unknown;
}

type Constructor = new () => MovieClip;

declare global {
  var createjs: CreateJs | undefined;
  var Library: Record<string, Record<string, Constructor>> | undefined;
  var AssetLoader: { getResult(id: string): unknown } | undefined;
}

export const CHARACTER_FILES: Record<string, string> = {
  King_Animation: 'kinganimation',
  Knight_Animation: 'knightanimation',
  Princess_Animation: 'princessanimation',
  Candlelight_Animation: 'candlelightanimation',
};

const scripts = new Map<string, Promise<void>>();
const sheets = new Map<string, unknown>();
let libraries: Promise<void> | null = null;

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`Cannot load ${source}`)), { once: true });
    image.src = source;
  });
}

function loadScript(source: string): Promise<void> {
  const known = scripts.get(source);
  if (known) return known;
  const loading = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script');
    element.async = false;
    element.src = source;
    element.addEventListener('load', () => resolve(), { once: true });
    element.addEventListener('error', () => reject(new Error(`Cannot load ${source}`)), { once: true });
    document.head.append(element);
  });
  scripts.set(source, loading);
  loading.catch(() => scripts.delete(source));
  return loading;
}

async function registerSheet(id: string, file: string, createjs: CreateJs): Promise<void> {
  const base = `${ApiRestService.apiUrl}assets/common/${file}`;
  const [data, image] = await Promise.all([
    fetch(`${base}.json`).then((response) => response.json()),
    loadImage(`${base}.webp`),
  ]);
  sheets.set(id, new createjs.SpriteSheet({ ...data, images: [image] }));
}

async function loadAll(): Promise<void> {
  await loadScript('/assets/vendor/createjs/easeljs-1.0.0.min.js');
  await loadScript('/assets/vendor/createjs/tweenjs-1.0.0.min.js');
  const createjs = globalThis.createjs!;
  globalThis.AssetLoader ??= {
    getResult: (id: string): unknown => sheets.get(id),
  };
  const entries = Object.entries(CHARACTER_FILES);
  await Promise.all(entries.map(([id, file]) => registerSheet(id, file, createjs)));
  await Promise.all(entries.map(([, file]) => loadScript(`${ApiRestService.apiUrl}assets/common/${file}.js`)));
}

export function loadTavernLibraries(): Promise<void> {
  libraries ??= loadAll().catch((error) => {
    libraries = null;
    throw error;
  });
  return libraries;
}

export function createCharacter(library: string): MovieClip {
  const namespace = globalThis.Library?.[library];
  const constructor = namespace?.[library];
  if (!constructor) throw new Error(`Missing game library ${library}`);
  return new constructor();
}
