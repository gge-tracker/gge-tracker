import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CalendarCheck, LucideAngularModule, SquareUser } from 'lucide-angular';
import { ApexAxisChartSeries, ApexChart, ApexNonAxisChartSeries, ApexOptions, ApexPlotOptions } from 'ng-apexcharts';
import { firstValueFrom } from 'rxjs';

import { EventsHeaderComponent } from './events-header/events-header.component';
import {
  ApiEventlist,
  ApiOuterRealmEvent,
  ApiOuterRealmPlayer,
  ChartAdvancedOptions,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LanguageService } from '@ggetracker-services/language.service';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';

export enum EventType {
  OUTER_REALM = 'outer-realms',
  BEYOND_THE_HORIZON = 'beyond-the-horizon',
}

interface GenericChartConfig {
  type: ApexChart['type'];
  series: ApexAxisChartSeries | ApexNonAxisChartSeries;
  colors?: string[];
  plotOptions?: ApexPlotOptions;
  title?: string;
  xaxisCategories?: string[];
  horizontal?: boolean;
  extraOptions?: Partial<ApexOptions>;
  tooltipFormatter?: (value: number, opts: { dataPointIndex: number }) => string;
}

export interface EventList {
  type: EventType;
  id: number;
  from: Date;
  to: Date;
  playerCount: number;
}

@Component({
  selector: 'app-events',
  standalone: true,
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
  ],
  templateUrl: './events.component.html',
  styleUrl: './events.component.css',
})
export class EventsComponent extends GenericComponent {
  public CalendarCheck = CalendarCheck;
  public SquareUser = SquareUser;
  public eventType: EventType | null = null;
  public responseTime = 0;
  public events: EventList[] = [];
  public activatedRoute = inject(ActivatedRoute);
  public tableLoading = false;
  public page = 1;
  public maxPage = 1;
  public playerNameFilter = '';
  public players: ApiOuterRealmPlayer[] = [];
  public nbPlayers = 0;
  public charts: Record<string, ChartAdvancedOptions> = {};
  public currentEvent: ApiOuterRealmEvent | null = null;
  public formFilters: {
    server: string | undefined;
    isFiltered: boolean;
  } = {
    server: '',
    isFiltered: false,
  };
  public translations: Record<string, string> = {};
  public servers = [
    'FR1',
    'DE1',
    'RO1',
    'CZ1',
    'NL1',
    'LIVE',
    'INT3',
    'US1',
    'TR1',
    'PT1',
    'BR1',
    'IN1',
    'IT1',
    'PL1',
    'AU1',
    'ARAB',
    'HANT',
    'GR1',
    'CN1',
    'ASIA',
    'AE1',
    'EG1',
    'SKN1',
    'RU1',
    'SA1',
    'BG1',
    'ES2',
    'SK1',
    'ES1',
    'GB1',
    'HU1',
    'INT2',
    'HU2',
    'JP1',
    'LT1',
    'INT1',
    'HIS1',
  ].sort((a, b) => a.localeCompare(b));

  private eventId: number | null = null;
  private languageService = inject(LanguageService);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
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

