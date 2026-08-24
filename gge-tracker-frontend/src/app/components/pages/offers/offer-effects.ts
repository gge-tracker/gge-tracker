export interface OfferEffect {
  value: string;
  label: string;
  cap: string | null;
}

export interface ParsedRewardDescription {
  effects: OfferEffect[];
  notes: string[];
  size: string | null;
}

const SIGNED_VALUE = /[+-]\s?\d[\d.,]*(?:\s?[km](?!\p{L}))?\s?%?/iu;
const SIZE = /\b\d+\s?[x×]\s?\d+\b/i;
const PARENTHETICAL = /\(([^()]*\d[^()]*)\)/;
const LABEL_EDGES = /^[\s,.:;·-]+|[\s,.:;·-]+$/g;

function splitClauses(description: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let current = '';
  for (const [index, char] of [...description].entries()) {
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    const previous = description[index - 1] ?? '';
    const next = description[index + 1];
    const isSeparator =
      depth === 0 &&
      (char === ',' ||
        char === ';' ||
        char === '\n' ||
        (char === '.' && !/\d/.test(previous) && (next === undefined || /\s/.test(next))));
    if (isSeparator) {
      clauses.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  clauses.push(current);
  return clauses.map((clause) => clause.trim()).filter((clause) => clause.length > 0);
}

function formatValue(raw: string, locale: string): string {
  const value = raw.replaceAll(/\s/g, '');
  const sign = value.slice(0, 1);
  const percent = value.endsWith('%');
  const digits = percent ? value.slice(1, -1) : value.slice(1);
  if (!/^\d+$/.test(digits)) return value;
  return `${sign}${new Intl.NumberFormat(locale).format(Number(digits))}${percent ? '%' : ''}`;
}

export function parseRewardDescription(description: string, locale: string): ParsedRewardDescription {
  const effects: OfferEffect[] = [];
  const notes: string[] = [];
  let size: string | null = null;

  for (const clause of splitClauses(description)) {
    const parenthetical = PARENTHETICAL.exec(clause);
    const cap = parenthetical?.[1]?.trim() ?? null;
    const body = parenthetical ? clause.replace(parenthetical[0], ' ') : clause;
    const value = SIGNED_VALUE.exec(body);

    if (!value) {
      const footprint = SIZE.exec(body);
      if (footprint && !size) {
        size = footprint[0].replaceAll(/\s/g, '');
      } else {
        notes.push(body.replaceAll(LABEL_EDGES, '').trim());
      }
      continue;
    }

    effects.push({
      value: formatValue(value[0], locale),
      label: body
        .replace(value[0], ' ')
        .replaceAll(/\s{2,}/g, ' ')
        .replaceAll(LABEL_EDGES, '')
        .trim(),
      cap,
    });
  }

  return { effects, notes: notes.filter((note) => note.length > 0), size };
}
