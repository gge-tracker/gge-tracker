import { NgIf, NgClass, NgForOf, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import Gradient from 'javascript-color-gradient';
import { ApexAxisChartSeries } from 'ng-apexcharts';

import { PlayerStatsCardComponent } from './player-stats-card/player-stats-card.component';
import {
  ChartOptions,
  EventGenericVariation,
  AlliancesUpdates,
  PlayersUpdates,
  Top3EventPlayers,
  ErrorType,
  ApiGenericData,
  ApiPlayerStatsType,
  ApiResponse,
  ApiPlayerStatsByPlayerId,
  ApiRankingStatsPlayer,
  CastleQuantity,
  CastleType,
  Monument,
} from '@ggetracker-interfaces/empire-ranking';
import { LanguageService } from '@ggetracker-services/language.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LevelPipe } from '@ggetracker-pipes/level.pipe';
import { FormsModule } from '@angular/forms';

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
    this.route.params.subscribe(async (params) => {
      this.isInLoading = true;
      this.cdr.detectChanges();
      const playerId = params['playerId'];
      if (playerId && !isNaN(playerId) && playerId > 0) {
        try {
          const response: ApiResponse<ApiPlayerStatsByPlayerId> = this.route.snapshot.data['stats'];
          if (response.success === false) throw new Error();
          const data = response.data;
          this.playerName = data.player_name;
          this.addStructuredPlayerData({
            name: this.playerName,
            url: `gge-tracker.com/player/${playerId}`,
            alliance: data.alliance_name,
            might:
              data.points.player_might_history.length > 0
                ? data.points.player_might_history[data.points.player_might_history.length - 1].point
                : 0,
          });
          if (!data.points || Object.keys(data.points).length === 0) {
            this.toastService.add(ErrorType.ERROR_OCCURRED, 20000);
            void this.router.navigate(['/']);
            return;
          }
          this.data = Object.fromEntries(
            Object.entries(data.points).map(([key, value]) => [
              key,
              value.map((point) => ({ ...point, variation: 0 })),
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
          this.toastService.add(ErrorType.ERROR_OCCURRED, 20000);
          void this.router.navigate(['/']);
        }
      } else {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 20000);
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
      case 44:
        return 'Guerre des royaumes';
      case 51:
        return 'Samouraïs';
      case 46:
        return 'Nomades';
      case 30:
        return 'Royaume de Berimond';
      case 58:
        return 'Corbeaux de sang';
      default:
        return 'Invasion de Berimond';
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
    const favoriesStr = this.localStorage.getItem('favories');
    let favoriteIds: string[] = favoriesStr ? JSON.parse(favoriesStr) : [];
    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }
    return favoriteIds.includes(this.playerId.toString());
  }

  public removePlayerFromFavorites(): void {
    const favoriesStr = this.localStorage.getItem('favories');
    let favoriteIds: string[] = favoriesStr ? JSON.parse(favoriesStr) : [];
    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }
    const playerIdNum = Number(this.playerId);
    favoriteIds = favoriteIds.filter((id) => id !== playerIdNum.toString());
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
    const favoriesStr = this.localStorage.getItem('favories');
    let favoriteIds: string[] = favoriesStr ? JSON.parse(favoriesStr) : [];

    if (!Array.isArray(favoriteIds)) {
      this.localStorage.setItem('favories', JSON.stringify([]));
      favoriteIds = [];
    }

    const playerIdNum = Number(this.playerId);
    if (!favoriteIds.includes(playerIdNum.toString())) {
      favoriteIds.push(playerIdNum.toString());
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
              formatter: function (val): string {
                return val + '%';
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
            return value > 0 ? value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : value === null ? '?' : '0';
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
            return value === null ? '?' : value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
    customConditionFn?: (data: ApiGenericData[], i: number) => boolean,
  ): void {
    const dataWithVariation = data as EventGenericVariation[];
    for (let i = 0; i < data.length; i++) {
      if (i === 0 || (customConditionFn && customConditionFn(data, i))) {
        dataWithVariation[i]['variation'] = 0;
      } else {
        dataWithVariation[i]['variation'] = Number(data[i][key]) - Number(data[i - 1][key]);
      }
    }
  }

  private normalizeSeriesByReferenceDate(
    seriesList: { name: string; data: [number, number][] }[],
    referenceDate: Date = new Date(Date.UTC(2023, 0, 1, 0, 0, 0)),
  ): { name: string; data: [number, number][] }[] {
    return seriesList.map((serie) => {
      if (serie.data.length === 0) return { ...serie, data: [] };
      const originalStart = Math.floor(serie.data[0][0] / 3600000) * 3600000;
      const newData = serie.data.map(([timestamp, value]) => {
        const alignedTimestamp = Math.floor(timestamp / 3600000) * 3600000;
        const offset = alignedTimestamp - originalStart;
        const newTimestamp = referenceDate.getTime() + offset;
        return [newTimestamp, value] as [number, number];
      });
      return {
        ...serie,
        data: newData,
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
    const stats = await this.apiRestService.getRankingStatsByPlayerId(this.playerId);
    if (stats.success === false) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 20000);
      return;
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
        dates.push(current.toISOString().replace('T', ' ').substring(0, 16));
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
      return point['date'].substring(0, point['date'].length - 5) + '00';
    });
    const points = lootPoints.map((point) => point['point']);
    const fillData = (weekHours: string[]): (number | null)[] => {
      let lastNonZeroPoint: number | null = null;
      return weekHours.map((hour) => {
        const hourDate = new Date(hour);
        const isMondayMidnight = hourDate.getDay() === 1 && hourDate.getHours() === 0;
        const pointIndex = dates.findIndex((date) => date === hour);
        if (isMondayMidnight) {
          return 0;
        }
        if (pointIndex !== -1) {
          const point = points[pointIndex];
          if (point > 0) {
            lastNonZeroPoint = point; // Update the last non-zero point
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
    const colors = ['#00000000', '#cc9a12'];
    const series = allWeeksData.map((weekData, index) => {
      const weekStartDate = new Date(firstMonday);
      weekStartDate.setDate(firstMonday.getDate() + index * 7);
      if (index === allWeeksData.length - 1) {
        if (weekData.length > allWeeksData[0].length) {
          weekData = weekData.slice(0, allWeeksData[0].length);
        }
        return {
          name: this.translateService.instant('Semaine courante'),
          data: weekData,
          color: colors[1],
        };
      } else {
        const locale = this.languageService.getCurrentLang();
        if (weekData.length > allWeeksData[0].length) {
          weekData = weekData.slice(0, allWeeksData[0].length);
        }
        if (index === allWeeksData.length - 2) {
          return {
            name: this.translateService.instant('Semaine précédente'),
            data: weekData,
            color: '#000000',
          };
        }
        return {
          name: this.translateService.instant('Semaine du 0 au 0', {
            start: weekStartDate.toLocaleDateString(locale).slice(0, -5),
            end: new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString(locale).slice(0, -5),
          }),
          data: weekData,
          color: colors[0],
          hidden: true,
        };
      }
    });
    this.initChartOption('loot', series, colors);
    this.charts['loot'].xaxis.type = 'datetime';
    const weekHoursRef = allWeeksHours[0];
    for (let i = 1; i < weekHoursRef.length; i++) {
      allWeeksHours[i] = weekHoursRef;
    }
    this.charts['loot'].xaxis.categories = allWeeksHours.flat(); // Flatten the array
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
    const days = [
      this.translateService.instant('Dimanche'),
      this.translateService.instant('Lundi'),
      this.translateService.instant('Mardi'),
      this.translateService.instant('Mercredi'),
      this.translateService.instant('Jeudi'),
      this.translateService.instant('Vendredi'),
      this.translateService.instant('Samedi'),
    ];
    const NeedPMFormat = this.languageService.getCurrentLang() === 'en';
    const tooltipX = this.charts['loot'].tooltip.x;
    if (!tooltipX) return;
    tooltipX.formatter = function (val): string {
      const date = new Date(val);
      const dayName = days[date.getDay()];
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      if (NeedPMFormat) {
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
      return value !== null ? value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-';
    };
  }

  /**
   * This function converts a value to a human-readable format with appropriate units.
   * It checks the value and applies the appropriate unit (k, M, G, T) based on the size of the value.
   * @param value The value to convert.
   * @returns The converted value with the appropriate unit.
   */
  private getUnitByValue(value: number): string {
    let unit = '';
    if (value >= 1000 && value < 1000000) {
      unit = 'k';
      value /= 1000;
    } else if (value >= 1000000 && value < 1000000000) {
      unit = 'M';
      value /= 1000000;
    } else if (value >= 1000000000 && value < 1000000000000) {
      unit = 'G';
      value /= 1000000000;
    } else if (value >= 1000000000000) {
      unit = 'T';
      value /= 1000000000000;
    }
    return value.toFixed(2) + unit;
  }

  private generateEventSeries(eventData: [number, number][][]): ApexAxisChartSeries {
    const series: ApexAxisChartSeries = [];
    for (const event of eventData) {
      const currentDate = new Date();
      const lastDate = new Date(event[event.length - 1][0]);
      let lastPoint: number | string | null = event[event.length - 1][1];
      if (!lastPoint) {
        lastPoint = 0;
      }
      lastPoint = lastPoint > 0 ? this.getUnitByValue(lastPoint) : '0';
      lastDate.setHours(lastDate.getHours() + 3);
      if (lastDate.getTime() < currentDate.getTime()) {
        const locale = this.languageService.getCurrentLang();
        const firstDate = new Date(event[0][0]);
        const lastDate = new Date(event[event.length - 1][0]);
        const name =
          this.translateService.instant('Événement du 0 au 0', {
            start: firstDate.toLocaleDateString(locale).slice(0, -5),
            end: lastDate.toLocaleDateString(locale).slice(0, -5),
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
    eventDataSegmentsRef: ApiGenericData[][],
    data: EventGenericVariation[],
    timeGap: number = 24 * 60 * 60 * 1000,
  ): [number, number][][] {
    let currentEvent: ApiGenericData[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i > 0) {
        const date1 = new Date(data[i - 1]['date']);
        const date2 = new Date(data[i]['date']);
        if (date2.getTime() - date1.getTime() > timeGap) {
          if (currentEvent.length > 0) {
            eventDataSegmentsRef ??= [];
            eventDataSegmentsRef.push(currentEvent);
          }
          currentEvent = [];
        }
      }
      currentEvent.push({
        date: data[i]['date'],
        point: data[i]['point'],
      });
    }
    if (currentEvent.length > 0) {
      if (!eventDataSegmentsRef) {
        eventDataSegmentsRef = [];
      }
      eventDataSegmentsRef.push(currentEvent);
    } else {
      if (!eventDataSegmentsRef) {
        eventDataSegmentsRef = [];
      }
    }
    return eventDataSegmentsRef.map((event) => {
      return event.map((e) => {
        return [new Date(e['date']).getTime(), e['point']];
      });
    });
  }

  private getPointsAndDates(data: EventGenericVariation[]): { dates: string[]; points: number[] } {
    const dates = data.map((point) => point.date.substring(0, point.date.length - 3));
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
        const firstAlliance = data.updates[data.updates.length - 1];
        for (let i = 0; i < data.updates.length; i++) {
          this.allianceUpdates[i] = {
            id: data.updates[i]['new_alliance_id'],
            date: data.updates[i]['date'],
            alliance: data.updates[i]['new_alliance_name'],
            duration:
              i > 0
                ? this.getDateDiff(data.updates[i]['date'], data.updates[i - 1]['date'])
                : this.translateService.instant('depuis') +
                  ' ' +
                  this.getDateDiff(data.updates[i]['date'], new Date().toISOString()),
          };
        }
        this.allianceUpdates.push({
          id: firstAlliance['old_alliance_id'],
          date: null,
          alliance: firstAlliance['old_alliance_name'],
          duration: '-',
        });
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
        const firstPlayer = data.updates[data.updates.length - 1];
        for (let i = 0; i < data.updates.length; i++) {
          this.playerUpdates[i] = {
            date: data.updates[i]['date'],
            player: data.updates[i]['new_player_name'],
            duration:
              i > 0
                ? this.getDateDiff(data.updates[i]['date'], data.updates[i - 1]['date'])
                : this.translateService.instant('depuis') +
                  ' ' +
                  this.getDateDiff(data.updates[i]['date'], new Date().toISOString()),
          };
        }
        this.playerUpdates.push({
          date: null,
          player: firstPlayer['old_player_name'],
          duration: '-',
        });
      }
    }
  }

  private fillQuantity(): void {
    this.stats?.castles.forEach((castle: number[]) => {
      const target = castle[3];
      switch (target) {
        case CastleType.CASTLE:
          this.quantity.castle++;
          break;
        case CastleType.REALM_CASTLE:
          this.quantity.castle++;
          break;
        case CastleType.OUTPOST:
          this.quantity.outpost++;
          break;
        case CastleType.MONUMENT:
          this.quantity.monument++;
          this.quantity.patriarch++;
          break;
        case CastleType.LABORATORY:
          this.quantity.laboratory++;
          this.quantity.patriarch++;
          break;
        case CastleType.CAPITAL:
          this.quantity.capital++;
          this.quantity.patriarch++;
          break;
        case CastleType.ROYAL_TOWER:
          this.quantity.royalTower++;
          this.quantity.patriarch++;
          break;
        case CastleType.CITY:
          this.quantity.city++;
          this.quantity.patriarch++;
          break;
        default:
          break;
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
