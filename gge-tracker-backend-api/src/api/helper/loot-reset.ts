export interface LootReset {
  timezone: string;
  minutesFromMonday: number;
}

export const DEFAULT_LOOT_RESET: LootReset = { timezone: 'Europe/Paris', minutesFromMonday: 0 };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const WEEK_MINUTES = 7 * 24 * 60;
const WEEK_MS = WEEK_MINUTES * MINUTE_MS;
const FIRST_MONDAY_MS = 4 * 24 * HOUR_MS;
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const LOCAL_TIME = /^(MON|TUE|WED|THU|FRI|SAT|SUN) ([01]\d|2[0-3]):([0-5]\d)$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

export function isTimeZone(timezone: string): boolean {
  try {
    formatterOf(timezone);
    return true;
  } catch {
    return false;
  }
}

function zoneOffsetMs(instant: number, timezone: string): number {
  const parts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatterOf(timezone).formatToParts(instant)) {
    if (part.type in parts) parts[part.type as keyof typeof parts] = Number(part.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

function wallToInstant(wall: number, timezone: string): number {
  const guess = wall - zoneOffsetMs(wall, timezone);
  return wall - zoneOffsetMs(guess, timezone);
}

export function parseLootReset(timezone: string, localTime: string): LootReset | null {
  const match = LOCAL_TIME.exec(localTime.trim().toUpperCase());
  if (!match || !isTimeZone(timezone)) return null;
  const minutes = DAYS.indexOf(match[1]) * 1440 + Number(match[2]) * 60 + Number(match[3]);
  return { timezone, minutesFromMonday: minutes > WEEK_MINUTES / 2 ? minutes - WEEK_MINUTES : minutes };
}

export function formatLootResetTime(reset: LootReset): string {
  const minutes = (reset.minutesFromMonday + WEEK_MINUTES) % WEEK_MINUTES;
  const hours = Math.floor((minutes % 1440) / 60);
  return `${DAYS[Math.floor(minutes / 1440)]} ${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function lootWeekStart(instant: number, reset: LootReset): number {
  const wall = instant + zoneOffsetMs(instant, reset.timezone);
  let startWall =
    Math.floor((wall - FIRST_MONDAY_MS) / WEEK_MS) * WEEK_MS + FIRST_MONDAY_MS + reset.minutesFromMonday * MINUTE_MS;
  while (startWall > wall) startWall -= WEEK_MS;
  while (startWall + WEEK_MS <= wall) startWall += WEEK_MS;
  const start = wallToInstant(startWall, reset.timezone);
  return start > instant ? wallToInstant(startWall - WEEK_MS, reset.timezone) : start;
}

export function lootWeekEnd(weekStart: number, reset: LootReset): number {
  return lootWeekStart(weekStart + WEEK_MS + 2 * HOUR_MS, reset);
}

export function lootResetOffsetHours(instant: number, reset: LootReset): number {
  const start = new Date(lootWeekStart(instant, reset));
  const offset = ((start.getUTCDay() + 6) % 7) * 24 + start.getUTCHours() + 1;
  return offset > 84 ? offset - 168 : offset;
}
