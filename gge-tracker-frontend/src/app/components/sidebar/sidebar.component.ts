import { NgClass, TitleCasePipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import package_ from '../../../../package.json';
import { SidebarService } from '@ggetracker-services/sidebar.service';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { TranslateModule } from '@ngx-translate/core';
import { SITE_NAVIGATION, SiteNavigationItem, SiteNavigationSection } from './site-navigation';

type OrderedSection = SiteNavigationSection & {
  order?: number;
  items: (SiteNavigationItem & { order?: number })[];
};

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, TranslateModule, NgClass, TitleCasePipe],
  standalone: true,
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css'],
  host: {
    '[class.sb-collapsed]': '!isSidebarOpen()',
    '[class.sb-overlay]': 'sidebarService.isMobileView',
  },
})
export class SidebarComponent implements AfterViewInit, OnDestroy {
  @ViewChild('panel', { read: ElementRef }) public panel?: ElementRef<HTMLElement>;
  @ViewChild('scroll', { read: ElementRef }) public scroll?: ElementRef<HTMLElement>;
  public sidebarService = inject(SidebarService);
  public apiRestService = inject(ApiRestService);
  public version = package_.version.split('-')[0].replaceAll('.', '-');
  public readonly menuStructure: OrderedSection[] = structuredClone(SITE_NAVIGATION) as OrderedSection[];

  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private widthObserver?: ResizeObserver;

  constructor() {
    let order = 0;
    for (const section of this.menuStructure) {
      section.order = order++;
      for (const item of section.items) {
        item.order = order++;
      }
    }
  }

  public ngAfterViewInit(): void {
    this.revealActiveItem();

    const panel = this.panel?.nativeElement;
    if (!panel || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.widthObserver = new ResizeObserver(() => {
      const width = panel.getBoundingClientRect().width;
      if (width > 0) {
        this.host.nativeElement.style.setProperty('--sb-w', `${Math.ceil(width)}px`);
      }
    });
    this.widthObserver.observe(panel);
  }

  public ngOnDestroy(): void {
    this.widthObserver?.disconnect();
  }

  public isActive(route: string | string[]): boolean {
    if (route === '/') {
      return /^\/(?:[#?].*)?$/.test(this.router.url);
    }
    if (Array.isArray(route)) {
      return route.some((r) => this.router.url.startsWith('/' + r) || this.router.url.startsWith(r));
    } else if (route.includes('/')) {
      return this.router.url.startsWith('/' + route) || this.router.url.startsWith(route);
    }
    return this.router.url.startsWith('/' + route) || this.router.url.startsWith(route);
  }

  public isSidebarOpen(): boolean {
    return this.sidebarService.isSidebarOpen();
  }

  public closeSidebar(): void {
    this.sidebarService.closeSidebar();
  }

  private revealActiveItem(): void {
    const container = this.scroll?.nativeElement;
    const active = container?.querySelector<HTMLElement>('.active-nav');
    if (!container || !active) {
      return;
    }
    const overflow = container.scrollHeight - container.clientHeight;
    if (overflow <= 0) {
      return;
    }
    const offset = active.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const centered = container.scrollTop + offset - (container.clientHeight - active.offsetHeight) / 2;
    container.scrollTop = Math.max(0, Math.min(centered, overflow));
  }
}
