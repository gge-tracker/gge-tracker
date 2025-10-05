import { Routes } from '@angular/router';

import { MaintenanceComponent } from '@ggetracker-components/maintenance/maintenance.component';
import { AboutComponent } from '@ggetracker-pages/about/about.component';
import { AllianceStatsComponent } from '@ggetracker-pages/alliance-stats/alliance-stats.component';
import { AlliancesComponent } from '@ggetracker-pages/alliances/alliances.component';
import { EventsComponent } from '@ggetracker-pages/events/events.component';
import { MovementsComponent } from '@ggetracker-pages/movements/movements.component';
import { OffersComponent } from '@ggetracker-pages/offers/offers.component';
import { PlayerStatsComponent } from '@ggetracker-pages/player-stats/player-stats.component';
import { PlayersComponent } from '@ggetracker-pages/players/players.component';
import { ReleaseNotesComponent } from '@ggetracker-pages/release-notes/release-notes.component';
import { RenamesComponent } from '@ggetracker-pages/renames/renames.component';
import { ServerCartographyComponent } from '@ggetracker-pages/server-cartography/server-cartography.component';
import { ServerStatisticsComponent } from '@ggetracker-pages/server-statistics/server-statistics.component';
import { TrackerComponent } from '@ggetracker-pages/tracker/tracker.component';
import { SkeletonComponent } from '@ggetracker-components/skeleton/skeleton.component';
import { PlayerStatsResolver } from '@ggetracker-resolvers/player-stats.resolver';
import { titleResolver } from '@ggetracker-resolvers/title.resolver';
import { ViewCastleComponent } from '@ggetracker-pages/view-castle/view-castle.component';

export const routes: Routes = [
  {
    path: 'maintenance',
    component: MaintenanceComponent,
    data: {
      description: '',
      titleKey: 'Maintenance',
    },
  },
  {
    path: 'release-notes',
    component: ReleaseNotesComponent,
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
        path: 'players',
        component: PlayersComponent,
        data: {
          description: 'Browse the list of players on Goodgame Empire, with detailed statistics.',
          titleKey: 'Liste des joueurs',
        },
        resolve: { titleResolver },
      },
      {
        path: 'player/:playerId',
        component: PlayerStatsComponent,
        data: {
          description: 'View detailed statistics of a player on Goodgame Empire.',
        },
        resolve: { stats: PlayerStatsResolver },
      },
      {
        path: 'alliances',
        component: AlliancesComponent,
        data: {
          description: 'Explore the list of alliances on Goodgame Empire, with detailed statistics.',
          titleKey: 'Liste des alliances',
        },
        resolve: { titleResolver },
      },
      {
        path: 'alliance/:allianceId',
        component: AllianceStatsComponent,
        data: {
          description: 'View detailed statistics of an alliance on Goodgame Empire.',
        },
        resolve: { titleResolver },
      },
      {
        path: 'dungeons',
        component: TrackerComponent,
        data: {
          description: 'Goodgame Empire Tracker: Track fortress attacks in real-time.',
          titleKey: 'Forteresses',
        },
        resolve: { titleResolver },
      },
      {
        path: 'map',
        component: ServerCartographyComponent,
        data: {
          description: 'View the world map of Goodgame Empire, with alliance positions and territories.',
          titleKey: 'Cartographie',
        },
        resolve: { titleResolver },
      },
      {
        path: 'map/:alliance',
        component: ServerCartographyComponent,
        data: {
          description: 'Explore the world map of Goodgame Empire, with alliance positions and territories.',
          titleKey: 'Cartographie',
        },
        resolve: { titleResolver },
      },
      {
        path: 'statistics',
        component: ServerStatisticsComponent,
        data: {
          description: 'Analyze the global statistics of the Goodgame Empire server',
          titleKey: 'Statistiques',
        },
        resolve: { titleResolver },
      },
      {
        path: 'movements',
        component: MovementsComponent,
        resolve: { titleResolver },
        data: {
          description: 'Analyze alliance movements on Goodgame Empire: relocations, new outposts, conquests, and more.',
          titleKey: 'Mouvements',
        },
      },
      {
        path: 'renames/:type',
        component: RenamesComponent,
        resolve: { titleResolver },
        data: {
          description: 'Discover the list of player and alliance name changes on Goodgame Empire.',
          titleKey: 'Changements de nom',
        },
      },
      {
        path: 'about',
        component: AboutComponent,
        resolve: { titleResolver },
        data: {
          description:
            'Discover the modern analysis tool for Goodgame Empire, with detailed statistics and interactive graphs.',
          titleKey: 'A propos',
        },
      },
      {
        path: 'offers',
        component: OffersComponent,
        resolve: { titleResolver },
        data: {
          description: 'Discover the available offers and promotions for Goodgame Empire.',
          titleKey: 'Offres',
        },
      },
      {
        path: 'events',
        component: EventsComponent,
        resolve: { titleResolver },
        data: {
          description: 'Analyze the events of Goodgame Empire: outer realms and beyond the horizon.',
          titleKey: 'Événements',
        },
      },
      {
        path: 'events/:eventType/:eventId',
        component: EventsComponent,
        resolve: { titleResolver },
        data: {
          description: 'Analyze the events of Goodgame Empire: outer realms and beyond the horizon.',
          titleKey: 'Événements',
        },
      },
      {
        path: 'castles',
        component: ViewCastleComponent,
        resolve: { titleResolver },
        data: {
          description: 'View detailed information about a specific castle in Goodgame Empire.',
          titleKey: 'Châteaux',
        },
      },
      {
        path: '**',
        pathMatch: 'full',
        redirectTo: 'players',
      },
    ],
  },
  {
    path: '**',
    pathMatch: 'full',
    redirectTo: 'players',
  },
];
