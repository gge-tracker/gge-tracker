import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexFill,
  ApexPlotOptions,
  ApexYAxis,
  ApexDataLabels,
  ApexGrid,
  ApexLegend,
  ApexStroke,
  ApexTitleSubtitle,
  ApexTooltip,
  ApexForecastDataPoints,
  ApexAnnotations,
  ApexMarkers,
  ApexNonAxisChartSeries,
} from 'ng-apexcharts';

export interface ChartAdvancedOptions {
  series?: ApexAxisChartSeries | ApexNonAxisChartSeries | undefined;
  chart: ApexChart;
  xaxis?: ApexXAxis | ApexXAxis[] | undefined;
  colors?: string[];
  fill?: ApexFill;
  plotOptions?: ApexPlotOptions;
  yaxis?: ApexYAxis | ApexYAxis[] | undefined;
  dataLabels?: ApexDataLabels;
  labels?: string[];
  grid?: ApexGrid;
  legend?: ApexLegend;
  stroke?: ApexStroke;
  title?: ApexTitleSubtitle;
  tooltip?: ApexTooltip;
  forecastDataPoints?: ApexForecastDataPoints;
  markers?: ApexMarkers;
  annotations?: ApexAnnotations;
}

export interface ChartOptions {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  colors: string[];
  fill: ApexFill;
  plotOptions: ApexPlotOptions;
  yaxis: ApexYAxis;
  dataLabels: ApexDataLabels;
  labels?: string[];
  grid: ApexGrid;
  legend: ApexLegend;
  stroke: ApexStroke;
  title: ApexTitleSubtitle;
  tooltip: ApexTooltip;
  forecastDataPoints?: ApexForecastDataPoints;
  markers?: ApexMarkers;
  annotations?: ApexAnnotations;
}

export interface AllianceStatsData {
  alliance_name: string;
  total_might: number;
  player_count: number;
}

export interface Card {
  identifier: keyof ApiServerStats;
  label: string;
  logo: string;
  value: string;
  avg: string;
  valueCompare: number;
  link?: string;
}

export interface Rename {
  rank: number;
  might: number | null;
  alliance: string | null;
  oldPlayerName: string;
  updatedPlayerName: string;
  date: string;
}

export interface Dungeon {
  rank: number;
  kid: number;
  image: string;
  position: string;
  playerName?: string;
  playerId?: number;
  cooldown: number;
  totalAttackCount: number;
  updatedAt: string;
  effectiveCooldownUntil: string;
  lastAttackAt: string;
  distance?: number;
}

export interface Offer {
  startAt: string;
  endAt: string;
  offer: number;
  offerType: string;
  serverType: string;
  worldType: string;
  isActive: boolean;
}

export interface Movement {
  rank: number;
  player: string;
  might: number | null;
  level: number | null;
  legendaryLevel: number | null;
  alliance: string | null;
  type: number;
  date: string;
  positionOld: (number | null)[];
  positionNew: (number | null)[];
}

export interface Player {
  rank: number;
  playerId: number;
  playerName: string;
  allianceName: string | null;
  allianceId: number | null;
  allianceRank: number | null;
  mightCurrent: number;
  mightAllTime: number;
  lootCurrent: number;
  lootAllTime: number;
  isFavorite?: boolean;
  honor: number;
  maxHonor: number;
  currentFame: number;
  highestFame: number;
  remainingRelocationTime: number | null;
  peaceDisabledAt: string | null;
  updatedAt: string;
  level: number | null;
  distance?: number;
  legendaryLevel: number | null;
}

export interface Alliance {
  id: number;
  rank: number;
  name: string;
  playerCount: number;
  mightCurrent: number;
  mightAllTime: number;
  lootCurrent: number;
  lootAllTime: number;
  currentFame: number;
  highestFame: number;
}

export interface FavoritePlayer {
  playerId: number;
  playerName: string;
}

export interface AlliancesUpdates {
  id: number | null;
  date: string | null;
  alliance: string | null;
  duration: string;
}

export interface PlayersUpdates {
  date: string | null;
  player: string | null;
  duration: string;
}

export enum ChartTypes {
  DEFAULT = 'Graphique',
  EVOLUTION = 'Evolution',
  PARTICIPATION_RATE = 'Participation',
  RADAR = 'Classement',
  TABLE = 'Données',
}

