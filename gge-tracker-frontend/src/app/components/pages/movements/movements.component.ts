import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { ApiMovementsResponse, ErrorType, Movement, SearchType } from '@ggetracker-interfaces/empire-ranking';
import { BoundType, FilterKeyMap } from '@ggetracker-interfaces/filter';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { TranslateModule } from '@ngx-translate/core';
import { ArrowBigRightDash, LucideAngularModule } from 'lucide-angular';

type FilterField = 'honor' | 'loot' | 'level' | 'might' | 'fame' | 'castleCount';

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
  castleType: string;
  movementType: string;
}

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
    LucideAngularModule,
    TranslateModule,
  ],
  providers: [FormatNumberPipe],
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
  public readonly ArrowBigRightDash = ArrowBigRightDash;
  public movements: Movement[] = [];
  public displayFormValues = {
    might: { min: '', max: '' },
    loot: { min: '', max: '' },
    honor: { min: '', max: '' },
    level: { min: '', max: '' },
    fame: { min: '', max: '' },
    castleCount: { min: '', max: '' },
  };
  public formFilters = {
    castleType: null,
    movementType: null,
    minHonor: '',
    maxHonor: '',
    minLoot: '',
    maxLoot: '',
    minLevel: '',
    maxLevel: '',
    minMight: '',
    maxMight: '',
    minFame: '',
    maxFame: '',
    castleCountMin: '',
    castleCountMax: '',
    allianceFilter: '',
    protectionFilter: '',
    banFilter: '',
    inactiveFilter: '',
    playerCastleDistance: '',
    isFiltered: false,
  };
  private readonly FILTER_KEYS: FilterKeyMap<FormFilters, FilterField> = {
    honor: { min: 'minHonor', max: 'maxHonor' },
    loot: { min: 'minLoot', max: 'maxLoot' },
    level: { min: 'minLevel', max: 'maxLevel' },
    might: { min: 'minMight', max: 'maxMight' },
    fame: { min: 'minFame', max: 'maxFame' },
    castleCount: { min: 'castleCountMin', max: 'castleCountMax' },
  };
  private formatNumberPipe = inject(FormatNumberPipe);
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

  public exportData(): void {
    const headers = [
      'Rank',
      'Player Name',
      'Current Might',
      'Level',
      'Alliance Name',
      'Type',
      'Description',
      'Date',
      'Old Position',
      'New Position',
    ];
    const rows: any[][] = [];
    this.movements.forEach((movement) => {
      const row = [
        movement.rank,
        this.utilitiesService.escapeCsv(movement.player),
        Number(movement.might),
        this.utilitiesService.constructPlayerLevel(movement.level ?? 0, movement.legendaryLevel ?? 0),
        this.utilitiesService.escapeCsv(movement.alliance),
        this.translateService.instant(this.getCastleType(movement.type)),
        this.translateService.instant(
          this.getDescription(movement.type, movement.positionOld, movement.positionNew).keyword,
        ),
        this.utilitiesService.escapeCsv(new Date(movement.date).toLocaleString()),
        movement.positionOld[0] === null ? '' : `x=${movement.positionOld[0]} y=${movement.positionOld[1]}`,
        movement.positionNew[0] === null ? '' : `x=${movement.positionNew[0]} y=${movement.positionNew[1]}`,
      ];
      rows.push(row);
    });
    void this.utilitiesService.exportDataXlsx(
      'Movements',
      headers,
      rows,
      `movements_${this.apiRestService.serverService.currentServer?.name || 'server'}_page_${this.page}_${new Date().toISOString()}.xlsx`,
    );
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
      numeric = this.utilitiesService.parseValue(raw);
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
    this.displayFormValues[field][type] =
      value == null || value === '' ? '' : this.utilitiesService.formatNumber(this.formatNumberPipe, Number(value));
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
      this.formFilters.castleType === null ? null : Number(this.formFilters.castleType),
      this.formFilters.movementType === null ? null : Number(this.formFilters.movementType),
      this.constructFilters(),
    );
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
    this.formFilters.isFiltered = Object.keys(filters).length > 0;
    return filters;
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
