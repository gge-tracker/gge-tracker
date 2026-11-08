import { ApiOfferHistory, ApiOfferHistoryEntry } from '@ggetracker-interfaces/empire-ranking';

export type OfferAvailabilityKind = 'ending' | 'remaining' | 'new' | 'today' | 'since';

export interface OfferAvailability {
  kind: OfferAvailabilityKind;
  remainingHours: number | null;
  days: number;
  usualRunHours: number | null;
  previousRunEndedAt: number | null;
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SLOT_HOURS = 6;
const NEW_FOR_DAYS = 2;
const MAX_SHOWN_DAYS = 30;
const OBSERVATION_DAYS_BEFORE_NEW = 14;

export function resolveOfferAvailability(
  entry: ApiOfferHistoryEntry | undefined,
  history: ApiOfferHistory,
  now: number,
): OfferAvailability | null {
  if (!history.first_snapshot_at || !history.last_snapshot_at) return null;
  const firstSnapshot = Date.parse(history.first_snapshot_at);
  const lastSeen = entry ? Date.parse(entry.last_seen_at) : null;
  // The live catalog is up to one slot ahead of the snapshots
  const cameBackSinceLastSnapshot = lastSeen !== null && lastSeen < Date.parse(history.last_snapshot_at);
  const runStart = !entry || cameBackSinceLastSnapshot ? now : Date.parse(entry.run_started_at);
  if (runStart === firstSnapshot) return null;

  const usualRunHours = entry?.last_completed_run_hours ?? null;
  const previousRunEndedAt = cameBackSinceLastSnapshot ? lastSeen : parsePreviousRunEnd(entry);
  const base = { usualRunHours, previousRunEndedAt };
  const remainingHours = estimateRemainingHours(runStart, usualRunHours, now);
  if (remainingHours !== null) {
    const kind = remainingHours < SLOT_HOURS ? 'ending' : 'remaining';
    return { ...base, kind, remainingHours, days: 0 };
  }

  const age = wholeDays(now - runStart);
  if (age > MAX_SHOWN_DAYS) return null;
  const firstSeen = entry ? Date.parse(entry.first_seen_at) : now;
  const watchedLongEnough = firstSeen - firstSnapshot >= OBSERVATION_DAYS_BEFORE_NEW * DAY_MS;
  if (previousRunEndedAt === null && watchedLongEnough && age < NEW_FOR_DAYS) {
    return { ...base, kind: 'new', remainingHours: null, days: age };
  }
  return { ...base, kind: age === 0 ? 'today' : 'since', remainingHours: null, days: age };
}

// A run starts and ends somewhere inside a slot; the middle of that slot is the best guess
function estimateRemainingHours(runStart: number, usualRunHours: number | null, now: number): number | null {
  if (usualRunHours === null) return null;
  const remaining = (runStart + usualRunHours * HOUR_MS - now) / HOUR_MS - SLOT_HOURS / 2;
  return remaining > -SLOT_HOURS ? Math.max(remaining, 0) : null;
}

function parsePreviousRunEnd(entry: ApiOfferHistoryEntry | undefined): number | null {
  return entry?.previous_run_ended_at ? Date.parse(entry.previous_run_ended_at) : null;
}

function wholeDays(elapsedMs: number): number {
  return Math.floor(elapsedMs / DAY_MS);
}
