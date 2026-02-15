import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { IconComponent } from '@ggetracker-components/icon/icon.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { Alliance, ApiAllianceResponse, ErrorType } from '@ggetracker-interfaces/empire-ranking';
import { BoundType, FilterKeyMap } from '@ggetracker-interfaces/filter';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { TranslateModule } from '@ngx-translate/core';
import { ArrowBigRightDash, LucideAngularModule } from 'lucide-angular';

type FilterField = 'might' | 'loot' | 'fame' | 'memberCount';

interface FormFilters {
  minMight?: number;
  maxMight?: number;
  minLoot?: number;
  maxLoot?: number;
  minFame?: number;
  maxFame?: number;
  minMemberCount?: number;
  maxMemberCount?: number;
  isFiltered: boolean;
}

@Component({
  selector: 'app-alliances',
  standalone: true,
  providers: [FormatNumberPipe],
  imports: [
    NgFor,
    NgIf,
    LucideAngularModule,
    NgClass,
    RouterLink,
    IconComponent,
    FormsModule,
    FormatNumberPipe,
    TableComponent,
    SearchFormComponent,
    TranslateModule,
  ],
  templateUrl: './alliances.component.html',
  styleUrl: './alliances.component.css',
})
export class AlliancesComponent extends GenericComponent implements OnInit {
  public alliances: Alliance[] = [];
  public page = 1;
  public maxPage?: number;
  public pageSize = 15;
  public lastUpdate?: string;
  public responseTime = 0;
  public allianceCount = 0;
  public search = '';
  public reverse = true;
  public sort = 'might_current';
  public formFilters = {
    minMight: '',
    maxMight: '',
    minLoot: '',
    maxLoot: '',
    minFame: '',
    maxFame: '',
    minMemberCount: '',
    maxMemberCount: '',
    isFiltered: false,
  };
  public displayFormValues = {
    might: { min: '', max: '' },
    loot: { min: '', max: '' },
    fame: { min: '', max: '' },
    memberCount: { min: '', max: '' },
  };
  public sortByOptions: { value: string; label: string }[] = [
    { value: 'might_current', label: 'Points de puissance' },
    { value: 'might_all_time', label: 'Puissance maximale atteinte' },
    { value: 'loot_current', label: 'Points de butin' },
    { value: 'loot_all_time', label: 'Butin maximal atteint' },
    { value: 'current_fame', label: 'Points de gloire' },
    { value: 'highest_fame', label: 'Gloire maximale atteinte' },
    { value: 'player_count', label: 'Nombre de joueurs' },
  ];
  public ArrowBigRightDash = ArrowBigRightDash;
  private readonly FILTER_KEYS: FilterKeyMap<FormFilters, FilterField> = {
    might: { min: 'minMight', max: 'maxMight' },
    loot: { min: 'minLoot', max: 'maxLoot' },
    fame: { min: 'minFame', max: 'maxFame' },
    memberCount: { min: 'minMemberCount', max: 'maxMemberCount' },
  };

  private localStorage = inject(LocalStorageService);
  private formatNumberPipe = inject(FormatNumberPipe);

  constructor() {
    super();
    this.isInLoading = true;
  }

  public ngOnInit(): void {
    const urlParameters = this.route.snapshot.queryParams;
    const page = urlParameters['page'] ? Number(urlParameters['page']) : 1;
    this.page = page;
    void this.init();
  }

