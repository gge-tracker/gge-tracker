import { NgClass, TitleCasePipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import package_ from '../../../../package.json';
import { SidebarService } from '@ggetracker-services/sidebar.service';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { TranslateModule } from '@ngx-translate/core';

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
  public readonly menuStructure: {
    title: string;
    order?: number;
    items: {
      label: string;
      id?: string;
      url?: string;
      iconUrl?: string;
      iconClass?: string;
      tag?: 'bot' | 'extension';
      frequency?: 'Temps réel' | 'Par heure';
      order?: number;
    }[];
  }[] = [
    {
      title: 'Rechercher et analyser',
      items: [
        { label: 'Joueurs', id: 'players', iconUrl: '/assets/tools/players.webp' },
        { label: 'Alliances', id: 'alliances', iconUrl: '/assets/tools/alliances.webp' },
        { label: 'Changements de nom', id: 'renames', iconUrl: '/assets/tools/renames.webp' },
        { label: 'Mouvements', id: 'movements', iconUrl: '/assets/tools/movements.webp' },
      ],
    },
    {
      title: 'Outils tactiques',
      items: [
        { label: 'Cartographie', id: 'map', iconUrl: '/assets/tools/cartography.webp' },
        { label: 'Forteresses', id: 'dungeons', iconUrl: '/assets/tools/fortresses.webp', frequency: 'Temps réel' },
        {
          label: 'Îles orageuses',
          id: 'storm-tracker',
          iconUrl: '/assets/storm-tracker/fort.png',
          frequency: 'Temps réel',
        },
        { label: 'Châteaux', id: 'castles', iconUrl: '/assets/tools/castles.webp', frequency: 'Temps réel' },
      ],
    },
    {
      title: 'Scores et classements',
      items: [
        {
          label: 'temp_server_name_tooltip',
          id: 'live/outer-realms',
          iconUrl: '/assets/tools/or.webp',
          frequency: 'Temps réel',
        },
        { label: 'Le Grand Tournoi', id: 'grand-tournament', iconUrl: '/assets/tools/gt.webp', frequency: 'Par heure' },
        { label: 'Scores finaux', id: 'events', iconUrl: '/assets/tools/events.webp' },
        {
          label: 'Roue des richesses inimaginables',
          id: 'woa',
          iconUrl: '/assets/tools/woa.webp',
        },
        {
          label: 'Classement des aigues-marines',
          id: 'stormy-isles',
          iconUrl: '/assets/tools/aquamarine.webp',
          frequency: 'Par heure',
        },
      ],
    },
    {
      title: 'Analytique',
      items: [
        { label: 'Statistiques', id: 'statistics', iconUrl: '/assets/tools/stats.webp' },
        { label: 'Offres', id: 'offers', iconUrl: '/assets/tools/shop.webp' },
      ],
    },
    {
      title: 'Défis quotidiens',
      items: [{ label: 'Qui est-ce ?', id: 'guess', iconUrl: '/assets/tools/guess.webp' }],
    },
    {
      title: 'À découvrir',
      items: [
        {
          label: 'empire-rankings.io',
          url: 'https://danadum.github.io/empire-rankings/',
          iconUrl: '/assets/tools/empire-rankings.webp',
        },
        {
          label: 'GGE Assistant',
          url: 'https://top.gg/bot/1472309793065533493',
          iconClass: 'fa-brands fa-discord',
          tag: 'bot',
        },
        {
          label: 'GGE WebSocket Studio',
          url: 'https://chromewebstore.google.com/detail/gge-websocket-studio/deaaangkjfdcpegbebpdhkiknaniomeg',
          iconClass: 'fa-brands fa-chrome',
          tag: 'extension',
        },
      ],
    },
  ];

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
