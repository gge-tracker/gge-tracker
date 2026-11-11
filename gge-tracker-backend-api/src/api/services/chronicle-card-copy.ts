import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type CopyParameters = Record<string, string | number>;

interface CachedSection {
  texts: Record<string, string> | null;
  expiresAt: number;
}

const ENGLISH: Record<string, string> = {
  title: 'The {{year}} Chronicle',
  verdictEye: "The Chronicle's verdict",
  cardMight: 'Might gained',
  cardLoot: 'Loot taken',
  eventsLead: 'Events played',
  cardDays: 'Days in action',
  cardCurve: 'Might through the year',
  cardTop: 'Top {{pct}}% of {{server}}',
  cardReign1: 'Days at #1 in might',
  cardReignTop: 'Days in the might top {{count}}',
  cardReignLongest: 'Longest reign: {{count}}',
  cardPlaces: 'Places climbed',
  cardProfile: 'Out of 100, against all of {{server}}',
  axisMight: 'Might',
  axisLoot: 'Loot',
  scoreEvents: 'Events',
  axisGlory: 'Glory',
  axisActivity: 'Activity',
  axisLoyalty: 'Loyalty',
  cardRange: 'Data: {{from}} to {{to}} {{year}}',
  cardSince: 'Tracked since {{date}} {{year}}',
  p_conqueror: 'The Conqueror',
  pl_conqueror: 'Few grew stronger this year.',
  p_plunderer: 'The Plunderer',
  pl_plunderer: 'No treasury slept soundly.',
  'p_tournament-knight': 'The Tournament Knight',
  'pl_tournament-knight': 'Always first on the field.',
  'p_night-watch': 'The Night Watch',
  'pl_night-watch': 'While the realm slept, you rode.',
  'p_iron-banner': 'The Iron Banner',
  'pl_iron-banner': 'One banner, all year long.',
  p_wanderer: 'The Wanderer',
  pl_wanderer: 'Many banners, one road.',
  p_risen: 'The Phoenix',
  pl_risen: 'Knocked down. Came back stronger.',
  'p_rising-star': 'The Rising Star',
  'pl_rising-star': 'The fastest climb in the kingdom.',
  p_veteran: 'The Veteran',
  pl_veteran: 'Day after day, never absent.',
  'p_hermit-king': 'The Hermit King',
  'pl_hermit-king': 'No alliance. No need.',
  p_glorious: 'The Glorious',
  pl_glorious: 'Your name is sung in every hall.',
  p_steadfast: 'The Steadfast',
  pl_steadfast: 'Present when it counted.',
};

const LANGUAGES = new Set([
  'ar',
  'bg',
  'cs',
  'de',
  'el',
  'en',
  'es',
  'fr',
  'hu',
  'it',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'tr',
]);
const BETA_I18N_URL = 'https://gge-tracker.github.io/i18n-beta/';
const PUBLIC_I18N_URL = 'https://ggetracker.github.io/i18n/';
const SECTION_TTL_MS = 3_600_000;
const FAILED_SECTION_TTL_MS = 300_000;
const FETCH_TIMEOUT_MS = 3000;

export class ChronicleCardCopy {
  private static readonly sections = new Map<string, CachedSection>();

  private constructor(
    public readonly lang: string,
    private readonly texts: Record<string, string>,
  ) {}

  public static async forLanguage(requested: unknown): Promise<ChronicleCardCopy> {
    const lang = typeof requested === 'string' && LANGUAGES.has(requested) ? requested : 'en';
    const texts = lang === 'en' ? null : await this.section(lang);
    return texts ? new ChronicleCardCopy(lang, texts) : new ChronicleCardCopy('en', {});
  }

  public static get readsLocalFiles(): boolean {
    return Boolean(process.env.I18N_LOCAL_DIR);
  }

  private static async section(lang: string): Promise<Record<string, string> | null> {
    if (this.readsLocalFiles) return this.readLocalSection(lang);
    const known = this.sections.get(lang);
    if (known && known.expiresAt > Date.now()) return known.texts;
    const texts = await this.fetchSection(lang);
    if (!texts && known?.texts) return known.texts;
    this.sections.set(lang, {
      texts,
      expiresAt: Date.now() + (texts ? SECTION_TTL_MS : FAILED_SECTION_TTL_MS),
    });
    return texts;
  }

  private static async readLocalSection(lang: string): Promise<Record<string, string> | null> {
    try {
      const content = await readFile(path.join(process.env.I18N_LOCAL_DIR as string, `${lang}.json`), 'utf8');
      return (JSON.parse(content) as { chronicle?: Record<string, string> }).chronicle ?? null;
    } catch {
      return null;
    }
  }

  private static async fetchSection(lang: string): Promise<Record<string, string> | null> {
    try {
      const answer = await fetch(`${this.baseUrl()}${lang}.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!answer.ok) return null;
      const document = (await answer.json()) as { chronicle?: Record<string, string> };
      return document.chronicle ?? null;
    } catch {
      return null;
    }
  }

  private static baseUrl(): string {
    if (process.env.I18N_BASE_URL) return process.env.I18N_BASE_URL;
    return process.env.API_CHANNEL?.trim().toLowerCase() === 'beta' ? BETA_I18N_URL : PUBLIC_I18N_URL;
  }

  public get isRightToLeft(): boolean {
    return this.lang === 'ar';
  }

  // Latin digits, as the game shows them in every language
  public get locale(): string {
    return `${this.lang}-u-nu-latn`;
  }

  public get version(): string {
    const cardTexts = Object.keys(ENGLISH).map((key) => this.texts[key] ?? ENGLISH[key]);
    return createHash('sha256').update(JSON.stringify(cardTexts)).digest('hex').slice(0, 12);
  }

  public has(key: string): boolean {
    return key in ENGLISH;
  }

  public text(key: string, parameters: CopyParameters = {}): string {
    const template = this.texts[key] ?? ENGLISH[key] ?? key;
    return template.replaceAll(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(parameters[name] ?? ''));
  }
}
