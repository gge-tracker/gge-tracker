import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { ApiRestService } from './api-rest.service';
import { ToastService } from './toast.service';
import { ApiLastUpdates, ErrorType } from '@ggetracker-interfaces/empire-ranking';

@Injectable({
  providedIn: 'root',
})
export class UtilitiesService {
  public lastUpdate?: string;
  public dataSubject = new BehaviorSubject<ApiLastUpdates | null>(null);
  public data$ = this.dataSubject.asObservable();
  private apiRestService = inject(ApiRestService);
  private toastService = inject(ToastService);
  private translateService = inject(TranslateService);

  constructor() {
    this.loadLastUpdates();
  }

  public loadLastUpdates(): void {
    void this.apiRestService.getLastUpdates(true).then((response) => {
      try {
        if (!response.success) throw new Error('Error fetching last updates');
        const lastUpdate = response.data;
        this.dataSubject.next(lastUpdate);
        const dateLoot = new Date(lastUpdate.last_update['loot']);
        const dateMight = new Date(lastUpdate.last_update['might']);
        setInterval(() => {
          void this.updateRefreshDate(dateLoot, dateMight);
        }, 60_000);
        void this.updateRefreshDate(dateLoot, dateMight);
      } catch {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      }
    });
  }

  private async updateRefreshDate(dateLoot: Date, dateMight: Date): Promise<void> {
    if (dateMight.getTime() < dateLoot.getTime()) {
      const translation = await firstValueFrom(this.translateService.get('Mise à jour en cours'));
      this.lastUpdate = translation;
      return;
    }
    const now = new Date();
    const diff = now.getTime() - dateMight.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const langs = {
      jour: await firstValueFrom(this.translateService.get('jour')),
      jours: await firstValueFrom(this.translateService.get('jours')),
      heure: await firstValueFrom(this.translateService.get('heure')),
      heures: await firstValueFrom(this.translateService.get('heures')),
      minute: await firstValueFrom(this.translateService.get('minute')),
      minutes: await firstValueFrom(this.translateService.get('minutes')),
      seconde: await firstValueFrom(this.translateService.get('seconde')),
      secondes: await firstValueFrom(this.translateService.get('secondes')),
      'il y a': await firstValueFrom(this.translateService.get('il y a')),
      et: await firstValueFrom(this.translateService.get('et')),
    };
    if (days > 0) {
      this.lastUpdate = `${langs['il y a']} ${days} ${langs[days > 1 ? 'jours' : 'jour']}`;
    } else if (hours > 0) {
      this.lastUpdate = `${langs['il y a']} ${hours} ${langs[hours > 1 ? 'heures' : 'heure']} ${langs['et']} ${minutes % 60} ${langs[minutes % 60 > 1 ? 'minutes' : 'minute']}`;
    } else if (minutes > 0) {
      this.lastUpdate = `${langs['il y a']} ${minutes} ${langs[minutes > 1 ? 'minutes' : 'minute']}`;
    } else {
      this.lastUpdate = `${langs['il y a']} ${seconds} ${langs[seconds > 1 ? 'secondes' : 'seconde']}`;
    }
  }
}
