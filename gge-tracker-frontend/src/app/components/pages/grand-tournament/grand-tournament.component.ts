import { CommonModule, NgFor } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiGrandTournamenAllianceAnalysisResponse,
  ApiGrandTournamentAlliance,
  ApiGrandTournamentSearchAlliances,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { TranslateModule } from '@ngx-translate/core';
import { Calendar, LucideAngularModule } from 'lucide-angular';
import { GrandTournamentAnalyzeComponent } from './grand-tournament-analyze/grand-tournament-analyze.component';
import { ServerService } from '@ggetracker-services/server.service';

interface IGrandTournamentAlliances extends ApiGrandTournamentAlliance {
  disabled?: boolean;
}

interface IGrandTournamentSearchAlliances extends ApiGrandTournamentSearchAlliances {
  disabled?: boolean;
}

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
    GrandTournamentAnalyzeComponent,
  ],
  templateUrl: './grand-tournament.component.html',
  styleUrl: './grand-tournament.component.css',
})
export class GrandTournamentComponent extends GenericComponent implements OnInit {
  public isDataLoading = false;
  public isSubDivisionFilterActivated = false;
  public search = '';
  public alliances: (IGrandTournamentAlliances | IGrandTournamentSearchAlliances)[] = [];
  public selectedAllianceInAnalyzer: ApiGrandTournamenAllianceAnalysisResponse | null = null;
  public events: { dates: string[]; event_id: number }[] = [];
  public currentDates: string[] = [];
  public currentEventId = 0;
  public currentDate = '';
  public readonly Calendar = Calendar;
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

  public divisionNames = [
    'ame_division_name_1',
    'ame_division_name_2',
    'ame_division_name_3',
    'ame_division_name_4',
    'ame_division_name_5',
  ];
  public serverService = inject(ServerService);

  constructor() {
    super();
    this.isInLoading = true;
  }

  public isWithDivision(object: unknown): object is { division: number } {
    return typeof object === 'object' && object !== null && 'division' in object;
  }

  public async analyzeAlliance(allianceId: number): Promise<void> {
    const eventId = this.events.find((event) => event.dates.includes(this.currentDate))?.event_id;
    if (!eventId) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    const response = await this.apiRestService.getGrandTournamentAllianceAnalysis(allianceId, eventId);
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.selectedAllianceInAnalyzer = response.data;
  }

  public async loadAlliances(
    division: number,
    page: number,
    date: string = this.currentDate,
    subdivision?: number,
  ): Promise<void> {
    this.isDataLoading = true;
    const response = await this.apiRestService.getGrandTournamentAlliances(date, division, page, subdivision);
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    const responseContent = response.data;
    this.alliances = responseContent.event.alliances.map((alliance) => {
      return {
        ...alliance,
        disabled: String(alliance.alliance_id).endsWith('999'),
      };
    });
    this.division = responseContent.event.division;
    this.subdivision = responseContent.event.subdivision;
    this.pagination = responseContent.pagination;
    this.isDataLoading = false;
  }

  public async changeDivision(division: number): Promise<void> {
    this.search = '';
    this.isSubDivisionFilterActivated = false;
    this.subdivision.current_subdivision = 0;
    await this.loadAlliances(division, 1);
  }

  public async filterBySubDivision(division: number, subdivision: number): Promise<void> {
    this.search = '';
    this.isSubDivisionFilterActivated = true;
    this.subdivision.current_subdivision = subdivision;
    await this.loadAlliances(division, 1, this.currentDate, subdivision);
  }

  public async clearSubDivisionFilter(): Promise<void> {
    this.search = '';
    this.isSubDivisionFilterActivated = false;
    this.subdivision.current_subdivision = 0;
    await this.loadAlliances(this.division.current_division ?? 5, 1, this.currentDate);
  }

  public navigateTo(page: number): void {
    if (this.search.trim() !== '') {
      void this.searchAlliance(this.search, page);
      return;
    }
    void this.loadAlliances(this.division.current_division, page);
  }

  public updateDates(eventId: string): void {
    this.currentEventId = Number(eventId);
    const event = this.events.find(
      (event: { dates: string[]; event_id: number }) => event.event_id === Number(eventId),
    );
    this.currentDates = event ? event.dates : [];
  }

  public loadDate(date: string): void {
    this.currentDate = date;
    if (this.search.trim() !== '') {
      void this.searchAlliance(this.search, 1);
      return;
    }
    void this.loadAlliances(this.division.current_division, 1, date);
  }

  public previousPage(): void {
    const currentSubDivision = this.isSubDivisionFilterActivated ? this.subdivision.current_subdivision : undefined;
    if (this.pagination.current_page > 1) {
      if (this.search.trim() !== '') {
        void this.searchAlliance(this.search, this.pagination.current_page - 1);
        return;
      }
      void this.loadAlliances(
        this.division.current_division,
        this.pagination.current_page - 1,
        this.currentDate,
        currentSubDivision,
      );
    }
  }

  public nextPage(): void {
    const currentSubDivision = this.isSubDivisionFilterActivated ? this.subdivision.current_subdivision : undefined;
    if (this.pagination.current_page < this.pagination.total_pages) {
      if (this.search.trim() !== '') {
        void this.searchAlliance(this.search, this.pagination.current_page + 1);
        return;
      }
      void this.loadAlliances(
        this.division.current_division,
        this.pagination.current_page + 1,
        this.currentDate,
        currentSubDivision,
      );
    }
  }

  public async ngOnInit(): Promise<void> {
    const response = await this.apiRestService.getGrandTournamentDates();
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.events = response.data.events;
    const dates = this.events.at(-1)?.dates;
    if (!dates || dates.length === 0) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.currentDates = dates.reverse();
    this.currentDate = dates.at(0) || '';
    await this.loadAlliances(5, 1, this.currentDate);
    this.isInLoading = false;
  }

  public isDisabledLink(allianceId: string): boolean {
    return allianceId.endsWith('999');
  }

  public async searchAlliance(alliance: string, page = 1): Promise<void> {
    this.search = alliance;
    if (this.search.trim() === '') {
      this.division.current_division = 5;
      await this.loadAlliances(this.division.current_division, page, this.currentDate);
      return;
    }
    this.division.current_division = 0;
    const response = await this.apiRestService.getGrandTournamentSearchAlliance(this.currentDate, this.search, page);
    if (!response.success) {
      this.toastService.add(ErrorType.NO_ALLIANCE_FOUND, 5000, 'error');
      return;
    }
    this.alliances = response.data.alliances.map((alliance) => {
      return {
        ...alliance,
        disabled: String(alliance.alliance_id).endsWith('999'),
      };
    });
    this.pagination = response.data.pagination;
  }
}
