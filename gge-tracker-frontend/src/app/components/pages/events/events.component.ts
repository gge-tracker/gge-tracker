import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiEventlist,
  ApiOuterRealmEvent,
  ApiOuterRealmPlayer,
  ChartAdvancedOptions,
  ErrorType,
  EventType,
} from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LanguageService } from '@ggetracker-services/language.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslatePipe } from '@ngx-translate/core';
import { Activity, CalendarCheck, LucideAngularModule, SquareUser, Target, TrendingUp, Trophy } from 'lucide-angular';
import { NgSelectComponent } from '@ng-select/ng-select';
import { ApexAxisChartSeries, ApexChart, ApexNonAxisChartSeries, ApexOptions, ApexPlotOptions } from 'ng-apexcharts';
import { firstValueFrom } from 'rxjs';
import { EventsHeaderComponent } from './events-header/events-header.component';
import { EventCardComponent } from './event-card/event-card.component';

interface GenericChartConfig {
  type: ApexChart['type'];
  series: ApexAxisChartSeries | ApexNonAxisChartSeries;
  colors?: string[];
  plotOptions?: ApexPlotOptions;
  title?: string;
  xaxisCategories?: string[];
  horizontal?: boolean;
  extraOptions?: Partial<ApexOptions>;
  tooltipFormatter?: (value: number, options: { dataPointIndex: number }) => string;
}

export interface EventList {
  type: EventType;
  id: number;
  from: Date;
  to: Date;
  playerCount: number;
}

