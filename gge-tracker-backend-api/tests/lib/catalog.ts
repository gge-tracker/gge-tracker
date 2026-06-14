import { Method } from 'axios';
import { Seeds } from './bootstrap';

export interface Endpoint {
  id: string;
  method: Method;
  scope: 'public' | 'protected';
  bypass?: boolean;
  token?: boolean;
  /** Builds the request path (with valid seeds substituted) */
  path: (s: Seeds) => string;
  /** Body builder for POST/PUT path */
  body?: (s: Seeds) => unknown;
  /** Acceptable statuses for a valid request. Defaults to [200] */
  okStatuses?: number[];
  /** Keys expected in a 200 JSON object/array element */
  shapeKeys?: string[];
  /** Expected payload kind for a 200 */
  kind?: 'json' | 'binary' | 'any';
  /** Seeds required for a meaningful happy-path call; skipped (not failed) if missing */
  needs?: ('server' | 'player' | 'alliance' | 'castle')[];
  /** Path segment that the security suite should replace with malicious text */
  fuzzPathParamIndex?: number;
  /** Query param names the security suite should inject malicious text into */
  fuzzQuery?: string[];
}

const q = (params: Record<string, string | number | undefined>): string => {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return pairs.length ? '?' + pairs.join('&') : '';
};

