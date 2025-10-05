import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { Alliance, ApiAllianceResponse, ErrorType } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { ServerBadgeComponent } from '@ggetracker-components/server-badge/server-badge.component';
import { TableComponent } from '@ggetracker-components/table/table.component';

@Component({
  selector: 'app-alliances',
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    NgClass,
    RouterLink,
    FormsModule,
    FormatNumberPipe,
    TableComponent,
    SearchFormComponent,
    TranslateModule,
    ServerBadgeComponent,
  ],
  templateUrl: './alliances.component.html',
  styleUrl: './alliances.component.css',
})
export class AlliancesComponent extends GenericComponent {
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

  private localStorage = inject(LocalStorageService);

  constructor() {
    super();
    void this.init();
  }

  public async searchAlliance(allianceName: string): Promise<void> {
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
    );
    this.responseTime = data.response;
    const alliances = data.data;
    this.alliances = this.mapAlliancesFromApi(
      alliances,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInLoading = false;
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
        1,
        this.sort,
        this.reverse ? 'DESC' : 'ASC',
      );
      this.responseTime = data.response;
      this.maxPage = data.data.pagination.total_pages;
      this.alliances = this.mapAlliancesFromApi(data.data, (index: number) => index + 1);
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
