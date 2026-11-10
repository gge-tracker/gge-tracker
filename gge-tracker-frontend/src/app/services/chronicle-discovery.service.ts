import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { LocalStorageService } from './local-storage.service';

export const CHRONICLE_PROMOTED_YEAR = 2026;

const PROMOTION_START_MS = Date.UTC(2026, 10, 1);
// First instant after June 1st, the last day the entry points are shown
const PROMOTION_END_MS = Date.UTC(2027, 5, 2);
const OPENED_KEY = `chronicle-${CHRONICLE_PROMOTED_YEAR}-opened`;
const INTRO_SHOWN_KEY = `chronicle-${CHRONICLE_PROMOTED_YEAR}-intro-shown`;

@Injectable({ providedIn: 'root' })
export class ChronicleDiscoveryService {
  public readonly promoted =
    environment.chronicleEnabled && Date.now() >= PROMOTION_START_MS && Date.now() < PROMOTION_END_MS;
  public readonly opened = signal(false);

  private readonly localStorage = inject(LocalStorageService);
  private readonly introShown = signal(false);

  constructor() {
    this.opened.set(this.isStored(OPENED_KEY));
    this.introShown.set(this.isStored(INTRO_SHOWN_KEY));
  }

  public isIntroPending(): boolean {
    return this.promoted && !this.opened() && !this.introShown();
  }

  public markOpened(): void {
    this.opened.set(true);
    this.store(OPENED_KEY);
  }

  public markIntroShown(): void {
    this.introShown.set(true);
    this.store(INTRO_SHOWN_KEY);
  }

  private isStored(key: string): boolean {
    try {
      return this.localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  private store(key: string): void {
    try {
      this.localStorage.setItem(key, '1');
    } catch {}
  }
}
