export type RealmMapShape = 'diamond' | 'circle';

export type RealmMapEmphasis = 'solid' | 'faded';

export interface RealmMapPoint {
  id: string;
  x: number;
  y: number;
  shape: RealmMapShape;
  color: string;
  emphasis: RealmMapEmphasis;
  radius: number;
  highlighted: boolean;
  title: string;
  subtitle: string;
}

export interface RealmMapExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface RealmMapOrigin {
  x: number;
  y: number;
  label: string;
}

export interface RealmMapLegendItem {
  key: string;
  label: string;
  color: string;
  shape: RealmMapShape;
  emphasis: RealmMapEmphasis;
  count: number;
  hidden: boolean;
}

export interface RealmMapLegendGroup {
  key: string;
  label: string;
  icon: string;
  count: number;
  hidden: boolean;
  items: RealmMapLegendItem[];
}

export interface RealmMapNearest {
  id: string;
  x: number;
  y: number;
  label: string;
  icon: string;
  distance: number;
  color: string;
  shape: RealmMapShape;
}

export interface RealmMapColorMode {
  value: string;
  label: string;
}

export type RealmMapLocateRequest = { kind: 'player'; name: string } | { kind: 'coords'; x: number; y: number };

export const REALM_MAP_STATE_COLORS = {
  ready: '#4ade80',
  soon: '#fbbf24',
  cooldown: '#94a3b8',
  held: '#38bdf8',
  spent: '#64748b',
} as const;

export const REALM_MAP_HIGHLIGHT_COLOR = '#f472b6';

export const REALM_WORLD_EXTENT: RealmMapExtent = { minX: 0, maxX: 1286, minY: 0, maxY: 1286 };
