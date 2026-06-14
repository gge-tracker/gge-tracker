import { Pipe, PipeTransform, OnDestroy, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Pipe({
  name: 'duration',
  standalone: true,
})
export class DurationPipe implements PipeTransform, OnDestroy {
  private translateService = inject(TranslateService);
  private timer: ReturnType<typeof setInterval> | null = null;

  private translations: Record<string, string> = {};

  constructor() {
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

  public transform(availableDurationSeconds: number): string {
    const hours = Math.floor(availableDurationSeconds / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((availableDurationSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (availableDurationSeconds % 60).toString().padStart(2, '0');
    return `~ ${hours === '00' ? '' : hours + this.translations['heures'] + ' '}${minutes}${this.translations['minutes']} ${seconds}${this.translations['secondes']}`;
  }
}
