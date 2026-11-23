import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { LayeredSceneComponent } from '@ggetracker-components/layered-scene/layered-scene.component';
import { LeagueMedalsComponent } from '@ggetracker-components/league-medals/league-medals.component';
import {
  HIGHEST_LEAGUE_TITLE,
  LeagueTitleComponent,
  LeagueTitleFamily,
  leagueTitleFamilies,
} from '@ggetracker-components/league-title/league-title.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiKingdomsLeagueAlliance,
  ApiKingdomsLeagueAlliancesResponse,
  ApiKingdomsLeagueGlobalAlliancesResponse,
  ApiKingdomsLeagueGlobalPlayersResponse,
  ApiKingdomsLeagueGlobalRow,
  ApiKingdomsLeaguePlayer,
  ApiKingdomsLeaguePlayerHistoryResponse,
  ApiKingdomsLeaguePlayersResponse,
  ApiKingdomsLeagueSeason,
  ApiPagination,
  ApiResponse,
  ErrorType,
  KingdomsLeagueGame,
  KingdomsLeagueQuery,
  KingdomsLeagueScope,
  KingdomsLeagueSubject,
} from '@ggetracker-interfaces/empire-ranking';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';
import { KingdomsLeagueProgressComponent } from './kingdoms-league-progress/kingdoms-league-progress.component';

type RankMovement = 'up' | 'down' | 'steady' | 'new' | 'none';
type LeaguePlayerRow = ApiKingdomsLeaguePlayer & Partial<ApiKingdomsLeagueGlobalRow>;
type LeagueAllianceRow = ApiKingdomsLeagueAlliance & Partial<ApiKingdomsLeagueGlobalRow>;
type MedalKind = 'gold' | 'silver' | 'bronze';

interface LeagueFilterForm {
  allianceName: string;
  minTitle: string;
  maxTitle: string;
  minGold: string;
  maxGold: string;
  minSilver: string;
  maxSilver: string;
  minBronze: string;
  maxBronze: string;
}

type NumericFilterKey = Exclude<keyof LeagueFilterForm, 'allianceName'>;

const NUMERIC_FILTER_KEYS: NumericFilterKey[] = [
  'minTitle',
  'maxTitle',
  'minGold',
  'maxGold',
  'minSilver',
  'maxSilver',
  'minBronze',
  'maxBronze',
];
const PLAYER_ONLY_KEYS = new Set<keyof LeagueFilterForm>(['allianceName', 'minTitle', 'maxTitle']);
const URL_KEYS: Record<keyof LeagueFilterForm, string> = {
  allianceName: 'alliance_name',
  minTitle: 'min_title',
  maxTitle: 'max_title',
  minGold: 'min_gold',
  maxGold: 'max_gold',
  minSilver: 'min_silver',
  maxSilver: 'max_silver',
  minBronze: 'min_bronze',
  maxBronze: 'max_bronze',
};
type TableHeader = [string, string, string, boolean];
type LeagueRankingResponse = ApiResponse<
  | ApiKingdomsLeaguePlayersResponse
  | ApiKingdomsLeagueAlliancesResponse
  | ApiKingdomsLeagueGlobalPlayersResponse
  | ApiKingdomsLeagueGlobalAlliancesResponse
>;

const PLAYER_HEADERS: TableHeader[] = [
  ['playerName', 'Joueur', '', true],
  ['allianceName', 'Alliance', '', true],
  ['title', 'Titre de royaume', '', true],
  ['medals', 'Médailles', '', true],
  ['actions', 'Actions', '', true],
];
const GLOBAL_PLAYER_HEADERS: TableHeader[] = [
  PLAYER_HEADERS[0],
  ['server', 'Serveur', '', true],
  ...PLAYER_HEADERS.slice(1),
];
const ALLIANCE_HEADERS: TableHeader[] = [
  ['allianceName', 'Alliance', '', true],
  ['medals', 'Médailles', '', true],
  ['actions', 'Actions', '', true],
];
const GLOBAL_ALLIANCE_HEADERS: TableHeader[] = [
  ALLIANCE_HEADERS[0],
  ['server', 'Serveur', '', true],
  ...ALLIANCE_HEADERS.slice(1),
];
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const MAX_MEDALS = 65_535;
const PAGE_SIZE_STORAGE_KEY = 'kingdomsLeaguePageSize';
const FILTERS_MODAL_ID = 'kingdomsLeagueFiltersModal';
const EMPTY_PAGINATION: ApiPagination = {
  current_page: 1,
  total_pages: 0,
  current_items_count: 0,
  total_items_count: 0,
};

