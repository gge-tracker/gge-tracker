import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';

@Injectable({
  providedIn: 'root',
})
export class PageTemplateService {
  private readonly router = inject(Router);

  public current(): string {
    const segments: string[] = [];
    let snapshot: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    while (snapshot) {
      const path = snapshot.routeConfig?.path;
      if (path) segments.push(path);
      snapshot = snapshot.firstChild;
    }
    return '/' + segments.join('/');
  }
}
