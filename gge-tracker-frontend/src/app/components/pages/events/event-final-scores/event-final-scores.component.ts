import { DatePipe, DecimalPipe, formatNumber } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  input,
  LOCALE_ID,
  OnChanges,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { MyStandingComponent, MyStandingFigure } from '@ggetracker-components/my-standing/my-standing.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiOuterRealmEvent,
  ApiOuterRealmPlayer,
  ApiOuterRealmPlayers,
  ErrorType,
  EventType,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { EventGame } from '@ggetracker-services/event-game.utilities';
import { encodeEventLinkCode } from '@ggetracker-services/event-link-code.utilities';
import { MyStandingService } from '@ggetracker-services/my-standing.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslatePipe } from '@ngx-translate/core';
import {
  buildLadder,
  buildLevelBands,
  buildServerRows,
  LadderRung,
  LevelBand,
  MyResult,
  nextTierFor,
  PodiumPlace,
  ServerRow,
} from './final-scores.model';
import { eventVariantKey } from '../event-variant';

const PAGE_SIZE = 15;
const COLLAPSED_SERVER_ROWS = 10;
const EVENT_TITLES: Record<EventType, string> = {
  [EventType.OUTER_REALM]: 'Royaume extérieur',
  [EventType.BEYOND_THE_HORIZON]: 'Lacis',
};

@Component({
  standalone: true,
  selector: 'app-event-final-scores',
  imports: [
    DatePipe,
    DecimalPipe,
    FormsModule,
    RouterLink,
    TranslatePipe,
    FormatNumberPipe,
    TableComponent,
    SearchFormComponent,
    MyStandingComponent,
  ],
  templateUrl: './event-final-scores.component.html',
  styleUrl: './event-final-scores.component.css',
  host: { '[class]': '"is-" + eventType()' },
})
export class EventFinalScoresComponent extends GenericComponent implements OnChanges {
  public readonly eventType = input.required<EventType>();
  public readonly eventNumber = input.required<number>();
  public readonly game = input.required<EventGame>();
  public readonly gameQueryParameters = input<Record<string, string>>({});

  public readonly serverService = inject(ServerService);
  public readonly tableHeaders: [string, string, string?, boolean?][] = [
    ['player', 'Joueur', '', true],
    ['server', 'Serveur', '', true],
    ['points', 'Points', '', true],
    ['actions', '', '', true],
  ];

  public event: ApiOuterRealmEvent | null = null;
  public players: ApiOuterRealmPlayer[] = [];
  public podium: PodiumPlace[] = [];
  public ladder: LadderRung[] = [];
  public servers: ServerRow[] = [];
  public levelBands: LevelBand[] = [];
  public mine: MyResult | null = null;
  public myFigures: MyStandingFigure[] = [];
  public participants = 0;
  public latestEventNumber: number | null = null;
  public page = 1;
  public maxPage = 1;
  public search = '';
  public serverFilter = '';
  public showAllServers = false;
  public isTableLoading = false;
  public isDataLoading = true;
  public comparedEdition: number | null = null;

