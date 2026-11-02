import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable, switchMap, timer } from 'rxjs';

const PRELOAD_DELAY_MS = 5000;

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

@Injectable({ providedIn: 'root' })
export class CoreRoutePreloading implements PreloadingStrategy {
  public preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.['preload'] !== true || this.savesData()) return EMPTY;
    return timer(PRELOAD_DELAY_MS).pipe(switchMap(() => load()));
  }

  private savesData(): boolean {
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    return connection?.saveData === true || /2g/.test(connection?.effectiveType ?? '');
  }
}
