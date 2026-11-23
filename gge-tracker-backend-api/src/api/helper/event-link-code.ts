type LinkGame = 'ep' | 'e4k';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 7;
const BASE = BigInt(ALPHABET.length);
const SPACE = BASE ** BigInt(CODE_LENGTH);
const ROUNDS: [bigint, bigint][] = [
  [48_271_957_313n, 9_041_224_573n],
  [31_415_926_537n, 27_182_818_284n],
];
const MAX_EVENT_NUMBER = 1_000_000n;
const LEGACY_EVENT_NUMBER = /^\d{1,6}$/;
const LINK_CODE = /^[\da-z]{7}$/;

function modularInverse(value: bigint, modulus: bigint): bigint {
  let [remainder, nextRemainder] = [value % modulus, modulus];
  let [coefficient, nextCoefficient] = [1n, 0n];
  while (nextRemainder !== 0n) {
    const quotient = remainder / nextRemainder;
    [remainder, nextRemainder] = [nextRemainder, remainder - quotient * nextRemainder];
    [coefficient, nextCoefficient] = [nextCoefficient, coefficient - quotient * nextCoefficient];
  }
  return ((coefficient % modulus) + modulus) % modulus;
}

const INVERSE_ROUNDS = ROUNDS.map(([multiplier, offset]) => [modularInverse(multiplier, SPACE), offset]).reverse();

function toDigits(value: bigint): string {
  let digits = '';
  for (let index = 0; index < CODE_LENGTH; index++) {
    digits = ALPHABET[Number(value % BASE)] + digits;
    value /= BASE;
  }
  return digits;
}

function fromDigits(digits: string): bigint {
  let value = 0n;
  for (const digit of digits) value = value * BASE + BigInt(ALPHABET.indexOf(digit));
  return value;
}

function reverseDigits(value: bigint): bigint {
  return fromDigits([...toDigits(value)].reverse().join(''));
}

export function encodeEventLinkCode(game: LinkGame, eventNumber: number): string {
  let value = BigInt(eventNumber) * 2n + (game === 'e4k' ? 1n : 0n);
  for (const [multiplier, offset] of ROUNDS) value = reverseDigits((value * multiplier + offset) % SPACE);
  return toDigits(value);
}

export function decodeEventLinkCode(code: string): { game: LinkGame; eventNumber: number } | null {
  if (!LINK_CODE.test(code)) return null;
  let value = fromDigits(code);
  for (const [inverse, offset] of INVERSE_ROUNDS) {
    value = (((((reverseDigits(value) - offset) % SPACE) + SPACE) % SPACE) * inverse) % SPACE;
  }
  const eventNumber = value / 2n;
  if (eventNumber >= MAX_EVENT_NUMBER) return null;
  return { game: value % 2n === 1n ? 'e4k' : 'ep', eventNumber: Number(eventNumber) };
}

export function isLegacyEventNumber(identifier: string): boolean {
  return LEGACY_EVENT_NUMBER.test(identifier);
}
