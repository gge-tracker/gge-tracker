import * as express from 'express';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import { ApiHelper } from '../api-helper';

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface EncodedBody {
  br: Buffer;
  gzip: Buffer;
}

export abstract class PrecompressedJson {
  private static readonly MAX_ENTRIES = 16;
  private static readonly BROTLI_QUALITY = 9;
  private static readonly entries = new Map<string, Promise<EncodedBody>>();

  public static async send(
    request: express.Request,
    response: express.Response,
    key: string,
    loadPayload: () => Promise<string>,
  ): Promise<void> {
    const body = await this.encoded(key, loadPayload);
    const encoding = request.acceptsEncodings('br', 'gzip');
    response.setHeader('Vary', 'Accept-Encoding');
    response.status(ApiHelper.HTTP_OK).type('application/json');
    if (encoding === 'br' || encoding === 'gzip') {
      response.setHeader('Content-Encoding', encoding);
      response.send(body[encoding]);
      return;
    }
    response.send(await gunzip(body.gzip));
  }

  private static encoded(key: string, loadPayload: () => Promise<string>): Promise<EncodedBody> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const pending = this.encode(loadPayload);
    this.entries.set(key, pending);
    pending.catch(() => this.entries.delete(key));
    while (this.entries.size > this.MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return pending;
  }

  private static async encode(loadPayload: () => Promise<string>): Promise<EncodedBody> {
    const payload = Buffer.from(await loadPayload());
    const [br, gzipped] = await Promise.all([
      brotliCompress(payload, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: this.BROTLI_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: payload.length,
        },
      }),
      gzip(payload, { level: 9 }),
    ]);
    return { br, gzip: gzipped };
  }
}
