import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Server },
  { path: 'players', renderMode: RenderMode.Server },
  { path: 'alliances', renderMode: RenderMode.Server },
  { path: 'player/:playerId', renderMode: RenderMode.Server },
  { path: 'alliance/:allianceId', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Client },
];
