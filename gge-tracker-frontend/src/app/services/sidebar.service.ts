import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, REQUEST, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SidebarService {
  private static readonly OVERLAY_MAX_WIDTH = 1200;
  public _isSidebarOpen = new BehaviorSubject<boolean>(true);
  public isSidebarOpen$ = this._isSidebarOpen.asObservable();
  public _isServerMenuOpen = new BehaviorSubject<boolean>(false);
  public isServerMenuOpen$ = this._isServerMenuOpen.asObservable();
  public _isLanguageMenuOpen = new BehaviorSubject<boolean>(false);
  public isLanguageMenuOpen$ = this._isLanguageMenuOpen.asObservable();
  public _searchQuery = new BehaviorSubject<string>('');
  public searchQuery$ = this._searchQuery.asObservable();
  public isMobileView: boolean;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly request = inject(REQUEST, { optional: true });

  constructor() {
    this.isMobileView = this.measureMobileView();
    if (this.isMobileView) {
      this._isSidebarOpen.next(false);
    }
    if (isPlatformBrowser(this.platformId)) {
      this.handleResize = this.handleResize.bind(this);
      window.addEventListener('resize', this.handleResize);
    }
  }

  public setSearchQuery(query: string): void {
    this._searchQuery.next(query);
  }

  public toggleLanguageMenu(): void {
    this._isLanguageMenuOpen.next(!this._isLanguageMenuOpen.value);
  }

  public isLanguageMenuOpen(): boolean {
    return this._isLanguageMenuOpen.value;
  }

  public toggleSidebar(): void {
    this.updateSidebarState(!this._isSidebarOpen.value);
    document.body.classList.toggle('no-scroll', this._isSidebarOpen.value && this.isMobileView);
  }

  public closeLanguageMenu(): void {
    this._isLanguageMenuOpen.next(false);
  }

  public closeSidebar(): void {
    this.updateSidebarState(false);
    document.body.classList.remove('no-scroll');
  }

  public closeServerMenu(): void {
    this._isServerMenuOpen.next(false);
  }

  public isSidebarOpen(): boolean {
    return this._isSidebarOpen.value;
  }

  public toggleServerMenu(): void {
    this._isServerMenuOpen.next(!this._isServerMenuOpen.value);
  }

  public isServerMenuOpen(): boolean {
    return this._isServerMenuOpen.value;
  }

  private updateSidebarState(state: boolean): void {
    if (this.isSidebarOpen()) {
      globalThis.removeEventListener('click', this.onGlobalClick);
    } else {
      setTimeout(() => {
        globalThis.addEventListener('click', this.onGlobalClick, { once: true });
      }, 100);
    }
    this._isSidebarOpen.next(state);
  }

  private readonly onGlobalClick = (): void => {
    if (this.isSidebarOpen() && this.isMobileView) {
      this.closeSidebar();
    }
  };

  private measureMobileView(): boolean {
    if (isPlatformBrowser(this.platformId)) return window.innerWidth < SidebarService.OVERLAY_MAX_WIDTH;
    return /mobi|android|ipad|tablet/i.test(this.request?.headers.get('user-agent') ?? '');
  }

  private handleResize(): void {
    const wasMobileView = this.isMobileView;
    this.isMobileView = window.innerWidth < SidebarService.OVERLAY_MAX_WIDTH;
    if (this.isMobileView && !wasMobileView) {
      this.closeSidebar();
      globalThis.removeEventListener('click', this.onGlobalClick);
    }
  }
}
