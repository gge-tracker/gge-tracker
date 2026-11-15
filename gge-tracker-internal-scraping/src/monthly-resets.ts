//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//

const MONUMENT = 26;
const LABORATORY = 28;

const RESET_DAY_OF_MONTH: Record<number, number> = { [MONUMENT]: 2, [LABORATORY]: 3 };

const WINDOW_HOURS = 4;

const UNKNOWN_ZONE_WINDOW = { startHoursBeforeDay: 12, endHoursIntoDay: 8 };

const formatters = new Map<string, Intl.DateTimeFormat>();

export const UNCAPTURABLE_CASTLE_TYPES = new Set([1, 12]);

export function isInMonthlyReset(castleType: number, instant: number, timezone: string | null): boolean {
  const resetDay = RESET_DAY_OF_MONTH[castleType];
  if (resetDay === undefined) return false;
  if (!timezone) return isInUtcResetSpan(resetDay, instant);
  const local = localDayAndHour(instant, timezone);
  return local.day === resetDay && local.hour < WINDOW_HOURS;
}

function isInUtcResetSpan(resetDay: number, instant: number): boolean {
  const date = new Date(instant);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), resetDay);
  const hour = 3600 * 1000;
  return (
    instant >= dayStart - UNKNOWN_ZONE_WINDOW.startHoursBeforeDay * hour &&
    instant < dayStart + UNKNOWN_ZONE_WINDOW.endHoursIntoDay * hour
  );
}

function localDayAndHour(instant: number, timezone: string): { day: number; hour: number } {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      day: 'numeric',
      hour: 'numeric',
    });
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { day: value('day'), hour: value('hour') };
}
