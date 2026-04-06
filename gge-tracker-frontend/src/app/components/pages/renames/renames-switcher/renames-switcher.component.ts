import { Component, OnDestroy, AfterViewInit, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { CURRENT } from '../rename.token';

@Component({
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  selector: 'app-renames-switcher',
  templateUrl: './renames-switcher.component.html',
  styleUrls: ['./renames-switcher.component.css'],
})
export class RenamesSwitcherComponent implements AfterViewInit, OnDestroy {
  public current = inject(CURRENT, { optional: true });
  public currentViewType?: 'players' | 'alliances';

  private destroy$ = new Subject<void>();
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  public ngAfterViewInit(): void {
    const inValue = this.current;
    this.currentViewType = inValue as 'players' | 'alliances';
    this.cdr.markForCheck();
  }

  public ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  public go(type: 'players' | 'alliances'): void {
    this.currentViewType = type;
    void this.router.navigate(['/renames', type]);
    this.cdr.markForCheck();
  }
}
