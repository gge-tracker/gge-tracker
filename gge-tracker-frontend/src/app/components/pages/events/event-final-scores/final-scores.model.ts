import { ApiOuterRealmEvent, ApiOuterRealmPlayer } from '@ggetracker-interfaces/empire-ranking';

export interface PodiumPlace {
  player: ApiOuterRealmPlayer;
  points: number;
  gapToWinner: number;
}

export interface LadderRung {
  label: string;
  rank: number;
  points: number;
  share: number;
  changePercent: number | null;
  isMine: boolean;
}

export interface ServerRow {
  server: string;
  players: number;
  top100: number;
  top1000: number;
  average: number;
  median: number;
  top100Share: number;
}

export interface LevelBand {
  label: string;
  players: number;
  average: number;
  playerShare: number;
  averageShare: number;
}

export interface MyResult {
  playerId: string;
  playerName: string;
  server: string;
  rank: number;
  points: number;
  topPercent: number;
  nextTier: { label: string; missing: number } | null;
}

const TIERS: { key: keyof ApiOuterRealmEvent['top_scores']; rank: number; label: string }[] = [
  { key: 'top_1', rank: 1, label: '1er' },
  { key: 'top_2', rank: 2, label: '2ème' },
  { key: 'top_3', rank: 3, label: '3ème' },
  { key: 'top_100', rank: 100, label: 'Top 100' },
  { key: 'top_1000', rank: 1000, label: 'Top 1k' },
  { key: 'top_10000', rank: 10_000, label: 'Top 10k' },
];

const LEVEL_BANDS: [number, number][] = [
  [0, 11],
  [12, 13],
  [14, 15],
  [16, 17],
  [18, 20],
  [21, 30],
  [31, 50],
  [51, 69],
  [70, 70],
];

export function tierPoints(
  event: ApiOuterRealmEvent,
  participants: number,
): { rank: number; label: string; points: number }[] {
  return TIERS.map((tier) => ({
    rank: tier.rank,
    label: tier.label,
    points: Number(event.top_scores[tier.key]),
  })).filter((tier) => tier.points > 0 && tier.rank <= participants);
}

export function buildLadder(
  event: ApiOuterRealmEvent,
  previous: ApiOuterRealmEvent | null,
  participants: number,
  mine: MyResult | null,
): LadderRung[] {
  const max = Number(event.score_stats.max_score) || 1;
  const previousTiers = new Map(
    previous ? tierPoints(previous, Number.MAX_SAFE_INTEGER).map((tier) => [tier.rank, tier.points]) : [],
  );
  const rungs: LadderRung[] = tierPoints(event, participants).map((tier) => {
    const before = previousTiers.get(tier.rank);
    return {
      label: tier.label,
      rank: tier.rank,
      points: tier.points,
      share: (tier.points / max) * 100,
      changePercent: before ? ((tier.points - before) / before) * 100 : null,
      isMine: false,
    };
  });
  if (mine && !rungs.some((rung) => rung.rank === mine.rank)) {
    rungs.push({
      label: 'home.you',
      rank: mine.rank,
      points: mine.points,
      share: (mine.points / max) * 100,
      changePercent: null,
      isMine: true,
    });
    rungs.sort((a, b) => a.rank - b.rank);
  }
  return rungs;
}

export function buildServerRows(event: ApiOuterRealmEvent): ServerRow[] {
  const distribution = new Map(event.rank_distribution.map((row) => [row.server, row]));
  const rows = event.server_avg_score.map((row) => {
    const ranks = distribution.get(row.server);
    return {
      server: row.server,
      players: Number(row.nb_players),
      top100: Number(ranks?.top_100 ?? 0),
      top1000: Number(ranks?.top_100 ?? 0) + Number(ranks?.top_1000 ?? 0),
      average: Number(row.avg_score),
      median: Number(row.median_score),
      top100Share: 0,
    };
  });
  const mostTop100 = Math.max(1, ...rows.map((row) => row.top100));
  for (const row of rows) row.top100Share = (row.top100 / mostTop100) * 100;
  return rows.sort((a, b) => b.top100 - a.top100 || b.top1000 - a.top1000 || b.average - a.average);
}

export function buildLevelBands(event: ApiOuterRealmEvent): LevelBand[] {
  const bands = LEVEL_BANDS.map(([from, to]) => {
    const levels = event.level_distribution.filter((row) => row.level >= from && row.level <= to);
    const players = levels.reduce((sum, row) => sum + Number(row.nb_players), 0);
    const points = levels.reduce((sum, row) => sum + Number(row.avg_score) * Number(row.nb_players), 0);
    const lowest = Math.min(...levels.map((row) => row.level));
    const highest = Math.max(...levels.map((row) => row.level));
    return {
      label: lowest === highest ? `${lowest}` : `${lowest}–${highest}`,
      players,
      average: players ? points / players : 0,
    };
  }).filter((band) => band.players > 0);
  if (bands.length < 2) return [];
  const mostPlayers = Math.max(...bands.map((band) => band.players));
  const bestAverage = Math.max(...bands.map((band) => band.average));
  return bands.map((band) => ({
    ...band,
    playerShare: (band.players / mostPlayers) * 100,
    averageShare: (band.average / bestAverage) * 100,
  }));
}

export function nextTierFor(
  rank: number,
  points: number,
  event: ApiOuterRealmEvent,
  participants: number,
): MyResult['nextTier'] {
  const above = tierPoints(event, participants)
    .filter((tier) => tier.rank < rank)
    .sort((a, b) => b.rank - a.rank)[0];
  return above ? { label: above.label, missing: Math.max(1, above.points - points + 1) } : null;
}
