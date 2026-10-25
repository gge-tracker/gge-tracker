import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { Component, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { LayeredSceneComponent } from '@ggetracker-components/layered-scene/layered-scene.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiLiveRanking,
  ApiLiveRankingResponse,
  IOuterRealmEvent,
  LiveRankingExportFormat,
  LiveRankingFilters,
  LiveRankingMovement,
  LiveRankingSortField,
  PlayerLiveRankingExtended,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { formatThousands } from '@ggetracker-services/text-format.utilities';
import { ServerService } from '@ggetracker-services/server.service';
import { NgLabelTemplateDirective, NgOptionTemplateDirective, NgSelectComponent } from '@ng-select/ng-select';
import { TranslateModule } from '@ngx-translate/core';
import { ApexAxisChartSeries, ApexChart, ApexNonAxisChartSeries, ApexOptions, ApexPlotOptions } from 'ng-apexcharts';
import { LiveOuterRealmsStatisticsModalComponent } from './live-outer-realms-statistics-modal/live-outer-realms-statistics-modal.component';
import Modal from 'bootstrap/js/dist/modal';

type TableHeader = [string, string, string?, boolean?];

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

@Component({
  selector: 'app-live-outer-realms',
  standalone: true,
  imports: [
    NgClass,
    SearchFormComponent,
    TranslateModule,
    TableComponent,
    FormatNumberPipe,
    RouterModule,
    LiveOuterRealmsStatisticsModalComponent,
    LayeredSceneComponent,
    DatePipe,
    DecimalPipe,
    FormsModule,
    ModalFormGroupComponent,
    NgSelectComponent,
    NgLabelTemplateDirective,
    NgOptionTemplateDirective,
  ],
  templateUrl: './live-outer-realms.component.html',
  styleUrls: ['./live-outer-realms.component.css'],
})
export class LiveOuterRealmsComponent extends GenericComponent {
  private static readonly ASCENDING_BY_DEFAULT = new Set<LiveRankingSortField>(['rank', 'player_name', 'distance']);
  public players: ApiLiveRanking[] = [];
  public eventNotActive = false;
  public charts: Record<string, any> = {};
  public currentEvent: IOuterRealmEvent | null = null;
  public player: PlayerLiveRankingExtended | null = null;
  public isDataLoading = false;
  public requestCounter = 0;
  public viewType: 'all' | 'player' = 'all';
  public pagination = {
    current_page: 1,
    total_pages: 1,
    current_items_count: 0,
    total_items_count: 0,
  };
  public search: string = '';
  @ViewChild('searchForm') public searchForm?: SearchFormComponent;
  public formFilters = {
    server: '',
    minLevel: '',
    maxLevel: '',
    minMight: '',
    maxMight: '',
    minScore: '',
    maxScore: '',
    minRank: '',
    maxRank: '',
    movement: '-1',
    activity: '-1',
    near: '',
    radius: '',
    isFiltered: false,
  };
  public selectedServers: string[] = [];
  public tableHeaders: TableHeader[] = LiveOuterRealmsComponent.headersFor(false);
  public sort: LiveRankingSortField = 'rank';
  public reverse = false;
  public readonly exportFormats: LiveRankingExportFormat[] = ['csv', 'json', 'ndjson'];
  public readonly sortOptions: { value: LiveRankingSortField; label: string }[] = [
    { value: 'rank', label: 'Classement' },
    { value: 'score', label: 'Score' },
    { value: 'score_diff', label: 'outer-realms-sort-score-gain' },
    { value: 'rank_diff', label: 'outer-realms-sort-rank-gain' },
    { value: 'might', label: 'Puissance' },
    { value: 'level', label: 'Niveau' },
    { value: 'player_name', label: 'Pseudonyme' },
    { value: 'distance', label: 'Distance' },
  ];
  public readonly movementOptions: { value: LiveRankingMovement | '-1'; label: string }[] = [
    { value: '-1', label: 'Tous' },
    { value: 'up', label: 'outer-realms-movement-up' },
    { value: 'down', label: 'outer-realms-movement-down' },
    { value: 'steady', label: 'outer-realms-movement-steady' },
  ];
  public servers: string[] = [];
  public eventRules: ApiLiveRankingResponse['event_rules'] = null;
  public collectedAt: string | null = null;
  public previousCollectedAt: string | null = null;
  public participants = 0;
  public serverService = inject(ServerService);
  private filters: LiveRankingFilters = {};
  private refreshTimer: any = null;

  constructor() {
    super();
    this.isInLoading = true;
    this.route.paramMap.subscribe((parameters) => {
      const playerId = parameters.get('playerId');
      if (playerId) {
        void this.initSpecificView(playerId);
      } else {
        void this.initDefaultView();
      }
    });
  }

  private static headersFor(withDistance: boolean): TableHeader[] {
    const headers: TableHeader[] = [
      ['player_name', 'Pseudonyme', ''],
      ['server', 'Serveur', '', true],
      ['level', 'Niveau', '/assets/lvl.png'],
      ['might', 'Puissance', '/assets/pp1.png'],
      ['score', 'Score', ''],
    ];
    if (withDistance) headers.push(['distance', 'Distance', '']);
    headers.push(['actions', 'Actions', '', true]);
    return headers;
  }

  public get chartsArray(): string[] {
    return Object.keys(this.charts);
  }

  public get readingGapMinutes(): number {
    if (!this.collectedAt || !this.previousCollectedAt) return 0;
    return Math.max(1, Math.round((Date.parse(this.collectedAt) - Date.parse(this.previousCollectedAt)) / 60_000));
  }

  public get isAscending(): boolean {
    return LiveOuterRealmsComponent.ASCENDING_BY_DEFAULT.has(this.sort) !== this.reverse;
  }

  public get availableSortOptions(): { value: LiveRankingSortField; label: string }[] {
    return this.sortOptions.filter((option) => option.value !== 'distance' || this.parseNear(this.formFilters.near));
  }

  public exportUrl(format: LiveRankingExportFormat): string {
    return this.apiRestService.getLiveRankingOuterRealmsExportUrl(format, this.requestFilters());
  }

  public openExportModal(): void {
    const modal = document.querySelector('#exportModal');
    if (modal) Modal.getOrCreateInstance(modal).show();
  }

  public async copyExportUrl(): Promise<void> {
    await globalThis.navigator.clipboard.writeText(this.exportUrl('json'));
    this.toastService.add(this.translateService.instant('Lien copié'), 3000);
  }

  public applyFilters(): void {
    const { minLevel, maxLevel, minMight, maxMight, minScore, maxScore, minRank, maxRank, movement, activity, radius } =
      this.formFilters;
    const near = this.parseNear(this.formFilters.near);
    if (!near) this.formFilters.radius = '';
    if (!near && this.sort === 'distance') this.sort = 'rank';
    this.formFilters.server = this.selectedServers.join(',');
    this.filters = {
      servers: this.selectedServers.length > 0 ? [...this.selectedServers] : undefined,
      minLevel: this.parseLevel(minLevel),
      maxLevel: this.parseLevel(maxLevel),
      minMight: this.parseAmount(minMight),
      maxMight: this.parseAmount(maxMight),
      minScore: this.parseAmount(minScore),
      maxScore: this.parseAmount(maxScore),
      minRank: this.parseAmount(minRank),
      maxRank: this.parseAmount(maxRank),
      movement: movement === '-1' ? undefined : (movement as LiveRankingMovement),
      activeOnly: activity === '1' || undefined,
      near: near ? { ...near, radius: this.parseAmount(radius) } : undefined,
    };
    this.formFilters.isFiltered = Object.values(this.filters).some((value) => value !== undefined);
    this.tableHeaders = LiveOuterRealmsComponent.headersFor(near !== null);
    void this.loadData(1).then(() => this.searchForm?.updateNbFilterActivated());
  }

  public resetFilters(): void {
    this.selectedServers = [];
    this.formFilters = {
      server: '',
      minLevel: '',
      maxLevel: '',
      minMight: '',
      maxMight: '',
      minScore: '',
      maxScore: '',
      minRank: '',
      maxRank: '',
      movement: '-1',
      activity: '-1',
      near: '',
      radius: '',
      isFiltered: false,
    };
    this.sort = 'rank';
    this.reverse = false;
    this.applyFilters();
  }

  public showNearby(player: ApiLiveRanking): void {
    const [x, y] = player.castle_position;
    if (x === null || y === null) return;
    this.formFilters.near = `${x},${y}`;
    this.sort = 'distance';
    this.reverse = false;
    this.applyFilters();
  }

  public sortTable(field: string): void {
    const sortField = this.sortOptions.find((option) => option.value === field)?.value;
    if (!sortField || this.isDataLoading) return;
    if (this.sort === sortField) {
      this.reverse = !this.reverse;
    } else {
      this.sort = sortField;
      this.reverse = false;
    }
    void this.loadData(1);
  }

  public peaceLabel(minutes: number): string {
    return minutes >= 60
      ? `${Math.round(minutes / 60)} ${this.translateService.instant('heures_h')}`
      : `${minutes} min`;
  }

  public async initSpecificView(playerId: string): Promise<void> {
    this.viewType = 'player';
    this.search = playerId;
    const response = await this.apiRestService.getLiveRankingOuterRealmsSpecificPlayer(Number(this.search));
    if (!response.success) {
      this.toastService.add('Unable to display outer realms ranking for the specified player');
      this.isInLoading = false;
      return;
    }
    this.player = {
      ...response.data.player,
      level: response.data.player.data[0]?.level || 0,
      legendary_level: response.data.player.data[0]?.legendary_level || 0,
    };
    const scoreSeries = [
      {
        name: this.translateService.instant('Score'),
        data: response.data.player.data.map((entry) => [new Date(entry.timestamp).getTime(), entry.score]),
      },
    ];
    this.initGenericChartOption(
      'player-score-chart',
      {
        type: 'area',
        series: scoreSeries,
        colors: ['#008FFB'],
        title: this.translateService.instant('score_over_time'),
      },
      { logarithmic: true },
    );
    const rankSeries = [
      {
        name: this.translateService.instant('Classement'),
        data: response.data.player.data.map((entry) => [new Date(entry.timestamp).getTime(), entry.rank]),
      },
    ];
    this.initGenericChartOption(
      'player-rank-chart',
      {
        type: 'line',
        series: rankSeries,
        colors: ['#00E396'],
        title: this.translateService.instant('rank_over_time'),
      },
      { logarithmic: true, reversed: true, minValue: 1 },
    );
    const levelSeries = [
      {
        name: this.translateService.instant('Niveau'),
        data: response.data.player.data.map((entry) => [
          new Date(entry.timestamp).getTime(),
          entry.level + entry.legendary_level,
        ]),
      },
    ];
    this.initGenericChartOption(
      'player-level-chart',
      {
        type: 'area',
        series: levelSeries,
        colors: ['#FEB019'],
        title: this.translateService.instant('level_over_time'),
      },
      {
        logarithmic: false,
        tooltipYFormatter: this.formatLegendaryLevel,
      },
    );
    this.charts['player-level-chart'].yaxis.labels.formatter = (value: number): string =>
      this.formatLegendaryLevel(value);

    this.isInLoading = false;
  }

  public async goBack(): Promise<void> {
    await this.router.navigate(['live', 'outer-realms']);
  }

  public async initDefaultView(): Promise<void> {
    await this.loadData(1);
    this.isInLoading = false;
  }

  public async loadData(page: number): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.requestCounter++;
    this.isDataLoading = true;
    const filters = this.requestFilters();
    const response = await this.apiRestService.getLiveRankingOuterRealms(page, filters);
    if (!response.success) {
      this.isInLoading = false;
      this.isDataLoading = false;
      if (this.requestCounter === 1) {
        this.eventNotActive = true;
      } else {
        this.toastService.add('Unable to display outer realms ranking');
      }
      return;
    }
    this.players = response.data.players;
    this.pagination = response.data.pagination;
    this.currentEvent = response.data.current_event;
    this.eventRules = response.data.event_rules;
    this.collectedAt = response.data.collected_at;
    this.previousCollectedAt = response.data.previous_collected_at;
    this.servers = response.data.servers;
    if (!filters.playerName && !this.formFilters.isFiltered) {
      this.participants = response.data.pagination.total_items_count;
    }
    this.isDataLoading = false;
    this.refreshTimer = setTimeout(() => {
      void this.loadData(page);
    }, 60_000);
  }

  public searchPlayer(playerName: string): Promise<void> {
    this.search = playerName;
    return this.loadData(1);
  }

  public navigateTo(page: number): void {
    void this.loadData(page);
  }

  public previousPage(): void {
    if (this.pagination.current_page > 1) void this.loadData(this.pagination.current_page - 1);
  }

  public nextPage(): void {
    if (this.pagination.current_page < this.pagination.total_pages) {
      void this.loadData(this.pagination.current_page + 1);
    }
  }

  private requestFilters(): LiveRankingFilters {
    const playerName = this.search.trim();
    const isDefaultSort = this.sort === 'rank' && !this.reverse;
    return {
      ...this.filters,
      playerName: playerName === '' ? undefined : playerName,
      orderBy: isDefaultSort ? undefined : this.sort,
      orderDir: isDefaultSort ? undefined : this.isAscending ? 'asc' : 'desc',
    };
  }

  private parseAmount(text: string): number | undefined {
    const match = /^\s*(\d+(?:[,.]\d+)?)\s*([bkm])?\s*$/i.exec(text);
    if (!match) return undefined;
    const multipliers: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
    const value = Number(match[1].replace(',', '.')) * (match[2] ? multipliers[match[2].toLowerCase()] : 1);
    return Math.round(value);
  }

  private parseNear(text: string): { x: number; y: number } | null {
    const match = /^\s*(\d{1,4})\s*[\s,/:;]\s*(\d{1,4})\s*$/.exec(text);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  }

  private parseLevel(text: string): number | undefined {
    const match = /^\s*(\d{1,3})\s*(?:\/\s*(\d{1,4}))?\s*$/.exec(text);
    if (!match) return undefined;
    return Number(match[1]) + Number(match[2] ?? 0);
  }

  private formatLegendaryLevel(level: number): string {
    const legendaryLevel = level - 70;
    return legendaryLevel > 0 ? '70/' + legendaryLevel : String(level);
  }

  private initGenericChartOption(
    name: string,
    config: GenericChartConfig,
    options: {
      height?: number;
      logarithmic?: boolean;
      tooltipYFormatter?: (value: number) => string;
      reversed?: boolean;
      minValue?: number;
    },
  ): void {
    const { height, logarithmic, tooltipYFormatter, reversed, minValue } = options;
    const dateFormat = this.translateService.instant('Date_4');
    const defaultOptions: ApexOptions = {
      series: config.series,
      chart: {
        type: config.type,
        height: height || 450,
        background: 'transparent',
        animations: {
          enabled: true,
          speed: 350,
        },
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.langageService.getCurrentLang(),
        toolbar: {
          show: true,
          tools: {
            download: true,
            selection: true,
            zoom: true,
            zoomin: true,
            zoomout: true,
            pan: true,
          },
          offsetY: -4,
        },
        zoom: {
          enabled: true,
          type: 'x',
          autoScaleYaxis: true,
        },
        stacked: false,
      },
      title: {
        text: config.title ?? '',
        align: 'left',
        style: {
          color: 'rgba(255,255,255,0.85)',
          fontSize: '16px',
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif',
        },
      },
      colors: config.colors!.map((c) => c + 'E6'),
      tooltip: {
        shared: false,
        followCursor: true,
        theme: 'dark',
        style: {
          fontSize: '13px',
          fontFamily: 'Inter, sans-serif',
        },
        fillSeriesColor: false,
        x: { format: dateFormat },
        y: {
          formatter:
            tooltipYFormatter ||
            ((value: number): string => (value === null ? '?' : formatThousands(value.toString()))),
        },
      },
      dataLabels: {
        enabled: false,
      },
      legend: {
        show: true,
        floating: true,
        position: 'top',
        horizontalAlign: 'right',
        offsetY: -8,
        markers: {
          strokeWidth: 0,
        },
        labels: {
          colors: 'rgba(255,255,255,0.7)',
        },
        fontSize: '13px',
      },
      yaxis: {
        reversed: reversed || false,
        min: minValue,
        labels: {
          style: { colors: 'rgba(255,255,255,0.65)' },
          formatter: (value: number) => (value === null ? '?' : formatThousands(value.toString())),
        },
        logarithmic: logarithmic || false,
        forceNiceScale: true,
      },
      xaxis: config.xaxisCategories
        ? {
            categories: config.xaxisCategories,
            labels: {
              rotate: -45,
              trim: false,
              style: {
                colors: 'rgba(255,255,255,0.65)',
              },
            },
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
              style: {
                colors: 'rgba(255,255,255,0.65)',
              },
            },
          },
      grid: {
        borderColor: 'rgba(255,255,255,0.05)',
        strokeDashArray: 4,
        position: 'back',
        padding: {
          top: 8,
          right: 10,
          left: 10,
          bottom: 0,
        },
        row: {
          colors: ['rgba(255,255,255,0.02)', 'transparent'],
          opacity: 0.5,
        },
      },
      stroke: {
        width: (Array.from({ length: config.series.length }).fill(2) as number[]) || 2,
        curve: 'smooth',
        lineCap: 'round',
      },

      fill: {
        type: ['gradient', 'gradient', 'solid'],
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0.45,
          gradientToColors: config.colors!.map((c) => c + 'aa'),
          opacityFrom: 0.92,
          opacityTo: 0.25,
          stops: [0, 70, 100],
        },
      },

      markers: {},
      plotOptions: {
        area: {
          fillTo: 'origin',
        },
      },
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
    this.charts[name].chart.zoom!.allowMouseWheelZoom = false;
  }
}
