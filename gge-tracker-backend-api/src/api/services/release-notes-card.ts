import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, ShareCardRenderer } from './share-card-renderer';

export interface ReleaseSummary {
  version: string;
  releasedOn: string;
  summary: string | null;
  highlights: string[];
  scope: string | null;
}

export abstract class ReleaseNotesCard {
  public static toHtml(release: ReleaseSummary, displayUrl: string): string {
    const escape = ShareCardRenderer.escape.bind(ShareCardRenderer);
    const highlights =
      release.highlights.length > 0
        ? `<ul class="highlights">${release.highlights.map((highlight) => `<li>${escape(highlight)}</li>`).join('')}</ul>`
        : '<div class="fallback">Every change to the site, the servers and the API</div>';
    const scope = release.scope ? `<div>${escape(release.scope)}</div>` : '';
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
      padding: 44px 72px 34px;
      display: flex; flex-direction: column;
    }
    .top { display: flex; align-items: center; justify-content: space-between; }
    .brand { font-size: 26px; font-weight: bold; letter-spacing: 6px; color: #c7d2fe; }
    .brand span { color: #6ee7d8; }
    .pill {
      font-size: 22px; font-weight: bold; letter-spacing: 2px; padding: 8px 20px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.08); border: 2px solid rgba(199, 210, 254, 0.35);
    }
    .kind { margin-top: 30px; font-size: 22px; letter-spacing: 5px; color: #6ee7d8; font-weight: bold; text-transform: uppercase; }
    .version { margin-top: 8px; font-size: 88px; font-weight: bold; line-height: 1.05; letter-spacing: 1px; }
    .date { margin-top: 6px; font-size: 30px; color: #a5b4fc; }
    .highlights {
      margin-top: auto; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px;
    }
    .highlights li {
      min-width: 0; padding: 14px 20px 14px 52px; border-radius: 14px; position: relative;
      font-size: 25px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(199, 210, 254, 0.18);
    }
    .highlights li::before {
      content: "+"; position: absolute; left: 20px; top: 50%; transform: translateY(-50%);
      color: #6ee7d8; font-size: 30px;
    }
    .fallback { margin-top: auto; font-size: 32px; color: #c7d2fe; }
    .footer {
      margin-top: 22px; padding-top: 14px; border-top: 1px solid rgba(199, 210, 254, 0.18);
      display: flex; justify-content: space-between; font-size: 20px; color: #7c8bc4; letter-spacing: 1px;
    }
    </style></head>
    <body>
    <div class="top"><div class="brand">GGE <span>TRACKER</span></div><div class="pill">WHAT'S NEW</div></div>
    <div class="kind">Release notes</div>
    <div class="version">${escape(release.version)}</div>
    <div class="date">Released ${escape(release.releasedOn)}</div>
    ${highlights}
    <div class="footer"><div>${escape(displayUrl)}</div>${scope}</div>
    </body></html>`;
  }
}
