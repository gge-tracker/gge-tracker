import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import package_ from '../../../../package.json';
import { SidebarService } from '@ggetracker-services/sidebar.service';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [NgFor, RouterLink, NgIf, TranslateModule, NgClass],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css'],
})
export class SidebarComponent {
  public sidebarService = inject(SidebarService);
  public apiRestService = inject(ApiRestService);
  public version = package_.version.split('-')[0].replaceAll('.', '-');
  public readonly menuStructure: {
    title: string;
    items: { label: string; id?: string; url?: string; iconUrl?: string; frequency?: 'Temps réel' | 'Par heure' }[];
  }[] = [
    {
      title: 'Rechercher et analyser',
      items: [
        { label: 'Joueurs', id: 'players', iconUrl: '/assets/tools/players.webp' },
        { label: 'Alliances', id: 'alliances', iconUrl: '/assets/tools/alliances.webp' },
        { label: 'Changements de nom', id: 'renames/players', iconUrl: '/assets/tools/renames.webp' },
        { label: 'Mouvements', id: 'movements', iconUrl: '/assets/tools/movements.webp' },
      ],
    },
    {
      title: 'Outils tactiques',
      items: [
        { label: 'Cartographie', id: 'map', iconUrl: '/assets/tools/cartography.webp' },
        { label: 'Forteresses', id: 'dungeons', iconUrl: '/assets/tools/fortresses.webp', frequency: 'Temps réel' },
        { label: 'Châteaux', id: 'castles', iconUrl: '/assets/tools/castles.webp', frequency: 'Temps réel' },
      ],
    },
    {
      title: 'Scores et classements',
      items: [
        { label: 'Outer Realms', id: 'live/outer-realms', iconUrl: '/assets/tools/or.webp', frequency: 'Temps réel' },
        { label: 'Le Grand Tournoi', id: 'grand-tournament', iconUrl: '/assets/tools/gt.webp', frequency: 'Par heure' },
        { label: 'Scores finaux', id: 'events', iconUrl: '/assets/tools/events.webp' },
      ],
    },
    {
      title: 'Analytique',
      items: [{ label: 'Statistiques', id: 'statistics', iconUrl: '/assets/tools/stats.webp' }],
    },
    {
      title: 'Défis quotidiens',
      items: [{ label: 'Qui est-ce ?', id: 'guess', iconUrl: '/assets/tools/guess.webp' }],
    },
    {
      title: 'Autres outils',
      items: [
        {
          label: 'Empire-Rankings',
          url: 'https://danadum.github.io/empire-rankings/',
          iconUrl: '/assets/tools/empire-rankings.webp',
        },
      ],
    },
  ];

  private router = inject(Router);

  public isActive(route: string | string[]): boolean {
    if (Array.isArray(route)) {
      return route.some((r) => this.router.url.startsWith('/' + r) || this.router.url.startsWith(r));
    }
    return this.router.url.startsWith('/' + route) || this.router.url.startsWith(route);
  }

  public isSidebarOpen(): boolean {
    return this.sidebarService.isSidebarOpen();
  }
}