@Component({
  standalone: true,
  selector: 'app-events',
  imports: [
    CommonModule,
    TranslatePipe,
    FormatNumberPipe,
    TableComponent,
    RouterLink,
    SearchFormComponent,
    FormsModule,
    LucideAngularModule,
    EventsHeaderComponent,
    ChartsWrapperComponent,
    EventCardComponent,
    ModalFormGroupComponent,
    NgSelectComponent,
  ],
  templateUrl: './events.component.html',
  styleUrl: './events.component.css',
})
export class EventsComponent extends GenericComponent {
  public readonly allianceNameDisplayIdThreshold = {
    [EventType.OUTER_REALM]: 58,
    [EventType.BEYOND_THE_HORIZON]: 22,
  };
  public CalendarCheck = CalendarCheck;
  public SquareUser = SquareUser;
  public TrophyIcon = Trophy;
  public TrendingUpIcon = TrendingUp;
  public TargetIcon = Target;
  public ActivityIcon = Activity;
  public eventType: EventType | null = null;
  public responseTime = 0;
  public events: EventList[] = [];
  public activatedRoute = inject(ActivatedRoute);
  public serverService = inject(ServerService);
  public tableHeaders: [string, string, string?, boolean?][] = [
    ['playerName', this.translateService.instant('Pseudonyme'), '', true],
    ['server', this.translateService.instant('Serveur'), '', true],
    ['points', this.translateService.instant('Points'), '', true],
    ['actions', this.translateService.instant('Actions'), '', true],
  ];
  public hasAllianceColumn = false;
  public tableLoading = false;
  public page = 1;
  public pagination = {
    current_page: 1,
    total_pages: 1,
    current_items_count: 0,
    total_items_count: 0,
  };
  public maxPage = 1;
  public cardLoading = false;
  public playerNameFilter = '';
  public players: ApiOuterRealmPlayer[] = [];
  public nbPlayers = 0;
  public charts: Record<string, ChartAdvancedOptions> = {};
  public currentEvent: ApiOuterRealmEvent | null = null;
  public formFilters: {
    server: string | null | undefined;
    isFiltered: boolean;
  } = {
    server: null,
    isFiltered: false,
  };
  public translations: Record<string, string> = {};
  private eventId: number | null = null;
  private languageService = inject(LanguageService);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
    this.onInit();
  }
  public serverGroupFn = (server: string): string => server.replaceAll(/\d+$/g, '').toUpperCase();

  public onInit(): void {
    void this.generateTranslations().then(() => {
      void this.init();
    });
  }

  public onEventClick(event: EventList): void {
    if (event.type === EventType.OUTER_REALM) {
      void this.router.navigate(['/events', 'outer-realms', event.id]);
    } else if (event.type === EventType.BEYOND_THE_HORIZON) {
      void this.router.navigate(['/events', 'beyond-the-horizon', event.id]);
    }
  }

  public async eventsNavigateTo(page: number): Promise<void> {
    if (this.cardLoading) return;
    this.cardLoading = true;
    this.page = page;
    await this.initEventList(this.page, this.eventType ?? undefined).then(async () => {
      await this.updatePageInUrl(this.page);
    });
    this.cardLoading = false;
    this.cdr.detectChanges();
  }

  public getEventName(type: string): string {
    switch (type) {
      case EventType.OUTER_REALM: {
        return this.translations['Royaume extérieur'];
      }
      case EventType.BEYOND_THE_HORIZON: {
        return this.translations['Lacis'];
      }
      default: {
        return '';
      }
    }
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.tableLoading) return;
    this.tableLoading = true;
    this.page = page;
    const players = await this.getEventPlayersById();
    this.responseTime = players.response;
    this.players = players.data.players;
    this.tableLoading = false;
    void this.updatePageInUrl(this.page);
    this.cdr.detectChanges();
  }

  public async nextPage(): Promise<void> {
    if (this.tableLoading) return;
    this.tableLoading = true;
    this.page++;
    const data = await this.getEventPlayersById();
    this.responseTime = data.response;
    const players = data.data;
    this.players = players.players;
    this.tableLoading = false;
    void this.updatePageInUrl(this.page);
    this.cdr.detectChanges();
  }

  public async previousPage(): Promise<void> {
    if (this.tableLoading) return;
    this.tableLoading = true;
    this.page--;
    const data = await this.getEventPlayersById();
    this.responseTime = data.response;
    const players = data.data;
    this.players = players.players;
    this.tableLoading = false;
    void this.updatePageInUrl(this.page);
    this.cdr.detectChanges();
  }

  public applyFilters(): void {
    this.formFilters.isFiltered = !!this.formFilters.server;
    this.isInLoading = true;
    this.page = 1;
    this.getEventPlayersById()
      .then((data) => {
        this.responseTime = data.response;
        this.players = data.data.players;
        this.maxPage = data.data.pagination.total_pages;
        this.isInLoading = false;
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.isInLoading = false;
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
        this.cdr.detectChanges();
      });
  }

  public createDate(date: string): Date {
    return new Date(date);
  }

  public searchPlayer(playerName: string): void {
    if (!playerName || playerName.trim() === '') {
      this.playerNameFilter = '';
      this.page = 1;
      void this.getEventPlayersById().then((data) => {
        this.responseTime = data.response;
        this.players = data.data.players;
        this.maxPage = data.data.pagination.total_pages;
        this.cdr.detectChanges();
      });
      return;
    }
    this.playerNameFilter = playerName.trim();
    this.page = 1;
    this.isInLoading = true;
    this.getEventPlayersById()
      .then((data) => {
        this.responseTime = data.response;
        this.players = data.data.players;
        this.maxPage = data.data.pagination.total_pages;
        this.isInLoading = false;
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.isInLoading = false;
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
        this.cdr.detectChanges();
      });
  }

  /**
   * Generate translations for the component.
   * This method fetches the translations for various keys used in the component.
   * It uses the TranslateService to get the translations and stores them in the `translations`
   * property of the component.
   * @returns {Promise<void>} A promise that resolves when the translations are generated.
   */
  private async generateTranslations(): Promise<void> {
    const keys = [
      'Classement des serveurs selon le nombre de joueurs dans le top 100',
      'Nombre de joueurs classés',
      'Pourcentage de joueurs du serveur dans le top 100',
      'Score',
      '1er',
      '2ème',
      '3ème',
      'Top 100',
      'Top 1k',
      'Top 10k',
      'Répartition des scores par palier',
      'Score moyen',
      'Serveurs avec le meilleur score moyen',
      'Pourcentage',
      'Serveurs avec le plus fort pourcentage de joueurs dans le top 100',
      'Nombre de joueurs',
      'Nombre de joueurs par niveau',
      'Royaume extérieur',
      'Lacis',
    ];
    const translations = await firstValueFrom(this.translateService.get(keys));
    this.translations = translations;
  }

  private async getEventList(
    page: number = 1,
    filterByEventType?: string,
  ): Promise<{ data: ApiEventlist; response: number }> {
    return await this.apiRestService.getGenericData(
      this.apiRestService.getEventList.bind(this.apiRestService, page, filterByEventType),
    );
  }

  private async getEventPlayersById(): Promise<{
    data: { players: ApiOuterRealmPlayer[]; pagination: { total_items_count: number; total_pages: number } };
    response: number;
  }> {
    if (!this.eventType) throw new Error('Event type is not defined');
    return await this.apiRestService.getGenericData(
      this.apiRestService.getEventPlayersById.bind(this.apiRestService, this.eventType, this.eventId ?? 1),
      this.page,
      this.playerNameFilter,
      this.formFilters.server,
    );
  }

  private async getEventDataById(): Promise<{ data: ApiOuterRealmEvent; response: number }> {
    if (!this.eventType) throw new Error('Event type is not defined');
    return await this.apiRestService.getGenericData(
      this.apiRestService.getEventDataById.bind(this.apiRestService, this.eventType, this.eventId ?? 1),
    );
  }

  private async initEventList(page: number, eventType?: EventType): Promise<void> {
    const events = await this.getEventList(page, eventType);
    this.responseTime = events.response;
    this.events = events.data.events.map((event) => ({
      type: event.type === 'outer_realms' ? EventType.OUTER_REALM : EventType.BEYOND_THE_HORIZON,
      id: event.event_num,
      from: this.utilitiesService.generateOuterRealmsEventFromDate(event.collect_date),
      to: new Date(event.collect_date),
      playerCount: event.player_count,
    }));
    this.pagination = events.data.pagination;
  }

  private async init(): Promise<void> {
    try {
      this.route.params.subscribe(async (parameters) => {
        if (Object.keys(parameters).length === 0 || Number.isNaN(Number.parseInt(parameters['eventId']))) {
          const targetedEvent = parameters['eventType'];
          const page = this.route.snapshot.queryParams['page'] ? Number(this.route.snapshot.queryParams['page']) : 1;
          this.page = page;
          await this.initEventList(this.page, targetedEvent);
        } else if (parameters['eventId'] !== undefined && !Number.isNaN(Number.parseInt(parameters['eventId']))) {
          if (
            parameters['eventType'] !== EventType.OUTER_REALM &&
            parameters['eventType'] !== EventType.BEYOND_THE_HORIZON
          ) {
            this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
            void this.router.navigate(['/events']);
            return;
          }
          this.eventId = Number.parseInt(parameters['eventId']);
          this.eventType = parameters['eventType'] as EventType;
          const urlParameters = this.route.snapshot.queryParams;
          const page = urlParameters['page'] ? Number(urlParameters['page']) : 1;
          this.page = page;
          if (this.eventId >= this.allianceNameDisplayIdThreshold[this.eventType]) {
            this.tableHeaders.splice(3, 0, ['alliance', this.translateService.instant('Alliance'), '', true]);
            this.hasAllianceColumn = true;
          }
          const eventPlayers = await this.getEventPlayersById();
          this.responseTime = eventPlayers.response;
          this.players = eventPlayers.data.players;
          this.nbPlayers = eventPlayers.data.pagination.total_items_count;
          this.maxPage = eventPlayers.data.pagination.total_pages;
          const eventData = await this.getEventDataById();
          this.responseTime = this.responseTime + eventData.response;
          this.currentEvent = eventData.data;
          this.buildEvents(eventData.data);
        }
        this.isInLoading = false;
      });
    } catch {
      this.isInLoading = false;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }

  private buildEvents(data: ApiOuterRealmEvent): void {
    const sortedByAvgScore = [...data.server_avg_score]
      .sort((a, b) => Number(b.avg_score) - Number(a.avg_score))
      .slice(0, 15);
    const sortedByTop100Ratio = [...data.top_100_ratio].sort((a, b) => b.ratio_top_100 - a.ratio_top_100).slice(0, 15);

    this.initGenericChartOption(
      'topScores',
      {
        type: 'bar',
        series: [
          {
            name: this.translations['Score'],
            data: [
              Number(data.top_scores.top_1),
              Number(data.top_scores.top_2),
              Number(data.top_scores.top_3),
              Number(data.top_scores.top_100),
              Number(data.top_scores.top_1000),
              Number(data.top_scores.top_10000),
            ],
          },
        ],
        colors: ['#F59E0B', '#94A3B8', '#B45309', '#3B82F6', '#8B5CF6', '#64748B'],
        xaxisCategories: [
          this.translations['1er'],
          this.translations['2ème'],
          this.translations['3ème'],
          this.translations['Top 100'],
          this.translations['Top 1k'],
          this.translations['Top 10k'],
        ],
        title: '',
        extraOptions: {
          plotOptions: { bar: { distributed: true, borderRadius: 6, borderRadiusApplication: 'end' } },
          legend: { show: false },
        },
      },
      false,
      280,
    );

    this.initGenericChartOption(
      'serverAvgScore',
      {
        type: 'bar',
        series: [
          {
            name: this.translations['Score moyen'],
            data: sortedByAvgScore.map((s) => Math.round(Number(s.avg_score))),
          },
        ],
        colors: ['#14B8A6'],
        xaxisCategories: sortedByAvgScore.map((s) => s.server),
        title: '',
        extraOptions: {
          plotOptions: { bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end' } },
        },
      },
      false,
      400,
    );

    this.initGenericChartOption(
      'top100Ratio',
      {
        type: 'bar',
        series: [
          {
            name: this.translations['Pourcentage'],
            data: sortedByTop100Ratio.map((s) => Number((s.ratio_top_100 * 100).toFixed(2))),
          },
        ],
        colors: ['#6366F1'],
        xaxisCategories: sortedByTop100Ratio.map((s) => s.server),
        title: '',
        extraOptions: {
          plotOptions: { bar: { horizontal: true, borderRadius: 4, borderRadiusApplication: 'end' } },
          tooltip: {
            y: {
              formatter: (value: number) => `${value}%`,
            },
          },
        },
      },
      false,
      400,
    );

    this.initGenericChartOption(
      'levelDistribution',
      {
        type: 'bar',
        series: [
          {
            name: this.translations['Nombre de joueurs'],
            data: data.level_distribution.map((l) => Number(l.nb_players)),
          },
        ],
        colors: ['#8B5CF6'],
        xaxisCategories: data.level_distribution.map((l) => l.level.toString()),
        title: '',
        extraOptions: {
          plotOptions: { bar: { borderRadius: 3, borderRadiusApplication: 'end' } },
        },
      },
      true,
      320,
    );
  }

  private initGenericChartOption(name: string, config: GenericChartConfig, logarithmic = false, height = 450): void {
    const dateFormat = this.translateService.instant('Date_4');
    const defaultOptions: ApexOptions = {
      series: config.series,
      chart: {
        type: config.type,
        height,
        animations: { enabled: false },
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        toolbar: { show: false },
        stacked: false,
        background: 'transparent',
        foreColor: '#475569',
      },
      title: { text: '' },
      colors: config.colors,
      tooltip: {
        shared: false,
        x: { format: dateFormat },
        y: {
          formatter: (value: number) =>
            value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ','),
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      legend: { show: true, showForZeroSeries: true },
      yaxis: {
        labels: {
          formatter: (value: number) =>
            value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ','),
          style: { colors: '#64748b' },
        },
        min: 0,
        logarithmic: logarithmic,
        forceNiceScale: true,
      },
      fill: {
        type: 'solid',
        opacity: 0.9,
      },
      grid: {
        borderColor: 'rgba(100,116,139,0.15)',
        row: { colors: ['transparent', 'transparent'] },
      },
      xaxis: config.xaxisCategories
        ? {
            categories: config.xaxisCategories,
            labels: {
              rotate: -38,
              trim: false,
              style: { colors: '#64748b', fontSize: '12px' },
            },
          }
        : {
            type: 'datetime',
            labels: {
              rotate: -38,
              datetimeFormatter: {
                year: 'yyyy',
                month: "MMM 'yy",
                day: 'dd MMM',
                hour: 'HH:mm',
                minute: 'HH:mm',
              },
              datetimeUTC: false,
              trim: false,
              style: { colors: '#64748b' },
            },
          },
      plotOptions: {},
    };
    if (config.type === 'radialBar' && config.extraOptions?.labels) {
      defaultOptions.labels = config.extraOptions.labels;
    }
    const chart = {
      ...defaultOptions,
      ...config.extraOptions,
      chart: {
        ...defaultOptions.chart,
        ...config.extraOptions?.chart,
        type: config.type,
      },
      xaxis: { ...defaultOptions.xaxis, ...config.extraOptions?.xaxis },
      yaxis: { ...defaultOptions.yaxis, ...config.extraOptions?.yaxis },
      tooltip: { ...defaultOptions.tooltip, ...config.extraOptions?.tooltip },
      stroke: { ...defaultOptions.stroke, ...config.extraOptions?.stroke },
      fill: { ...defaultOptions.fill, ...config.extraOptions?.fill },
      legend: { ...defaultOptions.legend, ...config.extraOptions?.legend },
      grid: { ...defaultOptions.grid, ...config.extraOptions?.grid },
      plotOptions: {
        ...defaultOptions.plotOptions,
        ...config.extraOptions?.plotOptions,
      },
    };
    this.charts[name] = chart;
  }
}
