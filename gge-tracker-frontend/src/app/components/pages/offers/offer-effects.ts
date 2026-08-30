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
const PARENTHETICAL = /\(([^()]*)\)/g;
const LABEL_EDGE_PUNCTUATION = new Set([',', '.', ':', ';', '·', '-']);
const WHITESPACE = /\s/;

const isLabelEdge = (character: string): boolean => LABEL_EDGE_PUNCTUATION.has(character) || WHITESPACE.test(character);

function trimLabelEdges(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isLabelEdge(text[start])) start++;
  while (end > start && isLabelEdge(text[end - 1])) end--;
  return text.slice(start, end);
}

function capParenthetical(clause: string): RegExpExecArray | null {
  PARENTHETICAL.lastIndex = 0;
  let match = PARENTHETICAL.exec(clause);
  while (match !== null) {
    if ([...match[1]].some((character) => character >= '0' && character <= '9')) return match;
    match = PARENTHETICAL.exec(clause);
  }
  return null;
}

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
    const parenthetical = capParenthetical(clause);
    const cap = parenthetical?.[1]?.trim() ?? null;
    const body = parenthetical ? clause.replace(parenthetical[0], ' ') : clause;
    const value = SIGNED_VALUE.exec(body);

    if (!value) {
      const footprint = SIZE.exec(body);
      if (footprint && !size) {
        size = footprint[0].replaceAll(/\s/g, '');
      } else {
        notes.push(trimLabelEdges(body));
      }
      continue;
    }

    effects.push({
      value: formatValue(value[0], locale),
      label: trimLabelEdges(body.replace(value[0], ' ').replaceAll(/\s{2,}/g, ' ')),
      cap,
    });
  }

  return { effects, notes: notes.filter((note) => note.length > 0), size };
}
