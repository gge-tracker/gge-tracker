import path from 'node:path';
import { puppeteerManagerInstance } from '../managers/puperteer.manager';

const MAX_IMAGE_DIMENSION = Number(process.env.ASSET_IMAGE_MAX_DIMENSION) || 512;
const WEBP_QUALITY = Number(process.env.ASSET_IMAGE_WEBP_QUALITY) || 0.92;

declare global {
  // Injected into the page by lib/gge-asset-render.js
  var renderGgeAsset: (options: Record<string, unknown>) => Promise<{ webp: string; png: string }>;
}

export interface AssetImageVariant {
  level?: string;
  type?: string;
  quality?: string;
}

export interface RenderedAssetImage {
  /** Absent when the browser declined to encode WebP and handed back a PNG data URL instead */
  webp: Buffer | null;
  png: Buffer;
}

export abstract class AssetImageRenderer {
  private static readonly inFlight = new Map<string, Promise<RenderedAssetImage>>();

  public static variantKey(asset: string, variant: AssetImageVariant): string {
    return [asset, variant.level ?? '', variant.type ?? '', variant.quality ?? ''].join('_');
  }

  public static render(asset: string, variant: AssetImageVariant, baseUrl: string): Promise<RenderedAssetImage> {
    const key = this.variantKey(asset, variant);
    const running = this.inFlight.get(key);
    if (running) return running;
    const job = this.renderOnce(asset, variant, baseUrl).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  private static async renderOnce(
    asset: string,
    variant: AssetImageVariant,
    baseUrl: string,
  ): Promise<RenderedAssetImage> {
    return puppeteerManagerInstance.withPage(async (page) => {
      page.on('pageerror', (error) => console.error('[AssetImageRenderer] page error', asset, String(error)));
      page.on('requestfailed', (request) =>
        console.error('[AssetImageRenderer] request failed', request.url(), request.failure()?.errorText),
      );

      const library = path.join(__dirname, './../lib');
      await page.addScriptTag({ path: path.join(library, 'createjs/createjs.min.js') });
      await page.addScriptTag({ path: path.join(library, 'createjs/easeljs.min.js') });
      await page.addScriptTag({ path: path.join(library, 'createjs/tweenjs.min.js') });
      await page.addScriptTag({ path: path.join(library, 'gge-asset-render.js') });
      await page.addScriptTag({ url: `${baseUrl}/assets/common/${asset}.js` });

      const options = {
        spritesheetUrl: `${baseUrl}/assets/common/${asset}.json`,
        level: variant.level ?? '',
        type: variant.type ?? '',
        quality: variant.quality ?? '',
        maxDimension: MAX_IMAGE_DIMENSION,
        webpQuality: WEBP_QUALITY,
      };
      const rendered = await this.withTimeout(
        page.evaluate((input) => globalThis.renderGgeAsset(input), options),
        `render ${asset}`,
      );

      const png = this.decodeDataUrl(rendered.png, 'image/png');
      if (!png) throw new Error(`The browser returned no PNG for ${asset}`);
      return { webp: this.decodeDataUrl(rendered.webp, 'image/webp'), png };
    });
  }

  private static decodeDataUrl(dataUrl: string, expected: string): Buffer | null {
    if (!dataUrl?.startsWith(`data:${expected};base64,`)) return null;
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  }

  private static async withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
    const limit = puppeteerManagerInstance.getPageTimeoutMs();
    let timer: NodeJS.Timeout;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${limit} ms: ${label}`)), limit);
    });
    try {
      return await Promise.race([work, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }
}
