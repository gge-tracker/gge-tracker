import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import {
  Player,
  SearchType,
  FavoritePlayer,
  ErrorType,
  ApiPlayersResponse,
  ApiPlayerSearchResponse,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { ServerBadgeComponent } from '@ggetracker-components/server-badge/server-badge.component';
import { TableComponent } from '@ggetracker-components/table/table.component';

@Component({
  selector: 'app-players',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgFor,
    NgIf,
    NgClass,
    RouterLink,
    FormsModule,
    FormatNumberPipe,
    TableComponent,
    DatePipe,
    SearchFormComponent,
    TranslateModule,
    ServerBadgeComponent,
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
    ['might_all_time', 'Puissance maximale atteinte', '/assets/pp2.png'],
    ['loot_current', 'Points de pillage hebdomadaire', '/assets/loot.png'],
    ['loot_all_time', 'Pillage maximal atteint', '/assets/loot3.png'],
    ['current_fame', 'Points de gloire', '/assets/glory.png'],
    ['highest_fame', 'Gloire maximale atteinte', '/assets/glory.png'],
    ['honor', 'Honneur', '/assets/honor.png'],
    ['alliance_name', 'Alliance', '/assets/min-alliance.png', true],
    ['', '', undefined, true],
  ];
  public formFilters = {
    minHonor: '',
    maxHonor: '',
    minMight: '',
    maxMight: '',
    minLoot: '',
    maxLoot: '',
    minLevel: '',
    maxLevel: '',
    allianceFilter: '-1',
    protectionFilter: '-1',
    banFilter: '-1',
    isFiltered: false,
    inactiveFilter: '1',
    playerCastleDistance: '',
  };
  private cdr = inject(ChangeDetectorRef);
  private localStorage = inject(LocalStorageService);

  public ngOnInit(): void {
    if (typeof window === 'undefined') return;
    const sort = this.localStorage.getItem('sort');
    if (sort) {
      if (sort === 'distance' && this.formFilters.playerCastleDistance !== '') this.sort = sort;
    }
    const reverse = this.localStorage.getItem('reverse');
    if (reverse === 'true') {
      this.reverse = true;
    }
    const playerNameForDistance = this.localStorage.getItem(
      'allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer,
    );
    if (playerNameForDistance) {
      this.formFilters.playerCastleDistance = playerNameForDistance;
      this.addHeaderTableBlock();
    }
    const urlParams = this.route.snapshot.queryParams;
    if (urlParams['alliance']) {
      this.search = urlParams['alliance'];
      this.isInLoading = false;
      void this.searchAlliance(this.search);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } else if (urlParams['player']) {
      this.search = urlParams['player'];
      this.isInLoading = false;
      void this.searchPlayer(this.search);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } else {
      void this.init();
    }
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
      this.page = 1;
      const data = await this.getGenericData();
      this.responseTime = data.response;
      const players = data.data;
      this.searchType = 'alliance';
      this.players = this.mapPlayersFromApi(players, (index: number) => index + 1);
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
    return Array.from({ length: pageCutHigh - pageCutLow + 1 }, (_, i) => pageCutLow + i);
  }

  public allPages(): number[] {
    return Array.from({ length: this.maxPage || 1 }, (_, i) => i + 1);
  }

  public async applyFilters(): Promise<void> {
    this.isInLoading = true;
    this.page = 1;
    if (this.formFilters.playerCastleDistance !== '') {
      void this.onAddDistanceColumn();
    } else {
      void this.resetDistanceColumn();
    }
    await this.init();
    this.searchForm.updateNbFilterActivated();
  }

  public async onAddDistanceColumn(): Promise<void> {
    if (!this.formFilters.playerCastleDistance?.trim()) return;
    this.isInLoading = true;
    this.cdr.detectChanges();
    this.localStorage.setItem(
      'allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer,
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
    this.localStorage.removeItem('allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer);
    this.cdr.detectChanges();
    if (this.playersTableHeader.length === 12) {
      this.playersTableHeader.splice(this.playersTableHeader.length - 3, 1);
      this.cdr.detectChanges();
    }
  }

  public async sortPlayers(sort: string): Promise<void> {
    if (typeof window === 'undefined') return;
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
    const favoriesStr = this.localStorage.getItem('favories');
    let favoriteIds: number[] = favoriesStr ? JSON.parse(favoriesStr) : [];
    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }
    const index = favoriteIds.indexOf(player.playerId);
    if (index !== -1) {
      favoriteIds.splice(index, 1);
      player.isFavorite = false;
    } else {
      favoriteIds.push(player.playerId);
      player.isFavorite = true;
    }

    this.cdr.detectChanges();
    this.localStorage.setItem('favories', JSON.stringify(favoriteIds));
  }

  private addHeaderTableBlock(): void {
    if (this.playersTableHeader.length === 11) {
      const block: [string, string, (string | undefined)?, (boolean | undefined)?] = [
        'distance',
        'Distance (m)',
        undefined,
        undefined,
      ];
      this.playersTableHeader.splice(this.playersTableHeader.length - 2, 0, block);
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
    const favoriePlayers: string[] = JSON.parse(this.localStorage.getItem('favories') || '[]');
    return players.players.map((player, index) => {
      return {
        rank: rankFunction(index),
        playerId: player.player_id,
        playerName: player.player_name,
        allianceName: player.alliance_name,
        allianceId: player.alliance_id,
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
    } catch (e: unknown) {
      this.isInLoading = false;
      this.cdr.detectChanges();
      throw e; // Re-throw the error to be handled in the calling function
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

  private async init(): Promise<void> {
    try {
      this.page = 1;
      const players = await this.getGenericData();
      this.structuredPlayersData(players.data.players);
      this.responseTime = players.response;
      this.maxPage = players.data.pagination.total_pages;
      this.players = this.mapPlayersFromApi(players.data, (index: number) => index + 1);
      this.isInLoading = false;
      this.cdr.detectChanges();
    } catch {
      this.isInLoading = false;
      if (this.formFilters.playerCastleDistance !== '') {
        this.toastService.add(ErrorType.NO_PLAYER_FOUND, 5000);
        this.formFilters.playerCastleDistance = '';
        this.localStorage.removeItem('allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer);
        void this.resetDistanceColumn();
      } else {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      }
      this.cdr.detectChanges();
    }
  }
}
