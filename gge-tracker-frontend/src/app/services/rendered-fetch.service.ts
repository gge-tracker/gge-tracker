import { inject, Injectable, makeStateKey, NgZone, PendingTasks, REQUEST, TransferState } from '@angular/core';
import { environment } from 'environments/environment';
import { SERVER_API_URL } from './server-api-url.token';

export interface RenderedResponse<T> {
  status: number;
  body: T | null;
}

const FORWARDED_HEADERS: Record<string, string> = {
  'cf-connecting-ip': 'cf-connecting-ip',
  'user-agent': 'user-agent',
  'accept-language': 'accept-language',
  'x-visitor-forwarded-for': 'x-forwarded-for',
};

@Injectable({ providedIn: 'root' })
export class RenderedFetchService {
  private readonly transferState = inject(TransferState);
  private readonly serverApiUrl = inject(SERVER_API_URL, { optional: true });
  private readonly request = inject(REQUEST, { optional: true });
  private readonly pendingTasks = inject(PendingTasks);
  private readonly ngZone = inject(NgZone);

  public fetchJson<T>(url: string, init: RequestInit = {}): Promise<RenderedResponse<T>> {
    return this.fetchRendered(url, init, (response) => response.json().catch(() => null));
  }

  public fetchText(url: string, init: RequestInit = {}): Promise<RenderedResponse<string>> {
    return this.fetchRendered(url, init, (response) => response.text());
  }

  private async fetchRendered<T>(
    url: string,
    init: RequestInit,
    read: (response: Response) => Promise<T | null>,
  ): Promise<RenderedResponse<T>> {
    const key = makeStateKey<RenderedResponse<T>>(`api ${new Headers(init.headers).get('gge-server') ?? ''} ${url}`);
    const rendered = this.transferState.get(key, null);
    if (rendered) {
      this.transferState.remove(key);
      return rendered;
    }
    if (!this.serverApiUrl) {
      const response = await fetch(url, init);
      return { status: response.status, body: await read(response) };
    }
    const done = this.pendingTasks.add();
    try {
      const serverUrl = url.replace(environment.apiUrl, this.serverApiUrl);
      const headers = this.forwarded(init.headers);
      const result = await this.ngZone.runOutsideAngular(async (): Promise<RenderedResponse<T>> => {
        const response = await fetch(serverUrl, { ...init, headers });
        return { status: response.status, body: await read(response) };
      });
      if (result.status >= 200 && result.status < 300) this.transferState.set(key, result);
      return result;
    } finally {
      done();
    }
  }
  private forwarded(headers: HeadersInit | undefined): Headers {
    const forwarded = new Headers(headers);
    for (const [received, sent] of Object.entries(FORWARDED_HEADERS)) {
      const value = this.request?.headers.get(received);
      if (value) forwarded.set(sent, value);
    }
    return forwarded;
  }
}
