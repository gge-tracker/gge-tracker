import { DatePipe, NgClass, NgForOf, NgIf, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import {
  AlliancesUpdates,
  ApiGenericData,
  ApiPlayerStatsByPlayerId,
  ApiPlayerStatsType,
  ApiRankingStatsPlayer,
  ApiResponse,
  CastleQuantity,
  CastleType,
  ChartOptions,
  ErrorType,
  EventGenericVariation,
  Monument,
  PlayersUpdates,
  Top3EventPlayers,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LevelPipe } from '@ggetracker-pipes/level.pipe';
import { LanguageService } from '@ggetracker-services/language.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { TranslateModule } from '@ngx-translate/core';
import Gradient from 'javascript-color-gradient';
import { ApexAxisChartSeries } from 'ng-apexcharts';
import { PlayerStatsCardComponent } from './player-stats-card/player-stats-card.component';

export interface IRankingStatsPlayer {
  playerId: number;
  server: string;
  mightCurrent: number;
  mightAllTime: number;
  currentFame: number;
  highestFame: number;
  peaceDisabledAt: Date | null;
  lootCurrent: number;
  lootAllTime: number;
  level: number;
  legendaryLevel: number;
  honor: number;
  maxHonor: number;
  serverRank: number;
  globalRank: number;
  totalLevel: number;
  castles: number[][];
  totalCastles: number;
}

type Tabs = 'overview' | 'loot' | 'alliances' | 'castles';

@Component({
  selector: 'app-player-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgIf,
    NgClass,
    RouterLink,
    PlayerStatsCardComponent,
    NgForOf,
    DatePipe,
    TranslateModule,
    FormatNumberPipe,
    LevelPipe,
    FormsModule,
    NgTemplateOutlet,
  ],
  templateUrl: './player-stats.component.html',
  styleUrl: './player-stats.component.css',
})
export class PlayerStatsComponent extends GenericComponent implements OnInit {
  public charts: Record<string, ChartOptions> = {};
  public radialCharts: Record<string, ChartOptions> = {};
  public eventDataSegments: Record<string, ApiGenericData[][]> = {};
  public playerId?: number;
  public playerName?: string;
  public allianceName?: string;
  public allianceId?: number;
  public favories: Record<number, string> = {};
  public activeOptionButton = '';
  public currentSemaine?: string;
  public data: Record<ApiPlayerStatsType, EventGenericVariation[]> = {
    player_event_berimond_invasion_history: [],
    player_event_berimond_kingdom_history: [],
    player_event_bloodcrow_history: [],
    player_event_nomad_history: [],
    player_event_samurai_history: [],
    player_event_war_realms_history: [],
    player_loot_history: [],
    player_might_history: [],
  };
  public allianceUpdates: AlliancesUpdates[] | null = [];
  public playerUpdates: PlayersUpdates[] | null = [];
  public top3Events: Top3EventPlayers | null = null;
  public events: number[] = [];
  public spinnerLoadingByChart: Record<string, boolean> = {};
  public stats: IRankingStatsPlayer | null = null;
  public animatedStats: Partial<Record<keyof IRankingStatsPlayer, number>> = {};
  public quantity: CastleQuantity = {
    castle: 0,
    outpost: 0,
    monument: 0,
    laboratory: 0,
    capital: 0,
    royalTower: 0,
    city: 0,
    patriarch: 0,
  };
  public monumentsList: Monument[] = [];
  public pageSize = 10;
  public currentPage = 1;
  public totalPages = 1;
  public searchTerm = '';
  public sortColumn: keyof Monument | null = null;
  public sortAsc = true;
  public tabs: { key: Tabs; label: string; assetIcon?: string }[] = [
    { key: 'overview', label: "Vue d'ensemble", assetIcon: 'players.png' },
    { key: 'loot', label: 'Points de pillage hebdomadaire', assetIcon: 'loot.png' },
    { key: 'alliances', label: 'Alliances', assetIcon: 'alliance.png' },
    { key: 'castles', label: 'Châteaux', assetIcon: 'tools/castles.webp' },
  ];
  public currentTab: Tabs = 'overview';
  public maxLootPointsByWeek: { week: string; points: number }[] = [];

  private animationFrames: Partial<Record<keyof IRankingStatsPlayer, number>> = {};
  private localStorage = inject(LocalStorageService);
  private languageService = inject(LanguageService);
  private cdr = inject(ChangeDetectorRef);
  private worlds = [
    { name: 'Le Grand Empire', id: 0 },
    { name: 'Le Glacier éternel', id: 2 },
    { name: 'Les Sables brûlants', id: 1 },
    { name: 'Les Pics du feu', id: 3 },
    { name: 'Les Îles orageuses', id: 4 },
  ];

  constructor() {
    super();
    this.favories = {};
    const favories = this.localStorage.getItem('favories');
    if (favories) {
      this.favories = JSON.parse(favories);
    }
  }

  public get peaceDisabledAtInDays(): number | null {
    if (this.stats && this.stats.peaceDisabledAt) {
      const now = new Date();
      const diff = this.stats.peaceDisabledAt.getTime() - now.getTime();
      return Math.ceil(diff / (1000 * 60 * 60 * 24));
    }
    return null;
  }