export type Top3EventPlayers = Record<number, Record<number, EventEntry>>;

export interface EventEntry {
  date: string;
  players: {
    id: string;
    point: number;
  }[];
}

export interface EventGenericVariation extends ApiGenericData {
  variation: number;
  playerName?: string;
  __hourKey?: string;
}

export enum CastleType {
  CASTLE = 1,
  REALM_CASTLE = 12,
  CAPITAL = 3,
  OUTPOST = 4,
  CITY = 22,
  ROYAL_TOWER = 23,
  MONUMENT = 26,
  LABORATORY = 28,
}

export enum ErrorType {
  ERROR_OCCURRED = 'Une erreur est survenue',
  NO_ALLIANCE_FOUND = 'Aucune alliance trouvée',
  NO_PLAYER_FOUND = 'Aucun joueur trouvé',
  ALLIANCE_ADDED = 'Alliance ajoutée',
  ALLIANCE_REMOVED = 'Alliance retirée',
  COPIED_TO_CLIPBOARD = 'Copié dans le presse-papier',
  RATE_LIMIT_EXCEEDED = 'Trop de requêtes, veuillez réessayer plus tard.',
}

export enum CastleTypeDefaultTranslation {
  CASTLE = 'Chateau principal',
  OUTPOST = 'Avant-poste',
  MONUMENT = 'Monument',
  LABORATORY = 'Laboratoire',
  CAPITAL = 'Capitale',
  ROYAL_TOWER = 'Tour royale',
  CITY = 'Cité marchande',
  UNKNOWN = 'Inconnu',
  MOVEMENT = 'Déménagement',
  DELETED = 'supprimé',
  NEW_PLAYER = 'Nouveau joueur',
  ABANDONED = 'abandonné',
  CONQUEST = "Conquête d'un",
}

export const WorldSizeDimensions = {
  X: { MIN: 0, MAX: 1286 },
  Y: { MIN: 0, MAX: 1286 },
} as const;

export interface CastleQuantity {
  castle: number;
  outpost: number;
  monument: number;
  laboratory: number;
  capital: number;
  royalTower: number;
  city: number;
  patriarch: number;
}

export interface Castle {
  name: string;
  castles: number[][];
  pp: number;
  alliance_id?: number;
  alliance_name?: string;
}

export interface Monument {
  type: string;
  position: string;
  owner: string;
  kingdom?: number;
  color: string;
}

export enum WatchModeStats {
  SPECIFIC_ALLIANCE = 'one',
  ALL_ALLIANCES = 'all',
}

export type SearchType = 'alliance' | 'player';

export type ApiResponse<T> = { success: true; error?: string; data: T } | { success: false; error: string };

export interface ApiPagination {
  current_page: number;
  current_items_count: number;
  total_pages: number;
  total_items_count: number;
}

export interface ApiDungeonsResource {
  kid: number;
  position_x: number;
  position_y: number;
  attack_cooldown: number;
  player_id?: number;
  player_name?: string;
  total_attack_count: number;
  updated_at: string;
  effective_cooldown_until: string;
  last_attack: string;
  distance?: number;
}

export interface ApiPlayerSearchResponse {
  player_id: number;
  player_name: string;
  alliance_name: string;
  alliance_id: number;
  alliance_rank: number | null;
  might_all_time: number;
  might_current: number;
  loot_all_time: number;
  loot_current: number;
  honor: number;
  max_honor: number;
  peace_disabled_at: string | null;
  level: number | null;
  legendary_level: number | null;
  current_fame: number;
  highest_fame: number;
  calculated_distance?: number;
  remaining_relocation_time: number | null;
  max_fame: number;
  updated_at: string;
}

export interface PlayerLiveRankingExtended extends PlayerLiveRanking {
  legendary_level: number;
  level: number;
}

export interface PlayerLiveRanking {
  castle_position: [number, number];
  player_id: string;
  player_name: string;
  server: string;
  data: ApiLiveRankingSpecificPlayerData[];
}

export interface ApiLiveRankingSpecificPlayerResponse {
  player: PlayerLiveRanking;
}

export interface ApiLiveRankingSpecificPlayerData {
  legendary_level: number;
  level: number;
  might: number;
  rank: number;
  score: number;
  timestamp: string;
}

export interface ApiLiveRankingResponse {
  players: ApiLiveRanking[];
  pagination: ApiPagination;
}

