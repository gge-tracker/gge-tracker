import { ApiServerStats } from '@ggetracker-interfaces/empire-ranking';
import { formatThousands } from '@ggetracker-services/text-format.utilities';

export type MetricKind = 'value' | 'level' | 'hourly-count' | 'percent';
export type ChangeDirection = 'up' | 'down' | 'flat';

export interface StatPoint {
  at: number;
  value: number | null;
}

export interface MetricChange {
  text: string;
  direction: ChangeDirection;
}

export interface Sparkline {
  path: string;
  lastX: number;
  lastY: number;
}

export interface StatMetric {
  key: string;
  label: string;
  logo: string;
  kind: MetricKind;
  series: StatPoint[];
  value: string;
  fullValue: string;
  hour: MetricChange;
  day: MetricChange;
  week: MetricChange;
  sparkline: Sparkline | null;
  format: (value: number) => string;
}

export interface StatGroup {
  title: string;
  metrics: StatMetric[];
}

type NumericStat = {
  [K in keyof ApiServerStats]-?: ApiServerStats[K] extends number | null | undefined ? K : never;
}[keyof ApiServerStats];

interface StatDefinition {
  identifier: NumericStat;
  label: string;
  logo: string;
  kind?: MetricKind;
}

interface EventDefinition {
  eventId: number;
  points: NumericStat;
  pointsLabel: string;
  rateLabel: string;
  logo: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SAMPLE_TOLERANCE_MS = 10 * 60 * 1000;

export const KEY_METRICS = ['players_count', 'players_in_peace', 'alliance_count', 'avg_might', 'total_loot'];

const GROUPS: { title: string; stats: StatDefinition[] }[] = [
  {
    title: 'Joueurs',
    stats: [
      { identifier: 'players_count', label: 'Nombre de joueurs', logo: 'assets/players.png' },
      { identifier: 'players_in_peace', label: 'En protection', logo: 'assets/players.png' },
      { identifier: 'avg_level', label: 'Niveau moyen', logo: 'assets/xp2.png', kind: 'level' },
      {
        identifier: 'players_who_changed_alliance',
        label: "Nombre de joueurs ayant changé d'alliance",
        logo: 'assets/players.png',
        kind: 'hourly-count',
      },
      {
        identifier: 'players_who_changed_name',
        label: 'Nombre de joueurs ayant changé de pseudonyme',
        logo: 'assets/players.png',
        kind: 'hourly-count',
      },
    ],
  },
  {
    title: 'Puissance',
    stats: [
      { identifier: 'avg_might', label: 'Puissance moyenne', logo: 'assets/pp3.png' },
      { identifier: 'max_might', label: 'Puissance maximale', logo: 'assets/pp3.png' },
      { identifier: 'total_might', label: 'Puissance cumulée', logo: 'assets/pp3.png' },
    ],
  },
  {
    title: 'Pillage hebdomadaire',
    stats: [
      { identifier: 'avg_loot', label: 'Pillage hebdo moyen', logo: 'assets/loot4.png' },
      { identifier: 'max_loot', label: 'Pillage hebdo maximal', logo: 'assets/loot4.png' },
      { identifier: 'total_loot', label: 'Pillage hebdo cumulé', logo: 'assets/loot4.png' },
    ],
  },
  {
    title: 'Honneur',
    stats: [
      { identifier: 'avg_honor', label: 'Honneur moyen', logo: 'assets/honor2.png' },
      { identifier: 'total_honor', label: 'Honneur cumulé', logo: 'assets/honor2.png' },
    ],
  },
];

const ALLIANCE_GROUP: { title: string; stats: StatDefinition[] } = {
  title: 'Alliances',
  stats: [
    { identifier: 'alliance_count', label: "Nombre d'alliances", logo: 'assets/alliance2.png' },
    {
      identifier: 'alliances_changed_name',
      label: 'Alliances ayant changé de nom',
      logo: 'assets/alliance2.png',
      kind: 'hourly-count',
    },
  ],
};

const EVENTS: EventDefinition[] = [
  {
    eventId: 46,
    points: 'event_nomad_points',
    pointsLabel: 'Points nomades cumulés',
    rateLabel: 'Taux de participation aux nomades',
    logo: 'assets/nomads.png',
  },
  {
    eventId: 51,
    points: 'event_samurai_points',
    pointsLabel: 'Points samouraïs cumulés',
    rateLabel: 'Taux de participation aux samouraïs',
    logo: 'assets/samurai.png',
  },
  {
    eventId: 44,
    points: 'event_war_realms_points',
    pointsLabel: 'Points guerre des royaumes cumulés',
    rateLabel: 'Taux de participation aux guerres des royaumes',
    logo: 'assets/war_realms.png',
  },
  {
    eventId: 30,
    points: 'event_berimond_kingdom_points',
    pointsLabel: 'Points royaumes de Berimond cumulés',
    rateLabel: 'Taux de participation aux royaumes de Berimond',
    logo: 'assets/berimond.png',
  },
  {
    eventId: 58,
    points: 'event_bloodcrow_points',
    pointsLabel: 'Points corbeaux de sang cumulés',
    rateLabel: 'Taux de participation aux corbeaux de sang',
    logo: 'assets/bloodcrow.png',
  },
];

export function buildStatGroups(history: ApiServerStats[]): StatGroup[] {
  if (history.length === 0) return [];
  const times = history.map((point) => new Date(point.created_at).getTime());
  const groups = GROUPS.map((group) => statGroup(group, history, times));
  const events = eventMetrics(history, times);
  if (events.length > 0) groups.push({ title: 'Événements', metrics: events });
  groups.push(statGroup(ALLIANCE_GROUP, history, times));
  return groups;
}

export function seriesSince(metric: StatMetric, windowMs: number): StatPoint[] {
  const lastAt = metric.series.at(-1)?.at ?? 0;
  return metric.series.filter((point) => point.at >= lastAt - windowMs - SAMPLE_TOLERANCE_MS);
}

export function formatCompact(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return (value / 1_000_000_000).toFixed(2) + 'B';
  if (absolute >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
  return formatThousands(Math.round(value));
}

export function formatLevel(value: number): string {
  const level = Math.round(value);
  return level > 70 ? `70/${level - 70}` : String(level);
}

function statGroup(
  group: { title: string; stats: StatDefinition[] },
  history: ApiServerStats[],
  times: number[],
): StatGroup {
  return {
    title: group.title,
    metrics: group.stats.map((stat) => {
      const series = history.map((point, index) => ({ at: times[index], value: numberOrNull(point[stat.identifier]) }));
      return metric(stat.identifier, stat.label, stat.logo, stat.kind ?? 'value', series);
    }),
  };
}

function eventMetrics(history: ApiServerStats[], times: number[]): StatMetric[] {
  const last = history.at(-1)!;
  const metrics: StatMetric[] = [];
  for (const event of EVENTS) {
    if (!(String(event.eventId) in last.events_participation_rate) || !last[event.points]) continue;
    const points = currentEdition(
      history.map((point, index) => ({ at: times[index], value: numberOrNull(point[event.points]) })),
    );
    metrics.push(metric(event.points, event.pointsLabel, event.logo, 'value', points));
    const rates = currentEdition(
      history.map((point, index) => ({ at: times[index], value: participationRate(point, event.eventId) })),
    );
    metrics.push(metric(`participation-${event.eventId}`, event.rateLabel, event.logo, 'percent', rates));
  }
  return metrics;
}

function currentEdition(series: StatPoint[]): StatPoint[] {
  for (let index = series.length - 1; index >= 0; index--) {
    if (!series[index].value) return series.slice(index + 1);
  }
  return series;
}

function metric(key: string, label: string, logo: string, kind: MetricKind, series: StatPoint[]): StatMetric {
  const format = formatterOf(kind);
  const current = series.at(-1)?.value ?? null;
  const shown = kind === 'hourly-count' ? sumSince(series, DAY_MS) : current;
  return {
    key,
    label,
    logo,
    kind,
    series,
    format,
    value: shown === null ? '-' : format(shown),
    fullValue: shown === null ? '' : formatThousands(Math.round(shown)),
    hour: change(series, kind, HOUR_MS),
    day: change(series, kind, DAY_MS),
    week: change(series, kind, Number.POSITIVE_INFINITY),
    sparkline: sparkline(series.map((point) => point.value)),
  };
}

function formatterOf(kind: MetricKind): (value: number) => string {
  if (kind === 'percent') return (value) => value.toFixed(2) + '%';
  if (kind === 'hourly-count') return (value) => formatThousands(Math.round(value));
  if (kind === 'level') return formatLevel;
  return formatCompact;
}

function change(series: StatPoint[], kind: MetricKind, windowMs: number): MetricChange {
  if (kind === 'hourly-count') {
    const total = sumSince(series, windowMs === HOUR_MS ? 0 : windowMs);
    return { text: formatThousands(total), direction: total > 0 ? 'up' : 'flat' };
  }
  const last = series.at(-1);
  const reference = referencePoint(series, windowMs);
  if (last?.value === null || last === undefined || !reference || reference.value === null) {
    return { text: '-', direction: 'flat' };
  }
  const delta = last.value - reference.value;
  return { text: formatDelta(delta, kind === 'percent' ? ' pt' : ''), direction: directionOf(delta) };
}

function referencePoint(series: StatPoint[], windowMs: number): StatPoint | undefined {
  const last = series.at(-1);
  if (!last) return undefined;
  const since = last.at - windowMs - SAMPLE_TOLERANCE_MS;
  return series.find((point) => point.at >= since && point.value !== null && point !== last);
}

function sumSince(series: StatPoint[], windowMs: number): number {
  const last = series.at(-1);
  if (!last) return 0;
  return series
    .filter((point) => point.at > last.at - windowMs - SAMPLE_TOLERANCE_MS)
    .reduce((total, point) => total + (point.value ?? 0), 0);
}

function directionOf(delta: number): ChangeDirection {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function participationRate(point: ApiServerStats, eventId: number): number | null {
  const participants = point.events_participation_rate?.[String(eventId)]?.[0];
  if (participants === undefined || !point.players_count) return null;
  return (participants / point.players_count) * 100;
}

function sparkline(values: (number | null)[]): Sparkline | null {
  const known = values.filter((value): value is number => value !== null);
  if (known.length < 2) return null;
  const min = Math.min(...known);
  const range = Math.max(...known) - min;
  const step = 100 / (values.length - 1);
  const yOf = (value: number): number => (range === 0 ? 50 : 90 - ((value - min) / range) * 80);
  let path = '';
  let penUp = true;
  let last = { x: 0, y: 50 };
  values.forEach((value, index) => {
    if (value === null) {
      penUp = true;
      return;
    }
    last = { x: index * step, y: yOf(value) };
    path += `${penUp ? 'M' : 'L'}${last.x.toFixed(2)},${last.y.toFixed(2)}`;
    penUp = false;
  });
  return { path, lastX: last.x, lastY: last.y };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDelta(delta: number, unit: string): string {
  if (delta === 0) return '±0' + unit;
  return (delta > 0 ? '+' : '-') + formatDeltaAmount(Math.abs(delta)) + unit;
}

function formatDeltaAmount(amount: number): string {
  if (amount >= 1_000_000) return formatCompact(amount);
  if (amount < 10 && !Number.isInteger(amount)) return amount.toFixed(2);
  return formatThousands(Math.round(amount));
}
