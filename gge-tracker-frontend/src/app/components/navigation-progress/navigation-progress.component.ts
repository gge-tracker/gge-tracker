import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';

const SHOW_AFTER_MS = 120;

@Component({
  selector: 'app-navigation-progress',
  templateUrl: './navigation-progress.component.html',
  styleUrl: './navigation-progress.component.css',
  imports: [TranslatePipe],
})
export class NavigationProgressComponent {
  public readonly visible = signal(false);

  private pendingShow: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event instanceof NavigationStart) this.scheduleShow();
        else if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        )
          this.hide();
      });
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  private scheduleShow(): void {
    if (this.pendingShow) clearTimeout(this.pendingShow);
    this.pendingShow = setTimeout(() => this.visible.set(true), SHOW_AFTER_MS);
  }

  private hide(): void {
    if (this.pendingShow) clearTimeout(this.pendingShow);
    this.pendingShow = null;
    this.visible.set(false);
  }
}