export interface ApiLiveRanking {
  player_id: string;
  player_name: string;
  server: string;
  rank: number;
  level: number;
  score: number;
  legendary_level: number;
  might: number;
  castle_position: [number, number];
  rank_diff: number;
  score_diff: number;
}
export interface ApiAllianceSearchResponse {
  alliance_id: number;
  alliance_name: string;
  player_count: number;
  might_current: number;
  might_all_time: number;
  loot_current: number;
  loot_all_time: number;
  current_fame: number;
  highest_fame: number;
}

export interface ApiAlliancePlayersSearchResponse {
  alliance_name: string;
  players: ApiPlayerSearchResponse[];
}

export interface ApiUpdateAlliancePlayersResponse {
  updates: ApiUpdateAlliancePlayers[];
}

export interface ApiUpdateAlliancePlayers {
  created_at: string;
  legendary_level: number | null;
  level: number | null;
  loot_current: number;
  might_current: number;
  new_alliance_id: number | null;
  old_alliance_id: number | null;
  player_id: number;
  player_name: string;
}

export type ISelectedTab = 'movement' | 'stats' | 'progress' | 'members' | 'movements' | 'health';

export interface GroupedUpdatesByDate {
  date: string;
  updates: {
    created_at: string;
    action: 'joined' | 'left';
    player_name: string;
    level: string;
    might_change: string;
  }[];
}

export interface ApiGenericResponse {
  duration: string;
  pagination: ApiPagination;
}
export interface ApiMovementsResponse extends ApiGenericResponse {
  movements: ApiMovement[];
}

export interface ApiRenamesResponse extends ApiGenericResponse {
  renames: ApiRenames[];
}

export interface ApiDungeonsResponse extends ApiGenericResponse {
  dungeons: ApiDungeonsResource[];
}

export interface ApiPlayersResponse extends ApiGenericResponse {
  players: ApiPlayerSearchResponse[];
}

export interface ApiAllianceResponse extends ApiGenericResponse {
  alliances: ApiAllianceSearchResponse[];
}

export interface ApiMovement {
  alliance_name: string | null;
  created_at: string;
  movement_type: 'add' | 'remove' | 'move';
  player_name: string;
  player_might: number | null;
  player_level: number | null;
  player_legendary_level: number | null;
  position_x_new: number | null;
  position_x_old: number | null;
  position_y_new: number | null;
  position_y_old: number | null;
  castle_type: number;
}

export interface ApiRenames {
  date: string;
  player_name: string;
  player_might: number | null;
  alliance_name: string | null;
  old_player_name: string;
  new_player_name: string;
}

export interface ApiLastUpdates {
  api_url: string;
  discord_url: string;
  discord_member_count?: number;
  release_version: string;
  website_url: string;
  server: string;
  version: string;
  players: number;
  last_update: {
    berimond_invasion: string;
    berimond_kingdom: string;
    bloodcrow: string;
    loot: string;
    might: string;
    nomad: string;
    samurai: string;
    war_realms: string;
  };
}

export enum ApiPlayerStatsType {
  might = 'player_might_history',
  loot = 'player_loot_history',
  berimond_invasion = 'player_event_berimond_invasion_history',
  berimond_kingdom = 'player_event_berimond_kingdom_history',
  bloodcrow = 'player_event_bloodcrow_history',
  nomad = 'player_event_nomad_history',
  samurai = 'player_event_samurai_history',
  war_realms = 'player_event_war_realms_history',
}

export type ApiPlayerStatsValue = (typeof ApiPlayerStatsType)[keyof typeof ApiPlayerStatsType];

export interface ApiGenericData {
  date: string;
  utcDate?: string;
  point: number;
}

export type ApiPlayerStats = Record<ApiPlayerStatsType, ApiGenericData[]>;

export type ApiPlayerStatsForAlliance = Record<ApiPlayerStatsType, ApiPlayerStatsAlliance[]>;

export interface ApiPlayerStatsAlliance extends ApiGenericData {
  player_id: number;
}

export interface ApiPlayerStatsByPlayerId {
  alliance_id: number;
  alliance_name: string;
  diffs: Record<ApiPlayerStatsType, number>;
  player_name: string;
  points: ApiPlayerStats;
  glory_points_100: { top: number; point: number }[];
  timezone_offset: number | null;
}

