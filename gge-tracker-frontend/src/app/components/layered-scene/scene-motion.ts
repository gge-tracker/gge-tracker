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

function breathe(
  depth: number,
  period: number,
  sway = 0,
  swayPeriod = 1,
): (node: DisplayObject, seconds: number) => void {
  return (node, seconds) => {
    node.scaleY = 1 + depth * swell(seconds, period);
    node.rotation = sway * oscillate(seconds, swayPeriod);
  };
}

function drift(distance: number, period: number): (node: DisplayObject, seconds: number) => void {
  return (node, seconds) => (node.x += distance * oscillate(seconds, period));
}

const OBJECT_MOTIONS: Record<string, (node: DisplayObject, seconds: number) => void> = {
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
};

export function pivotOf(id: string, width: number, height: number): { x: number; y: number } {
  // The chandelier hangs from the top edge, people stand on their feet
  return id === 'chandelier' ? { x: width / 2, y: 0 } : { x: width / 2, y: height };
}

export function animateObject(id: string, node: DisplayObject, seconds: number): void {
  OBJECT_MOTIONS[id]?.(node, seconds);
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
