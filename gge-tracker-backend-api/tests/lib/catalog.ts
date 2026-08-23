import { Method } from 'axios';
import { Seeds } from './bootstrap';
import { SnapshotMode } from './snapshot';

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
  needs?: ('server' | 'specialServer' | 'player' | 'alliance' | 'castle' | 'castlePlayer')[];
  /** Path segment that the security suite should replace with malicious text */
  fuzzPathParamIndex?: number;
  /** Query param names the security suite should inject malicious text into */
  fuzzQuery?: string[];
  cases?: EndpointCase[];
  upstream?: { status: number; what: string };
  /** What the semantic suite can assert about the CONTENT of a 200 */
  semantic?: SemanticSpec;
  snapshot?: SnapshotMode;
}

export interface SemanticSpec {
  collection: string;
  idField: string;
  idOf?: (row: any) => string;
  nonEmpty?: boolean;
  paginated?: boolean;
  filters?: FilterCheck[];
  sorts?: SortCheck[];
  stableOrder?: Record<string, string | number>;
  filtersCompose?: boolean;
}

export interface FilterCheck {
  param: string;
  field: string;
  kind: 'min' | 'max' | 'eq' | 'contains';
  /** A value that cannot match anything (equired for min/max) */
  impossible?: string | number;
  /** Derives the probe value from a row (default: the field itself) */
  probeValue?: (row: any) => string | number | undefined;
  noUnmatchableValue?: boolean;
  with?: Record<string, string | number>;
  matches?: (row: any, sent: string | number) => boolean;
}

export interface SortCheck {
  param: string;
  value: string;
  field: string;
  directionParam: string;
  ascending: string;
  descending: string;
}

export interface EndpointCase {
  label: string;
  path: (s: Seeds) => string;
  expect: number[];
  headers?: (s: Seeds) => Record<string, string> | undefined;
}

const q = (params: Record<string, string | number | undefined>): string => {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return pairs.length ? '?' + pairs.join('&') : '';
};

/** Aquamarine metrics the stormy isles leaderboard can be sorted and filtered on */
const STORMY_ISLES_METRIC_IDS = [15, 16, 17, 18, 19, 20, 100];

/** Rejected by the storms routes: bad coordinates, out-of-range filters and malformed isle lists */
const stormRejectedCases = (base: '/storms/forts' | '/storms/isles'): EndpointCase[] => [
  { label: 'positionX out of map', path: () => base + q({ page: 1, positionX: 99_999, positionY: 640 }), expect: [400] },
  { label: 'negative position', path: () => base + q({ page: 1, positionX: -1, positionY: -1 }), expect: [400] },
  { label: 'positionX without positionY', path: () => base + q({ page: 1, positionX: 640 }), expect: [400] },
  { label: 'maxDistance zero', path: () => base + q({ page: 1, positionX: 640, positionY: 640, maxDistance: 0 }), expect: [400] },
  { label: 'maxDistance not a number', path: () => base + q({ page: 1, positionX: 640, positionY: 640, maxDistance: 'far' }), expect: [400] },
  { label: 'nearPlayerName too long', path: () => base + q({ page: 1, nearPlayerName: 'x'.repeat(61) }), expect: [400] },
  { label: 'nearPlayerName unknown', path: () => base + q({ page: 1, nearPlayerName: 'zz-no-such-player-zz' }), expect: [400] },
  { label: 'filterByIsleIds not json', path: () => base + q({ page: 1, filterByIsleIds: 'not-json' }), expect: [400] },
  { label: 'filterByIsleIds not an array', path: () => base + q({ page: 1, filterByIsleIds: '{"a":1}' }), expect: [400] },
  { label: 'filterByIsleIds out of range', path: () => base + q({ page: 1, filterByIsleIds: '[99999]' }), expect: [400] },
  { label: 'filterByIsleIds too many', path: () => base + q({ page: 1, filterByIsleIds: JSON.stringify(Array.from({ length: 51 }, (_, i) => i)) }), expect: [400] },
  { label: 'filterByIsleIds empty selection', path: () => base + q({ page: 1, filterByIsleIds: '[]' }), expect: [200] },
  { label: 'unknown orderBy ignored', path: () => base + q({ page: 1, orderBy: 'nope', orderDirection: 'sideways' }), expect: [200] },
  { label: 'size 0 means max page size', path: () => base + q({ page: 1, size: 0 }), expect: [200] },
  { label: 'page beyond the last one', path: () => base + q({ page: 999_999 }), expect: [200] },
  {
    label: 'rejects a server without storms',
    path: () => base + q({ page: 1 }),
    expect: [400],
    headers: (s) => (s.unsupportedServer ? { 'gge-server': s.unsupportedServer } : undefined),
  },
];

