import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, ShareCardRenderer } from '../services/share-card-renderer';

export interface HeadDocument {
  path: string;
  title: string;
  description: string;
  heading: string;
  image: string;
  imageAlt: string;
  indexable: boolean;
  type: 'profile' | 'website';
}

export abstract class SeoHead {
  public static readonly SITE_NAME = 'GGE Tracker';

  public static render(document: HeadDocument): string {
    const escape = ShareCardRenderer.escape.bind(ShareCardRenderer);
    const canonical = this.siteUrl() + document.path;
    const meta: [string, string, string][] = [
      ['name', 'description', document.description],
      ['name', 'robots', document.indexable ? 'index, follow' : 'noindex, follow'],
      ['name', 'theme-color', '#060d1f'],
      ['property', 'og:site_name', this.SITE_NAME],
      ['property', 'og:type', document.type],
      ['property', 'og:locale', 'en_US'],
      ['property', 'og:title', document.title],
      ['property', 'og:description', document.description],
      ['property', 'og:url', canonical],
      ['property', 'og:image', document.image],
      ['property', 'og:image:type', 'image/jpeg'],
      ['property', 'og:image:width', String(SHARE_CARD_WIDTH)],
      ['property', 'og:image:height', String(SHARE_CARD_HEIGHT)],
      ['property', 'og:image:alt', document.imageAlt],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', document.title],
      ['name', 'twitter:description', document.description],
      ['name', 'twitter:image', document.image],
      ['name', 'twitter:image:alt', document.imageAlt],
    ];
    const tags = meta
      .map(([attribute, key, content]) => `<meta ${attribute}="${key}" content="${escape(content)}">`)
      .join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(document.title)}</title>
<link rel="canonical" href="${escape(canonical)}">
${tags}
</head>
<body>
<main>
<h1>${escape(document.heading)}</h1>
<p>${escape(document.description)}</p>
<p><a href="${escape(canonical)}">Open on ${this.SITE_NAME}</a></p>
</main>
</body>
</html>
`;
  }

  public static genericImage(): string {
    return `${this.apiUrl()}/assets/og/player/0.jpg`;
  }

  public static siteUrl(): string {
    return (process.env.SITE_URL || 'https://gge-tracker.com').replace(/\/+$/, '');
  }

  public static apiUrl(): string {
    return `${(process.env.BACKEND_API_URI || 'https://api.gge-tracker.com').replace(/\/+$/, '')}/api/v1`;
  }
}
