import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { EventCardComponent } from '../event-card/event-card.component';
import { NgClass } from '@angular/common';
import {
  ApiWoaEventDataResponse,
  ApiWoaEventListResponse,
  ApiWoaPlayerDataResponse,
  WoaEvent,
} from '@ggetracker-interfaces/empire-ranking';
import { TranslateModule } from '@ngx-translate/core';
import { EventsHeaderComponent } from '../events-header/events-header.component';
import { RouterModule } from '@angular/router';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';

interface WoaEventData {
  rank: number;
  playerId: string;
  playerName: string;
  allianceId: string | null;
  allianceName: string | null;
  playerCurrentMight: number;
  playerAllianceRank: number | null;
  playerAllTimeMight: number;
  playerLevel: number;
  playerLegendaryLevel: number;
  point: number;
}
@Component({
  selector: 'app-woa',
  imports: [
    EventCardComponent,
    NgClass,
    TranslateModule,
    EventsHeaderComponent,
    RouterModule,
    SearchFormComponent,
    TableComponent,
    FormatNumberPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './woa.component.html',
  styleUrls: ['./woa.component.css', '../events.component.css'],
})
export class WoaComponent extends GenericComponent implements OnInit {
  public events: WoaEvent[] = [];
  public currentEvent: WoaEvent | null = null;
  public page = 1;
  public players: WoaEventData[] = [];
  public pagination = {
    current_page: 1,
    total_pages: 1,
    current_items_count: 0,
    total_items_count: 0,
  };
  public allianceNameFilter = '';
  public playerNameFilter = '';
  public tableLoading = false;
  public woaCardInLoading = false;
  public cdr = inject(ChangeDetectorRef);

  public async ngOnInit(): Promise<void> {
    this.isInLoading = true;
    this.cdr.detectChanges();
    this.route.params.subscribe(async (parameters) => {
      this.events = [];
      this.currentEvent = null;
      this.page = 1;
      this.players = [];
      this.pagination = {
        current_page: 1,
        total_pages: 1,
        current_items_count: 0,
        total_items_count: 0,
      };
      const id = parameters['id'];
      const date = parameters['date'];
      if (date) {
        await this.loadEventByDate(date, this.page);
      } else if (id) {
        await this.loadEventById(id, this.page);
      } else {
        const events = await this.apiRestService.getWoaEventList(this.page);
        if (events.success) {
          this.events = this.mapEvents(events.data);
          this.pagination = events.data.pagination;
        } else {
          this.toastService.error('Failed to load event data');
        }
      }
      this.isInLoading = false;
      this.cdr.detectChanges();
    });
  }

  public onEventClick(event: WoaEvent): void {
    void this.router.navigate(['/woa', event.id]);
    this.cdr.detectChanges();
  }

  public searchPlayer(playerName: string): void {
    if (!this.currentEvent) return;
    void this.loadEventByDate(this.currentEvent.date, 1, playerName);
  }

  public searchAlliance(allianceName: string): void {
    if (!this.currentEvent) return;
    void this.loadEventByDate(this.currentEvent.date, 1, undefined, allianceName);
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.tableLoading) return;
    this.tableLoading = true;
    this.page = page;
    const players = await this.getEventByDate();
    this.players = this.mapEventData(players.data);
    this.tableLoading = false;
    void this.updatePageInUrl(this.page);
    this.cdr.detectChanges();
  }

  public async navigateToEventPage(page: number): Promise<void> {
    if (this.woaCardInLoading) return;
    this.woaCardInLoading = true;
    this.cdr.detectChanges();
    const events = await this.apiRestService.getWoaEventList(page);
    if (!events.success) {
      this.woaCardInLoading = false;
      this.toastService.error('Failed to load event data');
      this.cdr.detectChanges();
      return;
    }
    this.events = this.mapEvents(events.data);
    this.pagination = events.data.pagination;
    this.woaCardInLoading = false;
    void this.updatePageInUrl(this.page);
    this.cdr.detectChanges();
  }

  public async nextPage(): Promise<void> {
    if (this.tableLoading) return;
    this.tableLoading = true;
    this.page++;
    const data = await this.getEventByDate();
    this.players = this.mapEventData(data.data);
    this.tableLoading = false;
    void this.updatePageInUrl(this.page);
    this.cdr.detectChanges();
  }

  public async previousPage(): Promise<void> {
    if (this.tableLoading) return;
    this.tableLoading = true;
    this.page--;
    const data = await this.getEventByDate();
    this.players = this.mapEventData(data.data);
    this.tableLoading = false;
    void this.updatePageInUrl(this.page);
    this.cdr.detectChanges();
  }

  private async getEventByDate(): Promise<{
    data: ApiWoaEventDataResponse;
    response: number;
  }> {
    if (!this.currentEvent) throw new Error('Current event is not defined');
    const data = await this.apiRestService.getGenericData(
      this.apiRestService.getWoaEventDataByDate.bind(
        this.apiRestService,
        this.currentEvent.date,
        this.page,
        this.playerNameFilter,
        this.allianceNameFilter,
      ),
    );
    this.pagination = data.data.pagination;
    return data;
  }

  private async loadEventByDate(date: string, page: number, playerName?: string, allianceName?: string): Promise<void> {
    const response = await this.apiRestService.getGenericData(
      this.apiRestService.getWoaEventDataByDate.bind(this.apiRestService, date, page, playerName, allianceName),
    );
    await this.loadGenericEvent(response, date);
  }

  private async loadEventById(id: string, page: number): Promise<void> {
    const response = await this.apiRestService.getGenericData(
      this.apiRestService.getWoaEventDataById.bind(this.apiRestService, id, page),
    );
    await this.loadGenericEvent(response, response.data.event_date);
  }

  private async loadGenericEvent(
    response: { data: ApiWoaEventDataResponse; response: number },
    date: string,
  ): Promise<void> {
    try {
      this.currentEvent = {
        date,
        playerCount: response.data.pagination.total_items_count,
        totalTickets: -1,
        id: '',
        type: 'woa',
        to: this.utilitiesService.calculateWoaEventEndTime(new Date(date)),
        from: this.utilitiesService.calculateWoaEventBeginTime(new Date(date)),
      };

      this.players = this.mapEventData(response.data);
      this.pagination = response.data.pagination;
      this.tableLoading = false;
    } catch {
      this.isInLoading = false;
      this.tableLoading = false;
      this.toastService.error('Failed to load event data');
    }
    this.cdr.detectChanges();
  }

  private mapEvents(events: ApiWoaEventListResponse): WoaEvent[] {
    return events.events.map((event) => ({
      date: event.date,
      playerCount: event.participants,
      totalTickets: Number.parseInt(event.total_tickets, 10) || 0,
      type: 'woa',
      id: event.id,
      to: this.utilitiesService.calculateWoaEventEndTime(new Date(event.date)),
      from: this.utilitiesService.calculateWoaEventBeginTime(new Date(event.date)),
    }));
  }

  private mapPlayerData(playerData: ApiWoaPlayerDataResponse, rank: number): WoaEventData {
    return {
      playerId: playerData.player_id,
      playerName: playerData.player_name,
      allianceId: playerData.alliance_id,
      allianceName: playerData.alliance_name,
      playerAllianceRank: playerData.alliance_rank,
      playerCurrentMight: playerData.player_current_might,
      playerAllTimeMight: playerData.player_all_time_might,
      playerLevel: playerData.player_level,
      playerLegendaryLevel: playerData.player_legendary_level,
      point: playerData.point,
      rank: rank,
    };
  }

  private mapEventData(eventData: ApiWoaEventDataResponse): WoaEventData[] {
    const page = this.page;
    const itemsPerPage = 15;
    const startRank = (page - 1) * itemsPerPage + 1;
    return eventData.players.map((player, index) => this.mapPlayerData(player, startRank + index));
  }
}
