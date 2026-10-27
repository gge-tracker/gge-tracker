import {
  AfterViewInit,
  ApplicationRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  ViewChild,
} from '@angular/core';
import { ServerService } from '@ggetracker-services/server.service';
import { SidebarService } from '@ggetracker-services/sidebar.service';
import { IconComponent } from '@ggetracker-components/icon/icon.component';

import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { UtilitiesService } from '@ggetracker-services/utilities.service';
import { RouterModule } from '@angular/router';
import { LanguageService, SiteLanguage } from '@ggetracker-services/language.service';
import { DomPortalOutlet } from '@angular/cdk/portal';
import { TopBarService } from '@ggetracker-services/topbar.service';
import { OverlayModule } from '@angular/cdk/overlay';

@Component({
  selector: 'app-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [IconComponent, FormsModule, TranslateModule, RouterModule, OverlayModule],
  templateUrl: './top-bar.component.html',
  styleUrls: ['./top-bar.component.css'],
})
export class TopBarComponent implements AfterViewInit {
  @ViewChild('topbarHost', { read: ElementRef }) public host!: ElementRef;
  @ViewChild('languageToggle') public languageToggle?: ElementRef<HTMLButtonElement>;
  public sidebarBtn = input<boolean>(true);
  public discordMemberCount = 0;
  public serverService = inject(ServerService);
  public languageService = inject(LanguageService);
  public searchQuery: string = '';
  public languageQuery: string = '';
  public filteredServerInput: string = '';
  public sidebarOpen = false;
  private readonly sidebarService = inject(SidebarService);
  private readonly utilitiesService = inject(UtilitiesService);
  private readonly topBarService = inject(TopBarService);
  private readonly injector = inject(Injector);
  private readonly appRef = inject(ApplicationRef);
  private listener?: (event: PointerEvent) => void;
  private readonly cdr = inject(ChangeDetectorRef);

  constructor() {
    this.utilitiesService.data$.subscribe((data) => {
      this.discordMemberCount = data?.discord_member_count || 0;
    });
    this.sidebarService.isSidebarOpen$.subscribe((open) => {
      this.sidebarOpen = open;
      this.cdr.markForCheck();
    });
  }

  public isSidebarOpen(): boolean {
    return this.sidebarOpen;
  }

  public ngAfterViewInit(): void {
    const outlet = new DomPortalOutlet(this.host.nativeElement, this.appRef, this.injector);
    this.topBarService.registerOutlet(outlet);
    this.listener = this.handlePointerDown.bind(this);
    document.addEventListener('pointerdown', this.listener, { capture: true });
    this.cdr.markForCheck();
  }

  public toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
    this.cdr.markForCheck();
  }
  public isServerMenuOpen(): boolean {
    return this.sidebarService.isServerMenuOpen();
  }
  public toggleServerMenu(): void {
    this.sidebarService.toggleServerMenu();
    this.cdr.markForCheck();
  }

  public selectServer(server: string): void {
    this.serverService.changeServer(server);
    this.cdr.markForCheck();
  }
  public onSearchChange(): void {
    this.sidebarService.setSearchQuery(this.searchQuery);
  }

  @ViewChild('languageSearch') public set languageSearch(input: ElementRef<HTMLInputElement> | undefined) {
    input?.nativeElement.focus();
  }

  public toggleLanguageMenu(): void {
    this.languageQuery = '';
    this.sidebarService.toggleLanguageMenu();
    this.cdr.markForCheck();
  }

  public get filteredLanguages(): SiteLanguage[] {
    return this.languageService.searchLangs(this.languageQuery);
  }

  public selectFirstLanguage(): void {
    const first = this.filteredLanguages[0];
    if (first) this.selectLanguage(first.code);
  }

  public onLanguagePanelKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.sidebarService.closeLanguageMenu();
      this.languageToggle?.nativeElement.focus();
      this.cdr.markForCheck();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const panel = event.currentTarget as HTMLElement;
    const focusable = [
      ...(panel.querySelectorAll<HTMLElement>('.lang-search-input, .lang-option') as unknown as Iterable<HTMLElement>),
    ];
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    focusable[(index + step + focusable.length) % focusable.length]?.focus();
    event.preventDefault();
  }

  public isLanguageMenuOpen(): boolean {
    return this.sidebarService.isLanguageMenuOpen();
  }

  public isDevMode(): boolean {
    return !!localStorage.getItem('lang_dev');
  }

  public selectLanguage(lang: string): void {
    this.languageService.setCurrentLang(lang);
  }

  public disableDevLangOverride(): void {
    localStorage.removeItem('lang_dev');
    globalThis.location.reload();
  }

  public get servers(): string[] {
    return this.serverService.servers.filter(
      (server) =>
        this.filteredServerInput.length === 0 || server.toLowerCase().includes(this.filteredServerInput.toLowerCase()),
    );
  }

  private handlePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    const languageMenu = document.querySelector('#language-menu');
    const serverMenu = document.querySelector('#server-menu');
    if (languageMenu && !languageMenu.contains(target) && !target.classList.contains('language-menu-toggle')) {
      this.sidebarService.closeLanguageMenu();
      this.cdr.markForCheck();
    }
    if (serverMenu && !serverMenu.contains(target) && !target.classList.contains('server-menu-toggle')) {
      this.sidebarService.closeServerMenu();
      this.cdr.markForCheck();
    }
  }
}
