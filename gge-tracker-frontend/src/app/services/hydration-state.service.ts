import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ApplicationRef, inject, Injectable, PLATFORM_ID } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class HydrationStateService {
  private hydrating =
    isPlatformBrowser(inject(PLATFORM_ID)) && inject(DOCUMENT).querySelector('[ng-server-context]') !== null;

  constructor() {
    if (this.hydrating) {
      void inject(ApplicationRef)
        .whenStable()
        .then(() => (this.hydrating = false));
    }
  }

  public isHydrating(): boolean {
    return this.hydrating;
  }
}
