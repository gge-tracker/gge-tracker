import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { ApiMovementsResponse, ErrorType, Movement, SearchType } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-movements',
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    NgClass,
    FormsModule,
    FormatNumberPipe,
    TableComponent,
    DatePipe,
    SearchFormComponent,
    RouterLink,
    TranslateModule,
  ],
  templateUrl: './movements.component.html',
  styleUrl: './movements.component.css',
})
export class MovementsComponent extends GenericComponent {
  @ViewChild('searchForm') public searchForm!: SearchFormComponent;
  public search = '';
  public pageSize = 10;
  public searchType: SearchType = 'player';
  public responseTime = 0;
  public maxPage: number | null = null;
  public page = 1;
  public movements: Movement[] = [];
  public formFilters = {
    castleType: null,
    movementType: null,
    isFiltered: false,
  };
  private activatedRoute = inject(ActivatedRoute);

  constructor() {
    super();
    this.isInLoading = true;
    void this.init();
  }

  public async nextPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page++;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const movements = data.data;
    this.movements = this.mapMovementsFromApi(
      movements,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
  }

  public async previousPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page--;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const movements = data.data;
    this.movements = this.mapMovementsFromApi(
      movements,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
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
      const movements = data.data;
      this.movements = this.mapMovementsFromApi(movements, (index: number) => index + 1);
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
    void this.init();
    this.isInLoading = false;
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page = page;
    const movements = await this.getGenericData();
    this.responseTime = movements.response;
    this.movements = this.mapMovementsFromApi(
      movements.data,
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

    return Array.from({ length: pageCutHigh - pageCutLow + 1 }, (_, index) => pageCutLow + index);
  }

  public allPages(): number[] {
    return Array.from({ length: this.maxPage || 1 }, (_, index) => index + 1);
  }

  public async applyFilters(): Promise<void> {
    this.formFilters.isFiltered = true;
    await this.init();
    this.searchForm.updateNbFilterActivated();
  }

  private mapMovementsFromApi(movements: ApiMovementsResponse, rankFunction: (rank: number) => number): Movement[] {
    if (movements.pagination) {
      this.maxPage = movements.pagination.total_pages;
    } else {
      this.maxPage = 1;
    }
    return movements.movements.map((movement, index) => {
      return {
        rank: rankFunction(index),
        player: movement.player_name,
        might: movement.player_might,
        level: movement.player_level,
        legendaryLevel: movement.player_legendary_level,
        alliance: movement.alliance_name,
        type: movement.castle_type,
        date: movement.created_at,
        positionOld: [movement.position_x_old, movement.position_y_old],
        positionNew: [movement.position_x_new, movement.position_y_new],
      };
    });
  }

  private async getGenericData(): Promise<{ data: ApiMovementsResponse; response: number }> {
    return await this.apiRestService.getGenericData(
      this.apiRestService.getMovements.bind(this.apiRestService),
      this.page,
      this.search,
      this.searchType,
      this.formFilters.castleType,
      this.formFilters.movementType,
    );
  }

  private async init(): Promise<void> {
    try {
      this.page = 1;
      if (this.activatedRoute.snapshot.queryParamMap.keys.length === 0) {
        const movements = await this.getGenericData();
        this.responseTime = movements.response;
        this.maxPage = movements.data.pagination.total_pages;
        this.movements = this.mapMovementsFromApi(movements.data, (index: number) => index + 1);
        this.isInLoading = false;
      } else {
        this.activatedRoute.queryParams.subscribe(async (parameters) => {
          const player = parameters['player'];
          if (!player) return;
          this.page = 1;
          this.search = player;
          this.searchType = 'player';
          this.isInLoading = true;
          const data = await this.getGenericData();
          this.responseTime = data.response;
          const movements = data.data;
          this.movements = this.mapMovementsFromApi(movements, (index: number) => index + 1);
          this.isInLoading = false;
        });
      }
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }
}