function toTitle(index: number): number {
  return index + 1;
}

function emptyFilterForm(): LeagueFilterForm {
  return {
    allianceName: '',
    minTitle: '',
    maxTitle: '',
    minGold: '',
    maxGold: '',
    minSilver: '',
    maxSilver: '',
    minBronze: '',
    maxBronze: '',
  };
}

@Component({
  selector: 'app-kingdoms-league',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TranslateModule,
    SearchFormComponent,
    TableComponent,
    ModalFormGroupComponent,
    LeagueMedalsComponent,
    LeagueTitleComponent,
    KingdomsLeagueProgressComponent,
    LayeredSceneComponent,
  ],
  templateUrl: './kingdoms-league.component.html',
  styleUrl: './kingdoms-league.component.css',
})
export class KingdomsLeagueComponent extends GenericComponent implements OnInit {
  public readonly filtersModalId = FILTERS_MODAL_ID;
  public readonly titleFamilies = leagueTitleFamilies();
  public readonly titleOptions = [...Array.from({ length: HIGHEST_LEAGUE_TITLE }).keys()].map(toTitle);
  public readonly medalKinds: MedalKind[] = ['gold', 'silver', 'bronze'];
  public readonly games: { value: KingdomsLeagueGame; label: string; icon?: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'ep', label: 'Empire', icon: 'fa-solid fa-desktop' },
    { value: 'e4k', label: 'E4K', icon: 'fa-solid fa-mobile-screen-button' },
  ];
  public readonly maxPageSize = MAX_PAGE_SIZE;
  public scope: KingdomsLeagueScope = 'server';
  public game: KingdomsLeagueGame = 'all';
  public globalDays: string[] = [];
  public seasons: ApiKingdomsLeagueSeason[] = [];
  public seasonId = 0;
  public day = '';
  public previousDay: string | null = null;
  public tab: KingdomsLeagueSubject = 'players';
  public search = '';
  public players: LeaguePlayerRow[] = [];
  public alliances: LeagueAllianceRow[] = [];
  public pagination: ApiPagination = { ...EMPTY_PAGINATION };
  public isDataLoading = false;
  public isLeagueMissing = false;
  public progress: ApiKingdomsLeaguePlayerHistoryResponse | null = null;
  public loadingProgressFor: number | null = null;
  public filters: LeagueFilterForm = emptyFilterForm();
  public draft: LeagueFilterForm = emptyFilterForm();
  public memberOf: { id: number; name: string } | null = null;
  public pageSize = DEFAULT_PAGE_SIZE;
  public pageSizeInput = DEFAULT_PAGE_SIZE;
  public searchFormFilters: Record<string, string> = { tab: 'players' };
  public filtersOpened = false;
  public readonly serverService = inject(ServerService);
  private readonly localStorage = inject(LocalStorageService);

  constructor() {
    super();
    this.isInLoading = true;
  }

  public get season(): ApiKingdomsLeagueSeason | undefined {
    return this.seasons.find((season) => season.season_id === this.seasonId);
  }

  public get latestSeason(): ApiKingdomsLeagueSeason | undefined {
    return this.seasons.at(-1);
  }

  public get isFinalRanking(): boolean {
    const season = this.season;
    return !!season && season !== this.latestSeason && this.day === season.last_day;
  }

  public get rankedCount(): number {
    return this.pagination.total_items_count;
  }

  public get seasonsNewestFirst(): ApiKingdomsLeagueSeason[] {
    return [...this.seasons].reverse();
  }

  public get daysNewestFirst(): string[] {
    return this.scope === 'global' ? this.globalDays : [...(this.season?.days ?? [])].reverse();
  }

  public get isGlobal(): boolean {
    return this.scope === 'global';
  }

  public get playerHeaders(): TableHeader[] {
    return this.isGlobal ? GLOBAL_PLAYER_HEADERS : PLAYER_HEADERS;
  }

  public get allianceHeaders(): TableHeader[] {
    return this.isGlobal ? GLOBAL_ALLIANCE_HEADERS : ALLIANCE_HEADERS;
  }

  public get serverName(): string {
    return this.apiRestService.serverService.currentServer?.name ?? 'FR1';
  }

  public get draftChanged(): boolean {
    return (Object.keys(this.draft) as (keyof LeagueFilterForm)[]).some((key) => this.draft[key] !== '');
  }

  public async ngOnInit(): Promise<void> {
    const parameters = this.route.snapshot.queryParams;
    this.tab = parameters['tab'] === 'alliances' ? 'alliances' : 'players';
    this.search = parameters['search'] ?? '';
    this.scope = parameters['scope'] === 'global' ? 'global' : 'server';
    this.game = this.games.some((option) => option.value === parameters['game']) ? parameters['game'] : 'all';
    this.filters = this.readFiltersFromUrl(parameters);
    this.draft = { ...this.filters };
    this.pageSize = this.readStoredPageSize();
    this.pageSizeInput = this.pageSize;
    this.syncSearchFormFilters();
    await this.loadSeasons(Number(parameters['season']), parameters['day']);
    if (this.isGlobal) await this.loadGlobalDays(parameters['day']);
    await this.refresh(Number(parameters['page']) || 1);
    this.isInLoading = false;
  }

  public async switchScope(scope: KingdomsLeagueScope): Promise<void> {
    if (scope === this.scope || this.isDataLoading) return;
    this.scope = scope;
    this.memberOf = null;
    if (scope === 'global') await this.loadGlobalDays();
    else this.day = this.season?.last_day ?? '';
    this.syncSearchFormFilters();
    await this.refresh(1);
  }

  public async selectGame(game: KingdomsLeagueGame): Promise<void> {
    if (game === this.game || this.isDataLoading) return;
    this.game = game;
    await this.loadGlobalDays(this.day);
    await this.refresh(1);
  }

  public async changeSeason(seasonId: number): Promise<void> {
    this.seasonId = Number(seasonId);
    this.day = this.season?.last_day ?? '';
    await this.refresh(1);
  }

  public async changeDay(day: string): Promise<void> {
    this.day = day;
    await this.refresh(1);
  }

  public async changeTab(tab: KingdomsLeagueSubject): Promise<void> {
    if (tab === this.tab) return;
    this.tab = tab;
    this.search = '';
    if (tab === 'alliances') this.memberOf = null;
    this.syncSearchFormFilters();
    await this.refresh(1);
  }

  public async searchPlayer(name: string): Promise<void> {
    this.tab = 'players';
    this.search = name.trim();
    this.syncSearchFormFilters();
    await this.refresh(1);
  }

  public async searchAlliance(name: string): Promise<void> {
    this.tab = 'alliances';
    this.search = name.trim();
    this.memberOf = null;
    this.syncSearchFormFilters();
    await this.refresh(1);
  }

  public async showMembers(alliance: { alliance_id: number | null; alliance_name: string | null }): Promise<void> {
    if (!alliance.alliance_id) return;
    this.memberOf = {
      id: alliance.alliance_id,
      name: alliance.alliance_name ?? '',
    };
    this.tab = 'players';
    this.search = '';
    this.syncSearchFormFilters();
    await this.refresh(1);
  }

  public async clearMembers(): Promise<void> {
    this.memberOf = null;
    this.syncSearchFormFilters();
    await this.refresh(1);
  }

  public async navigateTo(page: number): Promise<void> {
    await this.refresh(page);
  }

  public async previousPage(): Promise<void> {
    if (this.pagination.current_page > 1) await this.refresh(this.pagination.current_page - 1);
  }

  public async nextPage(): Promise<void> {
    if (this.pagination.current_page < this.pagination.total_pages)
      await this.refresh(this.pagination.current_page + 1);
  }

  public async showProgress(player: LeaguePlayerRow): Promise<void> {
    this.loadingProgressFor = player.player_id;
    const response = await this.apiRestService
      .getKingdomsLeaguePlayerHistory(player.player_id, player.season_id ?? this.seasonId, player.server)
      .finally(() => (this.loadingProgressFor = null));
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.progress = response.data;
  }

  public isFamilySelected(family: { firstTitle: number; lastTitle: number }): boolean {
    return this.draft.minTitle === String(family.firstTitle) && this.draft.maxTitle === String(family.lastTitle);
  }

  public toggleFamily(family: { family: LeagueTitleFamily; firstTitle: number; lastTitle: number }): void {
    const selected = this.isFamilySelected(family);
    this.draft.minTitle = selected ? '' : String(family.firstTitle);
    this.draft.maxTitle = selected ? '' : String(family.lastTitle);
  }

  public medalKey(kind: MedalKind, bound: 'min' | 'max'): NumericFilterKey {
    return `${bound}${kind.charAt(0).toUpperCase()}${kind.slice(1)}` as NumericFilterKey;
  }

  public medalLabel(kind: MedalKind): string {
    if (kind === 'gold') return "Médaille d'or";
    return kind === 'silver' ? "Médaille d'argent" : 'Médaille de bronze';
  }

  public onDraftNumber(key: NumericFilterKey, event: Event): void {
    const value = (event.target as HTMLInputElement).value.replaceAll(/\D/g, '');
    this.draft[key] = value;
    (event.target as HTMLInputElement).value = value;
  }

  public resetDraft(): void {
    this.draft = emptyFilterForm();
    this.pageSizeInput = DEFAULT_PAGE_SIZE;
  }

  public async applyFilters(): Promise<void> {
    this.filters = this.sanitize(this.draft);
    this.draft = { ...this.filters };
    this.applyPageSize();
    this.syncSearchFormFilters();
    await this.refresh(1);
  }

  public onFiltersShown(): void {
    this.filtersOpened = true;
    this.draft = { ...this.filters };
    this.pageSizeInput = this.pageSize;
  }

  public isPlayerOnlyFilter(key: keyof LeagueFilterForm): boolean {
    return PLAYER_ONLY_KEYS.has(key);
  }

  public movementOf(row: { rank: number; previous_rank?: number | null }): RankMovement {
    if (!this.previousDay || row.previous_rank === undefined) return 'none';
    if (row.previous_rank === null) return 'new';
    if (row.previous_rank > row.rank) return 'up';
    return row.previous_rank < row.rank ? 'down' : 'steady';
  }

  public movementSize(row: { rank: number; previous_rank?: number | null }): number {
    return row.previous_rank === null || row.previous_rank === undefined ? 0 : Math.abs(row.previous_rank - row.rank);
  }

  private query(form: LeagueFilterForm): KingdomsLeagueQuery {
    const number = (value: string): number | undefined => (value === '' ? undefined : Number(value));
    const forPlayers = this.tab === 'players';
    return {
      day: this.day || undefined,
      name: this.search || undefined,
      allianceName: forPlayers ? form.allianceName.trim() || undefined : undefined,
      allianceId: forPlayers ? this.memberOf?.id : undefined,
      minTitle: forPlayers ? number(form.minTitle) : undefined,
      maxTitle: forPlayers ? number(form.maxTitle) : undefined,
      minGold: number(form.minGold),
      maxGold: number(form.maxGold),
      minSilver: number(form.minSilver),
      maxSilver: number(form.maxSilver),
      minBronze: number(form.minBronze),
      maxBronze: number(form.maxBronze),
    };
  }

  private sanitize(form: LeagueFilterForm): LeagueFilterForm {
    const clean = { ...form, allianceName: form.allianceName.trim() };
    for (const key of NUMERIC_FILTER_KEYS) {
      const highest = key.endsWith('Title') ? HIGHEST_LEAGUE_TITLE : MAX_MEDALS;
      const lowest = key.endsWith('Title') ? 1 : 0;
      const value = Number.parseInt(clean[key], 10);
      clean[key] = Number.isFinite(value) ? String(Math.min(highest, Math.max(lowest, value))) : '';
    }
    return clean;
  }

  private readFiltersFromUrl(parameters: Record<string, string>): LeagueFilterForm {
    const form = emptyFilterForm();
    for (const key of Object.keys(URL_KEYS) as (keyof LeagueFilterForm)[]) {
      form[key] = parameters[URL_KEYS[key]] ?? '';
    }
    const memberId = Number(parameters['alliance_id']);
    if (memberId > 0) this.memberOf = { id: memberId, name: parameters['alliance'] ?? '' };
    return this.sanitize(form);
  }

  private syncSearchFormFilters(): void {
    const active: Record<string, string> = { tab: this.tab };
    for (const key of Object.keys(this.filters) as (keyof LeagueFilterForm)[]) {
      if (this.tab === 'alliances' && this.isPlayerOnlyFilter(key)) continue;
      active[key] = this.filters[key];
    }
    this.searchFormFilters = active;
  }

  private applyPageSize(): void {
    const size = Math.trunc(Number(this.pageSizeInput));
    this.pageSize = Number.isFinite(size) ? Math.min(MAX_PAGE_SIZE, Math.max(1, size)) : DEFAULT_PAGE_SIZE;
    this.pageSizeInput = this.pageSize;
    if (this.pageSize === DEFAULT_PAGE_SIZE) this.localStorage.removeItem(PAGE_SIZE_STORAGE_KEY);
    else this.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(this.pageSize));
  }

  private readStoredPageSize(): number {
    const stored = Number.parseInt(this.localStorage.getItem(PAGE_SIZE_STORAGE_KEY) ?? '', 10);
    return Number.isFinite(stored) ? Math.min(MAX_PAGE_SIZE, Math.max(1, stored)) : DEFAULT_PAGE_SIZE;
  }

  private async loadGlobalDays(requestedDay?: string): Promise<void> {
    const response = await this.apiRestService.getKingdomsLeagueGlobalDays(this.game);
    if (!response.success) this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
    this.globalDays = response.success ? response.data.days : [];
    this.day = requestedDay && this.globalDays.includes(requestedDay) ? requestedDay : (this.globalDays.at(0) ?? '');
  }

  private async loadSeasons(requestedSeason: number, requestedDay: string | undefined): Promise<void> {
    const response = await this.apiRestService.getKingdomsLeagueSeasons();
    if (!response.success) this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
    this.seasons = response.success ? response.data.seasons : [];
    this.isLeagueMissing = this.seasons.length === 0;
    const season =
      this.seasons.find((candidate) => candidate.season_id === requestedSeason) ??
      this.seasons.find((candidate) => !!requestedDay && candidate.days.includes(requestedDay)) ??
      this.latestSeason;
    this.seasonId = season?.season_id ?? 0;
    this.day = season && requestedDay && season.days.includes(requestedDay) ? requestedDay : (season?.last_day ?? '');
  }

  private updateUrl(page: number): void {
    const filterParameters: Record<string, string> = {};
    const filterDefaults: Record<string, string> = {};
    for (const key of Object.keys(URL_KEYS) as (keyof LeagueFilterForm)[]) {
      filterParameters[URL_KEYS[key]] =
        this.tab === 'alliances' && this.isPlayerOnlyFilter(key) ? '' : this.filters[key];
      filterDefaults[URL_KEYS[key]] = '';
    }
    void this.updateGenericParamsInUrl(
      {
        scope: this.scope,
        game: this.isGlobal ? this.game : 'all',
        season: this.isGlobal ? 0 : this.seasonId,
        day: this.day,
        tab: this.tab,
        search: this.search,
        page,
        alliance_id: this.memberOf?.id ?? '',
        alliance: this.memberOf?.name ?? '',
        ...filterParameters,
      },
      {
        scope: 'server',
        game: 'all',
        season: this.isGlobal ? 0 : (this.latestSeason?.season_id ?? 0),
        day: this.isGlobal ? (this.globalDays.at(0) ?? '') : (this.season?.last_day ?? ''),
        tab: 'players',
        search: '',
        page: 1,
        alliance_id: '',
        alliance: '',
        ...filterDefaults,
      },
    );
  }

  private fetchRanking(page: number): Promise<LeagueRankingResponse> {
    const query = this.query(this.filters);
    if (this.isGlobal && this.tab === 'players')
      return this.apiRestService.getKingdomsLeagueGlobalPlayers(query, this.game, page, this.pageSize);
    if (this.isGlobal)
      return this.apiRestService.getKingdomsLeagueGlobalAlliances(query, this.game, page, this.pageSize);
    return this.tab === 'players'
      ? this.apiRestService.getKingdomsLeaguePlayers(query, page, this.pageSize)
      : this.apiRestService.getKingdomsLeagueAlliances(query, page, this.pageSize);
  }

  private async refresh(page: number): Promise<void> {
    this.updateUrl(page);
    if (!this.day) {
      this.players = [];
      this.alliances = [];
      this.pagination = { ...EMPTY_PAGINATION };
      return;
    }
    this.isDataLoading = true;
    const response = await this.fetchRanking(page);
    this.isDataLoading = false;
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.previousDay = 'previous_day' in response.data ? response.data.previous_day : null;
    this.pagination = response.data.pagination;
    this.players = 'players' in response.data ? response.data.players : [];
    this.alliances = 'alliances' in response.data ? response.data.alliances : [];
  }
}
