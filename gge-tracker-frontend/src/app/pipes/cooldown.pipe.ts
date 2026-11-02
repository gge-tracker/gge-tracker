import { Pipe, PipeTransform, ChangeDetectorRef, NgZone, OnDestroy, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export interface CooldownTarget {
  effectiveCooldownUntil?: string | null;
  globalAvailableAt?: string | null;
  availableSinceObserved?: boolean;
}

export type CooldownDisplay = 'state' | 'elapsed';

@Pipe({
  name: 'cooldown',
  standalone: true,
  pure: false,
})
export class CooldownPipe implements PipeTransform, OnDestroy {
  private readonly translateService = inject(TranslateService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private now = Date.now();

  private translations: Record<string, string> = {};

  constructor(
    private readonly reference: ChangeDetectorRef,
    private readonly zone: NgZone,
  ) {
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => {
        this.now = Date.now();
        this.zone.run(() => this.reference.markForCheck());
      }, 1000);
    });
    this.translateService
      .get(['jours_j', 'heures_h', 'minutes_m', 'secondes_s', 'Attaquable', 'depuis'])
      .subscribe((translations) => {
        this.translations = {
          jours: translations['jours_j'],
          heures: translations['heures_h'],
          minutes: translations['minutes_m'],
          secondes: translations['secondes_s'],
          Attaquable: translations['Attaquable'],
          depuis: translations['depuis'],
        };
      });
  }

  public ngOnDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  public transform(dungeon: CooldownTarget, display: CooldownDisplay = 'state'): string {
    const availableAt = new Date(dungeon.effectiveCooldownUntil || dungeon.globalAvailableAt || 0);
    const now = new Date(this.now);
    // We are adding 1 second to the end time to ensure that the cooldown is considered over after the last second
    const remaining = availableAt.getTime() - now.getTime() + 1000;
    if (remaining <= 0) {
      const elapsed = now.getTime() - availableAt.getTime();
      return display === 'elapsed' ? this.formatElapsed(elapsed, dungeon) : this.formatAvailable(elapsed);
    }
    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${days ? days + this.translations['jours'] + ' ' : ''}${hours ? hours + this.translations['heures'] + ' ' : ''}${minutes}${this.translations['minutes']} ${seconds}${this.translations['secondes']}`;
  }

  private formatAvailable(elapsed: number): string {
    if (elapsed <= 0) {
      return this.translations['Attaquable'];
    }
    if (Math.floor(elapsed / 3_600_000) > 480_000) {
      return this.translations['Attaquable'] + ' (?)';
    }
    return (
      this.translations['Attaquable'] + ' (' + this.translations['depuis'] + ' ' + this.formatElapsedTime(elapsed) + ')'
    );
  }

  private formatElapsed(elapsed: number, target: CooldownTarget): string {
    if (elapsed <= 0) return '';
    const atLeast = target.availableSinceObserved === false ? '≥ ' : '';
    return this.translations['depuis'] + ' ' + atLeast + this.formatElapsedTime(elapsed);
  }

  private formatElapsedTime(elapsed: number): string {
    const totalSeconds = Math.floor(elapsed / 1000);
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${hours == '00' ? '' : hours + this.translations['heures']} ${minutes}${this.translations['minutes']} ${seconds}${this.translations['secondes']}`;
  }
}
