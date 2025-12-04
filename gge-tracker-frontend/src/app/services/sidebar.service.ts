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
    this._isSidebarOpen.next(!this._isSidebarOpen.value);
    document.body.classList.toggle('no-scroll', this.isMobileView && this._isSidebarOpen.value);
  }

  public closeLanguageMenu(): void {
    this._isLanguageMenuOpen.next(false);
  }

  public closeSidebar(): void {
    this._isSidebarOpen.next(false);
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
}
