import { Pipe, PipeTransform, ChangeDetectorRef, NgZone, OnDestroy, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Pipe({
  name: 'cooldown',
  standalone: true,
  pure: false,
})
export class CooldownPipe implements PipeTransform, OnDestroy {
  private translateService = inject(TranslateService);
  private timer: ReturnType<typeof setInterval> | null = null;

  private translations: Record<string, string> = {};

  constructor(
    private reference: ChangeDetectorRef,
    private zone: NgZone,
  ) {
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => {
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

  public transform(cooldown: string, lastAttackDate: string): string {
    const updatedDate = new Date(cooldown);
    const endTime = new Date(updatedDate);
    const now = new Date();
    // We are adding 1 second to the end time to ensure that the cooldown is considered over after the last second
    const remaining = endTime.getTime() - now.getTime() + 1000;
    if (remaining <= 0) {
      const cooldownDuration = 24 * 60 * 60 * 1000;
      const lastAttackDateTime = new Date(lastAttackDate).getTime();
      const elapsed = now.getTime() - lastAttackDateTime - cooldownDuration;
      const totalSeconds = Math.floor(elapsed / 1000);
      const hours = Math.floor(totalSeconds / 3600)
        .toString()
        .padStart(2, '0');
      const minutes = Math.floor((totalSeconds % 3600) / 60)
        .toString()
        .padStart(2, '0');
      const seconds = (totalSeconds % 60).toString().padStart(2, '0');
      if (elapsed <= 0) {
        return this.translations['Attaquable'];
      }
      const elapsedTime = `${hours}${this.translations['heures']} ${minutes}${this.translations['minutes']} ${seconds}${this.translations['secondes']}`;
      if (Number(hours) > 480_000) {
        return this.translations['Attaquable'] + ' (?)';
      }
      return this.translations['Attaquable'] + ' (' + this.translations['depuis'] + ' ' + elapsedTime + ')';
    }
    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${days ? days + this.translations['jours'] + ' ' : ''}${hours}${this.translations['heures']} ${minutes}${this.translations['minutes']} ${seconds}${this.translations['secondes']}`;
  }
}
