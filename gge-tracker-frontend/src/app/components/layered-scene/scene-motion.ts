import { DisplayObject } from './scene-libraries';

export const TAU = Math.PI * 2;

export function swell(seconds: number, period: number): number {
  // Rises from 0 at the first frame, so every motion starts exactly as the poster shows it
  return 0.5 - 0.5 * Math.cos((seconds * TAU) / period);
}

function oscillate(seconds: number, period: number): number {
  return Math.sin((seconds * TAU) / period);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export type Cues = Readonly<Record<string, number>>;

export type Season = 'harvest' | 'winter' | null;

export function season(date = new Date()): Season {
  const day = (date.getMonth() + 1) * 100 + date.getDate();
  if (day >= 1024 && day <= 1102) return 'harvest';
  if (day >= 1215 || day <= 106) return 'winter';
  return null;
}

export function cycleStart(seconds: number, first: number, every: number, cued = -Infinity): number {
  const anchor = cued === -Infinity ? first : cued;
  return seconds < anchor ? -Infinity : anchor + Math.floor((seconds - anchor) / every) * every;
}

const CLOUD_FIRST_AT = 9;
const CLOUD_EVERY = 31;
const CLOUD_LENGTH = 9;

export function moonlight(seconds: number): number {
  if (seconds < CLOUD_FIRST_AT) return 1;
  const into = (seconds - CLOUD_FIRST_AT) % CLOUD_EVERY;
  const shade = smoothstep(0, 3, into) * (1 - smoothstep(CLOUD_LENGTH - 3.5, CLOUD_LENGTH, into));
  return 1 - 0.5 * shade;
}

export interface Drift {
  zoom: number;
  panX: number;
  panY: number;
}

export function cameraDrift(seconds: number): Drift {
  return {
    zoom: 1 + 0.02 * swell(seconds, 38),
    panX: 7 * oscillate(seconds, 53),
    panY: -4 * swell(seconds, 41),
  };
}

type Motion = (node: DisplayObject, seconds: number, cues: Cues) => void;

function breathe(depth: number, period: number, sway = 0, swayPeriod = 1): Motion {
  return (node, seconds) => {
    node.scaleY = 1 + depth * swell(seconds, period);
    node.rotation = sway * oscillate(seconds, swayPeriod);
  };
}

function wave(node: DisplayObject, seconds: number): void {
  node.skewX = 1.8 * oscillate(seconds, 3.3) + 0.7 * oscillate(seconds, 1.45);
  node.scaleX = 1 + 0.015 * swell(seconds, 2.2);
}

type Point = readonly [number, number];

const RAVEN = { first: 7, every: 47, length: 7.5 };
const RAVEN_PATH: readonly Point[] = [
  [0, 0],
  [-50, -180],
  [-220, -260],
  [-610, -390],
];

function bezier(points: readonly Point[], t: number): { x: number; y: number } {
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: points.reduce((sum, [x], index) => sum + x * weights[index], 0),
    y: points.reduce((sum, [, y], index) => sum + y * weights[index], 0),
  };
}

function ravenAge(seconds: number, cues: Cues): number {
  return seconds - cycleStart(seconds, RAVEN.first, RAVEN.every, cues['raven']);
}

function ravenFlight(wingsDown: boolean): Motion {
  return (node, seconds, cues) => {
    const age = ravenAge(seconds, cues);
    if (!(age >= 0 && age <= RAVEN.length)) {
      node.alpha = 0;
      return;
    }
    const progress = Math.pow(age / RAVEN.length, 1.25);
    const at = bezier(RAVEN_PATH, progress);
    const ahead = bezier(RAVEN_PATH, Math.min(1, progress + 0.02));
    node.x += at.x;
    node.y += at.y;
    node.scaleX = node.scaleY = 1 - 0.62 * progress;
    const climb = (Math.atan2(at.y - ahead.y, at.x - ahead.x) * 180) / Math.PI;
    node.rotation = 0.6 * Math.max(-30, Math.min(30, climb));
    const flapping = age < 2.6 || (age > 3.6 && age < 4.6);
    const down = flapping && Math.sin(age * TAU * 3) > 0;
    node.alpha = down === wingsDown ? Math.min(1, age / 0.25, (RAVEN.length - age) / 0.6) : 0;
  };
}

