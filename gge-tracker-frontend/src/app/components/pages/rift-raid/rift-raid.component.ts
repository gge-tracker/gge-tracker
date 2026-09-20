import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DivisionBadgeComponent } from '@ggetracker-components/division-badge/division-badge.component';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiPagination,
  ApiRiftRaidAlliance,
  ApiRiftRaidAllianceAnalysisResponse,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';
import { Calendar, LucideAngularModule } from 'lucide-angular';
import { GrandTournamentAnalyzeComponent } from '@ggetracker-pages/grand-tournament/grand-tournament-analyze/grand-tournament-analyze.component';

const RIFT_RAID_DIVISIONS = [1, 2, 3, 4, 5, 6];

const RIFT_RAID_DIVISION_NAMES = RIFT_RAID_DIVISIONS.map((division) => `arme_division_name_${division}`);

interface RiftRaidEvent {
  event_id: number;
  dates: string[];
}

interface RiftRaidRow extends ApiRiftRaidAlliance {
  disabled: boolean;
}

@Component({
  selector: 'app-rift-raid',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterModule,
    SearchFormComponent,
    TranslateModule,
    TableComponent,
    DivisionBadgeComponent,
    GrandTournamentAnalyzeComponent,
  ],
  templateUrl: './rift-raid.component.html',
  styleUrls: ['../grand-tournament/grand-tournament.component.css', './rift-raid.component.css'],
})
export class RiftRaidComponent extends GenericComponent implements OnInit {
  public static readonly TOP_DIVISION = 6;
  public static readonly UNKNOWN_SERVER_SUFFIX = '999';

  public readonly Calendar = Calendar;
  public readonly divisions = RIFT_RAID_DIVISIONS;
  public readonly divisionNames = RIFT_RAID_DIVISION_NAMES;
  public readonly serverService = inject(ServerService);

  public events: RiftRaidEvent[] = [];
  public eventDates: string[] = [];
  public selectedEventId = 0;
  public currentDate = '';
  public latestDate = '';
  public division = RiftRaidComponent.TOP_DIVISION;
  public subdivision = 0;
  public search = '';
  public alliances: RiftRaidRow[] = [];
  public pagination: ApiPagination = { current_page: 1, total_pages: 1, current_items_count: 0, total_items_count: 0 };
  public isDataLoading = false;
  public isEventMissing = false;
  public selectedAllianceInAnalyzer: ApiRiftRaidAllianceAnalysisResponse | null = null;

  constructor() {
    super();
    this.isInLoading = true;
  }

  public get isSubdivisionFiltered(): boolean {
    return this.subdivision > 0;
  }

  public async ngOnInit(): Promise<void> {
    const parameters = this.route.snapshot.queryParams;
    this.division = this.parseDivision(parameters['division']);
    this.subdivision = Number(parameters['subdivision']) || 0;
    this.search = parameters['search'] ?? '';
    await this.loadEvents(parameters['date']);
    await this.refresh(Number(parameters['page']) || 1);
    this.isInLoading = false;
  }

  public async changeDivision(division: number): Promise<void> {
    this.division = division;
    this.subdivision = 0;
    this.search = '';
    await this.refresh(1);
  }

  public async filterBySubdivision(alliance: ApiRiftRaidAlliance): Promise<void> {
    this.division = alliance.division;
    this.subdivision = alliance.subdivision;
    this.search = '';
    await this.refresh(1);
  }

  public async clearSubdivisionFilter(): Promise<void> {
    this.subdivision = 0;
    await this.refresh(1);
  }

  public async searchAlliance(name: string): Promise<void> {
    this.search = name.trim();
    this.subdivision = 0;
    await this.refresh(1);
  }

  public selectEvent(eventId: string): void {
    this.selectedEventId = Number(eventId);
    this.eventDates = this.datesOf(this.selectedEventId);
  }

  public async loadDate(date: string): Promise<void> {
    this.currentDate = date;
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

  public async analyzeAlliance(alliance: RiftRaidRow): Promise<void> {
    const eventId = this.eventOfDate(this.currentDate)?.event_id;
    if (!eventId || alliance.alliance_id === null) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    const response = await this.apiRestService.getRiftRaidAllianceAnalysis(alliance.alliance_id, eventId);
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.selectedAllianceInAnalyzer = response.data;
  }

  public analyzerMeta(analysis: ApiRiftRaidAllianceAnalysisResponse): {
    alliance_id: number;
    alliance_name: string;
    server: string;
  } {
    return { ...analysis.meta, alliance_name: analysis.meta.alliance_name ?? '' };
  }

  private parseDivision(value: unknown): number {
    const division = Number(value);
    return this.divisions.includes(division) ? division : RiftRaidComponent.TOP_DIVISION;
  }

  private async loadEvents(requestedDate?: string): Promise<void> {
    const response = await this.apiRestService.getRiftRaidDates();
    this.events = response.success ? response.data.events : [];
    const latestEvent = this.events.at(-1);
    this.latestDate = latestEvent?.dates.at(-1) ?? '';
    this.isEventMissing = !latestEvent;
    const requestedEvent = requestedDate ? this.eventOfDate(requestedDate) : undefined;
    this.currentDate = requestedEvent ? (requestedDate ?? '') : this.latestDate;
    this.selectedEventId = (requestedEvent ?? latestEvent)?.event_id ?? 0;
    this.eventDates = this.datesOf(this.selectedEventId);
    if (!response.success) this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
  }

  private eventOfDate(date: string): RiftRaidEvent | undefined {
    return this.events.find((event) => event.dates.includes(date));
  }

  private datesOf(eventId: number): string[] {
    return [...(this.events.find((event) => event.event_id === eventId)?.dates ?? [])].reverse();
  }

  private async refresh(page: number): Promise<void> {
    void this.updateGenericParamsInUrl(
      {
        date: this.currentDate,
        division: this.division,
        subdivision: this.subdivision,
        search: this.search,
        page,
      },
      { date: this.latestDate, division: RiftRaidComponent.TOP_DIVISION, subdivision: 0, search: '', page: 1 },
    );
    if (!this.currentDate) {
      this.alliances = [];
      return;
    }
    this.isDataLoading = true;
    const response = this.search
      ? await this.apiRestService.searchRiftRaidAlliances(this.currentDate, this.search, page)
      : await this.apiRestService.getRiftRaidAlliances(
          this.currentDate,
          this.division,
          page,
          this.subdivision || undefined,
        );
    this.isDataLoading = false;
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    const alliances = 'event' in response.data ? response.data.event.alliances : response.data.alliances;
    this.alliances = alliances.map((alliance) => ({
      ...alliance,
      disabled: String(alliance.alliance_id ?? RiftRaidComponent.UNKNOWN_SERVER_SUFFIX).endsWith(
        RiftRaidComponent.UNKNOWN_SERVER_SUFFIX,
      ),
    }));
    this.pagination = response.data.pagination;
  }
}