export interface ApiPlayerStatsByAllianceId {
  diffs: Record<ApiPlayerStatsType, number>;
  points: ApiPlayerStatsForAlliance;
  timezoneOffset: number | null;
}

export interface ApiAllianceHealthResponse {
  daily_avg_might_change: { date: string; avg_diff: number }[];
  might_intra_variation: { date: string; avg_diff: number }[];
  might_per_hour: { date: string; point: number }[];
  top_might_gain_7d: { current: number; diff: number; player_id: string }[];
  top_might_gain_24h: { current: number; diff: number; player_id: string }[];
  top_might_loss_7d: { current: number; diff: number; player_id: string }[];
  top_might_loss_24h: { current: number; diff: number; player_id: string }[];
}

export interface ApiOffersResponse {
  offers: ApiOffer[];
}

export interface ApiOffer {
  end_at: string;
  offer: number;
  offer_type: string;
  server_type: string;
  start_at: string;
  world_type: string;
}

export interface ApiEventlist {
  events: {
    event_num: number;
    collect_date: string;
    player_count: number;
    type: 'outer_realms' | 'beyond_the_horizon';
  }[];
}
export interface ApiOuterRealmPlayer {
  player_id: number;
  player_name: string;
  rank: number;
  point: string;
  server: string;
}
export interface ApiOuterRealmPlayers {
  pagination: ApiPagination;
  players: ApiOuterRealmPlayer[];
}

export interface IGenericGgeDataObject {
  wodID: number;
  objectID: number;
  positionX: number;
  positionY: number;
  rotation: number;
  constructionCompletionInSec: number;
  buildingState: number;
  hitPoints: number;
  constructionBoostAtStart: number;
  efficiency: number;
  internalID?: string;
  damageType: number;
  inDistrictID: number;
  districtSlotID: number;
  damageFactor: number;
}

export interface ApiPlayerCastleGenericBase {
  castleName: string;
  castleType: number;
  legendaryLevel: number | null;
  level: number;
  playerName: string;
  positionX: number;
  positionY: number;
}

export interface IMappedBuildingUnknownDataElement {
  [key: string]: string | number | boolean | null;
}

export interface IMappedBuildingElement {
  building: IGenericGgeDataObject;
  data: IMappedBuildingUnknownDataElement;
  constructionItems: { [key: string]: ConstructionItem };
}

export interface ConstructionItem {
  [key: string]: string | boolean | number | null;
}

export interface ApiPlayerCastleDataMapped extends ApiPlayerCastleGenericBase {
  data: {
    buildings: IMappedBuildingElement[];
    defenses: IMappedBuildingElement[];
    gates: IMappedBuildingElement[];
    grounds: IMappedBuildingElement[];
    towers: IMappedBuildingElement[];
  };
  constructionItems: ConstructionItem[];
}

export interface ApiPlayerCastleDataResponse extends ApiPlayerCastleGenericBase {
  data: {
    buildings: IGenericGgeDataObject[];
    defenses: IGenericGgeDataObject[];
    gates: IGenericGgeDataObject[];
    grounds: IGenericGgeDataObject[];
    towers: IGenericGgeDataObject[];
  };
  constructionItems: {
    [key: string]: [number, number][];
  };
}

export interface ApiGrandTournamentDatesResponse {
  events: {
    dates: string[];
    event_id: number;
  }[];
}

export interface ApiGrandTournamentAlliance {
  alliance_id: number;
  alliance_name: string;
  server: string;
  rank: number;
  score: number;
  subdivision: number;
}

export interface ApiGrandTournamentSearchAlliances extends ApiGrandTournamentAlliance {
  division: number;
  subdivision: number;
}

export interface ApiGrandTournamentAlliancesResponse {
  event: {
    alliances: ApiGrandTournamentAlliance[];
    division: {
      current_division: number;
      max_division: number;
      min_division: number;
    };
    subdivision: {
      current_subdivision: number;
      max_subdivision: number;
      min_subdivision: number;
    };
  };
  pagination: {
    current_items_count: number;
    current_page: number;
    total_items_count: number;
    total_pages: number;
  };
}

export interface ApiAllianceAnalysis {
  division: number;
  subdivision: number;
  rank: number;
  score: number;
  date: string;
}

