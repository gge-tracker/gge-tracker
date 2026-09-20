import { ApiAllianceProfile, ApiPlayerProfile } from '@ggetracker-interfaces/empire-ranking';

export type CompareSide = 0 | 1;
export type CompareFormat = 'number' | 'plain';

export interface CompareMetricDefinition<T> {
  label: string;
  icon: string;
  format: CompareFormat;
  read: (subject: T) => number | null;
  readRank?: (subject: T) => number | null;
}

export interface CompareMetricRow {
  label: string;
  icon: string;
  format: CompareFormat;
  values: [number | null, number | null];
  ranks: [number | null, number | null];
  winner: CompareSide | null;
  shareA: number | null;
  difference: number | null;
  percent: number | null;
}

export interface CompareScore {
  wins: [number, number];
  ties: number;
  total: number;
}

export const PLAYER_METRICS: CompareMetricDefinition<ApiPlayerProfile>[] = [
  {
    label: 'Puissance',
    icon: '/assets/pp3.png',
    format: 'number',
    read: (p) => p.player.might_current,
    readRank: (p) => p.rank?.might_current ?? null,
  },
  { label: 'Puissance max', icon: '/assets/pp1.png', format: 'number', read: (p) => p.player.might_all_time },
  {
    label: 'Pillage hebdomadaire',
    icon: '/assets/loot.png',
    format: 'number',
    read: (p) => p.player.loot_current,
    readRank: (p) => p.rank?.loot_current ?? null,
  },
  { label: 'Pillage max.', icon: '/assets/loot2.png', format: 'number', read: (p) => p.player.loot_all_time },
  {
    label: 'Points de gloire',
    icon: '/assets/glory.png',
    format: 'number',
    read: (p) => p.player.current_fame,
    readRank: (p) => p.rank?.current_fame ?? null,
  },
  { label: 'Gloire max.', icon: '/assets/glory.png', format: 'number', read: (p) => p.player.highest_fame },
  {
    label: 'Honneur',
    icon: '/assets/honor2.png',
    format: 'plain',
    read: (p) => p.player.honor,
    readRank: (p) => p.rank?.honor ?? null,
  },
];

export const ALLIANCE_METRICS: CompareMetricDefinition<ApiAllianceProfile>[] = [
  {
    label: 'Puissance cumulée',
    icon: '/assets/pp3.png',
    format: 'number',
    read: (a) => a.statistics.might_current,
    readRank: (a) => a.rank?.might_current ?? null,
  },
  {
    label: 'Puissance moyenne',
    icon: '/assets/pp1.png',
    format: 'number',
    read: (a) =>
      a.statistics.player_count > 0 ? Math.round(a.statistics.might_current / a.statistics.player_count) : null,
  },
  { label: 'Membres', icon: '/assets/members.png', format: 'plain', read: (a) => a.statistics.player_count },
  {
    label: 'Nombre de joueurs actifs',
    icon: '/assets/member-list-activity.png',
    format: 'plain',
    read: (a) => a.statistics.active_player_count,
  },
  {
    label: 'Pillage hebdo cumulé',
    icon: '/assets/loot.png',
    format: 'number',
    read: (a) => a.statistics.loot_current,
    readRank: (a) => a.rank?.loot_current ?? null,
  },
  {
    label: 'Gloire cumulée',
    icon: '/assets/glory.png',
    format: 'number',
    read: (a) => a.statistics.current_fame,
    readRank: (a) => a.rank?.current_fame ?? null,
  },
];

export function buildMetricRows<T>(definitions: CompareMetricDefinition<T>[], a: T, b: T): CompareMetricRow[] {
  return definitions.map((definition) => compareValues(definition, a, b));
}

export function scoreRows(rows: CompareMetricRow[]): CompareScore {
  const wins: [number, number] = [0, 0];
  let ties = 0;
  let total = 0;
  for (const row of rows) {
    if (row.values[0] === null || row.values[1] === null) continue;
    total++;
    if (row.winner === null) ties++;
    else wins[row.winner]++;
  }
  return { wins, ties, total };
}

function compareValues<T>(definition: CompareMetricDefinition<T>, subjectA: T, subjectB: T): CompareMetricRow {
  const a = definition.read(subjectA);
  const b = definition.read(subjectB);
  const row: CompareMetricRow = {
    label: definition.label,
    icon: definition.icon,
    format: definition.format,
    values: [a, b],
    ranks: [definition.readRank?.(subjectA) ?? null, definition.readRank?.(subjectB) ?? null],
    winner: null,
    shareA: null,
    difference: null,
    percent: null,
  };
  if (a === null || b === null) return row;
  if (a + b > 0) row.shareA = a / (a + b);
  if (a === b) return row;

  const aIsBetter = a > b;
  const worst = aIsBetter ? b : a;
  row.winner = aIsBetter ? 0 : 1;
  row.difference = Math.abs(a - b);
  if (worst > 0) {
    row.percent = Math.round(((Math.max(a, b) - worst) / worst) * 100);
  }
  return row;
}