  public exportData(): void {
    const headers = [
      'Rank',
      'Alliance ID',
      'Alliance Name',
      'Player Count',
      'Current Might',
      'Highest Might',
      'Current Loot',
      'Highest Loot',
      'Current Fame',
      'Highest Fame',
    ];
    const rows: any[][] = [];
    this.alliances.forEach((alliance) => {
      const row = [
        alliance.rank,
        Number(alliance.id),
        this.utilitiesService.escapeCsv(alliance.name),
        Number(alliance.playerCount),
        Number(alliance.mightCurrent),
        Number(alliance.mightAllTime),
        Number(alliance.lootCurrent),
        Number(alliance.lootAllTime),
        Number(alliance.currentFame),
        Number(alliance.highestFame),
      ];
      rows.push(row);
    });
    void this.utilitiesService.exportDataXlsx(
      'Players',
      headers,
      rows,
      `alliances_${this.apiRestService.serverService.currentServer?.name || 'server'}_page_${this.page}_${new Date().toISOString()}.xlsx`,
    );
  }

  public async searchAlliance(allianceName: string): Promise<void> {
    this.page = 1;
    this.search = allianceName;
    if (this.isInLoading) return;
    if (this.search === '') {
      void this.navigateTo(1);
      return;
    }
    this.isInLoading = true;
    const alliance = await this.apiRestService.getAllianceByName(this.search);
    if (!alliance.success) {
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000);
      this.isInLoading = false;
      return;
    }
    this.alliances = this.mapAlliancesFromApi(
      {
        alliances: [alliance.data],
        duration: '',
        pagination: {
          total_items_count: 1,
          total_pages: 1,
          current_items_count: 1,
          current_page: 1,
        },
      },
      () => 1,
    );
    this.isInLoading = false;
  }

  public async sortAlliances(sort: string): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    if (this.sort === sort) {
      this.reverse = !this.reverse;
    } else {
      this.reverse = false;
      this.sort = sort;
    }
    this.localStorage.setItem('alliances_sort', this.sort);
    this.localStorage.setItem('alliances_reverse', this.reverse ? 'true' : 'false');
    try {
      const data = await this.apiRestService.getGenericData(
        this.apiRestService.getAlliances.bind(this.apiRestService),
        this.page,
        this.sort,
        this.reverse ? 'DESC' : 'ASC',
        this.constructFilters(),
      );
      this.responseTime = data.response;
      this.alliances = this.mapAlliancesFromApi(
        data.data,
        (index: number) => (this.page - 1) * this.pageSize + index + 1,
      );
      this.isInLoading = false;
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page = page;
    const data = await this.apiRestService.getGenericData(
      this.apiRestService.getAlliances.bind(this.apiRestService),
      this.page,
      this.sort,
      this.reverse ? 'DESC' : 'ASC',
      this.constructFilters(),
    );
    this.responseTime = data.response;
    const alliances = data.data;
    this.alliances = this.mapAlliancesFromApi(
      alliances,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
  }

  public async nextPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page++;
    const data = await this.apiRestService.getGenericData(
      this.apiRestService.getAlliances.bind(this.apiRestService),
      this.page,
      this.sort,
      this.reverse ? 'DESC' : 'ASC',
      this.constructFilters(),
    );
    this.responseTime = data.response;
    const alliances = data.data;
    this.alliances = this.mapAlliancesFromApi(
      alliances,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
  }

  public async previousPage(): Promise<void> {
    if (this.isInLoading) return;
    this.isInLoading = true;
    this.page--;
    const data = await this.apiRestService.getGenericData(
      this.apiRestService.getAlliances.bind(this.apiRestService),
      this.page,
      this.sort,
      this.reverse ? 'DESC' : 'ASC',
      this.constructFilters(),
    );
    this.responseTime = data.response;
    const alliances = data.data;
    this.alliances = this.mapAlliancesFromApi(
      alliances,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
  }

  public async applyFilters(): Promise<void> {
    this.isInLoading = true;
    this.page = 1;
    const data = await this.apiRestService.getGenericData(
      this.apiRestService.getAlliances.bind(this.apiRestService),
      this.page,
      this.sort,
      this.reverse ? 'DESC' : 'ASC',
      this.constructFilters(),
    );
    this.responseTime = data.response;
    const alliances = data.data;
    this.alliances = this.mapAlliancesFromApi(
      alliances,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
  }

  public onGenericFocus(type: BoundType, field: FilterField): void {
    let targetValue: string | null = null;
    switch (field) {
      case 'might': {
        targetValue = type === 'min' ? this.formFilters.minMight : this.formFilters.maxMight;
        break;
      }
      case 'loot': {
        targetValue = type === 'min' ? this.formFilters.minLoot : this.formFilters.maxLoot;
        break;
      }
      case 'fame': {
        targetValue = type === 'min' ? this.formFilters.minFame : this.formFilters.maxFame;
        break;
      }
      case 'memberCount': {
        targetValue = type === 'min' ? this.formFilters.minMemberCount : this.formFilters.maxMemberCount;
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

  private constructFilters(): Record<string, string | number> {
    const filters: Record<string, string | number> = {};
    if (this.formFilters.minMight) filters['minMight'] = this.formFilters.minMight;
    if (this.formFilters.maxMight) filters['maxMight'] = this.formFilters.maxMight;
    if (this.formFilters.minLoot) filters['minLoot'] = this.formFilters.minLoot;
    if (this.formFilters.maxLoot) filters['maxLoot'] = this.formFilters.maxLoot;
    if (this.formFilters.minFame) filters['minFame'] = this.formFilters.minFame;
    if (this.formFilters.maxFame) filters['maxFame'] = this.formFilters.maxFame;
    if (this.formFilters.minMemberCount) filters['minMemberCount'] = this.formFilters.minMemberCount;
    if (this.formFilters.maxMemberCount) filters['maxMemberCount'] = this.formFilters.maxMemberCount;
    this.formFilters.isFiltered = Object.keys(filters).length > 0;
    return filters;
  }

  private async init(): Promise<void> {
    const sort = this.localStorage.getItem('alliances_sort');
    if (sort) {
      this.sort = sort;
    }
    const reverse = this.localStorage.getItem('alliances_reverse');
    if (reverse === 'true') {
      this.reverse = true;
    }
    try {
      const data = await this.apiRestService.getGenericData(
        this.apiRestService.getAlliances.bind(this.apiRestService),
        this.page,
        this.sort,
        this.reverse ? 'DESC' : 'ASC',
      );
      this.responseTime = data.response;
      this.maxPage = data.data.pagination.total_pages;
      this.alliances = this.mapAlliancesFromApi(
        data.data,
        (index: number) => (this.page - 1) * this.pageSize + index + 1,
      );
      this.structureAlliancesData(this.alliances);
      this.isInLoading = false;
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }

  private structureAlliancesData(alliances: Alliance[]): void {
    if (this.isBrowser && alliances.length > 0) {
      this.addStructuredAlliancesData(
        alliances.map((alliance) => ({
          name: alliance.name,
          url: `gge-tracker.com/alliance/${alliance.id}`,
          nbMembers: alliance.playerCount,
          might: alliance.mightCurrent,
        })),
      );
    }
  }

  private mapAlliancesFromApi(alliances: ApiAllianceResponse, rankFunction: (rank: number) => number): Alliance[] {
    if (alliances.pagination) {
      this.maxPage = alliances.pagination.total_pages;
      this.allianceCount = alliances.pagination.total_items_count;
    } else {
      this.maxPage = 1;
      this.allianceCount = 1;
    }
    void this.updateGenericParamsInUrl({ page: this.page }, { page: 1 });
    return alliances.alliances.map((alliance, index: number) => {
      return {
        id: alliance.alliance_id,
        rank: rankFunction(index),
        name: alliance.alliance_name,
        playerCount: alliance.player_count ?? 0,
        mightCurrent: alliance.might_current ?? 0,
        mightAllTime: alliance.might_all_time ?? 0,
        lootCurrent: alliance.loot_current ?? 0,
        lootAllTime: alliance.loot_all_time ?? 0,
        currentFame: alliance.current_fame ?? 0,
        highestFame: alliance.highest_fame ?? 0,
      };
    });
  }
}