function drift(distance: number, period: number): Motion {
  return (node, seconds) => (node.x += distance * oscillate(seconds, period));
}

const OBJECT_MOTIONS: Record<string, Motion> = {
  chandelier: (node, seconds) => (node.rotation = 0.35 * oscillate(seconds, 6.3)),
  king: breathe(0.01, 3.8, 0.45, 7.1),
  scout: breathe(0.008, 3.2, 0.35, 5.3),
  scribe: breathe(0.006, 4.4),
  'scout-figure': breathe(0.008, 3.4, 0.25, 6.5),
  'cartographer-figure': breathe(0.007, 4.1, 0.3, 6.9),
  wanderer: breathe(0.008, 3.6, 0.3, 6.1),
  'cloud-1': drift(60, 71),
  'cloud-2': drift(-45, 59),
  'cloud-3': drift(35, 83),
  'fog-1': drift(70, 67),
  'fog-2': drift(-55, 79),
  'standard-cloth': wave,
  'raven-glide': ravenFlight(false),
  'raven-beat': ravenFlight(true),
};

const CUE_COOLDOWN = 2.5;

export function acceptsCue(name: string, seconds: number, cues: Cues): boolean {
  if (name === 'raven') return !(ravenAge(seconds, cues) <= RAVEN.length);
  return !(seconds - (cues[name] ?? -Infinity) < CUE_COOLDOWN);
}

export function pivotOf(id: string, width: number, height: number): { x: number; y: number } {
  if (id === 'chandelier' || id === 'standard-cloth') return { x: width / 2, y: 0 };
  if (id.startsWith('raven')) return { x: width / 2, y: height / 2 };
  return { x: width / 2, y: height };
}

export function animateObject(id: string, node: DisplayObject, seconds: number, cues: Cues): void {
  OBJECT_MOTIONS[id]?.(node, seconds, cues);
}

export function flicker(node: DisplayObject, seconds: number, seed: number, scale: number, alpha: number): void {
  const fast = Math.sin(seconds * 11.3 + seed);
  const faster = Math.sin(seconds * 17.9 + seed * 1.7);
  const slow = Math.sin(seconds * 5.1 + seed * 0.3);
  node.scaleY = scale * (1 + 0.1 * fast * faster + 0.06 * slow);
  node.scaleX = scale * (1 - 0.05 * faster);
  node.rotation = 3 * Math.sin(seconds * 3.7 + seed);
  node.alpha = alpha * (0.85 + 0.075 * (1 + fast));
}

export function lightAlpha(id: string, seconds: number, tempo: number): number {
  if (id.startsWith('fireglow')) {
    return 1 - 0.18 * swell(seconds, 0.7 * tempo) - 0.1 * swell(seconds, 0.37) - 0.06 * swell(seconds, 0.21);
  }
  if (id.startsWith('windowglow')) {
    return 1 - 0.25 * swell(seconds, 2.3 * tempo) - 0.15 * swell(seconds, 1.1 * tempo);
  }
  if (id === 'moonglow-harvest') return season() === 'harvest' ? 1 - 0.2 * swell(seconds, 11) : 0;
  if (id === 'moonglow') return 1 - 0.15 * swell(seconds, 11);
  if (id.startsWith('motes')) return 1;
  if (id.startsWith('candleglow')) {
    return 1 - 0.12 * swell(seconds, 0.86 * tempo) - 0.08 * swell(seconds, 0.48 * tempo) - 0.04 * swell(seconds, 0.27);
  }
  return (1 - 0.25 * swell(seconds, 9 * tempo)) * moonlight(seconds);
}

export function hostsMotes(id: string): boolean {
  return id === 'moonbeam' || id.startsWith('motes');
}
