import { NodeClickHouseClient } from '@clickhouse/client/dist/client';

export const MIGHT_RULE = {
  minimumChange: 2_000_000,
  minimumShareOfMight: 0.03,
  typicalMultiplier: 5,
  baselineDays: 28,
  windowDays: 7,
  maxReadingGapSeconds: 4200,
  boostWindowHours: 48,
  boostResidualShare: 0.05,
} as const;

export interface MightSpike {
  playerId: number;
  occurredAt: string;
  change: number;
  before: number;
  typical: number;
}

export interface MightTrend {
  playerId: number;
  change24h: number;
  change7d: number;
}

export interface MightSignals {
  spikes: MightSpike[];
  trends: Map<number, MightTrend>;
}

export async function readMightSignals(
  client: NodeClickHouseClient,
  database: string,
  playerIds: number[],
): Promise<MightSignals> {
  if (playerIds.length === 0) return { spikes: [], trends: new Map() };
  if (!/^\w+$/.test(database)) throw new Error('Unexpected ClickHouse database name');
  const [spikes, trends] = await Promise.all([
    readRows(client, spikesQuery(database), playerIds),
    readRows(client, trendsQuery(database), playerIds),
  ]);
  return {
    spikes: withoutTemporaryBoosts(
      spikes.map((row) => ({
        playerId: Number(row.player_id),
        occurredAt: new Date(Number(row.at) * 1000).toISOString(),
        change: Number(row.delta),
        before: Number(row.previous),
        typical: Math.round(Number(row.typical)),
      })),
    ),
    trends: new Map(
      trends.map((row) => [
        Number(row.player_id),
        { playerId: Number(row.player_id), change24h: Number(row.change_24h), change7d: Number(row.change_7d) },
      ]),
    ),
  };
}

export function withoutTemporaryBoosts(spikes: MightSpike[]): MightSpike[] {
  const boosts = new Set<MightSpike>();
  const byPlayer = Map.groupBy(spikes, (spike) => spike.playerId);
  for (const own of byPlayer.values()) {
    const ordered = [...own].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    let start = 0;
    while (start < ordered.length) {
      const end = boostEnd(ordered, start);
      if (end === null) {
        start++;
        continue;
      }
      for (const spike of ordered.slice(start, end + 1)) boosts.add(spike);
      start = end + 1;
    }
  }
  return spikes.filter((spike) => !boosts.has(spike));
}

function boostEnd(ordered: MightSpike[], start: number): number | null {
  const limit = Date.parse(ordered[start].occurredAt) + MIGHT_RULE.boostWindowHours * 3_600_000;
  let net = 0;
  let peak = 0;
  for (let index = start; index < ordered.length && Date.parse(ordered[index].occurredAt) <= limit; index++) {
    net += ordered[index].change;
    peak = Math.max(peak, Math.abs(net));
    if (index > start && Math.abs(net) <= peak * MIGHT_RULE.boostResidualShare) return index;
  }
  return null;
}

async function readRows(client: NodeClickHouseClient, query: string, playerIds: number[]): Promise<any[]> {
  const result = await client.query({ query, query_params: { ids: playerIds }, format: 'JSONEachRow' });
  return (await result.json()) as any[];
}

function spikesQuery(database: string): string {
  const rule = MIGHT_RULE;
  return `
    WITH steps AS (
      SELECT
        player_id,
        created_at,
        toInt64(point) - toInt64(lagInFrame(point) OVER w) AS delta,
        toInt64(lagInFrame(point) OVER w) AS previous,
        dateDiff('second', lagInFrame(created_at) OVER w, created_at) AS gap
      FROM \`${database}\`.player_might_history
      WHERE player_id IN {ids:Array(UInt32)}
        AND created_at >= now() - INTERVAL ${rule.baselineDays + rule.windowDays} DAY
      WINDOW w AS (PARTITION BY player_id ORDER BY created_at ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
    ),
    valid AS (
      SELECT * FROM steps WHERE gap > 0 AND gap <= ${rule.maxReadingGapSeconds} AND previous > 0
    ),
    baseline AS (
      SELECT player_id, quantile(0.99)(abs(delta)) AS typical
      FROM valid
      WHERE created_at < now() - INTERVAL ${rule.windowDays} DAY
      GROUP BY player_id
    )
    SELECT v.player_id, toUnixTimestamp(v.created_at) AS at, v.delta, v.previous, b.typical
    FROM valid AS v
    LEFT JOIN baseline AS b ON b.player_id = v.player_id
    WHERE v.created_at >= now() - INTERVAL ${rule.windowDays} DAY
      AND abs(v.delta) >= greatest(${rule.minimumChange}, ${rule.minimumShareOfMight} * v.previous, ${rule.typicalMultiplier} * b.typical)
    ORDER BY v.created_at DESC
    SETTINGS join_use_nulls = 0
  `;
}

function trendsQuery(database: string): string {
  return `
    SELECT
      player_id,
      if(
        countIf(created_at >= now() - INTERVAL 1 DAY) > 0,
        toInt64(argMax(point, created_at)) - toInt64(argMinIf(point, created_at, created_at >= now() - INTERVAL 1 DAY)),
        0
      ) AS change_24h,
      toInt64(argMax(point, created_at)) - toInt64(argMin(point, created_at)) AS change_7d
    FROM \`${database}\`.player_might_history
    WHERE player_id IN {ids:Array(UInt32)}
      AND created_at >= now() - INTERVAL ${MIGHT_RULE.windowDays} DAY
    GROUP BY player_id
  `;
}