  public async ngOnInit(): Promise<void> {
    this.route.params.subscribe(async (parameters) => {
      this.isInLoading = true;
      this.cdr.detectChanges();
      const playerId = parameters['playerId'];
      if (playerId && !Number.isNaN(playerId) && playerId > 0) {
        try {
          const response: ApiResponse<ApiPlayerStatsByPlayerId> = this.route.snapshot.data['stats'];
          if (response.success === false) throw new Error('API Error');
          const data = response.data;
          this.playerName = data.player_name;
          this.addStructuredPlayerData({
            name: this.playerName,
            url: `gge-tracker.com/player/${playerId}`,
            alliance: data.alliance_name,
            might:
              data.points.player_might_history.length > 0 && data.points.player_might_history.at(-1)
                ? data.points.player_might_history.at(-1)!.point
                : 0,
          });
          if (!data.points || Object.keys(data.points).length === 0) {
            this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
            void this.router.navigate(['/']);
            return;
          }
          const formatLocal = (iso: string): string => {
            const d = new Date(iso);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
              2,
              '0',
            )}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(
              2,
              '0',
            )}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
          };
          this.data = Object.fromEntries(
            Object.entries(data.points).map(([key, value]) => [
              key,
              value.map((point) => ({
                date: formatLocal(point.date),
                point: point.point,
                variation: 0,
              })),
            ]),
          ) as Record<ApiPlayerStatsType, EventGenericVariation[]>;
          this.allianceName = data.alliance_name;
          this.allianceId = data.alliance_id;
          this.playerId = playerId;
          this.fillData();
          void this.initPlayerData(playerId).then(() => {
            this.isInLoading = false;
            this.cdr.detectChanges();
          });
        } catch {
          this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
          void this.router.navigate(['/']);
        }
      } else {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
        void this.router.navigate(['/']);
      }
    });
  }

  public getScoreboardFromEvent(eventId: number): number | null {
    if (this.top3Events === null) {
      return null;
    }
    return this.top3Events[eventId] ? Object.keys(this.top3Events[eventId]).length : null;
  }

  /**
   * This function returns the name of the event based on the event ID.
   * It is used to display the name of the event in the UI.
   * This method must return the i18n key for the event name (by default in French).
   * @param eventId The ID of the event.
   * @returns The event name as a key for i18n.
   */
  public getEventName(eventId: number): string {
    switch (eventId) {
      case 44: {
        return 'Guerre des royaumes';
      }
      case 51: {
        return 'Samouraïs';
      }
      case 46: {
        return 'Nomades';
      }
      case 30: {
        return 'Royaume de Berimond';
      }
      case 58: {
        return 'Corbeaux de sang';
      }
      default: {
        return 'Invasion de Berimond';
      }
    }
  }

  public changePage(delta: number): void {
    this.currentPage = Math.min(this.totalPages, Math.max(1, this.currentPage + delta));
  }

  public onSearchChange(): void {
    this.currentPage = 1;
  }

  public get paginatedMonuments(): Monument[] {
    let filtered = this.monumentsList;
    if (this.searchTerm.trim()) {
      const lower = this.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.type.toLowerCase().includes(lower) ||
          m.position.toLowerCase().includes(lower) ||
          m.kingdom?.toString().includes(lower) ||
          m.owner.toLowerCase().includes(lower),
      );
    }
    const sortColum = this.sortColumn;
    if (sortColum) {
      filtered = [...filtered].sort((a, b) => {
        const aValue = a[sortColum] ?? '';
        const bValue = b[sortColum] ?? '';
        return (
          ('' + aValue).localeCompare('' + bValue, undefined, {
            sensitivity: 'base',
          }) * (this.sortAsc ? 1 : -1)
        );
      });
    }

    this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize;
    return filtered.slice(start, start + this.pageSize);
  }

  public sortBy(column: keyof Monument): void {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }
  }

  public getRealmName(realmName?: number): string {
    if (realmName === undefined) return 'Unknown';
    return this.worlds.find((w) => w.id === realmName)?.name || 'Unknown';
  }

  public isInFavorites(): boolean {
    if (this.playerId === undefined) {
      return false;
    }
    const favoriesString = this.localStorage.getItem('favories');
    let favoriteIds: string[] = favoriesString ? JSON.parse(favoriesString) : [];
    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }
    return favoriteIds.includes(this.playerId.toString());
  }

  public removePlayerFromFavorites(): void {
    const favoriesString = this.localStorage.getItem('favories');
    let favoriteIds: string[] = favoriesString ? JSON.parse(favoriesString) : [];
    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }
    const playerIdNumber = Number(this.playerId);
    favoriteIds = favoriteIds.filter((id) => id !== playerIdNumber.toString());
    this.localStorage.setItem('favories', JSON.stringify(favoriteIds));
    this.cdr.detectChanges();
  }

  public compareDate<T extends { date: string }>(a: T, b: T): number {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  }

  public getDateDiff(date1: string, date2: string): string {
    const diff = new Date(date2).getTime() - new Date(date1).getTime();
    const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
    const days = Math.floor((diff % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24));
    const hours = Math.round((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    let result = '';
    if (months > 0) {
      result += `${months} ${this.translateService.instant('mois' + (months > 1 ? 's' : ''))}`;
    }
    if (days > 0) {
      if (result) result += ', ';
      result += `${days} ${this.translateService.instant('jour' + (days > 1 ? 's' : ''))}`;
    }
    if (hours > 0) {
      if (result) result += ', ';
      result += `${hours} ${this.translateService.instant('heure' + (hours > 1 ? 's' : ''))}`;
    }

    return result || this.translateService.instant("moins d'une heure");
  }

  public addPlayerToFavorites(): void {
    const favoriesString = this.localStorage.getItem('favories');
    let favoriteIds: string[] = favoriesString ? JSON.parse(favoriesString) : [];

    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }

    const playerIdNumber = Number(this.playerId);
    if (!favoriteIds.includes(playerIdNumber.toString())) {
      favoriteIds.push(playerIdNumber.toString());
    }
    this.localStorage.setItem('favories', JSON.stringify(favoriteIds));
    this.cdr.detectChanges();
  }

  public updateData(event: { eventName: string; points: ApiGenericData[] }): void {
    this.data[event.eventName as ApiPlayerStatsType] = event.points as EventGenericVariation[];
    if (event.eventName === 'player_might_history') {
      this.spinnerLoadingByChart['might'] = true;
      this.initMightHistoryData();
    }
  }

  private initRadialChartOption(name: string, data: number[], color: string[]): void {
    this.radialCharts[name] = {
      // @ts-expect-error: ApexAxisChartSeries expects an array of objects with name and data properties
      series: data,
      colors: color,
      chart: {
        type: 'radialBar',
        height: 350,
      },
      plotOptions: {
        radialBar: {
          dataLabels: {
            name: {
              fontSize: '22px',
              color: undefined,
              offsetY: 120,
            },
            value: {
              fontSize: '16px',
              color: undefined,
              offsetY: 76,
              formatter: function (value): string {
                return value + '%';
              },
            },
          },
        },
      },
      xaxis: {},
      yaxis: {},
      fill: {},
      stroke: {},
      dataLabels: {},
      grid: {},
      legend: {},
      title: {},
      tooltip: {},
    };
  }

  private formatHourlyCategoriesIntl(lang: string): string[] {
    const formatter = new Intl.DateTimeFormat(lang, {
      hour: 'numeric',
      hour12: undefined,
    });

    return Array.from({ length: 24 }, (_, index) => {
      const date = new Date(2020, 0, 1, index);
      return formatter.format(date);
    });
  }

  private initHeatmapChartOption(name: string, data: ApexAxisChartSeries, color: string[]): void {
    this.charts[name] = {
      series: data,
      chart: {
        height: 650,
        type: 'heatmap',
      },
      dataLabels: {
        enabled: false,
      },
      colors: color,
      xaxis: {
        type: 'category',
        categories: [],
      },
      title: {},
      grid: {
        padding: {
          right: 20,
        },
      },
      yaxis: {},
      fill: {},
      stroke: {},
      tooltip: {
        y: {
          formatter: function (value): string {
            if (value === null) return '?';
            if (value > 0) return value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
            return '0';
          },
        },
      },
      legend: {},
      plotOptions: {
        heatmap: {
          colorScale: {
            ranges: [
              { from: 0, to: 0, color: '#4e4e4e', name: '0' },
              { from: 1, to: 1_000_000, color: '#FFF3E0', name: '0 - 1M' },
              { from: 1_000_001, to: 10_000_000, color: '#FFE0B2', name: '1M - 10M' },
              { from: 10_000_001, to: 50_000_000, color: '#FFCC80', name: '10M - 50M' },
              { from: 50_000_001, to: 100_000_000, color: '#FFB74D', name: '50M - 100M' },
              { from: 100_000_001, to: 250_000_000, color: '#FFA726', name: '100M - 250M' },
              { from: 250_000_001, to: 500_000_000, color: '#FF9800', name: '250M - 500M' },
              { from: 500_000_001, to: 1_000_000_000, color: '#FB8C00', name: '500M - 1Md' },
              { from: 1_000_000_001, to: 2_000_000_000, color: '#F57C00', name: '1Md - 2Md' },
              { from: 2_000_000_001, to: 3_000_000_000, color: '#EF6C00', name: '2Md - 3Md' },
              { from: 3_000_000_001, to: 4_000_000_000, color: '#E65100', name: '3Md - 4Md' },
              { from: 4_000_000_001, to: Number.MAX_SAFE_INTEGER, color: '#BF360C', name: '> 4Md' },
            ],
          },
        },
      },
    };
    this.spinnerLoadingByChart[name] = false;
  }

  private initAverageGainChart(name: string, data: ApexAxisChartSeries): void {
    const lang = this.languageService.getCurrentLang();
    this.charts[name] = {
      series: data,
      chart: {
        type: 'area',
        height: 250,
        zoom: {},
      },
      stroke: {
        curve: 'smooth',
        width: 3,
      },
      xaxis: {
        categories: this.formatHourlyCategoriesIntl(lang),
      },
      tooltip: {
        y: {
          formatter: (value): string => value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ','),
        },
      },
      colors: ['#EF6C00'],
      dataLabels: {
        enabled: false,
      },
      title: {},
      grid: {},
      fill: {},
      yaxis: {
        labels: {
          formatter: (value): string => value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ','),
        },
      },
      legend: {},
      plotOptions: {},
    };
    // @ts-expect-error: Property 'allowMouseWheelZoom' does not exist on type 'Zoom'
    this.charts[name].chart.zoom.allowMouseWheelZoom = false;
  }

  private initHourlyActivityChart(name: string, data: ApexAxisChartSeries): void {
    const lang = this.languageService.getCurrentLang();
    this.charts[name] = {
      series: data,
      chart: {
        type: 'bar',
        height: 250,
        zoom: {},
      },
      xaxis: {
        categories: this.formatHourlyCategoriesIntl(lang),
      },
      yaxis: {
        max: 100,
        labels: {
          formatter: (value): string => `${value}%`,
        },
      },
      tooltip: {
        y: {
          formatter: (value): string => `${value}%`,
        },
      },
      colors: ['#FB8C00'],
      dataLabels: {
        enabled: false,
      },
      title: {},
      grid: {},
      fill: {},
      stroke: {},
      legend: {},
      plotOptions: {},
    };
    // @ts-expect-error: Property 'allowMouseWheelZoom' does not exist on type 'Zoom'
    this.charts[name].chart.zoom.allowMouseWheelZoom = false;
  }

  private initChartOption(name: string, data: ApexAxisChartSeries, color: string[]): void {
    const dateFormat = this.translateService.instant('Date_4');
    this.charts[name] = {
      series: data,
      title: {},
      tooltip: {
        shared: true,
        x: {
          format: dateFormat,
        },
        y: {
          formatter: function (value): string {
            if (value === null) return '?';
            if (value > 0) return value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
            return '0';
          },
        },
      },
      chart: {
        animations: {
          enabled: false,
        },
        selection: {
          enabled: true,
        },
        height: 450,
        type: 'area',
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        zoom: {
          type: 'x',
          enabled: true,
          autoScaleYaxis: true,
        },
        stacked: false,
        stackType: undefined,
        toolbar: {},
      },
      colors: color,
      fill: {
        colors: undefined,
        opacity: 0.3,
        type: 'gradient',
        gradient: {
          type: 'vertical',
          gradientToColors: undefined,
          opacityFrom: 0.8,
          opacityTo: 0.7,
          colorStops: [],
        },
        pattern: {
          style: 'verticalLines',
          width: 6,
          height: 6,
          strokeWidth: 2,
        },
      },
      dataLabels: {
        enabled: false,
      },
      stroke: {
        width: [2, 2, 0],
        curve: 'smooth',
      },
      grid: {
        row: {
          colors: ['#f3f3f3', 'transparent'],
          opacity: 0.5,
        },
      },
      legend: {
        show: true,
        showForZeroSeries: true,
      },
      yaxis: {
        labels: {
          formatter: function (value): string {
            return value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
          },
        },
        min: 0,
        forceNiceScale: true,
      },
      plotOptions: {},
      xaxis: {
        type: 'datetime',
        labels: {
          show: true,
          rotate: -45,
          rotateAlways: false,
          hideOverlappingLabels: true,
          showDuplicates: true,
          datetimeFormatter: {
            year: 'yyyy',
            month: "MMM 'yy",
            day: 'dd MMM',
            hour: 'HH:mm',
            minute: 'HH:mm',
          },
          datetimeUTC: false,
          trim: false,
          minHeight: undefined,
          maxHeight: 120,
          style: {
            colors: [],
            fontSize: '12px',
            fontFamily: 'Helvetica, Arial, sans-serif',
            cssClass: 'apexcharts-xaxis-label',
          },
        },
      },
    };
    // @ts-expect-error: Property 'allowMouseWheelZoom' does not exist on type 'Zoom'
    this.charts[name].chart.zoom.allowMouseWheelZoom = false;
    this.spinnerLoadingByChart[name] = false;
  }

  private setGenericVariations(
    data: ApiGenericData[],
    key: keyof ApiGenericData = 'point',
    customConditionFunction?: (data: ApiGenericData[], index: number) => boolean,
  ): void {
    const dataWithVariation = data as EventGenericVariation[];
    for (let index = 0; index < data.length; index++) {
      if (index === 0 || customConditionFunction?.(data, index)) {
        dataWithVariation[index]['variation'] = 0;
      } else {
        dataWithVariation[index]['variation'] = Number(data[index][key]) - Number(data[index - 1][key]);
      }
    }
  }

  private normalizeSeriesByReferenceDate(
    seriesList: { name: string; data: [number, number][] }[],
    referenceDate: Date = new Date(Date.UTC(2023, 0, 1, 0, 0, 0)),
  ): { name: string; data: [number, number][] }[] {
    return seriesList.map((serie) => {
      if (serie.data.length === 0) return { ...serie, data: [] };
      const originalStart = Math.floor(serie.data[0][0] / 3_600_000) * 3_600_000;
      const alignedData = serie.data.map(([timestamp, value]) => {
        const alignedTimestamp = Math.floor(timestamp / 3_600_000) * 3_600_000;
        const offset = alignedTimestamp - originalStart;
        const alignedTimestampResult = referenceDate.getTime() + offset;
        return [alignedTimestampResult, value] as [number, number];
      });
      return {
        ...serie,
        data: alignedData,
      };
    });
  }

  private initWarRealmsData(): void {
    const warRealms = this.data['player_event_war_realms_history'];
    this.setGenericVariations(warRealms);
    const eventData = this.groupEventDataByTimeGaps(this.eventDataSegments['warRealms'], warRealms);
    const series = this.generateEventSeries(eventData);
    // @ts-expect-error: Property 'hidden' does not exist on type 'SeriesOptionsType'
    series.forEach((serie, index) => (serie['hidden'] = index !== series.length - 1));
    const colors = ['#d2b8f2', '#c4a1f0', '#ae81e6', '#945adb', '#7d37d4'];
    this.initChartOption('warRealms', series, colors);
  }

  private initNomadHistoryData(): void {
    const nomadPoints = this.data['player_event_nomad_history'];
    this.setGenericVariations(nomadPoints);
    const eventData = this.groupEventDataByTimeGaps(this.eventDataSegments['nomad'], nomadPoints);
    const series = this.generateEventSeries(eventData);
    // @ts-expect-error: Property 'hidden' does not exist on type 'SeriesOptionsType'
    series.forEach((serie, index) => (serie['hidden'] = index !== series.length - 1));
    const colors = new Gradient();
    colors.setColorGradient('#ffcc00', '#ff0000');
    this.initChartOption('nomad', series, colors.getColors());
  }

  private async initPlayerStats(): Promise<void> {
    if (!this.playerId) return;
    let stats = await this.apiRestService.getRankingStatsByPlayerId(this.playerId);
    if (stats.success === false) {
      stats = {
        data: {
          player_id: this.playerId,
          server: '',
          might_current: -1,
          might_all_time: -1,
          current_fame: -1,
          highest_fame: -1,
          peace_disabled_at: null,
          loot_current: -1,
          loot_all_time: -1,
          level: 0,
          legendary_level: -1,
          honor: -1,
          max_honor: -1,
          server_rank: -1,
          global_rank: -1,
          castles: [],
          castles_realm: [],
        },
        success: true,
      };
    }
    this.stats = this.mapStatsFromData(stats.data);
    this.fillQuantity();
    this.setMonuments();
    for (const key of Object.keys(this.stats)) {
      const object = Number(this.stats[key as keyof IRankingStatsPlayer]);
      if (Number.isNaN(object)) {
        this.animatedStats[key as keyof IRankingStatsPlayer] = 0;
        continue;
      }
      this.animateStatTo(key as keyof IRankingStatsPlayer, object);
    }
    this.cdr.detectChanges();
  }

  private animateStatTo(statKey: keyof IRankingStatsPlayer, targetValue: number): void {
    const target = this.animatedStats[statKey] || 0;
    if (target) {
      cancelAnimationFrame(target);
    }
    const duration = 1000;
    const startTime = performance.now();
    const startValue = this.animatedStats[statKey] || 0;
    const animate = (currentTime: number): void => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      this.animatedStats[statKey] = Math.floor(startValue + (targetValue - startValue) * this.easeOutCircle(progress));
      this.cdr.detectChanges();
      if (progress < 1) {
        this.animationFrames[statKey] = requestAnimationFrame(animate);
      }
    };
    this.animationFrames[statKey] = requestAnimationFrame(animate);
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private easeOutCircle(t: number): number {
    return Math.sqrt(1 - Math.pow(t - 1, 2));
  }

  private setMonuments(): void {
    const allMonuments = this.stats?.castles;
    if (!allMonuments || allMonuments.length === 0) {
      this.monumentsList = [];
      return;
    }
    const monumentsList: {
      type: string;
      position: string;
      kingdom: number;
      owner: string;
      color: string;
    }[] = [];
    allMonuments.forEach((entry) => {
      monumentsList.push({
        type: this.translateService.instant(this.getCastleType(entry[3])),
        position: `${entry[1]}, ${entry[2]}`,
        kingdom: entry[0],
        owner: this.playerName || '',
        color: '#000000',
      });
    });
    monumentsList.sort((a, b) => a.type.localeCompare(b.type) || a.owner.localeCompare(b.owner));
    this.monumentsList = monumentsList;
  }

  private mapStatsFromData(data: ApiRankingStatsPlayer): IRankingStatsPlayer {
    const castles = this.getCastlesFromData(data.castles, data.castles_realm);
    return {
      playerId: Number(data.player_id),
      server: data.server,
      mightCurrent: Number(data.might_current),
      mightAllTime: Number(data.might_all_time),
      currentFame: Number(data.current_fame),
      highestFame: Number(data.highest_fame),
      peaceDisabledAt: data.peace_disabled_at ? new Date(data.peace_disabled_at) : null,
      lootCurrent: Number(data.loot_current),
      lootAllTime: Number(data.loot_all_time),
      level: Number(data.level),
      legendaryLevel: Number(data.legendary_level),
      honor: Number(data.honor),
      maxHonor: Number(data.max_honor),
      serverRank: Number(data.server_rank),
      globalRank: Number(data.global_rank),
      totalLevel: Number(data.level) + Number(data.legendary_level || 0),
      castles: castles,
      totalCastles: castles.length,
    };
  }

  private getCastlesFromData(castles: number[][] | null, castlesRealm: number[][] | null): number[][] {
    const globalCastles: number[][] = [];
    if (castles) {
      globalCastles.push(...castles.map((castle) => [0, ...castle]));
    }
    if (castlesRealm) {
      const allowedIds = new Set([1, 12, 3, 4, 22, 23, 26, 28]);
      castlesRealm = castlesRealm.filter((castle) => allowedIds.has(castle[3]));
      globalCastles.push(...castlesRealm);
    }
    return globalCastles;
  }

  private initMightHistoryData(): void {
    const mightPoints = this.data['player_might_history'];
    this.setGenericVariations(mightPoints);
    const { dates, points } = this.getPointsAndDates(mightPoints);
    this.translateService.get('Points de puissance').subscribe((translated) => {
      this.initChartOption('might', [{ name: translated, data: points }], ['#eae077']);
      this.charts['might'].xaxis.categories = dates;
      this.charts['might'].yaxis.min = undefined;
      this.charts['might'].chart.height = 420;
      this.charts['might'].chart.animations = {
        enabled: false,
      };
    });
  }

  private initBerimondKingdomData(): void {
    const berimondPoints = this.data['player_event_berimond_kingdom_history'];
    this.setGenericVariations(berimondPoints);
    const eventData = this.groupEventDataByTimeGaps(this.eventDataSegments['berimondKingdom'], berimondPoints);
    const series = this.generateEventSeries(eventData);
    // @ts-expect-error: Property 'hidden' does not exist on type 'SeriesOptionsType'
    series.forEach((serie, index) => (serie['hidden'] = index !== series.length - 1));
    const colors = new Gradient();
    colors.setColorGradient('#00aaff', '#00aaff');
    this.initChartOption('berimondKingdom', series, colors.getColors());
  }

  private initBerimondInvasionData(): void {
    const berimondPoints = this.data['player_event_berimond_invasion_history'];
    this.setGenericVariations(berimondPoints);
    const eventData = this.groupEventDataByTimeGaps(this.eventDataSegments['berimondInvasion'], berimondPoints);
    const series = this.generateEventSeries(eventData);
    // @ts-expect-error: Property 'hidden' does not exist on type 'SeriesOptionsType'
    series.forEach((serie, index) => (serie['hidden'] = index !== series.length - 1));
    const colors = new Gradient();
    colors.setColorGradient('#00aaff', '#00aaff');
    this.initChartOption('berimondInvasion', series, colors.getColors());
  }

  private initSamuraiHistoryData(): void {
    const samuraiPoints = this.data['player_event_samurai_history'];
    this.setGenericVariations(samuraiPoints);
    const eventData = this.groupEventDataByTimeGaps(this.eventDataSegments['samurai'], samuraiPoints);
    const series = this.generateEventSeries(eventData);
    // @ts-expect-error: Property 'hidden' does not exist on type 'SeriesOptionsType'
    series.forEach((serie, index) => (serie['hidden'] = index !== series.length - 1));
    const colors = new Gradient();
    colors.setColorGradient('#9ED334', '#58771D');
    this.initChartOption('samurai', series, colors.getColors());
  }

  private initBloodcrowHistoryData(): void {
    const bloodcrowPoints = this.data['player_event_bloodcrow_history'];
    this.setGenericVariations(bloodcrowPoints);
    const eventData = this.groupEventDataByTimeGaps(this.eventDataSegments['bloodcrow'], bloodcrowPoints);
    const series = this.generateEventSeries(eventData);
    // @ts-expect-error: Property 'hidden' does not exist on type 'SeriesOptionsType'
    series.forEach((serie, index) => (serie['hidden'] = index !== series.length - 1));
    const colors = new Gradient();
    colors.setColorGradient('#8e5da3', '#8e5da3');
    this.initChartOption('bloodcrow', series, colors.getColors());
  }

  private initLootHistoryData(): void {
    const maxPoints: { week: string; points: number }[] = [];
    const lootPoints = this.data['player_loot_history'];
    if (!lootPoints || lootPoints.length === 0) {
      return;
    }
    // Sort by converting timestamps to numbers (date in string format yyyy-mm-dd hh:mm:ss)
    lootPoints.sort((a, b) => {
      const dateA = new Date(a['date']).getTime();
      const dateB = new Date(b['date']).getTime();
      return dateA - dateB;
    });
    // Get the first date and find the previous or current Monday
    const firstDate = new Date(lootPoints[0]['date']);
    // Step 1: Find the first Monday
    const firstMonday = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), firstDate.getUTCDate()));
    const dayOfWeek = firstMonday.getUTCDay();
    firstMonday.setUTCDate(firstMonday.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    firstMonday.setUTCHours(1, 0, 0, 0);
    // Step 2: Generate all weeks from the first Monday to the current date
    const currentDate = new Date();
    const generateWeekHours = (start: Date, end: Date): string[] => {
      const dates = [];
      const current = new Date(start);
      while (current <= end) {
        dates.push(current.toISOString().replace('T', ' ').slice(0, 16));
        current.setHours(current.getHours() + 1);
      }
      return dates;
    };
    const allWeeksHours: string[][] = [];
    const currentMonday = new Date(firstMonday);
    while (currentMonday <= currentDate) {
      const currentSunday = new Date(currentMonday);
      currentSunday.setDate(currentMonday.getDate() + 6);
      currentSunday.setUTCHours(23, 0, 0, 0);
      allWeeksHours.push(generateWeekHours(currentMonday, currentSunday));
      currentMonday.setDate(currentMonday.getDate() + 7);
    }
    // Step 3: Extract dates and points from lootPoints
    const dates = lootPoints.map((point) => {
      return point['date'].slice(0, Math.max(0, point['date'].length - 5)) + '00';
    });
    const points = lootPoints.map((point) => point['point']);
    const fillData = (weekHours: string[]): (number | null)[] => {
      let lastNonZeroPoint: number | null = null;
      return weekHours.map((hour) => {
        const hourDate = new Date(hour);
        const isMondayMidnight = hourDate.getDay() === 1 && hourDate.getHours() === 0;
        const pointIndex = dates.indexOf(hour);
        if (isMondayMidnight) {
          return 0;
        }
        if (pointIndex !== -1) {
          const point = points[pointIndex];
          if (point > 0) {
            lastNonZeroPoint = point;
          }
          return point;
        }
        if (lastNonZeroPoint === null) {
          return 0;
        }
        return null;
      });
    };
    // Step 4: Fill the data for each week
    const allWeeksData = allWeeksHours.map((weekHours) => {
      return fillData(weekHours);
    });
    const colors = ['#bfb58f', '#cc9a12'];
    const series = allWeeksData.map((weekData, index) => {
      const weekStartDate = new Date(firstMonday);
      weekStartDate.setDate(firstMonday.getDate() + index * 7);
      if (index === allWeeksData.length - 1) {
        if (weekData.length > allWeeksData[0].length) {
          weekData = weekData.slice(0, allWeeksData[0].length);
        }
        const maxPoint = Math.max(...weekData.filter((point): point is number => point !== null));
        maxPoints.push({ week: weekStartDate.toISOString().slice(0, 10), points: maxPoint });
        return {
          name: this.translateService.instant('Semaine courante') + ' (' + this.getUnitByValue(maxPoint) + ')',
          data: weekData,
          color: colors[1],
        };
      } else {
        const locale = this.languageService.getCurrentLang();
        if (weekData.length > allWeeksData[0].length) {
          weekData = weekData.slice(0, allWeeksData[0].length);
        }
        const maxPoint = Math.max(...weekData.filter((point): point is number => point !== null));
        maxPoints.push({ week: weekStartDate.toISOString().slice(0, 10), points: maxPoint });
        if (index === allWeeksData.length - 2) {
          return {
            name: this.translateService.instant('Semaine précédente') + ' (' + this.getUnitByValue(maxPoint) + ')',
            data: weekData,
            color: '#b8b29e',
          };
        }
        return {
          name:
            this.translateService.instant('Semaine du 0 au 0', {
              start: weekStartDate.toLocaleDateString(locale).slice(0, -5),
              end: new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString(locale).slice(0, -5),
            }) +
            ' (' +
            this.getUnitByValue(maxPoint) +
            ')',
          data: weekData,
          color: colors[0],
          hidden: true,
        };
      }
    });
    const days = [
      this.translateService.instant('Dimanche'),
      this.translateService.instant('Lundi'),
      this.translateService.instant('Mardi'),
      this.translateService.instant('Mercredi'),
      this.translateService.instant('Jeudi'),
      this.translateService.instant('Vendredi'),
      this.translateService.instant('Samedi'),
    ];
    this.maxLootPointsByWeek = maxPoints;
    const maxSeriesLength = Math.max(...series.map((s: any) => s.data.length));
    for (const serie of series) {
      if (serie.data.length < maxSeriesLength) {
        const lastPoint = Math.max(...serie.data.filter((point): point is number => point !== null));
        while (serie.data.length < maxSeriesLength) {
          serie.data.push(lastPoint);
        }
      }
    }
    // Initialise the chart 'loot-heatmap' (heatmap loot history)
    const seriesHeatmap: ApexAxisChartSeries = [];
    const allValues: number[] = [];
    series.reverse().forEach((weekSerie) => {
      if (weekSerie.data.length === 0) return;
      if (seriesHeatmap.length >= 25) return; // Limit to 25 weeks for UI performance
      const dailyMax = new Map<number, number>();
      weekSerie.data.forEach((point: number | null, hourIndex: number) => {
        const dayIndex = Math.floor(hourIndex / 24);
        if (!dailyMax.has(dayIndex)) {
          dailyMax.set(dayIndex, 0);
        }

        if (point !== null) {
          dailyMax.set(dayIndex, Math.max(dailyMax.get(dayIndex)!, point));
        }
      });
      const heatmapData: { x: string; y: number }[] = [];
      dailyMax.forEach((maxValue, dayIndex) => {
        const xLabel = days[dayIndex + 1 > 6 ? 0 : dayIndex + 1];
        heatmapData.push({
          x: xLabel,
          y: maxValue,
        });
        allValues.push(maxValue);
      });
      seriesHeatmap.push({
        name: weekSerie.name,
        data: heatmapData,
      });
    });
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    // Initialize the chart 'loot-heatmap' (heatmap loot history)
    this.initHeatmapChartOption('loot-heatmap', seriesHeatmap, colors);
    this.charts['loot-heatmap'].plotOptions.heatmap!.colorScale!.ranges = this.buildHeatmapRanges(maxValue);
    // Initialise the hourly activity rate chart 'loot-activity' (hourly activity rate loot history)
    const lastWeeksData = allWeeksData.slice(-2);
    const hourlyActivity = this.computeHourlyActivityRate(lastWeeksData.flat());
    const seriesHourlyActivity: ApexAxisChartSeries = [
      {
        name: this.translateService.instant("Taux d'activité par heure"),
        data: hourlyActivity,
      },
    ];
    this.initHourlyActivityChart('hourly-activity', seriesHourlyActivity);
    // Initialise the average gain per hour chart 'loot-average-gain' (average gain per hour loot history)
    const avgGainPerHour = this.computeAverageGainPerHour(lastWeeksData.flat());
    const seriesAvgGain: ApexAxisChartSeries = [
      {
        name: this.translateService.instant('Gain moyen par heure'),
        data: avgGainPerHour,
      },
    ];
    this.initAverageGainChart('avg-gain-hour', seriesAvgGain);
    // Initialize the chart 'loot' (area loot history)
    this.initChartOption('loot', series, colors);
    this.charts['loot'].xaxis.type = 'datetime';
    const weekHoursReference = allWeeksHours[0];
    for (let index = 1; index < weekHoursReference.length; index++) {
      allWeeksHours[index] = weekHoursReference;
    }
    this.charts['loot'].xaxis.categories = allWeeksHours.flat();
    const labels = this.charts['loot'].xaxis.labels;
    if (labels) {
      labels.datetimeFormatter = {
        year: 'yyyy',
        month: '',
        day: 'dddd',
        hour: 'ddd HH:mm',
        minute: 'HH:mm',
      };
      labels.format = 'dddd';
    }
    const needPMFormat = this.languageService.getCurrentLang() === 'en';
    const tooltipX = this.charts['loot'].tooltip.x;
    if (!tooltipX) return;
    tooltipX.formatter = function (value): string {
      const date = new Date(value);
      const dayName = days[date.getDay()];
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      if (needPMFormat) {
        const ampm = Number(hours) >= 12 ? 'PM' : 'AM';
        const hourIn12Format = Number(hours) % 12 || 12;
        return `${dayName} ${hourIn12Format}:${minutes} ${ampm}`;
      }
      return `${dayName} ${hours}h${minutes}`;
    };
    this.charts['loot'].chart.animations = {
      enabled: false,
    };
    const yLabels = this.charts['loot'].yaxis.labels;
    if (!yLabels) return;
    yLabels.formatter = function (value): string {
      return value === null ? '-' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
    };
  }

  private computeHourlyActivityRate(data: (number | null)[]): number[] {
    const activityCount: number[] = Array.from({ length: 24 }, () => 0);
    const totalCount: number[] = Array.from({ length: 24 }, () => 0);
    for (let index = 1; index < data.length; index++) {
      const current = data[index];
      const previous = data[index - 1];
      if (current === null || previous === null) continue;
      const hour = index % 24;
      totalCount[hour]++;
      if (current > previous) {
        activityCount[hour]++;
      }
    }
    return activityCount.map((count, hour) =>
      totalCount[hour] > 0 ? Math.round((count / totalCount[hour]) * 100) : 0,
    );
  }

  private computeAverageGainPerHour(data: (number | null)[]): number[] {
    const gains: number[] = Array.from({ length: 24 }, () => 0);
    const counts: number[] = Array.from({ length: 24 }, () => 0);
    for (let index = 1; index < data.length; index++) {
      const current = data[index];
      const previous = data[index - 1];
      if (current === null || previous === null) continue;

      if (current > previous) {
        const hour = index % 24;
        gains[hour] += current - previous;
        counts[hour]++;
      }
    }
    return gains.map((sum, h) => (counts[h] > 0 ? Math.round(sum / counts[h]) : 0));
  }

  /**
   * This function converts a value to a human-readable format with appropriate units.
   * It checks the value and applies the appropriate unit (k, M, G, T) based on the size of the value.
   * @param value The value to convert.
   * @returns The converted value with the appropriate unit.
   */
  private getUnitByValue(value: number): string {
    let unit = '';
    if (value >= 1000 && value < 1_000_000) {
      unit = 'k';
      value /= 1000;
    } else if (value >= 1_000_000 && value < 1_000_000_000) {
      unit = 'M';
      value /= 1_000_000;
    } else if (value >= 1_000_000_000 && value < 1_000_000_000_000) {
      unit = 'G';
      value /= 1_000_000_000;
    } else if (value >= 1_000_000_000_000) {
      unit = 'T';
      value /= 1_000_000_000_000;
    }
    return value.toFixed(2) + unit;
  }

  private generateEventSeries(eventData: [number, number][][]): ApexAxisChartSeries {
    const series: ApexAxisChartSeries = [];
    for (const event of eventData) {
      const currentDate = new Date();
      const lastEvent = event.at(-1);
      const lastDate = lastEvent ? new Date(lastEvent[0]) : new Date();
      let lastPoint: number | string | null = lastEvent ? lastEvent[1] : 0;
      if (!lastPoint) {
        lastPoint = 0;
      }
      lastPoint = Number(lastPoint) > 0 ? this.getUnitByValue(Number(lastPoint)) : '0';
      lastDate.setHours(lastDate.getHours() + 3);
      if (lastDate.getTime() < currentDate.getTime()) {
        const locale = this.languageService.getCurrentLang();
        const firstDate = new Date(event[0][0]);
        const lastDateForName = lastEvent ? new Date(lastEvent[0]) : new Date();
        const name =
          this.translateService.instant('Événement du 0 au 0', {
            start: firstDate.toLocaleDateString(locale).slice(0, -5),
            end: lastDateForName.toLocaleDateString(locale).slice(0, -5),
          }) + ` (${lastPoint})`;
        series.push({
          name,
          data: event,
        });
      } else {
        series.push({
          name: this.translateService.instant('Événement courant'),
          data: event,
        });
      }
    }
    return series;
  }

  private groupEventDataByTimeGaps(
    eventDataSegmentsReference: ApiGenericData[][],
    data: EventGenericVariation[],
    timeGap: number = 24 * 60 * 60 * 1000,
  ): [number, number][][] {
    let currentEvent: ApiGenericData[] = [];
    for (let index = 0; index < data.length; index++) {
      if (index > 0) {
        const date1 = new Date(data[index - 1]['date']);
        const date2 = new Date(data[index]['date']);
        if (date2.getTime() - date1.getTime() > timeGap) {
          if (currentEvent.length > 0) {
            eventDataSegmentsReference ??= [];
            eventDataSegmentsReference.push(currentEvent);
          }
          currentEvent = [];
        }
      }
      currentEvent.push({
        date: data[index]['date'],
        point: data[index]['point'],
      });
    }
    if (currentEvent.length > 0) {
      if (!eventDataSegmentsReference) {
        eventDataSegmentsReference = [];
      }
      eventDataSegmentsReference.push(currentEvent);
    } else {
      if (!eventDataSegmentsReference) {
        eventDataSegmentsReference = [];
      }
    }
    return eventDataSegmentsReference.map((event) => {
      return event.map((event) => {
        return [new Date(event['date']).getTime(), event['point']];
      });
    });
  }

  private getPointsAndDates(data: EventGenericVariation[]): { dates: string[]; points: number[] } {
    const dates = data.map((point) => point.date.slice(0, Math.max(0, point.date.length - 3)));
    const points = data.map((point) => point.point);
    return { dates, points };
  }

  private fillData(): void {
    this.setDefaultAlliance();
    void this.initPlayerStats();
    this.initMightHistoryData();
    this.initLootHistoryData();
    this.initWarRealmsData();
    this.initNomadHistoryData();
    this.initBerimondKingdomData();
    this.initBerimondInvasionData();
    this.initSamuraiHistoryData();
    this.initBloodcrowHistoryData();
  }

  private buildHeatmapRanges(maxValue: number): any[] {
    const ranges: any[] = [];
    ranges.push({
      from: 0,
      to: 0,
      color: '#000000',
      name: '0',
    });

    if (maxValue <= 0) {
      return ranges;
    }

    const maxSteps = 10;
    const bases = [1, 2, 5];
    const maxPower = Math.floor(Math.log10(maxValue));
    const thresholds: number[] = [];

    for (let p = maxPower - 2; p <= maxPower + 1; p++) {
      for (const base of bases) {
        const value = base * Math.pow(10, p);
        if (value > 0 && value < maxValue) {
          thresholds.push(value);
        }
      }
    }

    thresholds.push(maxValue);
    thresholds.sort((a, b) => a - b);
    const unique = [...new Set(thresholds)];
    const step = Math.ceil(unique.length / maxSteps);
    const selected = unique.filter((_, index) => index % step === 0);
    const colors = [
      '#FFF3E0',
      '#FFE0B2',
      '#FFCC80',
      '#FFB74D',
      '#FFA726',
      '#FF9800',
      '#FB8C00',
      '#F57C00',
      '#EF6C00',
      '#E65100',
    ];

    let from = 1;

    selected.forEach((to, index) => {
      ranges.push({
        from,
        to,
        color: colors[Math.min(index, colors.length - 1)],
        name: `${this.formatValue(from)} – ${this.formatValue(to)}`,
      });
      from = to + 1;
    });

    return ranges;
  }

  private formatValue(value: number): string {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} G`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)} K`;
    return value.toString();
  }

  private async initPlayerData(playerId: number): Promise<void> {
    const [allianceUpdatesResponse, playerUpdatesResponse] = await Promise.all([
      this.apiRestService.getAllianceUpdatesByPlayerId(playerId),
      this.apiRestService.getPlayerUpdatesByPlayerId(playerId),
    ]);
    if (allianceUpdatesResponse.success === false) {
      this.allianceUpdates = null;
    } else {
      const data = allianceUpdatesResponse.data;
      if (data && data.updates && data.updates.length > 0) {
        data.updates.sort((a, b) => this.compareDate(a, b));
        this.allianceUpdates = [];
        const firstAlliance = data.updates.at(-1);
        for (let index = 0; index < data.updates.length; index++) {
          this.allianceUpdates[index] = {
            id: data.updates[index]['new_alliance_id'],
            date: data.updates[index]['date'],
            alliance: data.updates[index]['new_alliance_name'],
            duration:
              index > 0
                ? this.getDateDiff(data.updates[index]['date'], data.updates[index - 1]['date'])
                : this.translateService.instant('depuis') +
                  ' ' +
                  this.getDateDiff(data.updates[index]['date'], new Date().toISOString()),
          };
        }
        if (firstAlliance) {
          this.allianceUpdates.push({
            id: firstAlliance['old_alliance_id'],
            date: null,
            alliance: firstAlliance['old_alliance_name'],
            duration: '-',
          });
        }
      } else {
        this.setDefaultAlliance();
      }
    }
    if (playerUpdatesResponse.success === false) {
      this.playerUpdates = null;
    } else {
      const data = playerUpdatesResponse.data;
      if (data && data.updates && data.updates.length > 0) {
        data.updates.sort((a, b) => this.compareDate(a, b));
        this.playerUpdates = [];
        const firstPlayer = data.updates.at(-1);
        for (let index = 0; index < data.updates.length; index++) {
          this.playerUpdates[index] = {
            date: data.updates[index]['date'],
            player: data.updates[index]['new_player_name'],
            duration:
              index > 0
                ? this.getDateDiff(data.updates[index]['date'], data.updates[index - 1]['date'])
                : this.translateService.instant('depuis') +
                  ' ' +
                  this.getDateDiff(data.updates[index]['date'], new Date().toISOString()),
          };
        }
        if (firstPlayer) {
          this.playerUpdates.push({
            date: null,
            player: firstPlayer['old_player_name'],
            duration: '-',
          });
        }
      }
    }
  }

  private fillQuantity(): void {
    this.stats?.castles.forEach((castle: number[]) => {
      const target = castle[3];
      switch (target) {
        case CastleType.CASTLE: {
          this.quantity.castle++;
          break;
        }
        case CastleType.REALM_CASTLE: {
          this.quantity.castle++;
          break;
        }
        case CastleType.OUTPOST: {
          this.quantity.outpost++;
          break;
        }
        case CastleType.MONUMENT: {
          this.quantity.monument++;
          this.quantity.patriarch++;
          break;
        }
        case CastleType.LABORATORY: {
          this.quantity.laboratory++;
          this.quantity.patriarch++;
          break;
        }
        case CastleType.CAPITAL: {
          this.quantity.capital++;
          this.quantity.patriarch++;
          break;
        }
        case CastleType.ROYAL_TOWER: {
          this.quantity.royalTower++;
          this.quantity.patriarch++;
          break;
        }
        case CastleType.CITY: {
          this.quantity.city++;
          this.quantity.patriarch++;
          break;
        }
        default: {
          break;
        }
      }
    });
  }

  private setDefaultAlliance(): void {
    if (!this.allianceUpdates || this.allianceUpdates.length > 0) return;
    this.allianceUpdates = [
      {
        id: this.allianceId ?? null,
        date: null,
        alliance: this.allianceName ?? null,
        duration: '-',
      },
    ];
  }
}
