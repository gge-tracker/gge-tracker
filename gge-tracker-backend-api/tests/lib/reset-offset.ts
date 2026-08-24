/**
 * Re-measures a server's weekly loot reset from its own point stream
 *
 * serverResetOffset is an observation, not a derivation: the reset falls on
 * Monday 00:00 UTC + (offset - 1) hours and follows no timezone, so the only thing that can
 * confirm a value is the data it was read off in the first place
 */

export const HOURS_PER_WEEK = 168;
const MS_PER_HOUR = 3_600_000;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const CLUSTER_GAP_HOURS = 6;
const CLUSTER_SHARE = 0.1;

export interface ResetOffsetOptions {
  windowDays: number;
  minPeak: number;
  maxPeak: number;
  minGapHours: number;
}

export const defaultOptions: ResetOffsetOptions = {
  windowDays: 60,
  minPeak: 1_000_000,
  maxPeak: 300_000_000,
  minGapHours: 4,
};

export function offsetOfResetInstant(instant: Date): number {
  const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
  const offset = daysSinceMonday * 24 + instant.getUTCHours() + 1;
  return offset > HOURS_PER_WEEK / 2 ? offset - HOURS_PER_WEEK : offset;
}

export function describeOffset(offset: number): string {
  const hourOfWeek = (((offset - 1) % HOURS_PER_WEEK) + HOURS_PER_WEEK) % HOURS_PER_WEEK;
  return `${DAYS[Math.floor(hourOfWeek / 24)]} ${String(hourOfWeek % 24).padStart(2, '0')}:00 UTC`;
}

export function buildResetQuery(database: string, options: ResetOffsetOptions = defaultOptions): string {
  return `
WITH
    (SELECT max(created_at) FROM \`${database}\`.player_loot_history) AS latest,
    latest - INTERVAL ${options.windowDays} DAY AS since
SELECT
    formatDateTime(toStartOfHour(gap.1) + INTERVAL 1 HOUR, '%F %H') AS reset_hour,
    count() AS gaps,
    uniqExact(gap.2) AS players
FROM
(
    SELECT arrayJoin(
        arrayFilter(g -> g.3 >= ${options.minGapHours * 3600},
            arrayMap((a, b) -> (a, player_id, toInt64(b) - toInt64(a)),
                arraySlice(stream, 1, length(stream) - 1),
                arraySlice(stream, 2)))) AS gap
    FROM
    (
        SELECT player_id, arraySort(groupArray(created_at)) AS stream, max(point) AS peak
        FROM \`${database}\`.player_loot_history
        WHERE created_at >= since
        GROUP BY player_id
        HAVING (peak >= ${options.minPeak}) AND (peak <= ${options.maxPeak})
    )
)
GROUP BY reset_hour
ORDER BY gaps DESC`.trim();
}

export interface Measurement {
  offset: number;
  gaps: number;
  totalGaps: number;
  playerWeeks: number;
  agreement: number;
  weeks: number;
  blurred: number;
  instants: string[];
  runnerUp?: { offset: number; gaps: number };
}

interface Bucket {
  hour: string;
  instant: Date;
  gaps: number;
  players: number;
}

interface ResetEvent {
  hour: string;
  offset: number;
  gaps: number;
  players: number;
  blurred: boolean;
}

function resetEvents(buckets: Bucket[]): ResetEvent[] {
  const clusters: Bucket[][] = [];
  for (const bucket of buckets) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (current && previous && bucket.instant.getTime() - previous.instant.getTime() <= CLUSTER_GAP_HOURS * MS_PER_HOUR) {
      current.push(bucket);
    } else {
      clusters.push([bucket]);
    }
  }
  return clusters.map((cluster) => {
    const gaps = cluster.reduce((total, bucket) => total + bucket.gaps, 0);
    const weighty = cluster.filter((bucket) => bucket.gaps >= gaps * CLUSTER_SHARE);
    const reset = weighty.at(-1) as Bucket;
    return {
      hour: reset.hour,
      offset: offsetOfResetInstant(reset.instant),
      gaps,
      players: cluster.reduce((total, bucket) => total + bucket.players, 0),
      blurred: weighty.length > 1,
    };
  });
}

export function measure(rows: string[][]): Measurement | null {
  const buckets: Bucket[] = [];
  for (const [hour, gaps, players] of rows) {
    const instant = new Date(`${hour.replace(' ', 'T')}:00:00Z`);
    if (!Number.isNaN(instant.getTime())) buckets.push({ hour, instant, gaps: Number(gaps), players: Number(players) });
  }
  if (buckets.length === 0) return null;
  buckets.sort((a, b) => a.instant.getTime() - b.instant.getTime());

  const byOffset = new Map<number, { gaps: number; players: number; blurred: number; hours: string[] }>();
  let totalGaps = 0;
  for (const event of resetEvents(buckets)) {
    const bucket = byOffset.get(event.offset) ?? { gaps: 0, players: 0, blurred: 0, hours: [] };
    bucket.gaps += event.gaps;
    bucket.players += event.players;
    bucket.blurred += event.blurred ? 1 : 0;
    bucket.hours.push(event.hour);
    byOffset.set(event.offset, bucket);
    totalGaps += event.gaps;
  }
  if (totalGaps === 0) return null;

  const ranked = [...byOffset.entries()].sort((a, b) => b[1].gaps - a[1].gaps);
  const [offset, winner] = ranked[0];
  return {
    offset,
    gaps: winner.gaps,
    totalGaps,
    playerWeeks: winner.players,
    agreement: winner.gaps / totalGaps,
    weeks: winner.hours.length,
    blurred: winner.blurred,
    instants: winner.hours,
    runnerUp: ranked[1] ? { offset: ranked[1][0], gaps: ranked[1][1].gaps } : undefined,
  };
}
