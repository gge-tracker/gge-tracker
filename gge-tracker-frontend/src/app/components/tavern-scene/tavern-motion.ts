import { DisplayObject } from './tavern-libraries';

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

export function sunlight(seconds: number): number {
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

const SILHOUETTE_CYCLE = 27;
const SILHOUETTE_LEAVES_AT = 15;

function silhouette(node: DisplayObject, seconds: number): void {
  const into = seconds % SILHOUETTE_CYCLE;
  const away =
    smoothstep(SILHOUETTE_LEAVES_AT, SILHOUETTE_LEAVES_AT + 2.4, into) *
    (1 - smoothstep(SILHOUETTE_LEAVES_AT + 7, SILHOUETTE_LEAVES_AT + 9.4, into));
  node.rotation = 0.9 * oscillate(seconds, 4.3);
  node.scaleX = node.scaleY = 1 - 0.14 * away;
  node.alpha = 1 - away;
}

const OBJECT_MOTIONS: Record<string, (node: DisplayObject, seconds: number) => void> = {
  'chandelier-1': (node, seconds) => (node.rotation = 0.8 * oscillate(seconds, 5.3)),
  'chandelier-2': (node, seconds) => (node.rotation = -0.7 * oscillate(seconds, 6.1)),
  'soldier-1': (node, seconds) => (node.scaleY = 1 + 0.009 * swell(seconds, 3.7)),
  silhouette,
};

export function pivotOf(id: string, width: number, height: number): { x: number; y: number } {
  // Chandeliers hang from the top edge, people stand on their feet
  return id.startsWith('chandelier') ? { x: width / 2, y: 0 } : { x: width / 2, y: height };
}

export function animateObject(id: string, node: DisplayObject, seconds: number): void {
  OBJECT_MOTIONS[id]?.(node, seconds);
}

export function lightAlpha(id: string, seconds: number, tempo: number): number {
  if (id.startsWith('candlelight') || id === 'lightbeams-chandleliers') {
    return 1 - 0.12 * swell(seconds, 0.86 * tempo) - 0.08 * swell(seconds, 0.48 * tempo) - 0.04 * swell(seconds, 0.27);
  }
  return (1 - 0.25 * swell(seconds, 7 * tempo)) * sunlight(seconds);
}

export function lightOffset(id: string, seconds: number): { x: number; y: number } {
  if (id !== 'dust' && id !== 'particles') return { x: 0, y: 0 };
  const period = id === 'dust' ? 13 : 17;
  return { x: 8 * oscillate(seconds, period), y: -12 * swell(seconds, period * 1.3) };
}
