export type ReleaseType = 'Major' | 'Minor' | 'Fix';
export type ReleaseItemKind = 'new' | 'improved' | 'servers' | 'translations' | 'fixed';
export type ApiChangeKind = 'new' | 'changed' | 'legacy' | 'removed';

export interface ReleaseItem {
  kind: ReleaseItemKind;
  area: string | null;
  text: string;
}

export interface ApiChange {
  change: ApiChangeKind;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  tag: string;
  note: string;
}

export interface ReleasePreview {
  summary: string;
  highlights: string[];
}

export interface ReleaseNote {
  version: string;
  type: ReleaseType;
  date: string;
  items: ReleaseItem[];
  api_changes: ApiChange[];
  preview?: ReleasePreview;
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: 'v26-11-02',
    type: 'Major',
    date: '2026-11-02',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: E4K-IN1, E4K-PH, E4K-US2, EP-HIS1, PARTNER-SP',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Event Thresholds : the points needed for each rank of the kingdom events, hour by hour',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added in-game castle view: castles drawn from the game itself, with their walls and buildings',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Storm Tracker: added a map view of storm islands and fortresses',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Storm Tracker now shows how long each fort and isle has been available, and how long it stayed free',
      },
      {
        kind: 'new',
        area: 'Alliance List',
        text: 'Added a global ranking tab: alliances from every server in one ranking',
      },
      {
        kind: 'new',
        area: 'Player List',
        text: 'Added filters to the global rankings (players and alliances)',
      },
      {
        kind: 'new',
        area: 'Player List',
        text: 'Added a "castles in ruins" filter',
      },
      {
        kind: 'new',
        area: 'Offers',
        text: 'Offers are now available on E4K servers',
      },
      {
        kind: 'improved',
        area: 'Design',
        text: 'Complete design overhaul: new home, player, compare and map illustrations, themed tabs, new logo and favicon',
      },
      {
        kind: 'improved',
        area: 'Home',
        text: 'Live event tier, gap to the next tier and end target on your dashboard',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Redesigned alliance history, with a timeline bar',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Event charts now stack each run from its start',
      },
      {
        kind: 'improved',
        area: 'Castles',
        text: 'Redesigned castles list',
      },
      {
        kind: 'improved',
        area: 'Events',
        text: 'Event winners shown, with a filter by event type',
      },
      {
        kind: 'improved',
        area: 'Statistics',
        text: 'Server statistics rebuilt as a metrics table with an inline chart and records',
      },
      {
        kind: 'improved',
        area: 'Outer Realms',
        text: 'Redesigned live Outer Realms',
      },
      {
        kind: 'improved',
        area: 'Offers',
        text: 'Prices in your local currency, with the store update time',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Movements, renames and alliance lists now link to player pages',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Much faster page loading, and link previews for every page',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Advanced castle badge in the server list',
      },
      {
        kind: 'translations',
        area: 'Translation',
        text: 'New translations available: Български, Čeština, Ελληνικά, Magyar, Русский',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed weekly loot of top players going back to 0 past 4.29 billion',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Tournament dates are now shown in your local time',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed dungeons page size and sorting of nearby players',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed E4K event thresholds linking to the EP news hub',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed missing flags for some servers',
      },
    ],
    api_changes: [
      {
        change: 'new',
        method: 'GET',
        path: '/global-ranking/alliances',
        tag: 'Alliances',
        note: 'Alliances of every server in one ranking, filtered by game, servers, name, might, loot, fame and member count',
      },
      {
        change: 'new',
        method: 'GET',
        path: '/event-thresholds/{eventName}',
        tag: 'Events',
        note: 'Points needed for each rank of a kingdom event, hour by hour',
      },
      {
        change: 'new',
        method: 'GET',
        path: '/castle/player/{playerId}',
        tag: 'Castle',
        note: 'Realtime castles of a player, from their id',
      },
      {
        change: 'new',
        method: 'GET',
        path: '/live-ranking/outer-realms/export',
        tag: 'Live Ranking',
        note: 'The whole live Outer Realms ranking in one call, as json, ndjson or csv, with the same filters as the ranking',
      },
      {
        change: 'new',
        method: 'GET',
        path: '/assets/og/event/{eventType}/{eventNumber}.jpg',
        tag: 'Previews',
        note: 'Podium card image of a finished Outer Realms or Beyond the Horizon event',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/live-ranking/outer-realms',
        tag: 'Live Ranking',
        note: 'New filters: server, min/max level, might, score and rank, active, movement, near + radius, plus order_by, order_dir and size',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/players',
        tag: 'Players',
        note: 'New ruinFilter parameter: 0 castles not in ruins, 1 castles in ruins',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/players/search',
        tag: 'Players',
        note: 'New fields parameter to pick the returned fields',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/alliances/search',
        tag: 'Alliances',
        note: 'New fields parameter to pick the returned fields',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/offers',
        tag: 'Offers',
        note: 'Answers on E4K servers, prices in local currencies (approximatePrice / priceUnknown flags), X-Offers-* headers and ETag',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/storms/forts',
        tag: 'Storms',
        note: 'New available_since_observed and last_available_seconds fields',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/storms/isles',
        tag: 'Storms',
        note: 'New available_since_observed and last_available_seconds fields',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/castle/analysis/{castleId}',
        tag: 'Castle',
        note: 'Answers 503 when the game connection is down and 504 GAME_SERVER_UNREACHABLE when the game does not answer; 404 now only means the game refused the castle',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/castle/search/{playerName}',
        tag: 'Castle',
        note: 'Same 503 / 504 answers as the castle analysis',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/players/{playerId}/profile',
        tag: 'Players',
        note: 'New loot_reset field: the weekly loot reset as a timezone and a local time, daylight saving included',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/statistics/player/{playerId}/summary',
        tag: 'Statistics',
        note: 'New loot_reset field, as on the profile',
      },
      {
        change: 'changed',
        method: 'GET',
        path: '/events/list',
        tag: 'Events',
        note: 'Each event now carries its winner',
      },
      {
        change: 'legacy',
        method: 'GET',
        path: '/mini-games/guesses/autocomplete',
        tag: 'Mini-Games',
        note: 'Will be removed in a future version: use GET /players/search?fields=name instead',
      },
    ],
    preview: {
      summary:
        'a complete redesign, Event Thresholds, an in-game castle view, a Storm Tracker map, a global alliance ranking and store offers on E4K',
      highlights: [
        'Event Thresholds',
        'In-game castle view',
        'Storm Tracker map',
        'Global alliance ranking',
        'E4K store offers',
        'Complete redesign',
      ],
    },
  },
  {
    version: 'v26-10-04',
    type: 'Major',
    date: '2026-10-04',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: E4K-AR1, E4K-KR1, E4K-PL1, E4K-PL1-Beta, E4K-WORLD1, PARTNER-SA',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added EP-PT1 and E4K-PL1-Beta to advanced tools',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new home page: a personal dashboard (your might and rank, weekly loot, your alliance, your events this week and the players and alliances you follow)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Compare : two players or two alliances side by side (might, loot aligned on the weekly reset, glory, events and rankings)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Rift Tournament : the Rift Raid alliance ranking, hour by hour, with divisions and subdivisions (EP and E4K)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Grand Tournament is now available on E4K servers, with its own ranking',
      },
      {
        kind: 'new',
        area: 'Player List',
        text: 'Added a global ranking tab: players from every server in one ranking',
      },
      {
        kind: 'new',
        area: 'Player List',
        text: 'Number of results per page can now be changed',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Added "Follow", "This is me", "Compare" and "Share" buttons',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Participation tab now shows the full weekly loot history, week by week',
      },
      {
        kind: 'improved',
        area: 'Alliance Analysis',
        text: 'Added "Follow", "Compare" and "Share" buttons',
      },
      {
        kind: 'improved',
        area: 'Alliance Analysis',
        text: 'Latest Grand Tournament and Rift Tournament divisions displayed as statistics cards',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Player and alliance links now show a preview card on Discord and other social networks',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Restyled tournament score view',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Home, search and landing pages are now usable on phones',
      },
      {
        kind: 'improved',
        area: 'About',
        text: 'New "Integrations" section: GGE Assistant and the public API',
      },
      {
        kind: 'translations',
        area: 'Translation',
        text: 'New translations available: Português, Español, Italiano, Türkçe',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed several in-game names in English (events, levels)',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed missing chart texts (months, days, menu) in some languages',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed missing flags for some servers',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v26-08-23',
    type: 'Major',
    date: '2026-08-23',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: E4K-INT4, E4K-NL1, E4K-SKN1, E4K-PT1',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added EP-SKN1, EP-SK1 and E4K-GB1 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Storm Islands tracker : realtime storm forts and resource isles, with occupant, garrison, remaining attacks and distance filters',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Shop : browse the in-game offers catalog in your own currency, with reward details and rubies per currency unit',
      },
      {
        kind: 'new',
        area: 'Aquamarine Ranking',
        text: 'Renamed from "Stormy Isles" and added an advanced filter panel (might, level, alliance might, member count, aquamarine metrics, alliance state) with sorting and saved filters',
      },
      {
        kind: 'new',
        area: 'Alliance Analysis',
        text: 'Added new tab: alliance description with its full change history',
      },
      {
        kind: 'new',
        area: 'Alliance List',
        text: 'Added the current Stormlord indicator',
      },
      {
        kind: 'new',
        area: 'Fortress',
        text: 'Displaying the last scan time',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Complete redesign of the page',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: "Charts are now loaded on demand, so the page opens much faster, and every event chart can be expanded to the player's full recorded history",
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: '"Wheel of Unimaginable Affluence" tab now shows total tickets, average, record, best ranking and recent trend',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: '"Storm Islands" tab now supports month by month navigation',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Glory tab now displays the top-X glory titles ladder',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'In-game item and building images are now rendered server side (offer rewards, castle buildings)',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Restyled sidebar, loaders, skeleton screens and dropdowns',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: "New 'worth a look' section on the sidebar",
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed castle view returning a cached castle from another kingdom',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed weekly loot charts starting the week on the wrong hour on several servers',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed server statistics grouping days in UTC instead of local time',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v26-06-02',
    type: 'Major',
    date: '2026-06-02',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added E4K-DE2, EP-WORLD1 and EP-ASIA to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Stormy Isles leaderboard : browse rankings with aquamarine metrics',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Wheel of Unimaginable Affluence (WoA) : browse past event leaderboards',
      },
      {
        kind: 'new',
        area: 'Alliance Analysis',
        text: 'Added new statistics cards: players currently in protection, highest glory holder, and total alliance glory',
      },
      {
        kind: 'new',
        area: 'Alliance Analysis',
        text: 'Distance calculator now supports kingdom selection',
      },
      {
        kind: 'new',
        area: 'Fortress',
        text: 'Added a new indicator: observed availability (average availability time before attack)',
      },
      {
        kind: 'new',
        area: 'Fortress',
        text: 'Added player attack history in table and chart format',
      },
      {
        kind: 'new',
        area: 'Castle View',
        text: 'Displaying castle skins and added new tab: list of buildings (table)',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Added new "Wheel of Unimaginable Affluence" tab showing the player\'s WoA event history',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Added new "Stormy Isles" tab showing aquamarine points',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: 'Added new event indicators: participation rate, average score and participation trend',
      },
      {
        kind: 'improved',
        area: 'Alliance List',
        text: 'Added advanced filter: alliance might range',
      },
      {
        kind: 'improved',
        area: 'Castle View',
        text: 'UI overhaul and displaying several randomly selected castles',
      },
      {
        kind: 'improved',
        area: 'Events',
        text: 'Displaying player alliances',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed EP-WORLD1 and EP-WORLD2 outer realm server names displayed incorrectly (shown as LIVE / LIVE2)',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed playername display issue on fortress view',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v26-04-07',
    type: 'Major',
    date: '2026-04-07',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new server: EP-INT2',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added EP-IN1, E4K-INT2, EP-WORLD2, E4K-DE1 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
      },
      {
        kind: 'new',
        area: 'Player List',
        text: 'Added alliance count for each player',
      },
      {
        kind: 'new',
        area: 'Player List',
        text: 'Added kingdom filter',
      },
      {
        kind: 'new',
        area: 'Player List',
        text: 'Filters are now saved automatically',
      },
      {
        kind: 'new',
        area: 'Alliance',
        text: 'Added active players count in alliance tab',
      },
      {
        kind: 'new',
        area: 'Outer Realms',
        text: 'Now displays current active event in live rankings',
      },
      {
        kind: 'improved',
        area: 'API',
        text: 'Added remaining construction time in api-castle endpoint',
      },
      {
        kind: 'improved',
        area: 'Performance',
        text: 'Graphs are now lazily loaded (rendered only when visible) to improve performance',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed alliance filter issues',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed player name search issues',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed translation issues in "Who is it" mini-game',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed sidebar issues after window resize',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Player alliance history now shows both old and current alliance names if renamed',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v26-02-15',
    type: 'Major',
    date: '2026-02-15',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: E4K-RU1, E4K-WORLD2, EP-ES2, EP-AE1',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added EP-BG1, PARTNER_SP3, EP-AU1, E4K-RU1, EP-US1 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added movement filtering and alliance filtering',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added export button (xlsx) for player, alliance, and movement lists',
      },
      {
        kind: 'improved',
        area: 'Player Analysis',
        text: "Added new 'Glory' tab with detailed glory statistics (current title, estimated loss, points needed for next title, etc.)",
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Replaced circular ranking chart with raw points table on alliance event statistics page',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Added PWA support (Progressive Web App)',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Restored Danadum "Empire Rankings" link in the sidebar',
      },
      {
        kind: 'new',
        area: 'Mini-Game',
        text: 'Added daily mini-game "Who is it" (find a mystery player using distance, direction, and clue-based guesses)',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed UTC issues affecting hourly activity rate and alliance/player loot charts',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed "Distance (m)" column displayed in incorrect position',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed player sorting in alliance tab',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed sidebar overlapping certain charts',
      },
      {
        kind: 'fixed',
        area: 'API',
        text: 'Cartography endpoint no longer returns inactive players',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v26-01-05',
    type: 'Major',
    date: '2026-01-05',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: EP-SK1, E4K-CN1, E4K-GB1, EP-BG1, EP-JP1, EP-WORLD2, PARTNER-SP3',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added E4K-HANT, E4K-CN1, EP-BR1, EP-GR1, EP-ES1, EP-HU1, EP-INT3 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed an issue where the SKN1 flag was not displaying correctly',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Added advanced weekly player points analytics (hourly activity rate, average gain and weekly activity map) to the player analysis tool',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: "Added player's alliance rank",
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Improved player filtering with glory points range, castle count range, alliance rank selection, and advanced sorting options',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-12-08',
    type: 'Major',
    date: '2025-12-08',
    items: [
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: real-time EP Outer Realms leaderboard with rankings, scores, and minute-by-minute ranking changes (event-type dependent)',
      },
      {
        kind: 'improved',
        area: 'Design',
        text: 'Complete UI overhaul of the entire website',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed numerous issues and improved overall stability',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new EP servers: ASIA, EG1, GB1, SKN1',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added EP-TR1 and E4K-BR1 to advanced tools (realtime fortress tracker + castle visualizer across kingdoms)',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-11-02',
    type: 'Major',
    date: '2025-11-02',
    items: [
      {
        kind: 'improved',
        area: 'Server',
        text: 'Added Empire Four Kingdoms (E4K) system implementation',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: EP-GR1, E4K-BR1, E4K-DE1, E4K-DE2, E4K-FR1, E4K-HANT1, E4K-INT2, E4K-US1',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added EP-NL1 server to realtime fortress tracker tool',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool (EP): Grand Tournament alliances analysis with hour by hour points tracking and global leaderboard',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Added search functionality for servers list',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Added GitHub repository link in the navigation bar',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Added Discord member count display in the navigation bar',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed custom alliance colors in the cartography tab not being reset after adding a server',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed issue with translations were incorrectly applied in the cartography filtering mechanism',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-10-12',
    type: 'Minor',
    date: '2025-10-12',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: INT1, RU1, CN1',
      },
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added DE1 server to realtime fortress tracker tool',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-09-14',
    type: 'Minor',
    date: '2025-09-14',
    items: [
      {
        kind: 'improved',
        area: 'Server',
        text: 'Technical improvements and optimizations',
      },
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Official Discord support server added: https://discord.gg/eb6WSHQqYh',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-09-01',
    type: 'Major',
    date: '2025-09-01',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: ES1, SA1',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Realtime castle visualizer (Tools - Castles)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added SA1 server to fortress tracker',
      },
      {
        kind: 'improved',
        area: 'Design',
        text: 'General design overhaul of the application',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-08-11',
    type: 'Minor',
    date: '2025-08-11',
    items: [
      {
        kind: 'improved',
        area: 'Miscellaneous',
        text: 'Added search history for player and alliance searches',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed issue with the Polish translation not being applied correctly',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed an issue where the cartography tool was not displaying correctly',
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-08-06',
    type: 'Major',
    date: '2025-08-06',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new servers: HU1, HU2',
      },
      {
        kind: 'improved',
        area: 'Design',
        text: 'General design overhaul of the application',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed issue with the Romanian translation not being applied correctly',
      },
      {
        kind: 'translations',
        area: 'Translation',
        text: 'New translation available: Deutsch (German)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new indicators on player analysis page (server ranking, global ranking, number of castles, etc.)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: "Added external link to 'empire-rankings' in Tools section",
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-07-19',
    type: 'Major',
    date: '2025-07-19',
    items: [
      {
        kind: 'improved',
        area: 'Design',
        text: 'General design overhaul of the application',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: 'Added new tool: Event Tracker (for Outer Realms & Beyond the Horizon)',
      },
      {
        kind: 'new',
        area: 'Tools',
        text: "Revamped Cartography tool: improved performance, new features (add or remove an alliance, change an alliance's color in the legend, etc.)",
      },
    ],
    api_changes: [],
  },
  {
    version: 'v25-07-07',
    type: 'Major',
    date: '2025-07-07',
    items: [
      {
        kind: 'servers',
        area: 'Server',
        text: 'Added new server: HANT1',
      },
      {
        kind: 'fixed',
        area: null,
        text: 'Fixed realtime fortress tracker tool for CZ1, RO1, FR1 and IT1',
      },
    ],
    api_changes: [],
  },
];
