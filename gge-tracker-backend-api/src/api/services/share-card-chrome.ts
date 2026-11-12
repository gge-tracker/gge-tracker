import { readFileSync } from 'node:fs';
import path from 'node:path';

interface InterSubset {
  file: string;
  range: string;
}

const INTER_SUBSETS: InterSubset[] = [
  {
    file: 'inter-latin.woff2',
    range:
      'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  },
  {
    file: 'inter-latin-ext.woff2',
    range:
      'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  },
  { file: 'inter-greek.woff2', range: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF' },
  { file: 'inter-cyrillic.woff2', range: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' },
];

export abstract class ShareCardChrome {
  private static fontFaces: string | null = null;
  private static banner: string | null = null;
  private static backdrop: string | null = null;

  public static document(width: number, height: number, css: string, body: string): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${this.fonts()}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
body {
  font-family: "Inter", "DejaVu Sans", "FreeSans", sans-serif;
  color: #f1f3f6;
  background: linear-gradient(180deg, transparent 290px, #04070a 400px), #04070a url("${this.backdropUri()}") center -330px / 1300px auto no-repeat;
  display: flex; flex-direction: column;
}
.topbar {
  height: 72px; flex: none; display: flex; align-items: center; justify-content: space-between;
  background: rgba(8, 12, 17, 0.82); border-bottom: 1px solid rgba(255, 255, 255, 0.07); padding-right: 56px;
}
.banner { height: 72px; width: 280px; background: url("${this.bannerUri()}") left center / cover no-repeat; }
.url { font-family: "DejaVu Sans Mono", monospace; font-size: 19px; color: #8a94a3; }
.content { flex: 1; min-height: 0; padding: 34px 56px 44px; display: flex; flex-direction: column; }
.kicker { display: flex; align-items: center; gap: 14px; font-size: 17px; font-weight: 700; letter-spacing: 3px; color: #8a94a3; text-transform: uppercase; }
.tag { padding: 3px 10px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 6px; color: #ffffff; letter-spacing: 1.5px; }
.parchment { box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); background: #efe4cb; color: #3b2a14; border-radius: 10px; border-top: 6px solid #6b4423; }
.cell + .cell { border-left: 1px solid rgba(110, 78, 36, 0.22); }
.label { font-size: 17px; font-weight: 700; letter-spacing: 2.5px; color: #7a6038; text-transform: uppercase; white-space: nowrap; }
${css}
</style></head>
<body>${body}</body></html>`;
  }

  public static topBar(url: string, escape: (value: string) => string): string {
    return `<div class="topbar"><div class="banner"></div><div class="url">${escape(url)}</div></div>`;
  }

  public static kicker(tag: string | null, text: string, escape: (value: string) => string): string {
    const tagHtml = tag ? `<span class="tag">${escape(tag)}</span>` : '';
    return `<div class="kicker">${tagHtml}<span>${escape(text)}</span></div>`;
  }

  private static fonts(): string {
    this.fontFaces ??= INTER_SUBSETS.map(
      (subset) =>
        `@font-face { font-family: "Inter"; font-weight: 100 900; src: url("${this.dataUri(subset.file, 'font/woff2')}") format("woff2"); unicode-range: ${subset.range}; }`,
    ).join('\n');
    return this.fontFaces;
  }

  private static bannerUri(): string {
    this.banner ??= this.dataUri('banner.webp', 'image/webp');
    return this.banner;
  }

  private static backdropUri(): string {
    this.backdrop ??= this.dataUri('backdrop.webp', 'image/webp');
    return this.backdrop;
  }

  private static dataUri(file: string, mime: string): string {
    const content = readFileSync(path.resolve(process.cwd(), 'card-assets/share', file));
    return `data:${mime};base64,${content.toString('base64')}`;
  }
}
