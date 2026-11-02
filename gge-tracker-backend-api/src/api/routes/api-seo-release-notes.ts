import * as express from 'express';
import * as crypto from 'node:crypto';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { SeoHead } from '../helper/seo-head';
import { RELEASE_NOTES, ReleaseItemKind, ReleaseNote } from '../release-notes/release-notes';
import { ReleaseNotesCard, ReleaseSummary } from '../services/release-notes-card';
import { ShareCardRenderer } from '../services/share-card-renderer';
import { ApiSeo } from './api-seo';

export interface ReleaseNotesHead {
  title: string;
  description: string;
  heading: string;
  image: string;
  imageAlt: string;
}

export abstract class ApiSeoReleaseNotes implements ApiHelper {
  public static readonly PATH = '/release-notes';
  public static readonly CONTENT_DIGEST = this.digest(JSON.stringify(RELEASE_NOTES[0]));

  private static readonly MAX_CARD_HIGHLIGHTS = 6;
  private static readonly COUNTED_KINDS: [ReleaseItemKind, string][] = [
    ['new', 'new'],
    ['improved', 'improved'],
    ['fixed', 'fixed'],
  ];
  private static readonly LATEST = this.summarise(RELEASE_NOTES[0]);
  private static readonly CARD_HTML = ReleaseNotesCard.toHtml(this.LATEST, ApiSeo.displayUrl(this.PATH));
  private static readonly CARD_DIGEST = this.digest(this.CARD_HTML);
  private static readonly CARD_KEY = `seo:release-notes:${this.CARD_DIGEST}`;

  public static head(): ReleaseNotesHead {
    const release = this.LATEST;
    const summaryText = release.summary ? `: ${release.summary}` : '';
    return {
      title: `Release notes ${release.version} · ${SeoHead.SITE_NAME}`,
      description: `GGE Tracker ${release.version}, released ${release.releasedOn}${summaryText}. Every change to the site, the servers and the API.`,
      heading: `Release notes ${release.version}`,
      image: `${SeoHead.apiUrl()}/assets/og/release-notes.jpg?v=${this.CARD_DIGEST}`,
      imageAlt: `GGE Tracker ${release.version}, released ${release.releasedOn}`,
    };
  }

  public static async getCard(request: express.Request, response: express.Response): Promise<void> {
    try {
      if (
        HttpCache.handleConditional(request, response, {
          etag: HttpCache.etagFromCacheKey(this.CARD_KEY),
          dataVersion: null,
          maxAgeSeconds: ApiSeo.CARD_MAX_AGE_SECONDS,
        })
      ) {
        return;
      }
      await ApiSeo.sendCachedCard(request, response, this.CARD_KEY, () =>
        ShareCardRenderer.renderHtml(this.CARD_KEY, this.CARD_HTML),
      );
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getReleaseNotesCard', request);
    }
  }

  private static digest(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 20);
  }

  private static summarise(release: ReleaseNote): ReleaseSummary {
    const counts = this.COUNTED_KINDS.map(
      ([kind, label]) => [release.items.filter((item) => item.kind === kind).length, label] as const,
    )
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}`);
    if (release.api_changes.length > 0) {
      counts.push(`${release.api_changes.length} API change${release.api_changes.length === 1 ? '' : 's'}`);
    }
    return {
      version: release.version,
      releasedOn: new Date(`${release.date}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      summary: release.preview?.summary ?? null,
      highlights: release.preview?.highlights.slice(0, this.MAX_CARD_HIGHLIGHTS) ?? [],
      scope: counts.length > 0 ? counts.join(' · ') : null,
    };
  }
}
