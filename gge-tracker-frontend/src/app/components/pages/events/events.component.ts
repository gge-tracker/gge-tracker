import { DecimalPipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameSwitchComponent } from '@ggetracker-components/game-switch/game-switch.component';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ApiEventlist, ApiEventWinner, ErrorType, EventType } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { EventGame, eventGameQueryParameters, resolveEventGame } from '@ggetracker-services/event-game.utilities';
import {
  decodeEventLinkCode,
  encodeEventLinkCode,
  isLegacyEventNumber,
} from '@ggetracker-services/event-link-code.utilities';
import { MyStandingService } from '@ggetracker-services/my-standing.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslatePipe } from '@ngx-translate/core';
import { EventCardComponent } from './event-card/event-card.component';
import { eventVariantKey } from './event-variant';
import { EventFinalScoresComponent } from './event-final-scores/event-final-scores.component';

export interface EventList {
  type: EventType;
  id: number;
  from: Date;
  to: Date;
  playerCount: number;
  variant: string | null;
  winner?: ApiEventWinner | null;
}

interface MyEventResult {
  rank: number;
  points: number;
}

interface EventDetail {
  type: EventType;
  eventNumber: number;
}

@Component({
  standalone: true,
  selector: 'app-events',
  imports: [
    DecimalPipe,
    TranslatePipe,
    FormatNumberPipe,
    RouterLink,
    EventCardComponent,
    EventFinalScoresComponent,
    GameSwitchComponent,
  ],
  templateUrl: './events.component.html',
  styleUrl: './events.component.css',
})
export class EventsComponent extends GenericComponent {
  public readonly listFilters: { type: EventType | null; label: string }[] = [
    { type: null, label: 'Tous' },
    { type: EventType.OUTER_REALM, label: 'Royaume extérieur' },
    { type: EventType.BEYOND_THE_HORIZON, label: 'Lacis' },
  ];
  public readonly serverService = inject(ServerService);
  public events: EventList[] = [];
  public listType: EventType | null = null;
  public detail: EventDetail | null = null;
  public myResults = new Map<string, MyEventResult>();
  public pagination = {
    current_page: 1,
    total_pages: 1,
    current_items_count: 0,
    total_items_count: 0,
  };
  public page = 1;
  public cardLoading = false;
  public game: EventGame = 'ep';
  public gameQueryParameters: Record<string, string> = {};
  private readonly myStandingService = inject(MyStandingService);
  private readonly cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
    this.listenToRoute();
  }

  public onEventClick(event: EventList): void {
    void this.router.navigate(this.eventLink(event.type, event.id));
  }

  public variantKeyOf(event: EventList): string | null {
    return eventVariantKey(event.type, event.variant);
  }

  public myResultOf(event: EventList): MyEventResult | undefined {
    return this.myResults.get(this.resultKey(event.type, event.id));
  }

  public async selectGame(game: EventGame): Promise<void> {
    if (game === this.game || this.cardLoading) return;
    this.setGame(game);
    this.page = 1;
    await this.loadList();
    await this.updateGenericParamsInUrl({ page: 1, game: this.gameQueryParameters['game'] ?? null }, { page: 1 });
  }

  public async eventsNavigateTo(page: number): Promise<void> {
    if (this.cardLoading) return;
    this.page = page;
    await this.loadList();
    await this.updatePageInUrl(this.page);
  }

  private listenToRoute(): void {
    this.route.params.subscribe((parameters) => {
      const requestedGame = resolveEventGame(this.route.snapshot.queryParams['game'], this.serverService.isE4kServer());
      const identifier: string | undefined = parameters['eventId'];
      const eventType: string | undefined = parameters['eventType'];
      if (identifier === undefined) {
        this.detail = null;
        this.setGame(requestedGame);
        this.listType = this.isEventType(eventType) ? eventType : null;
        this.page = Number(this.route.snapshot.queryParams['page']) || 1;
        void this.loadList();
        return;
      }
      const link = this.resolveEventLink(identifier, requestedGame);
      if (!link || !this.isEventType(eventType)) {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
        void this.router.navigate(['/events']);
        return;
      }
      this.setGame(link.game);
      if (isLegacyEventNumber(identifier)) {
        void this.router.navigate(this.eventLink(eventType, link.eventNumber), {
          queryParams: { ...this.gameQueryParameters, page: this.route.snapshot.queryParams['page'] },
          replaceUrl: true,
        });
        return;
      }
      this.detail = { type: eventType, eventNumber: link.eventNumber };
      this.isInLoading = false;
      this.cdr.markForCheck();
    });
  }

  private async loadList(): Promise<void> {
    this.cardLoading = true;
    try {
      const response = await this.apiRestService.getEventList(this.page, this.listType ?? undefined, this.game);
      if (!response.success) throw new Error(response.error);
      this.events = this.toEventList(response.data);
      this.pagination = response.data.pagination;
      void this.loadMyResults();
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
    this.cardLoading = false;
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  private async loadMyResults(): Promise<void> {
    const me = this.myStandingService.meIn(this.game);
    if (!me) {
      this.myResults = new Map();
      return;
    }
    const response = await this.apiRestService.getEventsByPlayerId(Number(me.playerId));
    if (!response.success) return;
    this.myResults = new Map(
      response.data.events.map((event) => [
        this.resultKey(event.type, Number(event.event_num)),
        { rank: Number(event.rank), points: Number(event.point) },
      ]),
    );
    this.cdr.detectChanges();
  }

  private toEventList(data: ApiEventlist): EventList[] {
    return data.events.map((event) => ({
      type: event.type === 'outer_realms' ? EventType.OUTER_REALM : EventType.BEYOND_THE_HORIZON,
      id: event.event_num,
      from: this.utilitiesService.generateOuterRealmsEventFromDate(event.collect_date),
      to: new Date(event.collect_date),
      playerCount: event.player_count,
      variant: event.variant ?? null,
      winner: event.winner ?? null,
    }));
  }

  private resultKey(type: EventType, eventNumber: number): string {
    return `${type}:${eventNumber}`;
  }

  private isEventType(value: string | undefined): value is EventType {
    return value === EventType.OUTER_REALM || value === EventType.BEYOND_THE_HORIZON;
  }

  private eventLink(eventType: EventType, eventNumber: number): string[] {
    return ['/events', eventType, encodeEventLinkCode(this.game, eventNumber)];
  }

  private resolveEventLink(
    identifier: string,
    requestedGame: EventGame,
  ): { game: EventGame; eventNumber: number } | null {
    if (isLegacyEventNumber(identifier)) return { game: requestedGame, eventNumber: Number(identifier) };
    return decodeEventLinkCode(identifier);
  }

  private setGame(game: EventGame): void {
    this.game = game;
    const serverGame = resolveEventGame(undefined, this.serverService.isE4kServer());
    this.gameQueryParameters = game === serverGame ? eventGameQueryParameters(game) : { game };
  }
}
