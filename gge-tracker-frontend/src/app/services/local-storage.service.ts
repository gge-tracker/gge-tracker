import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, REQUEST, inject } from '@angular/core';

const COOKIE_KEYS = new Set(['lang', 'server']);
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 3600;

@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly request = inject(REQUEST, { optional: true });

  constructor() {
    if (this.isBrowser()) {
      for (const key of COOKIE_KEYS) {
        const value = localStorage.getItem(key);
        if (value) this.writeCookie(key, value);
      }
    }
  }

  public getItem(key: string): string | null {
    if (!COOKIE_KEYS.has(key)) {
      return this.isBrowser() ? localStorage.getItem(key) : null;
    }
    if (this.isBrowser()) {
      return localStorage.getItem(key) ?? this.readCookie(document.cookie, key);
    }
    return this.readCookie(this.request?.headers.get('cookie') ?? '', key);
  }

  public setItem(key: string, value: string): void {
    if (this.isBrowser()) {
      localStorage.setItem(key, value);
      if (COOKIE_KEYS.has(key)) this.writeCookie(key, value);
    }
  }

  public removeItem(key: string): void {
    if (this.isBrowser()) {
      localStorage.removeItem(key);
      if (COOKIE_KEYS.has(key)) document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  }

  public clear(): void {
    if (this.isBrowser()) {
      localStorage.clear();
    }
  }

  private writeCookie(key: string, value: string): void {
    document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`;
  }

  private readCookie(cookies: string, key: string): string | null {
    const value = cookies
      .split(';')
      .map((cookie) => cookie.trim().split('='))
      .find(([name]) => name === key)?.[1];
    return value ? decodeURIComponent(value) : null;
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}