  public getEventName(type: string): string {
    switch (type) {
      case EventType.OUTER_REALM:
        return this.translations['Royaume extérieur'];
      case EventType.BEYOND_THE_HORIZON:
        return this.translations['Lacis'];
      default:
        return '';
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
    this.cdr.detectChanges();
  }

  public getFlagUrl(server: string): string {
    const serverFlags: Record<string, string> = {
      FR1: 'https://flagsapi.com/FR/flat/64.png',
      DE1: 'https://flagsapi.com/DE/flat/64.png',
      RO1: 'https://flagsapi.com/RO/flat/64.png',
      CZ1: 'https://flagsapi.com/CZ/flat/64.png',
      NL1: 'https://flagsapi.com/NL/flat/64.png',
      LIVE: '/assets/int_flag.png',
      INT3: '/assets/int_flag.png',
      US1: 'https://flagsapi.com/US/flat/64.png',
      TR1: 'https://flagsapi.com/TR/flat/64.png',
      PT1: 'https://flagsapi.com/PT/flat/64.png',
      BR1: 'https://flagsapi.com/BR/flat/64.png',
      IN1: 'https://flagsapi.com/IN/flat/64.png',
      IT1: 'https://flagsapi.com/IT/flat/64.png',
      PL1: 'https://flagsapi.com/PL/flat/64.png',
      AU1: 'https://flagsapi.com/AU/flat/64.png',
      ARAB: '/assets/arab_flag.png',
      HANT: 'https://flagsapi.com/CN/flat/64.png',
      GR1: 'https://flagsapi.com/GR/flat/64.png',
      CN1: 'https://flagsapi.com/CN/flat/64.png',
      ASIA: 'https://flagsapi.com/AS/flat/64.png',
      AE1: 'https://flagsapi.com/AE/flat/64.png',
      EG1: 'https://flagsapi.com/EG/flat/64.png',
      SKN1: 'https://flagsapi.com/SK/flat/64.png',
      RU1: 'https://flagsapi.com/RU/flat/64.png',
      SA1: 'https://flagsapi.com/SA/flat/64.png',
      BG1: 'https://flagsapi.com/BG/flat/64.png',
      ES2: 'https://flagsapi.com/ES/flat/64.png',
      SK1: 'https://flagsapi.com/SK/flat/64.png',
      ES1: 'https://flagsapi.com/ES/flat/64.png',
      GB1: 'https://flagsapi.com/GB/flat/64.png',
      HU1: 'https://flagsapi.com/HU/flat/64.png',
      INT2: '/assets/int_flag.png',
      HU2: 'https://flagsapi.com/HU/flat/64.png',
      JP1: 'https://flagsapi.com/JP/flat/64.png',
      LT1: 'https://flagsapi.com/LT/flat/64.png',
      INT1: '/assets/int_flag.png',
      HIS1: 'https://flagsapi.com/MX/flat/64.png',
    };
    return serverFlags[server] || '/assets/default_flag.png';
  }

  public applyFilters(): void {
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

  public generateFromDate(date: string): Date {
    const d = new Date(date);
    // Event always begin 4 days before the collection date
    d.setDate(d.getDate() - 4);
    return d;
  }

  public newDate(date: string): Date {
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

  private async getEventList(): Promise<{ data: ApiEventlist; response: number }> {
    return await this.apiRestService.getGenericData(this.apiRestService.getEventList.bind(this.apiRestService));
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

  private async init(): Promise<void> {
    try {
      this.route.params.subscribe(async (params) => {
        if (Object.keys(params).length === 0) {
          const events = await this.getEventList();
          this.responseTime = events.response;
          this.events = events.data.events.map((event) => ({
            type: event.type === 'outer_realms' ? EventType.OUTER_REALM : EventType.BEYOND_THE_HORIZON,
            id: event.event_num,
            from: this.generateFromDate(event.collect_date),
            to: new Date(event.collect_date),
            playerCount: event.player_count,
          }));
        } else if (params['eventId'] !== undefined && !isNaN(parseInt(params['eventId']))) {
          if (params['eventType'] !== EventType.OUTER_REALM && params['eventType'] !== EventType.BEYOND_THE_HORIZON) {
            this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
            void this.router.navigate(['/events']);
            return;
          }
          this.eventId = Number.parseInt(params['eventId']);
          this.eventType = params['eventType'] as EventType;
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
    const nbAndRatioInTop100Data: Record<string, { nb: number; ratio: number }> = {};
    data.nb_in_top_100.forEach((item) => {
      nbAndRatioInTop100Data[item.server] = {
        nb: Number(item.nb_in_top_100),
        ratio: data.top_100_ratio.find((r) => r.server === item.server)?.ratio_top_100 ?? 0,
      };
    });
    this.initGenericChartOption('nbInTop100', {
      type: 'bar',
      series: [
        {
          name: this.translations['Nombre de joueurs classés'],
          data: Object.values(nbAndRatioInTop100Data).map((s) => s.nb),
        },
        {
          name: this.translations['Pourcentage de joueurs du serveur dans le top 100'],
          data: Object.values(nbAndRatioInTop100Data).map((s) => Number((s.ratio * 100).toFixed(2))),
        },
      ],
      colors: ['#FEB019', '#FF4560'],
      xaxisCategories: Object.keys(nbAndRatioInTop100Data),
      horizontal: false,
      title: this.translations['Classement des serveurs selon le nombre de joueurs dans le top 100'],
    });
    this.initGenericChartOption('topScores', {
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
      colors: ['#00E396'],
      xaxisCategories: [
        this.translations['1er'],
        this.translations['2ème'],
        this.translations['3ème'],
        this.translations['Top 100'],
        this.translations['Top 1k'],
        this.translations['Top 10k'],
      ],
      title: this.translations['Répartition des scores par palier'],
    });
    this.initGenericChartOption('serverAvgScore', {
      type: 'bar',
      series: [
        {
          name: this.translations['Score moyen'],
          data: data.server_avg_score
            .sort((a, b) => Number(b.avg_score) - Number(a.avg_score))
            .slice(0, 15)
            .map((s) => Math.round(Number(s.avg_score))),
        },
      ],
      colors: ['#775DD0', '#FEB019'],
      xaxisCategories: data.server_avg_score
        .sort((a, b) => Number(b.avg_score) - Number(a.avg_score))
        .slice(0, 15)
        .map((s) => s.server),
      horizontal: true,
      title: this.translations['Serveurs avec le meilleur score moyen'],
    });
    this.initGenericChartOption('top100Ratio', {
      type: 'bar',
      series: [
        {
          name: this.translations['Pourcentage'],
          data: data.top_100_ratio
            .sort((a, b) => b.ratio_top_100 - a.ratio_top_100)
            .slice(0, 15)
            .map((s) => Number((s.ratio_top_100 * 100).toFixed(2))),
        },
      ],
      colors: ['#FF4560'],
      xaxisCategories: data.top_100_ratio
        .sort((a, b) => b.ratio_top_100 - a.ratio_top_100)
        .slice(0, 15)
        .map((s) => s.server),
      horizontal: true,
      title: this.translations['Serveurs avec le plus fort pourcentage de joueurs dans le top 100'],
    });
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
        colors: ['#008FFB'],
        xaxisCategories: data.level_distribution.map((l) => l.level.toString()),
        title: this.translations['Nombre de joueurs par niveau'],
      },
      true,
      550,
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
        toolbar: {},
        stacked: false,
      },
      title: { text: config.title ?? '' },
      colors: config.colors,
      tooltip: {
        shared: false,
        x: { format: dateFormat },
        y: {
          formatter: (value: number) => (value !== null ? value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '?'),
        },
      },
      dataLabels: { enabled: false },
      stroke: { width: [2, 2, 0], curve: 'smooth' },
      legend: { show: true, showForZeroSeries: true },
      yaxis: {
        labels: {
          formatter: (value: number) => (value !== null ? value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '?'),
        },
        min: 0,
        logarithmic: logarithmic,
        forceNiceScale: true,
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          gradientToColors: config.colors,
          shadeIntensity: 0.8,
          type: 'horizontal',
          opacityFrom: 0.9,
          opacityTo: 0.6,
          stops: [0, 100],
        },
      },
      grid: {
        row: { colors: ['#f3f3f3', 'transparent'], opacity: 0.5 },
      },
      xaxis: config.xaxisCategories
        ? {
            categories: config.xaxisCategories,
            labels: { rotate: -45, trim: false },
          }
        : {
            type: 'datetime',
            labels: {
              rotate: -45,
              datetimeFormatter: {
                year: 'yyyy',
                month: "MMM 'yy",
                day: 'dd MMM',
                hour: 'HH:mm',
                minute: 'HH:mm',
              },
              datetimeUTC: false,
              trim: false,
            },
          },
      plotOptions: {},
    };
    if (config.type === 'bar' && config.horizontal) {
      defaultOptions.plotOptions = {
        bar: { horizontal: true },
      };
    }
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
