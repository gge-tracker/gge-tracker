import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { ApiRenamesResponse, ErrorType, Rename, SearchType } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { ServerBadgeComponent } from '@ggetracker-components/server-badge/server-badge.component';
import { TableComponent } from '@ggetracker-components/table/table.component';

@Component({
  selector: 'app-renames',
  standalone: true,
  imports: [
    NgClass,
    SearchFormComponent,
    TableComponent,
    NgIf,
    FormatNumberPipe,
    DatePipe,
    NgFor,
    TranslateModule,
    ServerBadgeComponent,
  ],
  templateUrl: './renames.component.html',
  styleUrl: './renames.component.css',
})
export class RenamesComponent extends GenericComponent {
  public search = '';
  public currentViewType: 'players' | 'alliances' | undefined = undefined;
  public pageSize = 15;
  public searchType: SearchType = 'player';
  public responseTime = 0;
  public maxPage: number | null = null;
  public page = 1;
  public headers: [string, string, string, boolean][] = [];
  public renames: Rename[] = [];
  public formFilters = {
    castleType: null,
    movementType: null,
    isFiltered: false,
  };

  constructor() {
    super();
    this.route.paramMap.subscribe((params) => {
      this.currentViewType = (params.get('type') as 'players' | 'alliances') || 'players';
      if (this.currentViewType === 'alliances') {
        this.headers = [
          ['oldPlayerName', 'Ancien nom', '', true],
          ['newPlayerName', 'Nouveau nom', '', true],
          ['date', 'Date de changement', '', true],
        ];
      } else if (this.currentViewType === 'players') {
        this.headers = [
          ['oldPlayerName', 'Ancien pseudonyme', '', true],
          ['newPlayerName', 'Nouveau pseudonyme', '', true],
          ['pp', 'Points de puissance', '/assets/pp1.png', true],
          ['allianceName', 'Alliance', '/assets/min-alliance.png', true],
          ['date', 'Date de changement', '', true],
        ];
      }
      this.init();
    });
  }

  public applyFilters(): void {
    this.formFilters.isFiltered = true;
    this.init();
  }

  public async nextPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page++;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const renames = data.data;
    this.renames = this.mapMovementsFromApi(renames, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
  }

  public async previousPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page--;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const renames = data.data;
    this.renames = this.mapMovementsFromApi(renames, (index: number) => (this.page - 1) * this.pageSize + index + 1);
    this.isInLoading = false;
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
      void this.navigateTo(1);
      return;
    }
    this.isInLoading = true;
    try {
      this.page = 1;
      this.searchType = 'alliance';
      const data = await this.getGenericData();
      this.responseTime = data.response;
      const renames = data.data;
      this.renames = this.mapMovementsFromApi(renames, (index: number) => index + 1);
      this.isInLoading = false;
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
    }
  }

  public async searchPlayer(playerName: string): Promise<void> {
    this.search = playerName;
    if (this.isInLoading) return;
    this.searchType = 'player';
    if (this.search === '') {
      void this.navigateTo(1);
      return;
    }
    this.isInLoading = true;
    this.init();
    this.isInLoading = false;
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page = page;
    const renames = await this.getGenericData();
    this.responseTime = renames.response;
    this.renames = this.mapMovementsFromApi(
      renames.data,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
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

  private mapMovementsFromApi(renames: ApiRenamesResponse, rankFunction: (rank: number) => number): Rename[] {
    if (renames.pagination) {
      this.maxPage = renames.pagination.total_pages;
    } else {
      this.maxPage = 1;
    }
    return renames.renames.map((movement, index) => {
      return {
        rank: rankFunction(index),
        player: movement.player_name,
        alliance: movement.alliance_name,
        date: movement.date,
        might: movement.player_might,
        newPlayerName: movement.new_player_name,
        oldPlayerName: movement.old_player_name,
      };
    });
  }

  private async getGenericData(): Promise<{ data: ApiRenamesResponse; response: number }> {
    return await this.apiRestService.getGenericData(
      this.apiRestService.getRenames.bind(this.apiRestService),
      this.page,
      this.search,
      this.searchType,
      this.currentViewType,
    );
  }

  private init(): void {
    try {
      this.page = 1;
      void this.getGenericData().then((renames) => {
        this.responseTime = renames.response;
        this.maxPage = renames.data.pagination.total_pages;
        this.renames = this.mapMovementsFromApi(renames.data, (index: number) => index + 1);
        this.isInLoading = false;
      });
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }
}
