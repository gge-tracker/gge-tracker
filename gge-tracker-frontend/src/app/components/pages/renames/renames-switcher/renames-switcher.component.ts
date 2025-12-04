import { Component, OnDestroy, AfterViewInit, inject, input } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { filter, Subject, takeUntil } from 'rxjs';

@Component({
  standalone: true,
  imports: [TranslateModule],
  selector: 'app-renames-switcher',
  templateUrl: './renames-switcher.component.html',
  styleUrls: ['./renames-switcher.component.css'],
})
export class RenamesSwitcherComponent implements AfterViewInit, OnDestroy {
  public current = input<string>();
  public currentViewType?: 'players' | 'alliances';

  private destroy$ = new Subject<void>();
  private router = inject(Router);

  public ngAfterViewInit(): void {
    const inValue = this.current();
    if (inValue) {
      this.currentViewType = inValue as 'players' | 'alliances';
      return;
    }
    this.updateCurrentViewTypeFromUrl(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        this.updateCurrentViewTypeFromUrl(event.urlAfterRedirects);
      });
  }

  public ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public go(type: 'players' | 'alliances'): void {
    this.currentViewType = type;
    void this.router.navigate(['/renames', type]);
  }

  private updateCurrentViewTypeFromUrl(url: string): void {
    this.currentViewType = url.includes('players') ? 'players' : 'alliances';
  }
}
