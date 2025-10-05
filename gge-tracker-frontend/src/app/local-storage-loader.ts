import { inject } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import { LocalStorageService } from '@ggetracker-services/local-storage.service';

export class LocalStorageTranslateLoader implements TranslateLoader {
  private localStorage = inject(LocalStorageService);

  public getTranslation(): Observable<TranslationObject> {
    const localLang = this.localStorage.getItem('lang_dev');
    if (localLang) {
      try {
        const json = JSON.parse(localLang);
        return of(json);
      } catch (e) {
        console.error('Erreur parsing lang_dev from localStorage', e);
        return of({});
      }
    }
    return of({});
  }
}