export const CATALOG: Endpoint[] = [
  // Documentation / status (public)
  { id: 'docs', method: 'GET', scope: 'public', path: () => '/docs', okStatuses: [200, 404], kind: 'any' },
  { id: 'status-root', method: 'GET', scope: 'protected', bypass: true, path: () => '/', okStatuses: [200], shapeKeys: ['version'], needs: ['server'] },
  { id: 'servers', method: 'GET', scope: 'public', path: () => '/servers', okStatuses: [200] },

  // Assets (public, rate-limit bypass)
  { id: 'assets-items', method: 'GET', scope: 'public', bypass: true, path: () => '/assets/items', okStatuses: [200], kind: 'any' },
  { id: 'assets-image', method: 'GET', scope: 'public', bypass: true, path: () => '/assets/images/keepbuildinglevel8.png', okStatuses: [200, 404], kind: 'any', fuzzPathParamIndex: 3 },
  { id: 'assets-common', method: 'GET', scope: 'public', bypass: true, path: () => '/assets/common/keepbuildinglevel8.json', okStatuses: [200, 404], kind: 'any', fuzzPathParamIndex: 3 },
  { id: 'assets-update', method: 'PUT', scope: 'public', token: true, path: () => '/assets/update/not-a-valid-token', okStatuses: [400, 401, 403, 404] },

  // Languages (public, bypass)
  { id: 'languages', method: 'GET', scope: 'public', bypass: true, path: () => '/languages/en', okStatuses: [200], kind: 'any', fuzzPathParamIndex: 2 },

  // Mini-games (protected)
  { id: 'minigame-daily', method: 'GET', scope: 'protected', path: () => '/mini-games/daily', okStatuses: [200, 404], needs: ['server'] },
  { id: 'minigame-autocomplete', method: 'GET', scope: 'protected', path: () => '/mini-games/guesses/autocomplete' + q({ query: 'a' }), okStatuses: [200, 400], needs: ['server'], fuzzQuery: ['query'] },
  { id: 'minigame-guess', method: 'POST', scope: 'protected', path: () => '/mini-games/guess', body: () => ({ guess: 'SomePlayer', requestGameId: 1 }), okStatuses: [200, 400, 404], needs: ['server'] },

  // Events (public)
  { id: 'events-list', method: 'GET', scope: 'public', path: () => '/events/list' + q({ page: 1 }), okStatuses: [200] },
  { id: 'events-type-players', method: 'GET', scope: 'public', path: () => '/events/outer-realms/1/players' + q({ page: 1 }), okStatuses: [200, 400, 404] },
  { id: 'events-type-data', method: 'GET', scope: 'public', path: () => '/events/outer-realms/1/data', okStatuses: [200, 400, 404] },
  { id: 'events-player', method: 'GET', scope: 'public', path: (s) => `/events/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['player'] },

  // Grand Tournament (public)
  { id: 'gt-dates', method: 'GET', scope: 'public', path: () => '/grand-tournament/dates', okStatuses: [200] },
  { id: 'gt-alliances', method: 'GET', scope: 'public', path: () => '/grand-tournament/alliances' + q({ date: '2026-01-01T00:00:00.000Z', division_id: 5, page: 1 }), okStatuses: [200, 400], fuzzQuery: ['date', 'division_id'] },
  { id: 'gt-alliance-analysis', method: 'GET', scope: 'public', path: (s) => `/grand-tournament/alliance/${s.allianceId ?? '1'}/1`, okStatuses: [200, 400, 404], needs: ['alliance'] },
  { id: 'gt-search', method: 'GET', scope: 'public', path: () => '/grand-tournament/search' + q({ date: '2026-01-01T00:00:00.000Z', alliance_name: 'a', page: 1 }), okStatuses: [200, 400], fuzzQuery: ['alliance_name', 'date'] },

  // Updates (public)
  { id: 'updates-alliance-players', method: 'GET', scope: 'public', path: (s) => `/updates/alliances/${s.allianceId ?? '1'}/players`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },
  { id: 'updates-player-names', method: 'GET', scope: 'public', path: (s) => `/updates/players/${s.playerId ?? '1'}/names`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'updates-player-alliances', method: 'GET', scope: 'public', path: (s) => `/updates/players/${s.playerId ?? '1'}/alliances`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Dungeons (protected + public player variant)
  { id: 'dungeons', method: 'GET', scope: 'protected', path: () => '/dungeons' + q({ page: 1, size: 15 }), okStatuses: [200, 400], needs: ['server'] },
  { id: 'dungeons-player', method: 'GET', scope: 'public', path: (s) => `/dungeons/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Server domain (protected)
  { id: 'server-movements', method: 'GET', scope: 'protected', path: () => '/server/movements' + q({ page: 1 }), okStatuses: [200, 400], needs: ['server'], fuzzQuery: ['search', 'searchType', 'castleType'] },
  { id: 'server-renames', method: 'GET', scope: 'protected', path: () => '/server/renames' + q({ page: 1 }), okStatuses: [200, 400], needs: ['server'], fuzzQuery: ['search', 'searchType', 'showType'] },
  { id: 'server-statistics', method: 'GET', scope: 'protected', path: () => '/server/statistics', okStatuses: [200], needs: ['server'] },

  // Cartography (protected + public id)
  { id: 'cartography-size', method: 'GET', scope: 'protected', path: () => '/cartography/size/100', okStatuses: [200, 400], needs: ['server'], fuzzPathParamIndex: 3 },
  { id: 'cartography-name', method: 'GET', scope: 'protected', path: (s) => `/cartography/name/${encodeURIComponent(s.allianceName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'], fuzzPathParamIndex: 3 },
  { id: 'cartography-id', method: 'GET', scope: 'public', path: (s) => `/cartography/id/${s.allianceId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },

  // Castle (mixed)
  { id: 'castle-analysis', method: 'GET', scope: 'public', path: (s) => `/castle/analysis/${s.castleId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'castle'] },
  { id: 'castle-search', method: 'GET', scope: 'protected', path: (s) => `/castle/search/${encodeURIComponent(s.playerName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'player'], fuzzPathParamIndex: 3 },
  { id: 'castle-random', method: 'GET', scope: 'protected', path: () => '/castle/random', okStatuses: [200, 404], needs: ['server'] },

  // Alliances (mixed)
  { id: 'alliances-list', method: 'GET', scope: 'protected', path: () => '/alliances' + q({ page: 1 }), okStatuses: [200], needs: ['server'] },
  { id: 'alliance-by-id', method: 'GET', scope: 'public', path: (s) => `/alliances/id/${s.allianceId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },
  { id: 'alliance-by-name', method: 'GET', scope: 'protected', path: (s) => `/alliances/name/${encodeURIComponent(s.allianceName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'], fuzzPathParamIndex: 3 },

  // Players (protected)
  { id: 'players-list', method: 'GET', scope: 'protected', path: () => '/players' + q({ page: 1 }), okStatuses: [200], needs: ['server'], fuzzQuery: ['sort', 'order', 'search'] },
  { id: 'players-by-name', method: 'GET', scope: 'protected', path: (s) => `/players/${encodeURIComponent(s.playerName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'player'], fuzzPathParamIndex: 2 },
  { id: 'players-bulk', method: 'POST', scope: 'protected', path: () => '/players', body: (s) => [s.playerId ? Number.parseInt(String(s.playerId).replace(/\D/g, ''), 10) || 1 : 1], okStatuses: [200, 400], needs: ['server'] },
  { id: 'top-players', method: 'GET', scope: 'public', path: (s) => `/top-players/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Statistics (public)
  { id: 'stats-player', method: 'GET', scope: 'public', path: (s) => `/statistics/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'stats-alliance', method: 'GET', scope: 'public', path: (s) => `/statistics/alliance/${s.allianceId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },
  { id: 'stats-alliance-pulse', method: 'GET', scope: 'public', path: (s) => `/statistics/alliance/${s.allianceId ?? '1'}/pulse`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },
  { id: 'stats-ranking-player', method: 'GET', scope: 'public', path: (s) => `/statistics/ranking/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'stats-player-event-duration', method: 'GET', scope: 'public', path: (s) => `/statistics/player/${s.playerId ?? '1'}/might/30`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Live ranking (public)
  { id: 'live-outer-realms', method: 'GET', scope: 'public', path: () => '/live-ranking/outer-realms' + q({ page: 1 }), okStatuses: [200, 400, 403] },
  { id: 'live-outer-realms-player', method: 'GET', scope: 'public', path: (s) => `/live-ranking/outer-realms/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['player'] },

  // WoA (protected + public player)
  { id: 'woa-events', method: 'GET', scope: 'protected', path: () => '/woa/events', okStatuses: [200], needs: ['server'] },
  { id: 'woa-events-by-date', method: 'GET', scope: 'protected', path: () => '/woa/events/date/2026-01-01', okStatuses: [200, 400, 404], needs: ['server'] },
  { id: 'woa-events-by-id', method: 'GET', scope: 'protected', path: () => '/woa/events/id/1', okStatuses: [200, 400, 404], needs: ['server'] },
  { id: 'woa-events-player', method: 'GET', scope: 'public', path: (s) => `/woa/events/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Aquamarine / Stormy Isles (mixed)
  { id: 'aquamarine-player', method: 'GET', scope: 'public', path: (s) => `/aquamarine/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'aquamarine', method: 'GET', scope: 'protected', path: () => '/aquamarine' + q({ page: 1 }), okStatuses: [200, 400], needs: ['server'] },
  { id: 'stormy-isles', method: 'GET', scope: 'protected', path: () => '/stormy-isles' + q({ page: 1 }), okStatuses: [200, 400], needs: ['server'] },
];

export const BYPASS_ENDPOINTS = CATALOG.filter((e) => e.bypass);
export const RATE_LIMITED_PROBE: Endpoint = CATALOG.find((e) => e.id === 'servers')!;
