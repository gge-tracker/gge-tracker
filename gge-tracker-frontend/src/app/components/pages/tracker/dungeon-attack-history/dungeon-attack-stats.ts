import { ApiDungeonsAttackHistory } from '@ggetracker-interfaces/empire-ranking';

export type AttackBucket = 'day' | 'week';

export interface DungeonAttack {
  kid: number;
  x: number;
  y: number;
  attackedAt: number;
}

export interface AttackTarget {
  kid: number;
  x: number;
  y: number;
  count: number;
  lastAttackAt: number;
}

export interface AttackSummary {
  total: number;
  averagePerDay: number;
  activeDays: number;
  coveredDays: number;
  lastAttackAt: number | null;
  realmCounts: Map<number, number>;
  targets: AttackTarget[];
  activity: number[][];
  activityMax: number;
  bucket: AttackBucket;
  bucketStarts: number[];
  countsByRealm: Map<number, number[]>;
}

const DAY_MS = 86_400_000;
const WEEKLY_BUCKETS_ABOVE_DAYS = 90;
const MIN_CHART_DAYS = 7;

export function toDungeonAttacks(rows: ApiDungeonsAttackHistory[]): DungeonAttack[] {
  return rows
    .map((row) => ({
      kid: row.kid,
      x: row.position_x,
      y: row.position_y,
      attackedAt: new Date(row.attacked_at).getTime(),
    }))
    .sort((a, b) => b.attackedAt - a.attackedAt);
}

export function summarizeAttacks(attacks: DungeonAttack[], periodDays: number, now = Date.now()): AttackSummary {
  const bucket: AttackBucket = periodDays > WEEKLY_BUCKETS_ABOVE_DAYS ? 'week' : 'day';
  const coveredDays = daysSinceFirstAttack(attacks, periodDays, now);
  const bucketStarts = buildBucketStarts(bucket, Math.max(coveredDays, MIN_CHART_DAYS), now);
  const countsByRealm = new Map<number, number[]>();
  const realmCounts = new Map<number, number>();
  const activeDays = new Set<number>();
  const activity = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  for (const attack of attacks) {
    realmCounts.set(attack.kid, (realmCounts.get(attack.kid) ?? 0) + 1);
    activeDays.add(startOfDay(attack.attackedAt));
    const date = new Date(attack.attackedAt);
    activity[mondayFirstWeekday(date)][date.getHours()]++;
    const index = bucketStarts.indexOf(bucketStart(bucket, attack.attackedAt));
    if (index === -1) continue;
    if (!countsByRealm.has(attack.kid))
      countsByRealm.set(
        attack.kid,
        bucketStarts.map(() => 0),
      );
    countsByRealm.get(attack.kid)![index]++;
  }

  return {
    total: attacks.length,
    averagePerDay: attacks.length / coveredDays,
    activeDays: activeDays.size,
    coveredDays,
    lastAttackAt: attacks[0]?.attackedAt ?? null,
    realmCounts,
    targets: rankTargets(attacks),
    activity,
    activityMax: Math.max(0, ...activity.flat()),
    bucket,
    bucketStarts,
    countsByRealm,
  };
}

export function mondayFirstWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function daysSinceFirstAttack(attacks: DungeonAttack[], periodDays: number, now: number): number {
  const firstAttackAt = attacks.at(-1)?.attackedAt;
  if (firstAttackAt === undefined) return periodDays;
  return Math.min(periodDays, Math.round((startOfDay(now) - startOfDay(firstAttackAt)) / DAY_MS) + 1);
}

function rankTargets(attacks: DungeonAttack[]): AttackTarget[] {
  const targets = new Map<string, AttackTarget>();
  for (const attack of attacks) {
    const key = `${attack.kid}:${attack.x}:${attack.y}`;
    const target = targets.get(key);
    if (target) {
      target.count++;
      target.lastAttackAt = Math.max(target.lastAttackAt, attack.attackedAt);
    } else {
      targets.set(key, { kid: attack.kid, x: attack.x, y: attack.y, count: 1, lastAttackAt: attack.attackedAt });
    }
  }
  return [...targets.values()].sort((a, b) => b.count - a.count || b.lastAttackAt - a.lastAttackAt);
}

function buildBucketStarts(bucket: AttackBucket, periodDays: number, now: number): number[] {
  const last = bucketStart(bucket, now);
  const first = bucketStart(bucket, now - (periodDays - 1) * DAY_MS);
  const starts: number[] = [];
  for (let start = first; start <= last; start = nextBucketStart(bucket, start)) starts.push(start);
  return starts;
}

function bucketStart(bucket: AttackBucket, time: number): number {
  const day = new Date(startOfDay(time));
  if (bucket === 'week') day.setDate(day.getDate() - mondayFirstWeekday(day));
  return day.getTime();
}

function nextBucketStart(bucket: AttackBucket, start: number): number {
  const next = new Date(start);
  next.setDate(next.getDate() + (bucket === 'week' ? 7 : 1));
  return next.getTime();
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
