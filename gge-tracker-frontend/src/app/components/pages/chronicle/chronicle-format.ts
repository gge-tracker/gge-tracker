const UNITS: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

let displayLocale = 'en-GB';

export function setChronicleLocale(locale: string): void {
  displayLocale = `${locale}-u-nu-latn`;
}

export function compact(value: number): string {
  for (const [threshold, suffix] of UNITS) {
    if (Math.abs(value) >= threshold) {
      const scaled = value / threshold;
      return `${scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : 1)}${suffix}`;
    }
  }
  return String(Math.round(value));
}

export function grouped(value: number): string {
  return value.toLocaleString(displayLocale);
}

function formatDay(day: string, month: 'long' | 'short'): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(displayLocale, { day: 'numeric', month, timeZone: 'UTC' });
}

function formatMonth(yearMonth: number, month: 'long' | 'short' | 'narrow'): string {
  return new Date(Date.UTC(2026, (yearMonth % 100) - 1, 15)).toLocaleDateString(displayLocale, {
    month,
    timeZone: 'UTC',
  });
}

export function longDay(day: string | null): string {
  return day ? formatDay(day, 'long') : '';
}

export function shortDay(day: string): string {
  return formatDay(day, 'short');
}

export function monthInitial(yearMonth: number): string {
  return formatMonth(yearMonth, 'narrow');
}

export function monthShort(yearMonth: number): string {
  return formatMonth(yearMonth, 'short');
}

export function monthName(yearMonth: number): string {
  return formatMonth(yearMonth, 'long');
}