  private readonly myStandingService = inject(MyStandingService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly locale = inject(LOCALE_ID);
  private readonly rankingAnchor = viewChild<ElementRef<HTMLElement>>('ranking');
  private previousEvent: ApiOuterRealmEvent | null = null;
  private loadToken = 0;

  public get title(): string {
    return EVENT_TITLES[this.eventType()];
  }

  public get variantKey(): string | null {
    return eventVariantKey(this.eventType(), this.event?.variant);
  }

  public get startDate(): Date | null {
    return this.event ? this.utilitiesService.generateOuterRealmsEventFromDate(this.event.collect_date) : null;
  }

  public get endDate(): Date | null {
    return this.event ? new Date(this.event.collect_date) : null;
  }

  public get visibleServers(): ServerRow[] {
    return this.showAllServers ? this.servers : this.servers.slice(0, COLLAPSED_SERVER_ROWS);
  }

  public get hasMoreServers(): boolean {
    return this.servers.length > COLLAPSED_SERVER_ROWS;
  }

  public get serverOptions(): ServerRow[] {
    return [...this.servers].sort((a, b) => a.server.localeCompare(b.server));
  }

  public get isFiltered(): boolean {
    return this.search !== '' || this.serverFilter !== '';
  }

  public get previousLink(): string[] | null {
    return this.eventNumber() > 1 ? this.editionLink(this.eventNumber() - 1) : null;
  }

  public get nextLink(): string[] | null {
    const latest = this.latestEventNumber;
    return latest !== null && this.eventNumber() < latest ? this.editionLink(this.eventNumber() + 1) : null;
  }

  public ngOnChanges(): void {
    void this.load();
  }

  public isMine(player: ApiOuterRealmPlayer): boolean {
    return this.mine !== null && String(player.player_id) === this.mine.playerId;
  }

  public async changePage(page: number): Promise<void> {
    if (this.isTableLoading || page < 1 || page > this.maxPage) return;
    this.page = page;
    await this.reloadPlayers();
    void this.updatePageInUrl(this.page);
  }

  public searchPlayer(name: string): void {
    this.search = name.trim();
    this.page = 1;
    void this.reloadPlayers();
  }

  public filterServer(server: string): void {
    this.serverFilter = this.serverFilter === server ? '' : server;
    this.page = 1;
    void this.reloadPlayers().then(() => this.scrollToRanking());
  }

  public async showMyRow(): Promise<void> {
    if (!this.mine) return;
    this.search = '';
    this.serverFilter = '';
    await this.changePage(Math.ceil(this.mine.rank / PAGE_SIZE));
    this.scrollToRanking();
  }

  public percent(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}`;
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.resetState();
    this.page = Number(this.route.snapshot.queryParams['page']) || 1;
    try {
      const [players, event] = await Promise.all([this.fetchPlayers(this.page), this.fetchEvent(this.eventNumber())]);
      if (token !== this.loadToken) return;
      this.applyPlayers(players);
      this.participants = players.pagination.total_items_count;
      this.event = event;
      this.servers = buildServerRows(event);
      this.levelBands = buildLevelBands(event);
      const firstPage = this.page === 1 ? players : await this.fetchPlayers(1);
      this.podium = this.toPodium(firstPage.players);
      this.ladder = buildLadder(event, null, this.participants, null);
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
    this.isDataLoading = false;
    this.cdr.detectChanges();
    void this.loadContext(token);
  }

  private async loadContext(token: number): Promise<void> {
    const comparedEdition = this.event?.previous_same_variant ?? null;
    const [previous, latest, mine] = await Promise.all([
      comparedEdition ? this.fetchEvent(comparedEdition).catch(() => null) : null,
      this.fetchLatestEventNumber().catch(() => null),
      this.fetchMyResult().catch(() => null),
    ]);
    if (token !== this.loadToken || !this.event) return;
    this.previousEvent = previous;
    this.comparedEdition = previous ? comparedEdition : null;
    this.latestEventNumber = latest;
    this.mine = mine;
    this.myFigures = mine ? this.figuresOf(mine) : [];
    this.ladder = buildLadder(this.event, this.previousEvent, this.participants, this.mine);
    this.cdr.detectChanges();
  }

  private figuresOf(mine: MyResult): MyStandingFigure[] {
    const figures: MyStandingFigure[] = [
      { label: this.translateService.instant('Rang'), value: `#${this.formatInteger(mine.rank)}` },
      { label: this.translateService.instant('Points'), value: this.formatInteger(mine.points) },
      {
        label: this.translateService.instant('Classement'),
        value: this.translateService.instant('final-scores-top-percent', {
          percent: formatNumber(mine.topPercent, this.locale, '1.0-1'),
        }),
      },
    ];
    if (mine.nextTier) {
      figures.push({
        label: this.translateService.instant('final-scores-next-tier', {
          tier: this.translateService.instant(mine.nextTier.label),
        }),
        value: `+${this.formatInteger(mine.nextTier.missing)}`,
      });
    }
    return figures;
  }

  private formatInteger(value: number): string {
    return formatNumber(value, this.locale, '1.0-0');
  }

  private resetState(): void {
    this.isDataLoading = true;
    this.event = null;
    this.previousEvent = null;
    this.comparedEdition = null;
    this.players = [];
    this.podium = [];
    this.ladder = [];
    this.servers = [];
    this.levelBands = [];
    this.mine = null;
    this.myFigures = [];
    this.search = '';
    this.serverFilter = '';
    this.showAllServers = false;
  }

  private async reloadPlayers(): Promise<void> {
    this.isTableLoading = true;
    this.cdr.detectChanges();
    try {
      this.applyPlayers(await this.fetchPlayers(this.page));
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
    this.isTableLoading = false;
    this.cdr.detectChanges();
  }

  private applyPlayers(data: ApiOuterRealmPlayers): void {
    this.players = data.players;
    this.maxPage = Math.max(1, data.pagination.total_pages);
  }

  private toPodium(players: ApiOuterRealmPlayer[]): PodiumPlace[] {
    const winner = Number(players[0]?.point ?? 0);
    return players
      .filter((player) => player.rank <= 3)
      .map((player) => ({ player, points: Number(player.point), gapToWinner: winner - Number(player.point) }));
  }

  private async fetchMyResult(): Promise<MyResult | null> {
    const me = this.myStandingService.meIn(this.game());
    if (!me) return null;
    const response = await this.apiRestService.getEventsByPlayerId(Number(me.playerId));
    if (!response.success || !this.event) return null;
    const entry = response.data.events.find(
      (candidate) => candidate.type === this.eventType() && Number(candidate.event_num) === this.eventNumber(),
    );
    if (!entry) return null;
    const rank = Number(entry.rank);
    const points = Number(entry.point);
    return {
      playerId: me.playerId,
      playerName: me.playerName,
      server: entry.server,
      rank,
      points,
      topPercent: Math.max(0.1, (rank / Math.max(1, this.participants)) * 100),
      nextTier: nextTierFor(rank, points, this.event, this.participants),
    };
  }

  private async fetchPlayers(page: number): Promise<ApiOuterRealmPlayers> {
    const response = await this.apiRestService.getEventPlayersById(
      this.eventType(),
      this.eventNumber(),
      page,
      this.search,
      this.serverFilter,
      this.game(),
    );
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  private async fetchEvent(eventNumber: number): Promise<ApiOuterRealmEvent> {
    const response = await this.apiRestService.getEventDataById(this.eventType(), eventNumber, this.game());
    if (!response.success) throw new Error(response.error);
    return response.data;
  }

  private async fetchLatestEventNumber(): Promise<number | null> {
    const response = await this.apiRestService.getEventList(1, this.eventType(), this.game());
    return response.success ? (response.data.events[0]?.event_num ?? null) : null;
  }

  private editionLink(eventNumber: number): string[] {
    return ['/events', this.eventType(), encodeEventLinkCode(this.game(), eventNumber)];
  }

  private scrollToRanking(): void {
    this.rankingAnchor()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
