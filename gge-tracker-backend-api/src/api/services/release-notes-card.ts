import { ShareCardChrome } from './share-card-chrome';
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
        ? release.highlights
            .map((highlight) => `<div class="item"><span class="plus">+</span>${escape(highlight)}</div>`)
            .join('')
        : '<div class="item fallback">Every change to the site, the servers and the API</div>';
    const scope = release.scope ? ` · ${release.scope}` : '';
    const css = `
.title { margin-top: 10px; font-size: 104px; font-weight: 800; line-height: 1.05; letter-spacing: -2px; }
.subtitle { margin-top: 8px; font-size: 28px; font-weight: 500; color: #8a94a3; }
.highlights { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; padding: 18px 0; }
.item { min-width: 0; padding: 14px 32px; font-size: 31px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item:nth-child(odd) { border-right: 1px solid rgba(110, 78, 36, 0.22); }
.plus { color: #6b4423; font-weight: 800; margin-right: 14px; }
.fallback { grid-column: 1 / -1; border-right: none; font-weight: 500; }`;
    const body =
      ShareCardChrome.topBar(displayUrl, escape) +
      `<div class="content">
${ShareCardChrome.kicker(null, "What's new", escape)}
<div class="title">${escape(release.version)}</div>
<div class="subtitle">Released ${escape(release.releasedOn)}${escape(scope)}</div>
<div class="highlights parchment">${highlights}</div>
</div>`;
    return ShareCardChrome.document(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT, css, body);
  }
}
