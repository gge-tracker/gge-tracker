import {
  AfterViewInit,
  ApplicationRef,
  Component,
  ComponentFactoryResolver,
  ElementRef,
  inject,
  Injector,
  ViewChild,
} from '@angular/core';
import { ServerService } from '@ggetracker-services/server.service';
import { SidebarService } from '@ggetracker-services/sidebar.service';
import { IconComponent } from '@ggetracker-components/icon/icon.component';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { UtilitiesService } from '@ggetracker-services/utilities.service';
import { RouterModule } from '@angular/router';
import { LanguageService } from '@ggetracker-services/language.service';
import { DomPortalOutlet } from '@angular/cdk/portal';
import { TopBarService } from '@ggetracker-services/topbar.service';
import { OverlayModule } from '@angular/cdk/overlay';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [IconComponent, NgFor, NgIf, FormsModule, TranslateModule, RouterModule, OverlayModule],
  templateUrl: './top-bar.component.html',
  styleUrls: ['./top-bar.component.css'],
})
export class TopBarComponent implements AfterViewInit {
  @ViewChild('topbarHost', { read: ElementRef }) public host!: ElementRef;
  public discordMemberCount = 0;
  public serverService = inject(ServerService);
  public languageService = inject(LanguageService);
  public searchQuery: string = '';
  public filteredServerInput: string = '';
  private sidebarService = inject(SidebarService);
  private utilitiesService = inject(UtilitiesService);
  private topBarService = inject(TopBarService);
  private injector = inject(Injector);
  private appRef = inject(ApplicationRef);
  private componentFactoryResolver = inject(ComponentFactoryResolver);
  private listener?: (event: PointerEvent) => void;

  constructor() {
    this.utilitiesService.data$.subscribe((data) => {
      this.discordMemberCount = data?.discord_member_count || 0;
    });
  }

  public ngAfterViewInit(): void {
    const outlet = new DomPortalOutlet(
      this.host.nativeElement,
      this.componentFactoryResolver,
      this.appRef,
      this.injector,
    );
    this.topBarService.registerOutlet(outlet);
    this.listener = this.handlePointerDown.bind(this);
    // Add pointerdown listener to the document to handle closing menus. We cannot use Angular CDK Overlay
    // or click events because native elements like dataLists will be broken.
    document.addEventListener('pointerdown', this.listener, { capture: true });
  }

  public toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
  public isServerMenuOpen(): boolean {
    return this.sidebarService.isServerMenuOpen();
  }
  public toggleServerMenu(): void {
    this.sidebarService.toggleServerMenu();
  }

  public selectServer(server: string): void {
    this.serverService.changeServer(server);
  }
  public onSearchChange(): void {
    this.sidebarService.setSearchQuery(this.searchQuery);
  }

  public toggleLanguageMenu(): void {
    this.sidebarService.toggleLanguageMenu();
  }

  public isLanguageMenuOpen(): boolean {
    return this.sidebarService.isLanguageMenuOpen();
  }

  public selectLanguage(lang: string): void {
    this.languageService.setCurrentLang(lang);
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
    }
    if (serverMenu && !serverMenu.contains(target) && !target.classList.contains('server-menu-toggle')) {
      this.sidebarService.closeServerMenu();
    }
  }
}
