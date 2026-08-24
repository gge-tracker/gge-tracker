export interface OfferCurrency {
  code: string;
  label: string;
}

export const OFFER_CURRENCIES: OfferCurrency[] = [
  { code: 'EUR', label: 'Euro' },
  { code: 'USD', label: 'Dollar américain' },
  { code: 'GBP', label: 'Livre sterling' },
  { code: 'BRL', label: 'Réal brésilien' },
  { code: 'TRY', label: 'Livre turque' },
  { code: 'PLN', label: 'Zloty polonais' },
  { code: 'CZK', label: 'Couronne tchèque' },
  { code: 'HUF', label: 'Forint hongrois' },
  { code: 'RON', label: 'Leu roumain' },
  { code: 'SEK', label: 'Couronne suédoise' },
  { code: 'AUD', label: 'Dollar australien' },
  { code: 'JPY', label: 'Yen japonais' },
  { code: 'KRW', label: 'Won sud-coréen' },
  { code: 'INR', label: 'Roupie indienne' },
  { code: 'SAR', label: 'Riyal saoudien' },
  { code: 'AED', label: 'Dirham émirati' },
  { code: 'TWD', label: 'Dollar taïwanais' },
];

export const DEFAULT_OFFER_CURRENCY = 'EUR';

const SERVER_CURRENCIES: Record<string, string> = {
  AE: 'AED',
  ARAB: 'SAR',
  ASIA: 'USD',
  AU: 'AUD',
  BR: 'BRL',
  CZ: 'CZK',
  EG: 'SAR',
  GB: 'GBP',
  HANT: 'TWD',
  HU: 'HUF',
  IN: 'INR',
  JP: 'JPY',
  KR: 'KRW',
  PL: 'PLN',
  RO: 'RON',
  RU: 'USD',
  SA: 'SAR',
  SKN: 'SEK',
  TR: 'TRY',
  US: 'USD',
};

export function currencyForServer(server: string | undefined): string {
  if (!server) return DEFAULT_OFFER_CURRENCY;
  const region = server.replace(/^(E4K_|PARTNER_)/, '').replace(/\d+$/, '');
  return SERVER_CURRENCIES[region] ?? DEFAULT_OFFER_CURRENCY;
}

export interface OfferCurrencyOption {
  code: string;
  name: string;
  symbol: string;
  sample: string;
}

const SAMPLE_AMOUNT = 4.99;

export function buildCurrencyOptions(locale: string): OfferCurrencyOption[] {
  const names = displayNames(locale);
  return OFFER_CURRENCIES.map((entry) => ({
    code: entry.code,
    name: names?.of(entry.code) ?? entry.label,
    symbol: currencySymbol(entry.code, locale),
    sample: currencySample(entry.code, locale),
  }));
}

function displayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' });
  } catch {
    return null;
  }
}

function currencySymbol(code: string, locale: string): string {
  for (const currencyDisplay of ['narrowSymbol', 'symbol'] as const) {
    try {
      const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay }).formatToParts(
        0,
      );
      const symbol = parts.find((part) => part.type === 'currency')?.value;
      if (symbol && symbol !== code) return symbol;
    } catch {}
  }
  return code;
}

function currencySample(code: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(SAMPLE_AMOUNT);
  } catch {
    return `${SAMPLE_AMOUNT} ${code}`;
  }
}
