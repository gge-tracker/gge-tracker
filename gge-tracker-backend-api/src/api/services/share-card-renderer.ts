import { puppeteerManagerInstance } from '../managers/puperteer.manager';
import { ShareCardChrome } from './share-card-chrome';

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;
export const SHARE_CARD_TEMPLATE_VERSION = 4;
const SHARE_CARD_SIZE = { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT };

export interface ShareCardStat {
  label: string;
  value: string;
  detail?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface ShareCardLevel {
  level: number;
  legendary: number;
}

export interface ShareCard {
  kind: string;
  title: string;
  subtitle: string | null;
  subtitleMuted?: boolean;
  level?: ShareCardLevel;
  server: string | null;
  stats: ShareCardStat[];
  footer: string;
}

export abstract class ShareCardRenderer {
  private static readonly inFlight = new Map<string, Promise<Buffer>>();

  public static render(key: string, card: ShareCard): Promise<Buffer> {
    return this.renderHtml(key, this.toHtml(card));
  }

  public static renderHtml(
    key: string,
    html: string,
    size: { width: number; height: number } = SHARE_CARD_SIZE,
  ): Promise<Buffer> {
    const running = this.inFlight.get(key);
    if (running !== undefined) return running;
    const job = this.renderOnce(html, size).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  public static escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  public static compact(value: number): string {
    const units: [number, string][] = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];
    for (const [threshold, suffix] of units) {
      if (Math.abs(value) >= threshold) {
        const scaled = value / threshold;
        return `${scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : 1)}${suffix}`;
      }
    }
    return String(Math.round(value));
  }

  public static grouped(value: number): string {
    return value.toLocaleString('en-US');
  }

  private static async renderOnce(html: string, size: { width: number; height: number }): Promise<Buffer> {
    return puppeteerManagerInstance.withPage(async (page) => {
      // Names are player input: the page runs no script and reaches nothing outside itself
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:')) void request.continue();
        else void request.abort();
      });
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      const image = await page.screenshot({ type: 'jpeg', quality: 85 });
      return Buffer.from(image);
    });
  }

  private static titleSize(title: string): number {
    const length = [...title].length;
    if (length <= 12) return 104;
    if (length <= 18) return 84;
    if (length <= 26) return 64;
    return 50;
  }

  private static valueSize(stats: ShareCardStat[]): number {
    const longest = Math.max(0, ...stats.map((stat) => [...stat.value].length));
    if (longest <= 6) return 88;
    if (longest <= 7) return 72;
    if (longest <= 8) return 64;
    return 54;
  }

  private static levelHtml(level: ShareCardLevel | undefined): string {
    if (!level) return '';
    const legendary = level.legendary > 0 ? `<span class="divider"></span><span>${level.legendary}</span>` : '';
    return `<div class="level"><span>${level.level}</span>${legendary}</div>`;
  }

  private static statHtml(stat: ShareCardStat): string {
    const arrow = { up: '▲', down: '▼', flat: '■' }[stat.trend ?? 'flat'];
    const detail = stat.detail
      ? `<div class="detail ${stat.trend ?? ''}">${stat.trend ? `${arrow} ` : ''}${this.escape(stat.detail)}</div>`
      : '';
    return `<div class="cell"><div class="label">${this.escape(stat.label)}</div><div class="value">${this.escape(stat.value)}</div>${detail}</div>`;
  }

  private static toHtml(card: ShareCard): string {
    const subtitle = card.subtitle
      ? `<div class="subtitle${card.subtitleMuted ? ' muted' : ''}">${this.escape(card.subtitle)}</div>`
      : '';
    const css = `
.title-row { margin-top: 10px; display: flex; align-items: center; gap: 24px; min-width: 0; }
.title {
  font-size: ${this.titleSize(card.title)}px; font-weight: 800; line-height: 1.05; letter-spacing: -2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.level {
  flex: none; display: flex; align-items: center; gap: 12px; padding: 6px 16px; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25); font-size: 28px; font-weight: 700;
}
.divider { width: 1px; height: 26px; background: rgba(255, 255, 255, 0.25); }
.subtitle { margin-top: 8px; font-size: 32px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subtitle.muted { color: #8a94a3; font-weight: 500; }
.stats { margin-top: auto; display: flex; }
.cell { flex: 1; min-width: 0; padding: 30px 32px 32px; }
.value { margin-top: 10px; font-size: ${this.valueSize(card.stats)}px; font-weight: 800; line-height: 1; letter-spacing: -2px; white-space: nowrap; }
.detail { margin-top: 12px; font-size: 25px; font-weight: 600; color: #7a6038; white-space: nowrap; }
.detail.up { color: #1f8a3e; }
.detail.down { color: #c0392b; }`;
    const escape = this.escape.bind(this);
    const body =
      ShareCardChrome.topBar(card.footer, escape) +
      `<div class="content">
${ShareCardChrome.kicker(card.server, card.kind, escape)}
<div class="title-row"><div class="title">${this.escape(card.title)}</div>${this.levelHtml(card.level)}</div>
${subtitle}
<div class="stats parchment">${card.stats.map((stat) => this.statHtml(stat)).join('')}</div>
</div>`;
    return ShareCardChrome.document(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT, css, body);
  }
}
