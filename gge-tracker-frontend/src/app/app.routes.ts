import { Routes } from '@angular/router';

import { SkeletonComponent } from '@ggetracker-components/skeleton/skeleton.component';
import { PlayerStatsResolver } from '@ggetracker-resolvers/player-stats.resolver';
import { titleResolver } from '@ggetracker-resolvers/title.resolver';

export const routes: Routes = [
  {
    path: 'maintenance',
    loadComponent: () =>
      import('@ggetracker-components/maintenance/maintenance.component').then((m) => m.MaintenanceComponent),
    data: {
      description: '',
      titleKey: 'Maintenance',
    },
  },
  {
    path: 'release-notes',
    loadComponent: () =>
      import('@ggetracker-pages/release-notes/release-notes.component').then((m) => m.ReleaseNotesComponent),
    data: {
      description: 'Discover the latest updates and changes in the Goodgame Empire Tracker.',
      titleKey: 'Release Notes',
    },
  },
  {
    path: '',
    component: SkeletonComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('@ggetracker-pages/home/home.component').then((m) => m.HomeComponent),
        data: {
          description:
            'Goodgame Empire statistics for every server: your might and rank, your alliance and the players you follow',
          titleKey: 'Accueil',
        },
        resolve: { titleResolver },
      },
      {
        path: 'players',
        loadComponent: () => import('@ggetracker-pages/players/players.component').then((m) => m.PlayersComponent),
        data: {
          description: 'Browse the list of players on Goodgame Empire, with detailed statistics.',
          titleKey: 'Liste des joueurs',
        },
        resolve: { titleResolver },
      },
      {
        path: 'guess',
        loadComponent: () =>
          import('@ggetracker-pages/guess-daily-player/guess-daily-player.component').then(
            (m) => m.GuessDailyPlayerComponent,
          ),
        resolve: { titleResolver },
        data: {
          description: '',
        },
      },
      {
        path: 'player/:playerId',
        loadComponent: () =>
          import('@ggetracker-pages/player-stats/player-stats.component').then((m) => m.PlayerStatsComponent),
        data: {
          description: 'View detailed statistics of a player on Goodgame Empire.',
        },
        resolve: { stats: PlayerStatsResolver },
      },
      {
        path: 'alliances',
        loadComponent: () =>
          import('@ggetracker-pages/alliances/alliances.component').then((m) => m.AlliancesComponent),
        data: {
          description: 'Explore the list of alliances on Goodgame Empire, with detailed statistics.',
          titleKey: 'Liste des alliances',
        },
        resolve: { titleResolver },
      },
      {
        path: 'alliance/:allianceId',
        loadComponent: () =>
          import('@ggetracker-pages/alliance-stats/alliance-stats.component').then((m) => m.AllianceStatsComponent),
        data: {
          description: 'View detailed statistics of an alliance on Goodgame Empire.',
        },
        resolve: { titleResolver },
      },
      {
        path: 'compare',
        pathMatch: 'full',
        redirectTo: 'compare/players',
      },
      {
        path: 'compare/:type',
        loadComponent: () => import('@ggetracker-pages/compare/compare.component').then((m) => m.CompareComponent),
        resolve: { titleResolver },
        data: {
          description: 'Compare two players or two alliances of Goodgame Empire side by side',
          titleKey: 'Comparer',
        },
      },
      {
        path: 'dungeons',
        loadComponent: () => import('@ggetracker-pages/tracker/tracker.component').then((m) => m.TrackerComponent),
        data: {
          description: 'Goodgame Empire Tracker: Track fortress attacks in real-time.',
          titleKey: 'Forteresses',
        },
        resolve: { titleResolver },
      },
      {
        path: 'map',
        loadComponent: () =>
          import('@ggetracker-pages/server-cartography/server-cartography.component').then(
            (m) => m.ServerCartographyComponent,
          ),
        data: {
          description: 'View the world map of Goodgame Empire, with alliance positions and territories.',
          titleKey: 'Cartographie',
        },
        resolve: { titleResolver },
      },
      {
        path: 'map/:alliance',
        loadComponent: () =>
          import('@ggetracker-pages/server-cartography/server-cartography.component').then(
            (m) => m.ServerCartographyComponent,
          ),
        data: {
          description: 'Explore the world map of Goodgame Empire, with alliance positions and territories.',
          titleKey: 'Cartographie',
        },
        resolve: { titleResolver },
      },
      {
        path: 'statistics',
        loadComponent: () =>
          import('@ggetracker-pages/server-statistics/server-statistics.component').then(
            (m) => m.ServerStatisticsComponent,
          ),
        data: {
          description: 'Analyze the global statistics of the Goodgame Empire server',
          titleKey: 'Statistiques',
        },
        resolve: { titleResolver },
      },
      {
        path: 'movements',
        loadComponent: () =>
          import('@ggetracker-pages/movements/movements.component').then((m) => m.MovementsComponent),
        resolve: { titleResolver },
        data: {
          description: 'Analyze alliance movements on Goodgame Empire: relocations, new outposts, conquests, and more.',
          titleKey: 'Mouvements',
        },
      },
      {
        path: 'renames',
        redirectTo: 'renames/players',
      },
      {
        path: 'renames/:type',
        loadComponent: () => import('@ggetracker-pages/renames/renames.component').then((m) => m.RenamesComponent),
        resolve: { titleResolver },
        data: {
          description: 'Discover the list of player and alliance name changes on Goodgame Empire.',
          titleKey: 'Changements de nom',
        },
      },
      {
        path: 'about',
        loadComponent: () => import('@ggetracker-pages/about/about.component').then((m) => m.AboutComponent),
        resolve: { titleResolver },
        data: {
          description:
            'Discover the modern analysis tool for Goodgame Empire, with detailed statistics and interactive graphs.',
          titleKey: 'A propos',
        },
      },
      {
        path: 'legal',
        loadComponent: () =>
          import('@ggetracker-pages/legal/legal-document.component').then((m) => m.LegalDocumentComponent),
        resolve: { titleResolver },
        data: {
          document: 'legal',
          description: 'Legal notice and terms of use of gge-tracker.com.',
          titleKey: 'Mentions légales',
        },
      },
      {
        path: 'privacy',
        loadComponent: () =>
          import('@ggetracker-pages/legal/legal-document.component').then((m) => m.LegalDocumentComponent),
        resolve: { titleResolver },
        data: {
          document: 'privacy',
          description: 'How gge-tracker.com handles personal data: request logs, game data, retention and your rights.',
          titleKey: 'Confidentialité',
        },
      },
      {
        path: 'offers',
        loadComponent: () => import('@ggetracker-pages/offers/offers.component').then((m) => m.OffersComponent),
        resolve: { titleResolver },
        data: {
          description: 'Discover the available offers and promotions for Goodgame Empire.',
          titleKey: 'Offres',
        },
      },
      {
        path: 'grand-tournament',
        loadComponent: () =>
          import('@ggetracker-pages/grand-tournament/grand-tournament.component').then(
            (m) => m.GrandTournamentComponent,
          ),
        resolve: { titleResolver },
        data: {
          description: 'Analyze the events of Goodgame Empire: Grand Tournament',
          titleKey: 'Le Grand Tournoi',
        },
      },
      {
        path: 'event-thresholds',
        loadComponent: () =>
          import('@ggetracker-pages/event-thresholds/event-thresholds.component').then(
            (m) => m.EventThresholdsComponent,
          ),
        resolve: { titleResolver },
        data: {
          description:
            'Points needed for each rank of the Goodgame Empire kingdom events on your server, edition after edition',
          titleKey: 'Seuils des événements',
        },
      },
      {
        path: 'rift-raid',
        loadComponent: () => import('@ggetracker-pages/rift-raid/rift-raid.component').then((m) => m.RiftRaidComponent),
        resolve: { titleResolver },
        data: {
          description: 'Follow the Rift Tournament of the Goodgame Empire Rift Raid, hour by hour',
          titleKey: 'Tournoi de la Faille',
        },
      },
      {
        path: 'stormy-isles',
        loadComponent: () =>
          import('@ggetracker-pages/stormy-isles/stormy-isles.component').then((m) => m.StormyIslesComponent),
        resolve: { titleResolver },
        data: {
          description: 'Browse the Stormy Isles leaderboard on Goodgame Empire, with aquamarine metrics.',
          titleKey: 'Classement des aigues-marines',
        },
      },
      {
        path: 'storm-tracker',
        loadComponent: () =>
          import('@ggetracker-pages/storm-tracker/storm-tracker.component').then((m) => m.StormTrackerComponent),
        resolve: { titleResolver },
        data: {
          description: 'Goodgame Empire Tracker: Track Storm Islands forts and resource isles in real-time.',
          titleKey: 'Îles orageuses',
        },
      },
      {
        path: 'woa',
        loadComponent: () => import('@ggetracker-pages/events/woa/woa.component').then((m) => m.WoaComponent),
        resolve: { titleResolver },
        data: {
          description: 'Discover the latest Wheel of Unimaginable Affluence ranking and events in Goodgame Empire.',
          titleKey: 'Roue des richesses inimaginables',
        },
      },
      {
        path: 'woa/:id',
        loadComponent: () => import('@ggetracker-pages/events/woa/woa.component').then((m) => m.WoaComponent),
        resolve: { titleResolver },
        data: {
          description: 'Discover the latest Wheel of Unimaginable Affluence ranking and events in Goodgame Empire.',
          titleKey: 'Roue des richesses inimaginables',
        },
      },
      {
        path: 'events',
        loadComponent: () => import('@ggetracker-pages/events/events.component').then((m) => m.EventsComponent),
        resolve: { titleResolver },
        data: {
          description: 'Analyze the events of Goodgame Empire: outer realms and beyond the horizon.',
          titleKey: 'Événements',
        },
      },
      {
        path: 'events/:eventType',
        loadComponent: () => import('@ggetracker-pages/events/events.component').then((m) => m.EventsComponent),
        resolve: { titleResolver },
        data: {
          description: 'Analyze the events of Goodgame Empire: outer realms and beyond the horizon.',
          titleKey: 'Événements',
        },
      },
      {
        path: 'events/:eventType/:eventId',
        loadComponent: () => import('@ggetracker-pages/events/events.component').then((m) => m.EventsComponent),
        resolve: { titleResolver },
        data: {
          description: 'Analyze the events of Goodgame Empire: outer realms and beyond the horizon.',
          titleKey: 'Événements',
        },
      },
      {
        path: 'castles',
        loadComponent: () =>
          import('@ggetracker-pages/view-castle/view-castle.component').then((m) => m.ViewCastleComponent),
        resolve: { titleResolver },
        data: {
          description: 'View detailed information about a specific castle in Goodgame Empire.',
          titleKey: 'Châteaux',
        },
      },
      {
        path: 'live/outer-realms',
        loadComponent: () =>
          import('@ggetracker-pages/live-outer-realms/live-outer-realms.component').then(
            (m) => m.LiveOuterRealmsComponent,
          ),
        resolve: { titleResolver },
        data: {
          description: 'Real-time tracking of Outer Realms rankings and player activities in Goodgame Empire.',
          titleKey: 'Royaume extérieur',
        },
      },
      {
        path: 'live/outer-realms/:playerId',
        loadComponent: () =>
          import('@ggetracker-pages/live-outer-realms/live-outer-realms.component').then(
            (m) => m.LiveOuterRealmsComponent,
          ),
        resolve: { titleResolver },
        data: {
          description: 'Real-time tracking of Outer Realms rankings and player activities in Goodgame Empire.',
          titleKey: 'Royaume extérieur',
        },
      },
      {
        path: '**',
        loadComponent: () => import('@ggetracker-pages/not-found/not-found.component').then((m) => m.NotFoundComponent),
        resolve: { titleResolver },
        data: {
          description: '',
          titleKey: 'Page introuvable',
        },
      },
    ],
  },
];
