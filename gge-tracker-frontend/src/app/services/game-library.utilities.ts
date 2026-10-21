import { ApiRestService } from '@ggetracker-services/api-rest.service';

export interface DisplayObject {
  x: number;
  y: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  regX: number;
  regY: number;
  visible: boolean;
  compositeOperation: GlobalCompositeOperation | null;
  shadow: unknown;
  cursor: string | null;
  mouseEnabled: boolean;
  parent: Container | null;
  name: string | null;
  getBounds(): { x: number; y: number; width: number; height: number } | null;
  localToLocal(x: number, y: number, target: DisplayObject): { x: number; y: number };
}

export interface Container extends DisplayObject {
  children: DisplayObject[];
  addChild(child: DisplayObject): void;
  removeAllChildren(): void;
  getChildByName(name: string): DisplayObject | null;
  getObjectUnderPoint(x: number, y: number, mode: number): DisplayObject | null;
  cache(x: number, y: number, width: number, height: number, scale?: number): void;
  uncache(): void;
}

export interface MovieClip extends Container {
  framerate: number | null;
  totalFrames: number;
  gotoAndPlay(frame: number): void;
  gotoAndStop(frame: number): void;
  stop(): void;
}

export interface Stage extends Container {
  update(properties?: { delta: number }): void;
  clear(): void;
  autoClear: boolean;
  tickOnUpdate: boolean;
}

export interface Graphics {
  clear(): Graphics;
  beginFill(color: string): Graphics;
  beginBitmapFill(image: HTMLImageElement | HTMLCanvasElement, repetition?: string): Graphics;
  beginStroke(color: string): Graphics;
  setStrokeStyle(thickness: number): Graphics;
  moveTo(x: number, y: number): Graphics;
  lineTo(x: number, y: number): Graphics;
  drawRect(x: number, y: number, width: number, height: number): Graphics;
  closePath(): Graphics;
  endFill(): Graphics;
  endStroke(): Graphics;
}

export interface Shape extends DisplayObject {
  graphics: Graphics;
}

export interface Text extends DisplayObject {
  text: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  outline: number;
  lineWidth: number | null;
  getMeasuredHeight(): number;
}

export interface Bitmap extends DisplayObject {
  sourceRect: unknown;
  image: HTMLImageElement | HTMLCanvasElement;
}

export interface CreateJs {
  Stage: new (canvas: HTMLCanvasElement) => Stage;
  Container: new () => Container;
  Bitmap: new (image: HTMLImageElement | HTMLCanvasElement) => Bitmap;
  Shape: new () => Shape;
  Text: new (text: string, font: string, color: string) => Text;
  Rectangle: new (x: number, y: number, width: number, height: number) => unknown;
  Shadow: new (color: string, offsetX: number, offsetY: number, blur: number) => unknown;
  SpriteSheet: new (data: unknown) => unknown;
  Ticker: {
    framerate: number;
    addEventListener(type: 'tick', listener: (event: { delta: number }) => void): unknown;
    removeEventListener(type: 'tick', listener: (event: { delta: number }) => void): void;
  };
}

type SymbolConstructor = new () => MovieClip;

declare global {
  var createjs: CreateJs | undefined;
  var Library: Record<string, Record<string, SymbolConstructor>> | undefined;
  var AssetLoader: { getResult(id: string): unknown } | undefined;
}

const LIBRARY_NAME_PATTERN = /\b(\w+)\.(\w+)\|\|\(\1\.\2={}\)/;

const scripts = new Map<string, Promise<void>>();
const sheets = new Map<string, unknown>();
const libraries = new Map<string, Promise<string>>();
let runtime: Promise<CreateJs> | null = null;

export function loadImage(source: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
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

export function loadCreateJs(): Promise<CreateJs> {
  runtime ??= (async (): Promise<CreateJs> => {
    await loadScript('/assets/vendor/createjs/easeljs-1.0.0.min.js');
    await loadScript('/assets/vendor/createjs/tweenjs-1.0.0.min.js');
    globalThis.AssetLoader ??= { getResult: (id: string): unknown => sheets.get(id) };
    return globalThis.createjs!;
  })().catch((error) => {
    runtime = null;
    throw error;
  });
  return runtime;
}

export function gameAssetUrl(file: string, extension: 'js' | 'json' | 'webp'): string {
  return `${ApiRestService.apiUrl}assets/common/${file}.${extension}`;
}

async function fetchLibrary(file: string): Promise<string> {
  const createjs = await loadCreateJs();
  const source = await fetch(gameAssetUrl(file, 'js')).then((response) => {
    if (!response.ok) throw new Error(`Missing game library ${file}`);
    return response.text();
  });
  const name = LIBRARY_NAME_PATTERN.exec(source)?.[2];
  if (!name) throw new Error(`Unnamed game library ${file}`);
  if (!sheets.has(name)) {
    const [data, image] = await Promise.all([
      fetch(gameAssetUrl(file, 'json')).then((response) => response.json()),
      loadImage(gameAssetUrl(file, 'webp'), true),
    ]);
    sheets.set(name, new createjs.SpriteSheet({ ...data, images: [image] }));
  }
  if (!globalThis.Library?.[name]) {
    const element = document.createElement('script');
    element.text = source;
    document.head.append(element);
    element.remove();
  }
  return name;
}

export function loadGameLibrary(file: string): Promise<string> {
  const known = libraries.get(file);
  if (known) return known;
  const loading = fetchLibrary(file);
  libraries.set(file, loading);
  loading.catch(() => libraries.delete(file));
  return loading;
}

export function createGameSymbol(library: string, symbol: string): MovieClip | null {
  const namespace = globalThis.Library?.[library];
  if (!namespace) return null;
  const constructor =
    namespace[symbol] ?? Object.entries(namespace).find(([name]) => name.toLowerCase() === symbol.toLowerCase())?.[1];
  return constructor ? new constructor() : null;
}
