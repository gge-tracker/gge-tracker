import { NavigationError } from '@angular/router';

const STALE_CHUNK_MESSAGE = /dynamically imported module|importing a module script failed/i;
const RELOAD_GUARD_KEY = 'stale-chunk-reload-at';
const RELOAD_GUARD_MS = 30_000;

export function reloadOnStaleChunk(error: NavigationError): void {
  if (!STALE_CHUNK_MESSAGE.test(String((error.error as Error | undefined)?.message))) return;
  try {
    const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY));
    if (Date.now() - lastReload < RELOAD_GUARD_MS) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    return;
  }
  location.assign(error.url);
}
