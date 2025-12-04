import { NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { ApiLiveRanking, ChartAdvancedOptions, PlayerLiveRankingExtended } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';
import { ApexAxisChartSeries, ApexChart, ApexNonAxisChartSeries, ApexOptions, ApexPlotOptions } from 'ng-apexcharts';
import { LiveOuterRealmsStatisticsModalComponent } from './live-outer-realms-statistics-modal/live-outer-realms-statistics-modal.component';

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
    NgFor,
    NgIf,
    FormatNumberPipe,
    RouterModule,
    NgFor,
    LiveOuterRealmsStatisticsModalComponent,
  ],
  templateUrl: './live-outer-realms.component.html',
  styleUrls: ['./live-outer-realms.component.css'],
})
export class LiveOuterRealmsComponent extends GenericComponent {
  public players: ApiLiveRanking[] = [];
  public charts: Record<string, ChartAdvancedOptions | any> = {};
  public player: PlayerLiveRankingExtended | null = null;
  public isDataLoading = false;
  public viewType: 'all' | 'player' = 'all';
  public pagination = {
    current_page: 1,
    total_pages: 1,
    current_items_count: 0,
    total_items_count: 0,
  };
  public search: string = '';
  public serverService = inject(ServerService);

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

  public get chartsArray(): string[] {
    return Object.keys(this.charts);
  }

  public async initSpecificView(playerId: string): Promise<void> {
    this.viewType = 'player';
    this.search = playerId;
    const response = await this.apiRestService.getLiveRankingOuterRealmsSpecificPlayer(Number(this.search));
    if (!response.success) {
      this.toastService.add('Unable to display outer realms ranking for the specified player');
      return;
    }
    this.player = Object.assign({}, response.data.player, {
      level: response.data.player.data[0]?.level || 0,
      legendary_level: response.data.player.data[0]?.legendary_level || 0,
    });
    const scoreSeries = [
      {
        name: this.translateService.instant('Score'),
        data: response.data.player.data.map((entry) => [new Date(entry.timestamp).getTime(), entry.score]),
      },
    ];
    this.initGenericChartOption(
      'player-score-chart',
      {
        type: 'line',
        series: scoreSeries,
        colors: ['#008FFB'],
        title: this.translateService.instant('Score_Over_Time'),
      },
      { logarithmic: true },
    );
    const rankSeries = [
      {
        name: this.translateService.instant('Rank'),
        data: response.data.player.data.map((entry) => [new Date(entry.timestamp).getTime(), entry.rank]),
      },
    ];
    this.initGenericChartOption(
      'player-rank-chart',
      {
        type: 'line',
        series: rankSeries,
        colors: ['#00E396'],
        title: this.translateService.instant('Rank_Over_Time'),
      },
      { logarithmic: true, reversed: true, minValue: 1 },
    );
    const levelSeries = [
      {
        name: this.translateService.instant('Level'),
        data: response.data.player.data.map((entry) => [
          new Date(entry.timestamp).getTime(),
          entry.level + entry.legendary_level,
        ]),
      },
    ];
    this.initGenericChartOption(
      'player-level-chart',
      {
        type: 'line',
        series: levelSeries,
        colors: ['#FEB019'],
        title: this.translateService.instant('Level_Over_Time'),
      },
      {
        logarithmic: false,
        tooltipYFormatter: this.formatLegendaryLevel,
      },
    );

    this.isInLoading = false;
  }

  public async goBack(): Promise<void> {
    await this.router.navigate(['live', 'outer-realms']);
  }

  public async initDefaultView(): Promise<void> {
    this.search = '';
    this.viewType = 'all';
    const response = await this.apiRestService.getLiveRankingOuterRealms(1);
    if (!response.success) {
      this.toastService.add('Unable to display outer realms ranking');
      return;
    }
    this.isInLoading = false;
    this.players = response.data.players;
    this.pagination = response.data.pagination;
  }

  public loadData(page: number, playerName?: string): Promise<void> {
    return new Promise<void>(async (resolve) => {
      this.isDataLoading = true;
      const response = await this.apiRestService.getLiveRankingOuterRealms(page, playerName);
      if (!response.success) {
        this.toastService.add('Unable to display outer realms ranking');
        this.isDataLoading = false;
        resolve();
        return;
      }
      this.players = response.data.players;
      this.pagination = response.data.pagination;
      this.isDataLoading = false;
      resolve();
    });
  }

  public searchPlayer(playerName: string, page: number = 1): Promise<void> {
    this.search = playerName;
    return this.loadData(page, playerName);
  }

  public navigateTo(page: number): void {
    if (this.search.trim() !== '') {
      void this.searchPlayer(this.search, page);
      return;
    }
    void this.loadData(page, this.search.trim() === '' ? undefined : this.search);
  }

  public previousPage(): void {
    if (this.pagination.current_page > 1) {
      if (this.search.trim() !== '') {
        void this.searchPlayer(this.search, this.pagination.current_page - 1);
        return;
      }
      void this.loadData(this.pagination.current_page - 1, this.search.trim() === '' ? undefined : this.search);
    }
  }

  public nextPage(): void {
    if (this.pagination.current_page < this.pagination.total_pages) {
      if (this.search.trim() !== '') {
        void this.searchPlayer(this.search, this.pagination.current_page + 1);
        return;
      }
      void this.loadData(this.pagination.current_page + 1, this.search.trim() === '' ? undefined : this.search);
    }
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
          easing: 'easeinout',
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
            ((value: number): string =>
              value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',')),
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
          width: 10,
          height: 10,
          strokeWidth: 0,
          radius: 12,
        },
        labels: {
          colors: 'rgba(255,255,255,0.7)',
        },
        fontSize: '13px',
      },
      yaxis: {
        reversed: reversed || false,
        min: minValue === undefined ? undefined : minValue,
        labels: {
          style: { colors: 'rgba(255,255,255,0.65)' },
          formatter: (value: number) =>
            value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ','),
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

      markers: {
        size: 3,
        strokeWidth: 1.5,
        strokeOpacity: 0.9,
        strokeColors: '#181a1f',
        colors: config.colors!.map((c) => c + 'dd'),
        hover: { size: 5 },
      },
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
