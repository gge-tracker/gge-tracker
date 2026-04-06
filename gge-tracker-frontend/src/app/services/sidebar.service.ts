import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class SidebarService {
  public _isSidebarOpen = new BehaviorSubject<boolean>(true);
  public isSidebarOpen$ = this._isSidebarOpen.asObservable();
  public _isServerMenuOpen = new BehaviorSubject<boolean>(false);
  public isServerMenuOpen$ = this._isServerMenuOpen.asObservable();
  public _isLanguageMenuOpen = new BehaviorSubject<boolean>(false);
  public isLanguageMenuOpen$ = this._isLanguageMenuOpen.asObservable();
  public _searchQuery = new BehaviorSubject<string>('');
  public searchQuery$ = this._searchQuery.asObservable();
  public isMobileView: boolean = window.innerWidth < 768;

  constructor() {
    if (this.isMobileView) {
      this._isSidebarOpen.next(false);
    }
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
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

  private handleResize(): void {
    const wasMobileView = this.isMobileView;
    this.isMobileView = window.innerWidth < 768;
    if (this.isMobileView && !wasMobileView) {
      this.closeSidebar();
      globalThis.removeEventListener('click', this.onGlobalClick);
    }
  }
}
