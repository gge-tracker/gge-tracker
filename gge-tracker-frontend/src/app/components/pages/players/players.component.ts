import { NgClass, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiPlayerSearchResponse,
  ApiPlayersResponse,
  ErrorType,
  FavoritePlayer,
  Player,
  SearchType,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { TranslateModule } from '@ngx-translate/core';
import { ArrowBigRightDash, LucideAngularModule } from 'lucide-angular';
import { PlayerTableContentComponent } from './player-table-content/player-table-content.component';
import { IconComponent } from '@ggetracker-components/icon/icon.component';

type FilterField = 'honor' | 'loot' | 'level' | 'might' | 'fame' | 'castleCount';
type BoundType = 'min' | 'max';

interface FormFilters {
  minHonor: string;
  maxHonor: string;
  minLoot: string;
  maxLoot: string;
  minLevel: string;
  maxLevel: string;
  minMight: string;
  maxMight: string;
  minFame: string;
  maxFame: string;
  castleCountMin: string;
  castleCountMax: string;
  allianceFilter: string;
  protectionFilter: string;
  banFilter: string;
  isFiltered: boolean;
  inactiveFilter: string;
  playerCastleDistance: string;
}

type FilterKeyMap = {
  [K in FilterField]: {
    min: keyof FormFilters;
    max: keyof FormFilters;
  };
};

@Component({
  selector: 'app-players',
  standalone: true,
  providers: [FormatNumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    FormsModule,
    NgFor,
    NgIf,
    TableComponent,
    SearchFormComponent,
    TranslateModule,
    PlayerTableContentComponent,
    LucideAngularModule,
    IconComponent,
  ],
  templateUrl: './players.component.html',
  styleUrl: './players.component.css',
})
export class PlayersComponent extends GenericComponent implements OnInit {
  @ViewChild('searchForm') public searchForm!: SearchFormComponent;
  public players: Player[] = [];
  public page = 1;
  public maxPage?: number;
  public pageSize = 15;
  public responseTime = 0;
  public playerCount = 0;
  public search = '';
  public searchType: SearchType = 'player';
  public reverse = true;
  public sort = 'might_current';
  public favoriePlayers: FavoritePlayer[] = [];
  public playersTableHeader: [string, string, (string | undefined)?, (boolean | undefined)?][] = [
    ['player_name', 'Pseudonyme'],
    ['level', 'Niveau', '/assets/lvl.png'],
    ['might_current', 'Points de puissance', '/assets/pp1.png'],
    ['loot_current', 'Points de pillage hebdomadaire', '/assets/loot.png'],
    ['current_fame', 'Points de gloire', '/assets/glory.png'],
    ['honor', 'Honneur', '/assets/honor.png'],
    ['alliance_name', 'Alliance', '/assets/min-alliance.png', true],
    ['', '', undefined, true],
  ];
  public sortByOptions: { value: string; label: string }[] = [
    { value: 'player_name', label: 'Pseudonyme' },
    { value: 'level', label: 'Niveau' },
    { value: 'might_current', label: 'Points de puissance' },
    { value: 'might_all_time', label: 'Puissance maximale atteinte' },
    { value: 'loot_current', label: 'Points de pillage hebdomadaire' },
    { value: 'loot_all_time', label: 'Pillage maximal atteint' },
    { value: 'current_fame', label: 'Points de gloire' },
    { value: 'highest_fame', label: 'Gloire maximale atteinte' },
    { value: 'honor', label: 'Honneur' },
    { value: 'alliance_name', label: 'Alliance' },
  ];
  public defaultPlayersTableHeaderSize = this.playersTableHeader.length;
  public formFilters = {
    minHonor: '',
    maxHonor: '',
    minMight: '',
    maxMight: '',
    minLoot: '',
    maxLoot: '',
    minLevel: '',
    maxLevel: '',
    minFame: '',
    maxFame: '',
    castleCountMin: '',
    castleCountMax: '',
    allianceFilter: '-1',
    protectionFilter: '-1',
    banFilter: '-1',
    isFiltered: false,
    inactiveFilter: '1',
    playerCastleDistance: '',
    allianceRankFilter: ['0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
  };
  public readonly ArrowBigRightDash = ArrowBigRightDash;
  public displayFormValues = {
    might: { min: '', max: '' },
    loot: { min: '', max: '' },
    honor: { min: '', max: '' },
    level: { min: '', max: '' },
    fame: { min: '', max: '' },
    castleCount: { min: '', max: '' },
  };
  private readonly FILTER_KEYS: FilterKeyMap = {
    honor: { min: 'minHonor', max: 'maxHonor' },
    loot: { min: 'minLoot', max: 'maxLoot' },
    level: { min: 'minLevel', max: 'maxLevel' },
    might: { min: 'minMight', max: 'maxMight' },
    fame: { min: 'minFame', max: 'maxFame' },
    castleCount: { min: 'castleCountMin', max: 'castleCountMax' },
  };
  private cdr = inject(ChangeDetectorRef);
  private localStorage = inject(LocalStorageService);
  private formatNumberPipe = inject(FormatNumberPipe);

  constructor() {
    super();
    this.isInLoading = true;
  }

  public ngOnInit(): void {
    if (globalThis.window === undefined) return;
    const sort = this.localStorage.getItem('sort');
    if (sort && sort === 'distance' && this.formFilters.playerCastleDistance !== '') this.sort = sort;
    const reverse = this.localStorage.getItem('reverse');
    if (reverse === 'true') {
      this.reverse = true;
    }
    const playerNameForDistance = this.localStorage.getItem(
      'allianceDistancePlayerName_' + this.apiRestService.serverService.currentServer?.name,
    );
    if (playerNameForDistance) {
      this.formFilters.playerCastleDistance = playerNameForDistance;
      this.addHeaderTableBlock();
    }
    const urlParameters = this.route.snapshot.queryParams;
    const page = urlParameters['page'] ? Number(urlParameters['page']) : 1;
    this.page = page;
    if (urlParameters['alliance']) {
      this.search = urlParameters['alliance'];
      this.isInLoading = false;
      void this.searchAlliance(this.search);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } else if (urlParameters['player']) {
      this.search = urlParameters['player'];
      this.isInLoading = false;
      void this.searchPlayer(this.search);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } else {
      void this.init(this.page);
    }
  }

  public parseValue(value: string | number): number {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    let string_ = value.replaceAll(/\s+/g, '').replaceAll(',', '').toUpperCase();
    let multiplier = 1;
    if (string_.endsWith('B')) {
      multiplier = 1_000_000_000;
      string_ = string_.slice(0, -1);
    } else if (string_.endsWith('M')) {
      multiplier = 1_000_000;
      string_ = string_.slice(0, -1);
    } else if (string_.endsWith('K')) {
      multiplier = 1000;
      string_ = string_.slice(0, -1);
    }
    const numeric = Number(string_);
    if (Number.isNaN(numeric)) return 0;

    return numeric * multiplier;
  }

  public onGenericFocus(type: 'min' | 'max', field: FilterField): void {
    let targetValue: string | null = null;
    switch (field) {
      case 'honor': {
        targetValue = type === 'min' ? this.formFilters.minHonor : this.formFilters.maxHonor;
        break;
      }
      case 'loot': {
        targetValue = type === 'min' ? this.formFilters.minLoot : this.formFilters.maxLoot;
        break;
      }
      case 'level': {
        targetValue = type === 'min' ? this.formFilters.minLevel : this.formFilters.maxLevel;
        break;
      }
      case 'might': {
        targetValue = type === 'min' ? this.formFilters.minMight : this.formFilters.maxMight;
        break;
      }
      case 'fame': {
        targetValue = type === 'min' ? (this.formFilters as any).minFame : (this.formFilters as any).maxFame;
        break;
      }
    }
    if (targetValue != null) {
      if (type === 'min') {
        this.displayFormValues[field].min = targetValue.toString();
      } else {
        this.displayFormValues[field].max = targetValue.toString();
      }
    }
  }

  public onGenericInput(type: BoundType, field: FilterField, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value;
    let numeric = raw === '' ? '' : Number(raw.replaceAll(/\s/g, ''));
    if (numeric !== null && Number.isNaN(numeric)) {
      numeric = this.parseValue(raw);
      if (numeric === 0 && raw !== '0' && raw !== '') {
        this.displayFormValues[field][type] = raw;
        return;
      }
    }
    const filterKey = this.FILTER_KEYS[field][type];
    (this.formFilters as any)[filterKey] = numeric.toString();
    this.displayFormValues[field][type] = raw;
  }

  public onGenericBlur(type: BoundType, field: FilterField): void {
    const filterKey = this.FILTER_KEYS[field][type];
    const value = this.formFilters[filterKey];
    this.displayFormValues[field][type] = value == null || value === '' ? '' : this.formatNumber(Number(value));
  }

  public formatNumber(value: number): string {
    return this.formatNumberPipe.transform(value);
  }

  public async nextPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.cdr.detectChanges();
    this.page++;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const players = data.data;
    this.players = this.mapPlayersFromApi(players, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  public async previousPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.cdr.detectChanges();
    this.page--;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const players = data.data;
    this.players = this.mapPlayersFromApi(players, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  public async clickOnAlliance(allianceName: string | null): Promise<void> {
    if (allianceName === null || (this.searchType === 'alliance' && this.search === allianceName)) return;
    this.search = allianceName;
    void this.searchAlliance(allianceName);
  }

  public async searchAlliance(allianceName: string): Promise<void> {
    this.search = allianceName;
    if (this.isInLoading) return;
    if (this.search === '') {
      void this.navigateTo(1).then(() => {
        this.isInLoading = false;
        this.cdr.detectChanges();
      });
    }
    this.isInLoading = true;
    try {
      const data = await this.getGenericData();
      this.responseTime = data.response;
      const players = data.data;
      this.searchType = 'alliance';
      this.players = this.mapPlayersFromApi(players, (index: number) => (this.page - 1) * this.pageSize + index + 1);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
      this.cdr.detectChanges();
    }
  }

  public async searchPlayer(playerName: string): Promise<void> {
    this.search = playerName;
    if (this.isInLoading) return;
    this.searchType = 'player';
    if (this.search === '') {
      await this.navigateTo(1);
      this.cdr.detectChanges();
      return;
    }
    this.isInLoading = true;
    this.cdr.detectChanges();
    const response = await this.apiRestService.getPlayer(this.search);
    if (response.success === false || response.error) {
      this.toastService.add(ErrorType.NO_PLAYER_FOUND, 5000);
      this.isInLoading = false;
      this.cdr.detectChanges();
      return;
    }
    const player = response.data;
    this.players = this.mapPlayersFromApi(
      {
        players: [player],
        duration: '',
        pagination: {
          total_pages: 1,
          current_items_count: 1,
          current_page: 1,
          total_items_count: 1,
        },
      },
      () => 1,
    );
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page = page;
    const players = await this.getGenericData();
    this.responseTime = players.response;
    this.players = this.mapPlayersFromApi(players.data, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  public visiblePages(): number[] {
    if (!this.maxPage) return [];
    let pageCutLow = Math.max(1, this.page - 1);
    let pageCutHigh = Math.min(this.maxPage, this.page + 1);
    if (this.page === 1) pageCutHigh += 2;
    if (this.page === 2) pageCutHigh += 1;
    if (this.page === this.maxPage) pageCutLow -= 2;
    if (this.page === this.maxPage - 1) pageCutLow -= 1;
    return Array.from({ length: pageCutHigh - pageCutLow + 1 }, (_, index) => pageCutLow + index);
  }

  public allPages(): number[] {
    return Array.from({ length: this.maxPage || 1 }, (_, index) => index + 1);
  }

  public onAllianceRankFilterChanged(index: number): void {
    this.formFilters.allianceRankFilter[index] = this.formFilters.allianceRankFilter[index] === '0' ? '1' : '0';
  }

  public async applyFilters(): Promise<void> {
    this.isInLoading = true;
    this.page = 1;
    if (this.formFilters.playerCastleDistance === '') {
      void this.resetDistanceColumn();
    } else {
      void this.onAddDistanceColumn();
    }
    await this.init();
    this.searchForm.updateNbFilterActivated();
  }

  public async onAddDistanceColumn(): Promise<void> {
    console.log('onAddDistanceColumn called');
    if (!this.formFilters.playerCastleDistance?.trim()) return;
    console.log('Player castle distance filter is set:', this.formFilters.playerCastleDistance);
    this.isInLoading = true;
    this.cdr.detectChanges();
    this.localStorage.setItem(
      'allianceDistancePlayerName_' + this.apiRestService.serverService.currentServer?.name,
      this.formFilters.playerCastleDistance,
    );
    const data = await this.getGenericData();
    const players = data.data;
    this.responseTime = data.response;
    this.players = this.mapPlayersFromApi(players, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
    this.addHeaderTableBlock();
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  public async resetDistanceColumn(): Promise<void> {
    this.formFilters.playerCastleDistance = '';
    if (this.sort === 'distance') {
      this.sort = 'might_current';
      this.reverse = true;
      this.localStorage.setItem('sort', this.sort);
      this.localStorage.setItem('reverse', this.reverse ? 'true' : 'false');
    }
    this.localStorage.removeItem('allianceDistancePlayerName_' + this.apiRestService.serverService.currentServer?.name);
    this.cdr.detectChanges();
    if (this.playersTableHeader.length === 9) {
      this.playersTableHeader.splice(-3, 1);
      this.cdr.detectChanges();
    }
  }

  public async sortPlayers(sort: string): Promise<void> {
    if (globalThis.window === undefined) return;
    if (this.isInLoading || (this.searchType === 'player' && this.search !== '')) return;
    this.isInLoading = true;
    this.cdr.detectChanges();
    if (this.sort === sort) {
      this.reverse = !this.reverse;
    } else {
      this.reverse = false;
      this.sort = sort;
    }
    this.localStorage.setItem('sort', this.sort);
    this.localStorage.setItem('reverse', this.reverse ? 'true' : 'false');
    try {
      const data = await this.getGenericData();
      const players = data.data;
      this.responseTime = data.response;
      this.players = this.mapPlayersFromApi(players, (index: number) => (this.page - 1) * this.pageSize + index + 1);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      this.cdr.detectChanges();
    }
  }

  public toggleFavorite(player: Player): void {
    const favoriesString = this.localStorage.getItem('favories');
    let favoriteIds: number[] = favoriesString ? JSON.parse(favoriesString) : [];
    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }
    const index = favoriteIds.indexOf(player.playerId);
    if (index === -1) {
      favoriteIds.push(player.playerId);
      player.isFavorite = true;
    } else {
      favoriteIds.splice(index, 1);
      player.isFavorite = false;
    }

    this.cdr.detectChanges();
    this.localStorage.setItem('favories', JSON.stringify(favoriteIds));
  }

  public exportData(): void {
    const headers = [
      'Rank',
      'Player Name',
      'Alliance ID',
      'Alliance Name',
      'Alliance Rank',
      'Level',
      'Current Might',
      'Highest Might',
      'Current Loot',
      'Highest Loot',
      'Current Glory',
      'Highest Glory',
      'Current Honor',
      'Highest Honor',
      'Peace Disabled At',
      'Distance (m)',
    ];
    const rows: any[][] = [];
    this.players.forEach((player) => {
      const row = [
        player.rank,
        this.escapeCsv(player.playerName),
        Number(player.allianceId),
        this.escapeCsv(player.allianceName),
        `url=/assets/alliance_ranks/${player.allianceRank}.png`,
        this.constructPlayerLevel(player.level ?? 0, player.legendaryLevel ?? 0),
        Number(player.mightCurrent),
        Number(player.mightAllTime),
        Number(player.lootCurrent),
        Number(player.lootAllTime),
        Number(player.currentFame),
        Number(player.highestFame),
        Number(player.honor),
        Number(player.maxHonor),
        player.peaceDisabledAt ? this.escapeCsv(new Date(player.peaceDisabledAt).toLocaleString()) : '',
        Number(player.distance ?? 0),
      ];
      rows.push(row);
    });
    void this.utilitiesService.exportDataXlsx(
      'Players',
      headers,
      rows,
      `players_${this.apiRestService.serverService.currentServer?.name || 'server'}_page_${this.page}_${new Date().toISOString()}.xlsx`,
    );
  }

  private escapeCsv(value: string | null | undefined): string {
    if (value == null) return '';
    return `"${value.replaceAll('"', '""')}"`;
  }

  private addHeaderTableBlock(): void {
    if (this.playersTableHeader.length === 8) {
      const block: [string, string, (string | undefined)?, (boolean | undefined)?] = [
        'distance',
        'Distance (m)',
        undefined,
        undefined,
      ];
      this.playersTableHeader.splice(-2, 0, block);
    }
  }

  private mapPlayersFromApi(players: ApiPlayersResponse, rankFunction: (rank: number) => number): Player[] {
    if (players.pagination) {
      this.maxPage = players.pagination.total_pages;
      this.playerCount = players.pagination.total_items_count;
    } else {
      this.maxPage = 1;
      this.playerCount = 1;
    }
    void this.updateGenericParamsInUrl(
      {
        page: this.page,
        player: this.searchType === 'player' ? this.search : undefined,
        alliance: this.searchType === 'alliance' ? this.search : undefined,
      },
      { page: 1, player: '', alliance: '' },
    );
    const favoriePlayers: string[] = JSON.parse(this.localStorage.getItem('favories') || '[]');
    return players.players.map((player, index) => {
      return {
        rank: rankFunction(index),
        playerId: player.player_id,
        playerName: player.player_name,
        allianceName: player.alliance_name,
        allianceId: player.alliance_id,
        allianceRank: player.alliance_rank,
        mightCurrent: player.might_current,
        mightAllTime: player.might_all_time,
        lootCurrent: player.loot_current ?? 0,
        lootAllTime: player.loot_all_time ?? 0,
        isFavorite: favoriePlayers.includes(player.player_id.toString()),
        honor: player.honor,
        maxHonor: player.max_honor,
        peaceDisabledAt: player.peace_disabled_at,
        updatedAt: player.updated_at,
        level: player.level,
        legendaryLevel: player.legendary_level,
        currentFame: player.current_fame,
        highestFame: player.highest_fame,
        distance: player.calculated_distance,
        remainingRelocationTime: player.remaining_relocation_time,
      };
    });
  }

  private constructFilters(): Record<string, string | number> {
    const filters: Record<string, string | number> = {};
    if (this.formFilters.minHonor) filters['minHonor'] = this.formFilters.minHonor;
    if (this.formFilters.maxHonor) filters['maxHonor'] = this.formFilters.maxHonor;
    if (this.formFilters.minMight) filters['minMight'] = this.formFilters.minMight;
    if (this.formFilters.maxMight) filters['maxMight'] = this.formFilters.maxMight;
    if (this.formFilters.minLoot) filters['minLoot'] = this.formFilters.minLoot;
    if (this.formFilters.maxLoot) filters['maxLoot'] = this.formFilters.maxLoot;
    if (this.formFilters.minLevel) filters['minLevel'] = this.formFilters.minLevel;
    if (this.formFilters.maxLevel) filters['maxLevel'] = this.formFilters.maxLevel;
    if (this.formFilters.allianceFilter !== '-1') filters['allianceFilter'] = this.formFilters.allianceFilter;
    if (this.formFilters.protectionFilter !== '-1') filters['protectionFilter'] = this.formFilters.protectionFilter;
    if (this.formFilters.banFilter !== '-1') filters['banFilter'] = this.formFilters.banFilter;
    if (this.formFilters.inactiveFilter !== '-1') filters['inactiveFilter'] = this.formFilters.inactiveFilter;
    if (this.formFilters.playerCastleDistance) filters['playerNameForDistance'] = this.formFilters.playerCastleDistance;
    if (this.formFilters.minFame) filters['minFame'] = this.formFilters.minFame;
    if (this.formFilters.maxFame) filters['maxFame'] = this.formFilters.maxFame;
    if (this.formFilters.castleCountMin) filters['castleCountMin'] = this.formFilters.castleCountMin;
    if (this.formFilters.castleCountMax) filters['castleCountMax'] = this.formFilters.castleCountMax;
    if (this.formFilters.allianceRankFilter.includes('1')) {
      filters['allianceRankFilter'] = this.formFilters.allianceRankFilter
        .map((value, index) => (value === '1' ? index : null))
        .filter((value) => value !== null)
        .join(',');
    }
    this.formFilters.isFiltered = Object.keys(filters).length > 0;
    return filters;
  }

  private async getGenericData(): Promise<{ data: ApiPlayersResponse; response: number }> {
    try {
      return await this.apiRestService.getGenericData(
        this.apiRestService.getPlayers.bind(this.apiRestService),
        this.page,
        this.sort,
        this.reverse ? 'DESC' : 'ASC',
        this.search ?? undefined,
        this.constructFilters(),
      );
    } catch (error: unknown) {
      this.isInLoading = false;
      this.cdr.detectChanges();
      throw error; // Re-throw the error to be handled in the calling function
    }
  }

  private constructPlayerLevel(level: number, legendaryLevel: number): string {
    if (legendaryLevel >= 70) {
      return `${level}/${legendaryLevel}`;
    }
    return level.toString();
  }

  private structuredPlayersData(players: ApiPlayerSearchResponse[]): void {
    if (this.isBrowser && players.length > 0) {
      this.addStructuredPlayersData(
        players.map((player) => ({
          name: player.player_name,
          url: `gge-tracker.com/player/${player.player_id}`,
          alliance: player.alliance_name || '',
          might: player.might_current,
          level: this.constructPlayerLevel(player.level || 0, player.legendary_level || 0),
        })),
      );
    }
  }

  private async init(page = 1): Promise<void> {
    try {
      this.page = page;
      const players = await this.getGenericData();
      this.structuredPlayersData(players.data.players);
      this.responseTime = players.response;
      this.maxPage = players.data.pagination.total_pages;
      this.players = this.mapPlayersFromApi(players.data, (index: number) => (page - 1) * this.pageSize + index + 1);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } catch {
      this.isInLoading = false;
      if (this.formFilters.playerCastleDistance === '') {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      } else {
        this.toastService.add(ErrorType.NO_PLAYER_FOUND, 5000);
        this.formFilters.playerCastleDistance = '';
        this.localStorage.removeItem(
          'allianceDistancePlayerName_' + this.apiRestService.serverService.currentServer?.name,
        );
        void this.resetDistanceColumn();
      }
      this.cdr.detectChanges();
    }
  }
}