export interface ApiGrandTournamenAllianceAnalysisResponse {
  meta: {
    alliance_id: number;
    alliance_name: string;
    server: string;
  };
  analysis: ApiAllianceAnalysis[];
}

export interface ApiGrandTournamentAlliancesSearchResponse {
  alliances: ApiGrandTournamentSearchAlliances[];
  pagination: {
    current_items_count: number;
    current_page: number;
    total_items_count: number;
    total_pages: number;
  };
}

export interface ApiPlayerCastleNameResponse {
  kingdomId: number;
  id: number;
  positionX: number;
  positionY: number;
  type: number;
  name: string;
  keepLevel: number;
  wallLevel: number;
  gateLevel: number;
  towerLevel: number;
  moatLevel: number;
  equipmentUniqueIdSkin: number;
  equipment?: any;
  isAvailable: boolean;
}

export interface ApiRankingStatsPlayer {
  player_id: number;
  server: string;
  might_current: number;
  might_all_time: number;
  current_fame: number;
  highest_fame: number;
  peace_disabled_at: string | null;
  player_current_fame_rank: string | null;
  updated_at: string;
  loot_current: number;
  loot_all_time: number;
  level: number | null;
  legendary_level: number | null;
  honor: number;
  max_honor: number;
  castles: number[][] | null;
  castles_realm: number[][] | null;
  server_rank: number;
  global_rank: number;
}

export interface ApiOuterRealmEvent {
  event_id: string;
  event_type: string;
  collect_date: string;
  nb_in_top_100: {
    server: string;
    nb_in_top_100: string;
  }[];
  top_scores: {
    top_1: string;
    top_2: string;
    top_3: string;
    top_100: string;
    top_1000: string;
    top_10000: string;
  };
  rank_distribution: {
    server: string;
    top_100: string;
    top_1000: string;
    top_10000: string;
  }[];
  score_stats: {
    avg_score: string;
    median_score: string;
    max_score: string;
  };
  score_stddev: string;
  level_distribution: {
    level: number;
    nb_players: string;
    avg_score: string;
  }[];
  server_avg_score: {
    server: string;
    avg_score: string;
    median_score: number;
    nb_players: string;
  }[];
  top_100_ratio: {
    server: string;
    ratio_top_100: number;
  }[];
}

export interface ApiTop3EventsById {
  topPlayers: ApiTop3Events[];
}

export interface ApiTop3Events {
  date: string;
  top_players: string;
}

export interface ApiAllianceUpdates {
  date: string;
  old_alliance_id: number | null;
  old_alliance_name: string | null;
  new_alliance_id: number | null;
  new_alliance_name: string | null;
}

export interface ApiPlayerUpdates {
  date: string;
  old_player_name: string | null;
  new_player_name: string | null;
}

export interface ApiAllianceUpdatesByPlayerId {
  updates: ApiAllianceUpdates[];
}

export interface ApiPlayerUpdatesByPlayerId {
  updates: ApiPlayerUpdates[];
}

export interface ApiServerStats {
  avg_might: number;
  avg_loot: number;
  avg_honor: number;
  avg_level: number;
  max_might: number;
  max_loot: number;
  players_count: number;
  alliance_count: number;
  players_who_changed_alliance: number;
  players_who_changed_name: number;
  total_might: number;
  total_loot: number;
  total_honor: number;
  variation_might: number;
  variation_loot: number;
  variation_honor: number;
  alliances_changed_name: number;
  events_count: number;
  events_top_3_names: Record<string, { id: string; point: number }[]>;
  events_participation_rate: Record<string, [number, number]>;
  event_nomad_points: number | null;
  event_war_realms_points: number | null;
  event_bloodcrow_points: number | null;
  event_samurai_points: number | null;
  event_berimond_invasion_points: number | null;
  event_berimond_kingdom_points: number | null;
  event_nomad_players: number | null;
  event_berimond_invasion_players: number | null;
  event_berimond_kingdom_players: number | null;
  event_bloodcrow_players: number | null;
  event_samurai_players: number | null;
  event_war_realms_players: number | null;
  created_at: string;
}

export interface ApiCartoAlliance {
  name: string;
  castles: [number, number, number][] | null;
  castles_realm: [number, number, number, number][] | null;
  might_current: number;
}

export interface ApiCartoMap extends ApiCartoAlliance {
  alliance_name: string;
  alliance_id: number;
}
