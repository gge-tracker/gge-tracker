import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DivisionBadgeComponent } from '@ggetracker-components/division-badge/division-badge.component';
import { EventTimelineComponent } from '@ggetracker-components/event-timeline/event-timeline.component';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { MyStandingComponent } from '@ggetracker-components/my-standing/my-standing.component';
import { LayeredSceneComponent } from '@ggetracker-components/layered-scene/layered-scene.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiPagination,
  ApiRiftRaidAlliance,
  ApiRiftRaidAllianceAnalysisResponse,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { MyAllianceStanding, MyStandingService } from '@ggetracker-services/my-standing.service';
import { ServerService } from '@ggetracker-services/server.service';
import { EventGame, resolveEventGame } from '@ggetracker-services/event-game.utilities';
import { TranslateModule } from '@ngx-translate/core';
import { GrandTournamentAnalyzeComponent } from '@ggetracker-pages/grand-tournament/grand-tournament-analyze/grand-tournament-analyze.component';

const RIFT_RAID_DIVISIONS = [1, 2, 3, 4, 5, 6];

const MY_ALLIANCE_GRACE_MS = 800;

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
    RouterModule,
    SearchFormComponent,
    TranslateModule,
    TableComponent,
    DivisionBadgeComponent,
    GrandTournamentAnalyzeComponent,
    EventTimelineComponent,
    LayeredSceneComponent,
    MyStandingComponent,
  ],
  templateUrl: './rift-raid.component.html',
  styleUrls: ['../grand-tournament/grand-tournament.component.css', './rift-raid.component.css'],
})
export class RiftRaidComponent extends GenericComponent implements OnInit {
  public static readonly TOP_DIVISION = 6;
  public static readonly UNKNOWN_SERVER_SUFFIX = '999';

  public readonly divisions = RIFT_RAID_DIVISIONS;
  public readonly divisionNames = RIFT_RAID_DIVISION_NAMES;
  public readonly serverService = inject(ServerService);

  public game: EventGame = 'ep';
  public events: RiftRaidEvent[] = [];
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
  public analyzingAllianceId: number | null = null;
  public myAlliance: MyAllianceStanding | null = null;
  private readonly myStanding = inject(MyStandingService);

  constructor() {
    super();
    this.isInLoading = true;
  }

  public get isSubdivisionFiltered(): boolean {
    return this.subdivision > 0;
  }

  public async ngOnInit(): Promise<void> {
    const parameters = this.route.snapshot.queryParams;
    this.game = resolveEventGame(parameters['game'], this.serverService.isE4kServer());
    this.division = this.parseDivision(parameters['division']);
    this.subdivision = Number(parameters['subdivision']) || 0;
    this.search = parameters['search'] ?? '';
    const myAlliance = this.loadMyAlliance();
    await this.loadEvents(parameters['date']);
    await Promise.race([myAlliance, new Promise((resolve) => setTimeout(resolve, MY_ALLIANCE_GRACE_MS))]);
    await this.refresh(Number(parameters['page']) || 1);
    this.isInLoading = false;
  }

  public async selectGame(game: EventGame): Promise<void> {
    if (game === this.game || this.isDataLoading) return;
    this.game = game;
    this.division = RiftRaidComponent.TOP_DIVISION;
    this.subdivision = 0;
    this.search = '';
    this.alliances = [];
    this.myAlliance = null;
    this.isInLoading = true;
    const myAlliance = this.loadMyAlliance();
    await this.loadEvents();
    await Promise.race([myAlliance, new Promise((resolve) => setTimeout(resolve, MY_ALLIANCE_GRACE_MS))]);
    await this.refresh(1);
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

  public async showMyAllianceSubdivision(mine: MyAllianceStanding): Promise<void> {
    this.currentDate = mine.standing.date;
    this.division = mine.standing.division;
    this.subdivision = mine.standing.subdivision;
    this.search = '';
    await this.refresh(1);
  }

  public async analyzeMyAlliance(mine: MyAllianceStanding): Promise<void> {
    this.currentDate = mine.standing.date;
    await this.analyzeAlliance({
      alliance_id: mine.allianceId,
      alliance_name: mine.allianceName,
      server: '',
      score: mine.standing.score,
      division: mine.standing.division,
      subdivision: mine.standing.subdivision,
      rank: mine.standing.rank,
      disabled: false,
    });
  }

  public async searchAlliance(name: string): Promise<void> {
    this.search = name.trim();
    this.subdivision = 0;
    await this.refresh(1);
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
    this.analyzingAllianceId = alliance.alliance_id;
    const response = await this.apiRestService
      .getRiftRaidAllianceAnalysis(alliance.alliance_id, eventId)
      .finally(() => (this.analyzingAllianceId = null));
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

  private async loadMyAlliance(): Promise<void> {
    const game = this.game;
    const mine = await this.myStanding.allianceStanding('rift_raid', game);
    if (mine && game === this.game) this.myAlliance = mine;
  }

  private parseDivision(value: unknown): number {
    const division = Number(value);
    return this.divisions.includes(division) ? division : RiftRaidComponent.TOP_DIVISION;
  }

  private async loadEvents(requestedDate?: string): Promise<void> {
    const response = await this.apiRestService.getRiftRaidDates(this.game);
    this.events = response.success ? response.data.events : [];
    const latestEvent = this.events.at(-1);
    this.latestDate = latestEvent?.dates.at(-1) ?? '';
    this.isEventMissing = !latestEvent;
    const requestedEvent = requestedDate ? this.eventOfDate(requestedDate) : undefined;
    this.currentDate = requestedEvent ? (requestedDate ?? '') : this.latestDate;
    if (!response.success) this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
  }

  private eventOfDate(date: string): RiftRaidEvent | undefined {
    return this.events.find((event) => event.dates.includes(date));
  }

  private async refresh(page: number): Promise<void> {
    void this.updateGenericParamsInUrl(
      {
        date: this.currentDate,
        division: this.division,
        subdivision: this.subdivision,
        search: this.search,
        page,
        game: this.game,
      },
      {
        date: this.latestDate,
        division: RiftRaidComponent.TOP_DIVISION,
        subdivision: 0,
        search: '',
        page: 1,
        game: resolveEventGame(undefined, this.serverService.isE4kServer()),
      },
    );
    if (!this.currentDate) {
      this.alliances = [];
      return;
    }
    this.isDataLoading = true;
    const response = this.search
      ? await this.apiRestService.searchRiftRaidAlliances(this.currentDate, this.search, page, this.game)
      : await this.apiRestService.getRiftRaidAlliances(
          this.currentDate,
          this.division,
          page,
          this.subdivision || undefined,
          this.game,
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
