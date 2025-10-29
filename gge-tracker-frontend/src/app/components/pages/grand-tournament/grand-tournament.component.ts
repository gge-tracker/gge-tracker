import { CommonModule, NgFor } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { RouterModule } from '@angular/router';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TranslateModule } from '@ngx-translate/core';
import { TableComponent } from '@ggetracker-components/table/table.component';

@Component({
  selector: 'app-grand-tournament',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterModule,
    SearchFormComponent,
    TranslateModule,
    TableComponent,
    NgFor,
  ],
  templateUrl: './grand-tournament.component.html',
  styleUrl: './grand-tournament.component.css',
})
export class GrandTournamentComponent extends GenericComponent implements OnInit {
  public alliances: any[] = [];
  public isDataLoading = false;
  public search = '';
  public dates = [];
  public division = {
    current_division: 0,
    max_division: 0,
    min_division: 0,
  };
  public subdivision = {
    current_subdivision: 0,
    max_subdivision: 0,
    min_subdivision: 0,
  };
  public pagination = {
    current_page: 1,
    total_pages: 1,
    current_items_count: 0,
    total_items_count: 0,
  };

  public divisionNames = ['Copper', 'Glass', 'Bronze', 'Silver', 'Gold'];

  public async loadAlliances(
    division: number,
    subdivision: number,
    page: number,
    date: string = this.dates[0],
  ): Promise<void> {
    const list: any = await this.apiRestService.apiFetch(
      `${ApiRestService.apiUrl}grand-tournament/alliances?date=${date}&division_id=${division}&page=${page}`,
    );
    this.alliances = list.data.event.alliances.map((alliance: any) => {
      return {
        ...alliance,
        disabled: String(alliance.alliance_id).endsWith('999'),
      };
    });
    this.division = list.data.event.division;
    this.subdivision = list.data.event.subdivision;
    this.pagination = list.data.pagination;
  }

  public async changeDivision(division: number): Promise<void> {
    console.log('Changing division to', division);
    await this.loadAlliances(division, 1, 1);
  }

  public navigateTo(page: number): void {
    void this.loadAlliances(this.division.current_division, this.subdivision.current_subdivision, page);
  }

  public previousPage(): void {
    if (this.pagination.current_page > 1) {
      void this.loadAlliances(
        this.division.current_division,
        this.subdivision.current_subdivision,
        this.pagination.current_page - 1,
      );
    }
  }

  public nextPage(): void {
    if (this.pagination.current_page < this.pagination.total_pages) {
      void this.loadAlliances(
        this.division.current_division,
        this.subdivision.current_subdivision,
        this.pagination.current_page + 1,
      );
    }
  }

  public async ngOnInit(): Promise<void> {
    const dates: any = await this.apiRestService.apiFetch(`${ApiRestService.apiUrl}grand-tournament/dates`);
    this.dates = dates.data.eventDates;
    await this.loadAlliances(5, 1, 1, this.dates[0]);
    this.isInLoading = false;
  }

  public searchAlliance(alliance: string): void {
    this.toastService.add('Not implemented yet!', 5000);
  }
}