export const CATALOG: Endpoint[] = [
  // Documentation / status (public)
  { id: 'docs', method: 'GET', scope: 'public', path: () => '/docs', okStatuses: [200], kind: 'any', shapeKeys: ['openapi', 'info', 'paths'] },
  { id: 'status-root', snapshot: 'shape', method: 'GET', scope: 'protected', bypass: true, path: () => '/', okStatuses: [200], shapeKeys: ['version'], needs: ['server'] },
  { id: 'servers', method: 'GET', scope: 'public', path: () => '/servers', okStatuses: [200] },

  // Assets (public, rate-limit bypass)
  { id: 'assets-items', method: 'GET', scope: 'public', bypass: true, path: () => '/assets/items', okStatuses: [200], kind: 'any' },
  { id: 'assets-image', method: 'GET', scope: 'public', bypass: true, path: () => '/assets/images/keepbuildinglevel8.png', okStatuses: [200, 404], kind: 'any', fuzzPathParamIndex: 3 },
  { id: 'assets-image-variant', method: 'GET', scope: 'public', bypass: true, path: () => '/assets/images/castlewall.png' + q({ level: '3', type: 'gate', quality: 'basic' }), okStatuses: [200, 404], kind: 'any', fuzzQuery: ['level', 'type', 'quality'] },
  { id: 'assets-common', method: 'GET', scope: 'public', bypass: true, path: () => '/assets/common/keepbuildinglevel8.json', okStatuses: [200, 404], kind: 'any', fuzzPathParamIndex: 3 },
  { id: 'assets-update', method: 'PUT', scope: 'public', token: true, path: () => '/assets/update/not-a-valid-token', okStatuses: [400, 401, 403, 404] },

  // Languages (public, bypass)
  { id: 'languages', method: 'GET', scope: 'public', bypass: true, path: () => '/languages/en', okStatuses: [200], kind: 'any', fuzzPathParamIndex: 2 },

  // Mini-games (protected)
  { id: 'minigame-daily', snapshot: 'shape', method: 'GET', scope: 'protected', path: () => '/mini-games/daily', okStatuses: [200, 404], needs: ['server'] },
  { id: 'minigame-autocomplete', method: 'GET', scope: 'protected', path: () => '/mini-games/guesses/autocomplete' + q({ query: 'a' }), okStatuses: [200, 400], needs: ['server'], fuzzQuery: ['query'] },
  { id: 'minigame-guess', method: 'POST', scope: 'protected', path: () => '/mini-games/guess', body: () => ({ guess: 'SomePlayer', requestGameId: 1 }), okStatuses: [200, 400, 404], needs: ['server'] },

  // Events (public)
  {
    id: 'events-list',
    method: 'GET',
    scope: 'public',
    path: () => '/events/list' + q({ page: 1 }),
    okStatuses: [200],
    fuzzQuery: ['type'],
    semantic: {
      collection: 'events',
      idField: 'event_num',
      idOf: (row) => `${row.type}/${row.event_num}/${row.collect_date}`,
      nonEmpty: true,
      paginated: true,
      filters: [
        {
          param: 'type',
          field: 'type',
          kind: 'eq',
          probeValue: (row) => String(row.type).replaceAll('_', '-'),
          matches: (row, sent) => String(row.type).replaceAll('_', '-') === String(sent).replaceAll('_', '-'),
        },
      ],
    },
  },
  { id: 'events-list-typed', method: 'GET', scope: 'public', path: () => '/events/list' + q({ page: 1, type: 'outer-realms' }), okStatuses: [200] },
  {
    id: 'events-type-players',
    method: 'GET',
    scope: 'public',
    path: () => '/events/outer-realms/1/players' + q({ page: 1 }),
    okStatuses: [200, 400, 404],
    fuzzQuery: ['player_name', 'server'],
    semantic: {
      collection: 'players',
      idField: 'player_id',
      idOf: (row) => `rank:${row.rank}`,
      nonEmpty: true,
      paginated: true,
      filters: [
        { param: 'player_name', field: 'player_name', kind: 'eq' },
        { param: 'server', field: 'server', kind: 'eq' },
      ],
    },
  },
  { id: 'events-type-players-filtered', method: 'GET', scope: 'public', path: (s) => '/events/outer-realms/1/players' + q({ page: 1, player_name: s.eventPlayerName ?? s.playerName ?? 'a', server: s.server }), okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'events-type-data', method: 'GET', scope: 'public', path: () => '/events/outer-realms/1/data', okStatuses: [200, 400, 404] },
  { id: 'events-player', method: 'GET', scope: 'public', path: (s) => `/events/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['player'] },

  // Grand Tournament (public)
  { id: 'gt-dates', method: 'GET', scope: 'public', path: () => '/grand-tournament/dates', okStatuses: [200] },
  { id: 'gt-alliances', method: 'GET', scope: 'public', path: () => '/grand-tournament/alliances' + q({ date: '2026-01-01T00:00:00.000Z', division_id: 5, page: 1 }), okStatuses: [200, 400], fuzzQuery: ['date', 'division_id', 'subdivision_id'] },
  { id: 'gt-alliances-subdivision', method: 'GET', scope: 'public', path: () => '/grand-tournament/alliances' + q({ date: '2026-01-01T00:00:00.000Z', division_id: 5, subdivision_id: 1, page: 1 }), okStatuses: [200, 400] },
  { id: 'gt-alliance-analysis', method: 'GET', scope: 'public', path: (s) => `/grand-tournament/alliance/${s.allianceId ?? '1'}/1`, okStatuses: [200, 400, 404], needs: ['alliance'] },
  { id: 'gt-search', method: 'GET', scope: 'public', path: () => '/grand-tournament/search' + q({ date: '2026-01-01T00:00:00.000Z', alliance_name: 'a', page: 1 }), okStatuses: [200, 400], fuzzQuery: ['alliance_name', 'date'] },

  // Updates (public)
  { id: 'updates-alliance-players', method: 'GET', scope: 'public', path: (s) => `/updates/alliances/${s.allianceId ?? '1'}/players`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },
  { id: 'updates-player-names', method: 'GET', scope: 'public', path: (s) => `/updates/players/${s.playerId ?? '1'}/names`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'updates-player-alliances', method: 'GET', scope: 'public', path: (s) => `/updates/players/${s.playerId ?? '1'}/alliances`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Dungeons (protected + public player variant)
  {
    id: 'dungeons',
    method: 'GET',
    scope: 'protected',
    path: () => '/dungeons' + q({ page: 1, size: 15 }),
    okStatuses: [200, 400],
    needs: ['server'],
    fuzzQuery: ['filterByKid', 'filterByAttackCooldown', 'filterByPlayerName', 'positionX', 'positionY', 'nearPlayerName'],
    semantic: {
      collection: 'dungeons',
      idField: 'player_id',
      idOf: (row) => `${row.kid}/${row.position_x}/${row.position_y}`,
      nonEmpty: true,
      paginated: true,
      filters: [
        {
          param: 'filterByKid',
          field: 'kid',
          kind: 'eq',
          probeValue: (row) => JSON.stringify([row.kid]),
          matches: (row, sent) => {
            try {
              return (JSON.parse(String(sent)) as number[]).includes(Number(row.kid));
            } catch {
              return false;
            }
          },
        },
      ],
    },
  },
  { id: 'dungeons-meta', snapshot: 'shape', method: 'GET', scope: 'protected', path: () => '/dungeons/meta', okStatuses: [200, 400], shapeKeys: ['last_scan_at'], needs: ['server'] },
  { id: 'dungeons-filtered', method: 'GET', scope: 'protected', path: (s) => '/dungeons' + q({ page: 1, size: 15, filterByKid: '[1,2,3]', filterByAttackCooldown: 1, filterByPlayerName: s.castlePlayerName ?? s.playerName ?? 'a', nearPlayerName: s.castlePlayerName ?? s.playerName ?? 'a' }), okStatuses: [200, 400], needs: ['server', 'player'] },
  { id: 'dungeons-at-position', method: 'GET', scope: 'protected', path: () => '/dungeons' + q({ page: 1, positionX: 640, positionY: 640 }), okStatuses: [200, 400], needs: ['server'] },
  { id: 'dungeons-player', method: 'GET', scope: 'public', path: (s) => `/dungeons/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'], fuzzQuery: ['lastDays'] },
  { id: 'dungeons-player-window', method: 'GET', scope: 'public', path: (s) => `/dungeons/player/${s.playerId ?? '1'}` + q({ lastDays: 30 }), okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Server domain (protected)
  {
    id: 'server-movements',
    method: 'GET',
    scope: 'protected',
    path: () => '/server/movements' + q({ page: 1 }),
    okStatuses: [200, 400],
    needs: ['server'],
    fuzzQuery: ['search', 'searchType', 'castleType', 'movementType', 'allianceId'],
    semantic: {
      collection: 'movements',
      idField: 'player_name',
      idOf: (row) =>
        [
          row.player_name,
          row.created_at,
          row.movement_type,
          row.castle_type,
          row.position_x_old,
          row.position_y_old,
          row.position_x_new,
          row.position_y_new,
        ].join('/'),
      nonEmpty: true,
      paginated: true,
      filters: [
        { param: 'castleType', field: 'castle_type', kind: 'eq', impossible: 99 },
        { param: 'search', field: 'player_name', kind: 'eq', with: { searchType: 'player' } },
      ],
    },
  },
  { id: 'server-movements-filtered', method: 'GET', scope: 'protected', path: (s) => '/server/movements' + q({ page: 1, castleType: s.movementCastleType, movementType: s.movementType, search: s.movementPlayerName ?? 'a', searchType: 'player' }), okStatuses: [200, 400], needs: ['server', 'alliance'] },
  {
    id: 'server-renames',
    method: 'GET',
    scope: 'protected',
    path: () => '/server/renames' + q({ page: 1 }),
    okStatuses: [200, 400],
    needs: ['server'],
    fuzzQuery: ['search', 'searchType', 'showType', 'allianceId'],
    semantic: {
      collection: 'renames',
      idField: 'date',
      idOf: (row) => `${row.date}/${row.old_player_name}->${row.new_player_name}`,
      nonEmpty: true,
      paginated: true,
      filters: [
        {
          param: 'search',
          field: 'new_player_name',
          kind: 'eq',
          with: { searchType: 'player' },
          matches: (row, sent) =>
            String(row.old_player_name ?? '').toLowerCase() === String(sent).toLowerCase() ||
            String(row.new_player_name ?? '').toLowerCase() === String(sent).toLowerCase(),
        },
      ],
    },
  },
  { id: 'server-renames-filtered', method: 'GET', scope: 'protected', path: (s) => '/server/renames' + q({ page: 1, search: s.renamePlayerName ?? 'a', searchType: 'player', showType: 'players', allianceId: s.allianceId }), okStatuses: [200, 400], needs: ['server', 'alliance'] },
  { id: 'server-statistics', snapshot: 'fields', method: 'GET', scope: 'protected', path: () => '/server/statistics', okStatuses: [200], needs: ['server'] },

  // Cartography (protected + public id)
  { id: 'cartography-size', method: 'GET', scope: 'protected', path: () => '/cartography/size/100', okStatuses: [200, 400], needs: ['server'], fuzzPathParamIndex: 3 },
  { id: 'cartography-name', method: 'GET', scope: 'protected', path: (s) => `/cartography/name/${encodeURIComponent(s.allianceName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'], fuzzPathParamIndex: 3 },
  { id: 'cartography-id', method: 'GET', scope: 'public', path: (s) => `/cartography/id/${s.allianceId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },

  // Castle (mixed)
  { id: 'castle-analysis', method: 'GET', scope: 'public', path: (s) => `/castle/analysis/${s.castleId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'castle'], fuzzQuery: ['kingdomId'] },
  { id: 'castle-analysis-kingdom', method: 'GET', scope: 'public', path: (s) => `/castle/analysis/${s.castleId ?? '1'}` + q({ kingdomId: 0 }), okStatuses: [200, 400, 404], needs: ['server', 'castle'] },
  { id: 'castle-search', method: 'GET', scope: 'protected', path: (s) => `/castle/search/${encodeURIComponent(s.castlePlayerName ?? s.playerName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'castlePlayer'], fuzzPathParamIndex: 3 },
  { id: 'castle-random', snapshot: 'none', method: 'GET', scope: 'protected', path: () => '/castle/random', okStatuses: [200, 404], needs: ['server'] },

  // Offers (protected)
  { id: 'offers-catalog', snapshot: 'none', method: 'GET', scope: 'protected', path: () => '/offers' + q({ locale: 'en', currency: 'EUR', level: 70, legendaryLevel: 950 }), okStatuses: [200, 400, 503], needs: ['server'], fuzzQuery: ['locale', 'currency', 'level', 'legendaryLevel'], upstream: { status: 503, what: 'the official Goodgame Empire store' } },

  // Alliances (mixed)
  {
    id: 'alliances-list',
    method: 'GET',
    scope: 'protected',
    path: () => '/alliances' + q({ page: 1 }),
    okStatuses: [200],
    needs: ['server'],
    fuzzQuery: ['orderBy', 'orderType'],
    semantic: {
      collection: 'alliances',
      idField: 'alliance_id',
      nonEmpty: true,
      paginated: true,
      sorts: [
        { param: 'orderBy', value: 'might_current', field: 'might_current', directionParam: 'orderType', ascending: 'ASC', descending: 'DESC' },
        { param: 'orderBy', value: 'alliance_name', field: 'alliance_name', directionParam: 'orderType', ascending: 'ASC', descending: 'DESC' },
      ],
    },
  },
  { id: 'alliances-ordered', method: 'GET', scope: 'protected', path: () => '/alliances' + q({ page: 1, orderBy: 'might_current', orderType: 'DESC' }), okStatuses: [200], needs: ['server'] },
  { id: 'alliance-by-id', method: 'GET', scope: 'public', path: (s) => `/alliances/id/${s.allianceId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'], fuzzQuery: ['playerNameForDistance'] },
  { id: 'alliance-by-id-distance', method: 'GET', scope: 'public', path: (s) => `/alliances/id/${s.allianceId ?? '1'}` + q({ playerNameForDistance: s.playerName ?? 'a' }), okStatuses: [200, 400, 404], needs: ['server', 'alliance', 'player'] },
  { id: 'alliance-by-name', method: 'GET', scope: 'protected', path: (s) => `/alliances/name/${encodeURIComponent(s.allianceName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'], fuzzPathParamIndex: 3 },

  // Players (protected)
  {
    id: 'players-list',
    method: 'GET',
    scope: 'protected',
    path: () => '/players' + q({ page: 1 }),
    okStatuses: [200],
    needs: ['server'],
    fuzzQuery: ['orderBy', 'orderType', 'alliance', 'playerNameForDistance', 'allianceRankFilter'],
    semantic: {
      collection: 'players',
      idField: 'player_id',
      nonEmpty: true,
      paginated: true,
      filters: [
        { param: 'minMight', field: 'might_current', kind: 'min', impossible: 2_000_000_000 },
        { param: 'maxMight', field: 'might_current', kind: 'max', impossible: 0 },
        { param: 'minHonor', field: 'honor', kind: 'min', impossible: 2_000_000_000 },
        { param: 'maxHonor', field: 'honor', kind: 'max', noUnmatchableValue: true },
        { param: 'minLoot', field: 'loot_current', kind: 'min', impossible: 2_000_000_000 },
        { param: 'maxLoot', field: 'loot_current', kind: 'max', noUnmatchableValue: true },
        { param: 'alliance', field: 'alliance_name', kind: 'eq' },
        { param: 'minLevel', field: 'level', kind: 'min' },
        { param: 'maxLevel', field: 'level', kind: 'max', impossible: 0 },
        {
          param: 'minLevel',
          field: 'level/legendary_level',
          kind: 'eq',
          noUnmatchableValue: true,
          probeValue: (row) => `${row.level}/${row.legendary_level}`,
          matches: (row, sent) => {
            const [level, legendary] = String(sent).split('/').map(Number);
            return Number(row.level) >= level && Number(row.legendary_level) >= legendary;
          },
        },
      ],
      sorts: [
        { param: 'orderBy', value: 'might_current', field: 'might_current', directionParam: 'orderType', ascending: 'ASC', descending: 'DESC' },
        { param: 'orderBy', value: 'honor', field: 'honor', directionParam: 'orderType', ascending: 'ASC', descending: 'DESC' },
        { param: 'orderBy', value: 'level', field: 'level', directionParam: 'orderType', ascending: 'ASC', descending: 'DESC' },
        { param: 'orderBy', value: 'player_name', field: 'player_name', directionParam: 'orderType', ascending: 'ASC', descending: 'DESC' },
      ],
    },
  },
  {
    id: 'players-filtered',
    method: 'GET',
    scope: 'protected',
    path: (s) => '/players' + q({
      page: 1,
      orderBy: 'might_current',
      orderType: 'DESC',
      alliance: s.alliedPlayerAlliance ?? s.allianceName,
      minHonor: 0,
      maxHonor: 2_000_000_000,
      minMight: 0,
      maxMight: 2_000_000_000,
      minLoot: 0,
      maxLoot: 2_000_000_000,
      minLevel: 0,
      maxLevel: 2000,
      minLegendaryLevel: 0,
      maxLegendaryLevel: 2000,
      allianceFilter: 1,
      protectionFilter: -1,
      banFilter: 0,
      inactiveFilter: -1,
      allianceRankFilter: s.alliedPlayerRank ?? '5',
    }),
    okStatuses: [200],
    needs: ['server', 'alliance'],
  },
  { id: 'players-by-distance', method: 'GET', scope: 'protected', path: (s) => '/players' + q({ page: 1, orderBy: 'distance', orderType: 'ASC', playerNameForDistance: s.playerName ?? 'a' }), okStatuses: [200, 400], needs: ['server', 'player'] },
  { id: 'players-by-name', method: 'GET', scope: 'protected', path: (s) => `/players/${encodeURIComponent(s.playerName ?? 'a')}`, okStatuses: [200, 400, 404], needs: ['server', 'player'], fuzzPathParamIndex: 2 },
  { id: 'players-bulk', method: 'POST', scope: 'protected', path: () => '/players', body: (s) => [s.playerId ? Number.parseInt(String(s.playerId).replace(/\D/g, ''), 10) || 1 : 1], okStatuses: [200, 400], needs: ['server'] },
  { id: 'top-players', method: 'GET', scope: 'public', path: (s) => `/top-players/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },

  // Statistics (public)
  { id: 'stats-player', method: 'GET', scope: 'public', path: (s) => `/statistics/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'stats-alliance', method: 'GET', scope: 'public', path: (s) => `/statistics/alliance/${s.allianceId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },
  { id: 'stats-alliance-trimmed', snapshot: 'fields', method: 'GET', scope: 'public', path: (s) => `/statistics/alliance/${s.allianceId ?? '1'}` + q({ events: 'player_might_history,player_loot_history', limit: 5 }), okStatuses: [200, 400, 404], needs: ['server', 'alliance'], fuzzQuery: ['events', 'limit'] },
  { id: 'stats-alliance-pulse', method: 'GET', scope: 'public', path: (s) => `/statistics/alliance/${s.allianceId ?? '1'}/pulse`, okStatuses: [200, 400, 404], needs: ['server', 'alliance'] },
  { id: 'stats-ranking-player', method: 'GET', scope: 'public', path: (s) => `/statistics/ranking/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'stats-player-event-duration', method: 'GET', scope: 'public', path: (s) => `/statistics/player/${s.playerId ?? '1'}/player_event_nomad_history/30`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'stats-player-trimmed', snapshot: 'fields', method: 'GET', scope: 'public', path: (s) => `/statistics/player/${s.playerId ?? '1'}` + q({ events: 'player_might_history,player_loot_history', since: 30, limit: 50, dedup: 1 }), okStatuses: [200, 400, 404], needs: ['server', 'player'], fuzzQuery: ['events', 'since', 'limit', 'dedup'] },
  { id: 'stats-player-summary', snapshot: 'shape', method: 'GET', scope: 'public', path: (s) => `/statistics/player/${s.playerId ?? '1'}/summary`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  { id: 'stats-player-event-occurrences', method: 'GET', scope: 'public', path: (s) => `/statistics/player/${s.playerId ?? '1'}/player_event_nomad_history/occurrences`, okStatuses: [200, 400, 404], needs: ['server', 'player'], cases: [
    { label: 'rejects an unknown event', path: (s) => `/statistics/player/${s.playerId ?? '1'}/not_an_event/occurrences`, expect: [400] },
    { label: 'rejects a continuously sampled table', path: (s) => `/statistics/player/${s.playerId ?? '1'}/player_might_history/occurrences`, expect: [400] },
  ] },

  // Live ranking (public)
  { id: 'live-outer-realms', method: 'GET', scope: 'public', path: () => '/live-ranking/outer-realms' + q({ page: 1 }), okStatuses: [200, 400, 403], fuzzQuery: ['player_name'] },
  { id: 'live-outer-realms-search', method: 'GET', scope: 'public', path: (s) => '/live-ranking/outer-realms' + q({ page: 1, player_name: s.playerName ?? 'a' }), okStatuses: [200, 400, 403], needs: ['player'] },
  { id: 'live-outer-realms-player', method: 'GET', scope: 'public', path: (s) => `/live-ranking/outer-realms/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['player'] },

  // WoA (protected + public player)
  {
    id: 'woa-events',
    method: 'GET',
    scope: 'protected',
    path: () => '/woa/events' + q({ page: 1 }),
    okStatuses: [200],
    needs: ['server'],
    semantic: { collection: 'events', idField: 'id', nonEmpty: true, paginated: true },
  },
  {
    id: 'woa-events-by-date',
    method: 'GET',
    scope: 'protected',
    path: (s) => `/woa/events/date/${s.woaEventDate ?? '2026-01-01'}` + q({ page: 1 }),
    okStatuses: [200, 400, 404],
    needs: ['server'],
    fuzzQuery: ['player_name', 'alliance_name'],
    cases: [
      { label: 'filtered by player', path: (s) => `/woa/events/date/${s.woaEventDate ?? '2026-01-01'}` + q({ page: 1, player_name: s.playerName ?? 'a' }), expect: [200, 400, 404] },
      { label: 'filtered by alliance', path: (s) => `/woa/events/date/${s.woaEventDate ?? '2026-01-01'}` + q({ page: 1, alliance_name: s.allianceName ?? 'a' }), expect: [200, 400, 404] },
    ],
  },
  {
    id: 'woa-events-by-id',
    method: 'GET',
    scope: 'protected',
    path: (s) => `/woa/events/id/${s.woaEventId ?? '1'}` + q({ page: 1 }),
    okStatuses: [200, 400, 404],
    needs: ['server'],
    fuzzQuery: ['player_name', 'alliance_name'],
    semantic: {
      collection: 'players',
      idField: 'player_id',
      nonEmpty: true,
      paginated: true,
      filtersCompose: false,
      filters: [
        { param: 'player_name', field: 'player_name', kind: 'eq' },
        { param: 'alliance_name', field: 'alliance_name', kind: 'eq' },
      ],
    },
    cases: [
      { label: 'filtered by player', path: (s) => `/woa/events/id/${s.woaEventId ?? '1'}` + q({ page: 1, player_name: s.playerName ?? 'a' }), expect: [200, 400, 404] },
      { label: 'filtered by alliance', path: (s) => `/woa/events/id/${s.woaEventId ?? '1'}` + q({ page: 1, alliance_name: s.allianceName ?? 'a' }), expect: [200, 400, 404] },
    ],
  },
  {
    id: 'woa-events-player',
    method: 'GET',
    scope: 'public',
    path: (s) => `/woa/events/player/${s.woaPlayerId ?? s.playerId ?? '1'}`,
    okStatuses: [200, 400, 404],
    shapeKeys: ['events', 'player', 'coverage'],
    needs: ['server', 'player'],
    fuzzPathParamIndex: 4,
    cases: [
      { label: 'player with no WoA history', path: (s) => `/woa/events/player/${s.playerId ?? '1'}`, expect: [200] },
      { label: 'unparseable player id', path: () => '/woa/events/player/not-an-id', expect: [400] },
    ],
  },

  {
    id: 'storms-meta',
    method: 'GET',
    scope: 'protected',
    path: () => '/storms/meta',
    okStatuses: [200],
    shapeKeys: ['season_started_at', 'scan_radius', 'last_scan_at', 'forts_count', 'isles_count'],
    needs: ['specialServer'],
    cases: [
      {
        label: 'rejects a server without storms',
        path: () => '/storms/meta',
        expect: [400],
        headers: (s) => (s.unsupportedServer ? { 'gge-server': s.unsupportedServer } : undefined),
      },
    ],
  },
  {
    id: 'storms-forts',
    method: 'GET',
    scope: 'protected',
    path: () => '/storms/forts' + q({ page: 1 }),
    okStatuses: [200],
    shapeKeys: ['forts', 'pagination'],
    needs: ['specialServer'],
    fuzzQuery: ['filterByAvailability', 'minAttacksLeft', 'positionX', 'positionY', 'maxDistance', 'size', 'orderBy', 'orderDirection', 'filterByIsleIds', 'nearPlayerName'],
    semantic: {
      collection: 'forts',
      idField: 'isle_id',
      idOf: (row) => `${row.kid}/${row.position_x}/${row.position_y}`,
      nonEmpty: true,
      paginated: true,
      filters: [
        { param: 'minAttacksLeft', field: 'attacks_left', kind: 'min', impossible: 11 },
      ],
      sorts: [
        { param: 'orderBy', value: 'attacksLeft', field: 'attacks_left', directionParam: 'orderDirection', ascending: 'asc', descending: 'desc' },
      ],
    },
    cases: [
      ...stormRejectedCases('/storms/forts'),
      { label: 'minAttacksLeft above the cap', path: () => '/storms/forts' + q({ page: 1, minAttacksLeft: 99 }), expect: [400] },
      { label: 'minAttacksLeft negative', path: () => '/storms/forts' + q({ page: 1, minAttacksLeft: -1 }), expect: [400] },
      { label: 'minAttacksLeft not an integer', path: () => '/storms/forts' + q({ page: 1, minAttacksLeft: 1.5 }), expect: [400] },
      { label: 'minAttacksLeft at the cap', path: () => '/storms/forts' + q({ page: 1, minAttacksLeft: 10 }), expect: [200] },
      { label: 'unknown filterByAvailability ignored', path: () => '/storms/forts' + q({ page: 1, filterByAvailability: 9 }), expect: [200] },
      { label: 'orderBy attacksLeft', path: () => '/storms/forts' + q({ page: 1, orderBy: 'attacksLeft', orderDirection: 'desc' }), expect: [200] },
    ],
  },
  {
    id: 'storms-forts-filtered',
    method: 'GET',
    scope: 'protected',
    path: () => '/storms/forts' + q({ page: 1, size: 50, filterByAvailability: 1, minAttacksLeft: 3, filterByIsleIds: '[1,2,3]', positionX: 640, positionY: 640, maxDistance: 200, orderBy: 'distance', orderDirection: 'asc' }),
    okStatuses: [200],
    shapeKeys: ['forts', 'pagination'],
    needs: ['specialServer'],
  },
  {
    id: 'storms-forts-near-player',
    method: 'GET',
    scope: 'protected',
    path: (s) => '/storms/forts' + q({ page: 1, nearPlayerName: s.castlePlayerName ?? s.playerName ?? 'a', orderBy: 'availability', orderDirection: 'desc' }),
    okStatuses: [200, 400],
    needs: ['specialServer', 'castlePlayer'],
  },
  {
    id: 'storms-isles',
    method: 'GET',
    scope: 'protected',
    path: () => '/storms/isles' + q({ page: 1 }),
    okStatuses: [200],
    shapeKeys: ['isles', 'pagination'],
    needs: ['specialServer'],
    fuzzQuery: ['filterByState', 'filterByOccupierName', 'positionX', 'positionY', 'maxDistance', 'size', 'orderBy', 'orderDirection', 'filterByIsleIds', 'nearPlayerName'],
    semantic: {
      collection: 'isles',
      idField: 'object_id',
      idOf: (row) => `${row.kid}/${row.position_x}/${row.position_y}`,
      nonEmpty: true,
      paginated: true,
      filters: [
        { param: 'filterByState', field: 'state', kind: 'eq', noUnmatchableValue: true, probeValue: (row) => Number(row.state) + 1, matches: (row, sent) => Number(row.state) + 1 === Number(sent) },
        { param: 'filterByOccupierName', field: 'occupier_name', kind: 'eq', with: { filterByState: 2 } },
      ],
    },
    cases: [
      ...stormRejectedCases('/storms/isles'),
      { label: 'filterByOccupierName too long', path: () => '/storms/isles' + q({ page: 1, filterByOccupierName: 'x'.repeat(41) }), expect: [400] },
      { label: 'filterByOccupierName unknown', path: () => '/storms/isles' + q({ page: 1, filterByOccupierName: 'zz-no-such-player-zz' }), expect: [200] },
      { label: 'unknown filterByState ignored', path: () => '/storms/isles' + q({ page: 1, filterByState: 9 }), expect: [200] },
      { label: 'fort-only orderBy ignored', path: () => '/storms/isles' + q({ page: 1, orderBy: 'attacksLeft', orderDirection: 'desc' }), expect: [200] },
      { label: 'orderBy availability', path: () => '/storms/isles' + q({ page: 1, orderBy: 'availability', orderDirection: 'desc' }), expect: [200] },
    ],
  },
  {
    id: 'storms-isles-filtered',
    method: 'GET',
    scope: 'protected',
    path: () => '/storms/isles' + q({ page: 1, size: 50, filterByState: 2, filterByIsleIds: '[10,11]', positionX: 640, positionY: 640, maxDistance: 200, orderBy: 'position', orderDirection: 'desc' }),
    okStatuses: [200],
    shapeKeys: ['isles', 'pagination'],
    needs: ['specialServer'],
  },
  {
    id: 'storms-isles-occupier',
    method: 'GET',
    scope: 'protected',
    path: (s) => '/storms/isles' + q({ page: 1, filterByOccupierName: s.stormOccupierName ?? s.playerName ?? 'a' }),
    okStatuses: [200],
    shapeKeys: ['isles', 'pagination'],
    needs: ['specialServer', 'player'],
  },
  {
    id: 'storms-isles-near-player',
    method: 'GET',
    scope: 'protected',
    path: (s) => '/storms/isles' + q({ page: 1, nearPlayerName: s.castlePlayerName ?? s.playerName ?? 'a', orderBy: 'distance' }),
    okStatuses: [200, 400],
    needs: ['specialServer', 'castlePlayer'],
  },

  // Aquamarine / Stormy Isles (mixed)
  { id: 'aquamarine-player', method: 'GET', scope: 'public', path: (s) => `/aquamarine/player/${s.playerId ?? '1'}`, okStatuses: [200, 400, 404], needs: ['server', 'player'] },
  {
    id: 'aquamarine',
    method: 'GET',
    scope: 'protected',
    path: () => '/aquamarine' + q({ page: 1 }),
    okStatuses: [200, 400],
    needs: ['server'],
    fuzzQuery: ['order_by', 'order_dir'],
    semantic: {
      collection: 'players',
      idField: 'player_id',
      nonEmpty: true,
      paginated: true,
      sorts: [
        { param: 'order_by', value: 'collected_at', field: 'last_collected_at', directionParam: 'order_dir', ascending: 'ASC', descending: 'DESC' },
      ],
    },
  },
  { id: 'aquamarine-ordered', method: 'GET', scope: 'protected', path: () => '/aquamarine' + q({ page: 1, order_by: 'collected_at', order_dir: 'ASC' }), okStatuses: [200, 400], needs: ['server'] },
  {
    id: 'stormy-isles',
    method: 'GET',
    scope: 'protected',
    path: () => '/stormy-isles' + q({ page: 1 }),
    okStatuses: [200, 400],
    needs: ['server'],
    fuzzQuery: ['order_by', 'order_dir', 'size', 'player_name', 'alliance_name', 'alliance_filter'],
    semantic: {
      collection: 'players',
      idField: 'player_id',
      nonEmpty: true,
      paginated: true,
      stableOrder: { order_by: 'might_current', order_dir: 'ASC' },
      filters: [
        { param: 'min_might', field: 'might_current', kind: 'min', impossible: 2_000_000_000 },
        { param: 'max_might', field: 'might_current', kind: 'max', impossible: 0 },
        { param: 'player_name', field: 'player_name', kind: 'contains' },
        { param: 'alliance_name', field: 'alliance_name', kind: 'contains' },
        {
          param: 'min_level',
          field: 'level+legendary_level',
          kind: 'min',
          impossible: 30_000,
          probeValue: (row) => Number(row.level) + Number(row.legendary_level),
          matches: (row, sent) => Number(row.level) + Number(row.legendary_level) >= Number(sent),
        },
        {
          param: 'max_level',
          field: 'level+legendary_level',
          kind: 'max',
          impossible: 0,
          probeValue: (row) => Number(row.level) + Number(row.legendary_level),
          matches: (row, sent) => Number(row.level) + Number(row.legendary_level) <= Number(sent),
        },
        { param: 'min_alliance_might', field: 'alliance_might', kind: 'min', impossible: 999_999_999_999 },
        { param: 'max_alliance_might', field: 'alliance_might', kind: 'max', noUnmatchableValue: true },
        { param: 'min_alliance_players', field: 'alliance_player_count', kind: 'min', impossible: 10_000 },
        { param: 'max_alliance_players', field: 'alliance_player_count', kind: 'max', impossible: 0 },
      ],
      sorts: [
        { param: 'order_by', value: 'might_current', field: 'might_current', directionParam: 'order_dir', ascending: 'ASC', descending: 'DESC' },
        { param: 'order_by', value: 'level', field: 'level', directionParam: 'order_dir', ascending: 'ASC', descending: 'DESC' },
        { param: 'order_by', value: 'alliance_might', field: 'alliance_might', directionParam: 'order_dir', ascending: 'ASC', descending: 'DESC' },
      ],
    },
    cases: [
      { label: 'min_level above smallint', path: () => '/stormy-isles' + q({ page: 1, min_level: 99_999 }), expect: [200, 400] },
      { label: 'max_level above smallint', path: () => '/stormy-isles' + q({ page: 1, max_level: 99_999 }), expect: [200, 400] },
      { label: 'min_level at the smallint ceiling', path: () => '/stormy-isles' + q({ page: 1, min_level: 32_767 }), expect: [200, 400] },
    ],
  },
  { id: 'stormy-isles-filtered', method: 'GET', scope: 'protected', path: () => '/stormy-isles' + q({ page: 1, order_by: 'alliance_might', order_dir: 'DESC', min_might: 1, min_alliance_players: 1, alliance_filter: 1, min_metric_100: 1 }), okStatuses: [200, 400], needs: ['server'] },
  {
    id: 'stormy-isles-player-filters',
    method: 'GET',
    scope: 'protected',
    path: (s) => '/stormy-isles' + q({
      page: 1,
      size: 20,
      order_by: 'might_current',
      order_dir: 'ASC',
      player_name: (s.playerName ?? 'a').slice(0, 1),
      alliance_name: (s.allianceName ?? 'a').slice(0, 1),
      min_might: 0,
      max_might: 2_000_000_000,
      min_level: 0,
      max_level: 2000,
      min_alliance_might: 0,
      max_alliance_might: 2_000_000_000,
      min_alliance_players: 0,
      max_alliance_players: 200,
    }),
    okStatuses: [200, 400],
    shapeKeys: ['players', 'snapshot_date', 'pagination'],
    needs: ['server', 'player', 'alliance'],
  },
  {
    id: 'stormy-isles-metric-filters',
    method: 'GET',
    scope: 'protected',
    path: () => '/stormy-isles' + q(
      Object.fromEntries([
        ['page', 1],
        ...STORMY_ISLES_METRIC_IDS.flatMap((id) => [
          [`min_metric_${id}`, 0],
          [`max_metric_${id}`, 2_000_000_000],
        ]),
      ]) as Record<string, number>,
    ),
    okStatuses: [200, 400],
    shapeKeys: ['players', 'snapshot_date', 'pagination'],
    needs: ['server'],
  },
];

export const BYPASS_ENDPOINTS = CATALOG.filter((e) => e.bypass);
export const RATE_LIMITED_PROBE: Endpoint = CATALOG.find((e) => e.id === 'servers')!;
