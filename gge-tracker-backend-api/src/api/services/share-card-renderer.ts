import { puppeteerManagerInstance } from '../managers/puperteer.manager';

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

export interface ShareCardStat {
  label: string;
  value: string;
  detail?: string;
  trend?: 'up' | 'down' | 'flat';
}

export interface ShareCard {
  kind: string;
  title: string;
  subtitle: string | null;
  server: string | null;
  stats: ShareCardStat[];
  footer: string;
}

export abstract class ShareCardRenderer {
  private static readonly inFlight = new Map<string, Promise<Buffer>>();

  public static render(key: string, card: ShareCard): Promise<Buffer> {
    const running = this.inFlight.get(key);
    if (running !== undefined) return running;
    const job = this.renderOnce(card).finally(() => this.inFlight.delete(key));
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

  private static async renderOnce(card: ShareCard): Promise<Buffer> {
    return puppeteerManagerInstance.withPage(async (page) => {
      // Names are player input: the page runs no script and reaches nothing outside itself
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url().startsWith('data:')) void request.continue();
        else void request.abort();
      });
      await page.setViewport({ width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT, deviceScaleFactor: 1 });
      await page.setContent(this.toHtml(card), { waitUntil: 'load' });
      const image = await page.screenshot({ type: 'jpeg', quality: 85 });
      return Buffer.from(image);
    });
  }

  private static titleSize(title: string): number {
    const length = [...title].length;
    if (length <= 12) return 92;
    if (length <= 18) return 80;
    if (length <= 26) return 64;
    return 52;
  }

  private static statHtml(stat: ShareCardStat): string {
    const arrow = { up: '▲', down: '▼', flat: '■' }[stat.trend ?? 'flat'];
    const detail = stat.detail
      ? `<div class="detail ${stat.trend ?? ''}">${stat.trend ? `${arrow} ` : ''}${this.escape(stat.detail)}</div>`
      : '';
    return `<div class="stat"><div class="label">${this.escape(stat.label)}</div><div class="value">${this.escape(stat.value)}</div>${detail}</div>`;
  }

  private static toHtml(card: ShareCard): string {
    const server = card.server ? `<div class="server">${this.escape(card.server)}</div>` : '';
    const subtitle = card.subtitle ? `<div class="subtitle">${this.escape(card.subtitle)}</div>` : '';
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${SHARE_CARD_WIDTH}px; height: ${SHARE_CARD_HEIGHT}px; overflow: hidden; }
body {
  font-family: "DejaVu Sans", "FreeSans", "Liberation Sans", Arial, sans-serif;
  color: #eef2ff;
  background:
    radial-gradient(900px 520px at 88% -10%, rgba(58, 83, 221, 0.55), transparent 60%),
    radial-gradient(700px 420px at -5% 110%, rgba(62, 157, 149, 0.35), transparent 60%),
    linear-gradient(160deg, #0b1636 0%, #060d1f 70%);
  padding: 44px 72px 40px;
  display: flex; flex-direction: column;
}
.top { display: flex; align-items: center; justify-content: space-between; }
.brand { font-size: 26px; font-weight: bold; letter-spacing: 6px; color: #c7d2fe; }
.brand span { color: #6ee7d8; }
.server {
  font-size: 26px; font-weight: bold; letter-spacing: 2px; padding: 10px 22px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.08); border: 2px solid rgba(199, 210, 254, 0.35);
}
.kind { margin-top: 34px; font-size: 22px; letter-spacing: 5px; color: #6ee7d8; font-weight: bold; text-transform: uppercase; }
.title {
  margin-top: 10px; font-size: ${this.titleSize(card.title)}px; font-weight: bold; line-height: 1.05;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.subtitle {
  margin-top: 10px; font-size: 32px; color: #a5b4fc;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.stats { margin-top: auto; padding-top: 28px; display: flex; gap: 22px; }
.stat {
  flex: 1; min-width: 0; padding: 20px 26px; border-radius: 18px;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(199, 210, 254, 0.18);
}
.label { font-size: 20px; letter-spacing: 3px; color: #94a3d8; text-transform: uppercase; }
.value { margin-top: 8px; font-size: 46px; font-weight: bold; white-space: nowrap; }
.detail { margin-top: 6px; font-size: 22px; color: #94a3d8; white-space: nowrap; }
.detail.up { color: #4ade80; }
.detail.down { color: #f87171; }
.footer { margin-top: 22px; font-size: 22px; color: #7c8bc4; letter-spacing: 1px; }
</style></head>
<body>
<div class="top"><div class="brand">GGE <span>TRACKER</span></div>${server}</div>
<div class="kind">${this.escape(card.kind)}</div>
<div class="title">${this.escape(card.title)}</div>
${subtitle}
<div class="stats">${card.stats.map((stat) => this.statHtml(stat)).join('')}</div>
<div class="footer">${this.escape(card.footer)}</div>
</body></html>`;
  }
}
