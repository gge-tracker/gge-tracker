import { DatePipe, LowerCasePipe, NgClass, NgFor, NgIf } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiAlliancePlayersSearchResponse,
  ApiGenericData,
  ApiMovementsResponse,
  ApiPlayerSearchResponse,
  ApiPlayerStatsAlliance,
  ApiPlayerStatsForAlliance,
  ApiPlayerStatsType,
  ApiServerStats,
  ApiUpdateAlliancePlayers,
  Card,
  ChartOptions,
  ChartTypes,
  ErrorType,
  EventGenericVariation,
  FavoritePlayer,
  GroupedUpdatesByDate,
  ISelectedTab,
  Movement,
  Player,
  SearchType,
} from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LanguageService } from '@ggetracker-services/language.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { WindowService } from '@ggetracker-services/window.service';
import { TranslateModule } from '@ngx-translate/core';
import { format } from 'date-fns';
import katex from 'katex';
import {
  Activity,
  BriefcaseConveyorBelt,
  ChartSpline,
  Earth,
  Flag,
  LucideAngularModule,
  Trophy,
  Users,
} from 'lucide-angular';
import { ApexAxisChartSeries, XAxisAnnotations } from 'ng-apexcharts';
import { PlayerStatsCardComponent } from '../player-stats/player-stats-card/player-stats-card.component';
import { StatsCardContentComponent } from './stats-card-content/stats-card-content.component';
import { PlayerTableContentComponent } from '@ggetracker-pages/players/player-table-content/player-table-content.component';

enum ChartTypeHeights {
  DEFAULT = 450,
  LARGE = 650,
}

@Component({
  selector: 'app-alliance-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgFor,
    NgClass,
    NgIf,
    DatePipe,
    TranslateModule,
    PlayerStatsCardComponent,
    LowerCasePipe,
    FormsModule,
    LucideAngularModule,
    TableComponent,
    PlayerTableContentComponent,
    FormatNumberPipe,
    RouterLink,
    StatsCardContentComponent,
    TranslateModule,
  ],
  templateUrl: './alliance-stats.component.html',
  styleUrl: './alliance-stats.component.css',
})
export class AllianceStatsComponent extends GenericComponent implements OnInit, OnDestroy {
  public players: Player[] = [];
  public isDistanceIsInLoading = false;
  public page = 1;
  public maxPage?: number;
  public pageSize = 15;
  public responseTime = 0;
  public playerCount = 0;
  public movements: Movement[] = [];
  public toggleCharts: Record<keyof typeof ApiPlayerStatsType, boolean> = {
    might: false,
    loot: false,
    berimond_invasion: false,
    berimond_kingdom: false,
    bloodcrow: false,
    nomad: false,
    samurai: false,
    war_realms: false,
  };
  public movementsResponseTime = 0;
  public search = '';
  public searchType: SearchType = 'player';
  public reverse = true;
  public sort = 'might_current';
  public favoriePlayers: FavoritePlayer[] = [];
  public readonly ChartSpline = ChartSpline;
  public readonly Trophy = Trophy;
  public readonly BriefcaseConveyorBelt = BriefcaseConveyorBelt;
  public readonly Users = Users;
  public readonly Earth = Earth;
  public readonly Flag = Flag;
  public readonly Activity = Activity;
  /**
   * Array of loading messages for the component (these are i18n keys).
   */
  public loadingMessages: string[] = [
    'Chargement_1',
    'Chargement_2',
    'Chargement_3',
    'Chargement_4',
    'Chargement_5',
    'Chargement_6',
    'Chargement_7',
    'Chargement_8',
    'Chargement_9',
  ];
  public currentMessageIndex = 0;
  public message = this.loadingMessages[this.currentMessageIndex];
  public intervalId?: unknown;
  public fullScreenModalKey: keyof typeof ApiPlayerStatsType | null = null;
  public seriesLabels: Record<keyof typeof ApiPlayerStatsType, boolean> = {
    might: true,
    berimond_kingdom: true,
    berimond_invasion: true,
    war_realms: true,
    bloodcrow: true,
    nomad: true,
    samurai: true,
    loot: true,
  };
  public cumulSeries: Record<keyof typeof ApiPlayerStatsType, boolean> = {
    might: false,
    berimond_kingdom: false,
    berimond_invasion: false,
    war_realms: false,
    bloodcrow: false,
    nomad: false,
    samurai: false,
    loot: false,
  };
  public eventTitles: Record<keyof typeof ApiPlayerStatsType, string> = {
    might: '',
    loot: '',
    berimond_invasion: '',
    berimond_kingdom: '',
    bloodcrow: '',
    nomad: '',
    samurai: '',
    war_realms: '',
  };
  public charts: Record<keyof typeof ApiPlayerStatsType, ChartOptions | undefined> = {
    might: undefined,
    loot: undefined,
    berimond_invasion: undefined,
    berimond_kingdom: undefined,
    bloodcrow: undefined,
    nomad: undefined,
    samurai: undefined,
    war_realms: undefined,
  };
  public participationRateCharts: Record<keyof typeof ApiPlayerStatsType, ChartOptions | undefined> = {
    might: undefined,
    loot: undefined,
    berimond_invasion: undefined,
    berimond_kingdom: undefined,
    bloodcrow: undefined,
    nomad: undefined,
    samurai: undefined,
    war_realms: undefined,
  };
  public radarCharts: Record<keyof typeof ApiPlayerStatsType, ChartOptions | undefined> = {
    might: undefined,
    loot: undefined,
    berimond_invasion: undefined,
    berimond_kingdom: undefined,
    bloodcrow: undefined,
    nomad: undefined,
    samurai: undefined,
    war_realms: undefined,
  };
  public groupedUpdatedByMonths: Record<string, GroupedUpdatesByDate[]> = {};
  public nbMovementsByMonth: Record<string, { movements: number; leaves: number; joins: number }> = {};
  public progressByPlayer: {
    event: ApiPlayerStatsType;
    data: { playerName: string; progress: number }[];
  }[] = [];
  public allianceId = 0;
  public progressCalcFinished = false;
  public progressCalcInProgress = false;
  public selectedTab: ISelectedTab = 'members';
  public actualMonth = new Date().toISOString().split('T')[0].slice(0, 7);
  public groupedUpdates: GroupedUpdatesByDate[] = [];
  public playerNameForDistance = '';
  public allianceName = '';
  public updatesPlayers: ApiUpdateAlliancePlayers[] = [];
  public countQueryFinished = 0;
  public totalQuery = 0;
  public cards: Card[] = [];
  public isInMovementLoading = false;
  public lastUpdate = '';
  public graphPages: Record<ApiPlayerStatsType, number> = {
    player_might_history: -1,
    player_event_berimond_kingdom_history: -1,
    player_event_war_realms_history: -1,
    player_event_bloodcrow_history: -1,
    player_event_nomad_history: -1,
    player_event_samurai_history: -1,
    player_loot_history: 0,
    player_event_berimond_invasion_history: -1,
  };
  public readonly statsCardConfigs: {
    chartKey: keyof typeof ApiPlayerStatsType;
    title: string;
    dataName: string;
    backgroundColour: string;
    backgroundIconImage: string;
    eventTitleKey: keyof typeof ApiPlayerStatsType;
  }[] = [
    {
      chartKey: 'might',
      title: 'Points de puissance',
      dataName: 'Point de puissance',
      backgroundColour: 'rgb(255 230 35)',
      backgroundIconImage: '/assets/banner-pp.png',
      eventTitleKey: 'might',
    },
    {
      chartKey: 'loot',
      title: 'Points de pillage',
      dataName: 'Point de pillage',
      backgroundColour: '#e7a220',
      backgroundIconImage: '/assets/banner-loot.png',
      eventTitleKey: 'loot',
    },
    {
      chartKey: 'war_realms',
      title: 'Guerre des royaumes',
      dataName: 'Point de guerre des royaumes',
      backgroundColour: 'rgb(216 182 255)',
      backgroundIconImage: '/assets/banner-realm.png',
      eventTitleKey: 'war_realms',
    },
    {
      chartKey: 'bloodcrow',
      title: 'Corbeaux de sang',
      dataName: 'Point de corbeaux de sang',
      backgroundColour: 'rgb(216 182 255)',
      backgroundIconImage: '/assets/banner-bloodcrow.png',
      eventTitleKey: 'bloodcrow',
    },
    {
      chartKey: 'berimond_kingdom',
      title: 'Bataille de Berimond',
      dataName: 'Point de Berimond',
      backgroundColour: '#00aaff',
      backgroundIconImage: '/assets/banner-berimond.png',
      eventTitleKey: 'berimond_kingdom',
    },
    {
      chartKey: 'nomad',
      title: 'Nomades',
      dataName: 'Point de nomades',
      backgroundColour: 'rgb(255 130 54)',
      backgroundIconImage: '/assets/banner-nomad.png',
      eventTitleKey: 'nomad',
    },
    {
      chartKey: 'samurai',
      title: 'Samouraïs',
      dataName: 'Point de samouraïs',
      backgroundColour: '#58771db5',
      backgroundIconImage: '/assets/banner-samurai.png',
      eventTitleKey: 'samurai',
    },
  ];
  public eventDataSegments: Record<string, ApiGenericData[][]> = {};
  public readonly monthNames = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ];
  public ApiPlayerStatsType: typeof ApiPlayerStatsType = ApiPlayerStatsType;
  public chartsTabs: Record<keyof typeof ApiPlayerStatsType, ChartTypes | null> = {
    might: null,
    loot: null,
    berimond_kingdom: null,
    war_realms: null,
    bloodcrow: null,
    nomad: null,
    samurai: null,
    berimond_invasion: null,
  };
  public mightPerHourChart: ChartOptions | undefined;
  public dailyAvgMightChangeChart: ChartOptions | undefined;
  public mightIntraVariationChart: ChartOptions | undefined;
  public isPulseChartReady = false;
  public topMightGain24h: {
    current: number;
    diff: number;
    player_id: string;
    playerName: string;
  }[] = [];
  public topMightLoss24h: {
    current: number;
    diff: number;
    player_id: string;
    playerName: string;
  }[] = [];
  public topMightGain7d: {
    current: number;
    diff: number;
    player_id: string;
    playerName: string;
  }[] = [];
  public topMightLoss7d: {
    current: number;
    diff: number;
    player_id: string;
    playerName: string;
  }[] = [];
  public mightPerHourTable: {
    date: string;
    point: number;
    variation: number;
  }[] = [];
  public el = inject(ElementRef);
  public membersTableHeader: [string, string, (string | undefined)?, (boolean | undefined)?][] = [
    ['player_name', 'Pseudonyme'],
    ['level', 'Niveau', '/assets/lvl.png'],
    ['might_current', 'Points de puissance', '/assets/pp1.png'],
    ['loot_current', 'Points de pillage hebdomadaire', '/assets/loot.png'],
    ['current_fame', 'Points de gloire', '/assets/glory.png'],
    ['honor', 'Honneur', '/assets/honor.png'],
    ['', '', undefined, true],
  ];
  private windowService = inject(WindowService);
  private languageService = inject(LanguageService);
  private cdr = inject(ChangeDetectorRef);
  private localStorage = inject(LocalStorageService);
  private playersColors: Record<string, string> = {};
  private statsFinished = false;
  private statsInProgress = false;
  private data: ApiPlayerStatsForAlliance | null = null;
  private titleService = inject(Title);

  public ngOnInit(): void {
    this.init();
  }

  public ngOnDestroy(): void {
    clearInterval(this.intervalId as number);
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInMovementLoading) return;
    this.isInMovementLoading = true;
    this.page = page;
    const movements = await this.getGenericData();
    this.responseTime = movements.response;
    this.movements = this.mapMovementsFromApi(
      movements.data,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInMovementLoading = false;
    this.cdr.detectChanges();
  }

  public changeTabGraph(chartKey: keyof typeof ApiPlayerStatsType, tab: ChartTypes): void {
    this.chartsTabs[chartKey] = tab;
  }

  public formatAvg(value: number, toFixed = 3): string {
    return value.toFixed(toFixed).replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  public customFormatter(value: number, precision: number): string {
    return value.toFixed(precision).replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  public openFullscreen(chartKey: keyof typeof ApiPlayerStatsType): void {
    let chart;
    const tab = this.chartsTabs[chartKey];
    if (tab === ChartTypes.PARTICIPATION_RATE) {
      chart = this.participationRateCharts[chartKey];
    } else if (tab === ChartTypes.RADAR) {
      chart = this.radarCharts[chartKey];
    } else {
      chart = this.charts[chartKey];
    }
    if (!chart) return;
    const copyChart = { ...chart };
    const win = this.windowService.getWindow();
    if (!win || !win.innerWidth || !win.innerHeight) return;
    chart.chart.height = win.innerHeight - 250;
    chart.chart.width = win.innerWidth - 100;
    if (tab === ChartTypes.PARTICIPATION_RATE) {
      this.participationRateCharts[chartKey] = chart;
    } else if (tab === ChartTypes.RADAR) {
      this.radarCharts[chartKey] = chart;
    } else {
      this.charts[chartKey] = chart;
    }
    this.cdr.detectChanges();
    setTimeout(() => {
      if (tab === ChartTypes.PARTICIPATION_RATE) {
        delete this.participationRateCharts[chartKey];
      } else if (tab === ChartTypes.RADAR) {
        delete this.radarCharts[chartKey];
      } else {
        delete this.charts[chartKey];
      }
      this.fullScreenModalKey = chartKey;
      this.cdr.detectChanges();
      // Refresh the chart
      setTimeout(() => {
        if (tab === ChartTypes.PARTICIPATION_RATE) {
          this.participationRateCharts[chartKey] = copyChart;
        } else if (tab === ChartTypes.RADAR) {
          this.radarCharts[chartKey] = copyChart;
        } else {
          this.charts[chartKey] = copyChart;
        }
        this.cdr.detectChanges();
      }, 0);
    });
  }

  public closeFullscreen(): void {
    const key = this.fullScreenModalKey;
    if (!key) return;
    let chart;
    const tab = this.chartsTabs[key];
    if (tab === ChartTypes.PARTICIPATION_RATE) {
      chart = this.participationRateCharts[key];
    } else if (tab === ChartTypes.RADAR) {
      chart = this.radarCharts[key];
    } else {
      chart = this.charts[key];
    }
    if (!chart) return;
    if (tab === ChartTypes.RADAR) {
      chart.chart.height = ChartTypeHeights.LARGE;
    } else {
      chart.chart.height = ChartTypeHeights.DEFAULT;
    }
    const participationRateChart = this.participationRateCharts[key];
    const basicChart = this.charts[key];
    const radarChart = this.radarCharts[key];
    if (participationRateChart) {
      participationRateChart.chart.height = ChartTypeHeights.DEFAULT;
    }
    if (basicChart) {
      basicChart.chart.height = ChartTypeHeights.DEFAULT;
    }
    if (radarChart) {
      radarChart.chart.height = ChartTypeHeights.LARGE;
    }
    chart.chart.width = undefined;
    if (participationRateChart) {
      participationRateChart.chart.width = undefined;
    }
    if (basicChart) {
      basicChart.chart.width = undefined;
    }
    if (radarChart) {
      radarChart.chart.width = undefined;
    }
    const copyChart = { ...chart };
    if (tab === ChartTypes.PARTICIPATION_RATE) {
      this.participationRateCharts[key] = chart;
    } else if (tab === ChartTypes.RADAR) {
      this.radarCharts[key] = chart;
    } else {
      this.charts[key] = chart;
    }
    this.cdr.detectChanges();
    setTimeout(() => {
      // Update the chart reference
      if (tab === ChartTypes.PARTICIPATION_RATE) {
        delete this.participationRateCharts[key];
      } else if (tab === ChartTypes.RADAR) {
        delete this.radarCharts[key];
      } else {
        delete this.charts[key];
      }
      this.cdr.detectChanges();
      setTimeout(() => {
        if (tab === ChartTypes.PARTICIPATION_RATE) {
          this.participationRateCharts[key] = copyChart;
        } else if (tab === ChartTypes.RADAR) {
          this.radarCharts[key] = copyChart;
        } else {
          this.charts[key] = copyChart;
        }
        this.fullScreenModalKey = null;
        this.cdr.detectChanges();
      }, 0);
    });
  }

  public async nextPage(): Promise<void> {
    if (this.isInMovementLoading) return;
    this.isInMovementLoading = true;
    this.page++;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const movements = data.data;
    this.movements = this.mapMovementsFromApi(
      movements,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInMovementLoading = false;
    this.cdr.detectChanges();
  }

  public async previousPage(): Promise<void> {
    if (this.isInMovementLoading) return;
    this.isInMovementLoading = true;
    this.page--;
    const data = await this.getGenericData();
    this.responseTime = data.response;
    const movements = data.data;
    this.movements = this.mapMovementsFromApi(
      movements,
      (index: number) => (this.page - 1) * this.pageSize + index + 1,
    );
    this.isInMovementLoading = false;
    this.cdr.detectChanges();
  }

  public previousGraph(graphKey: ApiPlayerStatsType): void {
    if (!this.data) return;
    const serieChoosen = this.graphPages[graphKey];
    this.graphPages[graphKey] = serieChoosen - 1;
    switch (graphKey) {
      case ApiPlayerStatsType.might: {
        this.seriesLabels.might = true;
        this.initMightHistoryData(this.data);
        break;
      }
      case ApiPlayerStatsType.berimond_kingdom: {
        this.seriesLabels.berimond_kingdom = true;
        this.initBerimondKingdomData(this.data);
        break;
      }
      case ApiPlayerStatsType.war_realms: {
        this.seriesLabels.war_realms = true;
        this.initWarRealmsData(this.data);
        break;
      }
      case ApiPlayerStatsType.bloodcrow: {
        this.seriesLabels.bloodcrow = true;
        this.initBloodcrowData(this.data);
        break;
      }
      case ApiPlayerStatsType.nomad: {
        this.seriesLabels.nomad = true;
        this.initNomadData(this.data);
        break;
      }
      case ApiPlayerStatsType.samurai: {
        this.seriesLabels.samurai = true;
        this.initSamuraiData(this.data);
        break;
      }
      case ApiPlayerStatsType.loot: {
        this.graphPages[graphKey] = serieChoosen + 1;
        this.seriesLabels.loot = true;
        this.initLootHistoryData(this.data);
        break;
      }
    }
    this.cdr.detectChanges();
  }

  public nextGraph(graphKey: ApiPlayerStatsType): void {
    if (!this.data) return;
    const serieChoosen = this.graphPages[graphKey];
    if (
      (serieChoosen >= -1 && graphKey !== ApiPlayerStatsType.loot) ||
      (graphKey === ApiPlayerStatsType.loot && serieChoosen <= 0)
    )
      return;
    this.graphPages[graphKey] = serieChoosen + 1;
    switch (graphKey) {
      case ApiPlayerStatsType.might: {
        this.seriesLabels.might = true;
        this.initMightHistoryData(this.data);
        break;
      }
      case ApiPlayerStatsType.berimond_kingdom: {
        this.seriesLabels.berimond_kingdom = true;
        this.initBerimondKingdomData(this.data);
        break;
      }
      case ApiPlayerStatsType.war_realms: {
        this.seriesLabels.war_realms = true;
        this.initWarRealmsData(this.data);
        break;
      }
      case ApiPlayerStatsType.bloodcrow: {
        this.seriesLabels.bloodcrow = true;
        this.initBloodcrowData(this.data);
        break;
      }
      case ApiPlayerStatsType.nomad: {
        this.seriesLabels.nomad = true;
        this.initNomadData(this.data);
        break;
      }
      case ApiPlayerStatsType.samurai: {
        this.seriesLabels.samurai = true;
        this.initSamuraiData(this.data);
        break;
      }
      case ApiPlayerStatsType.loot: {
        this.graphPages[graphKey] = serieChoosen - 1;
        this.seriesLabels.loot = true;
        this.initLootHistoryData(this.data);
        break;
      }
    }
    this.cdr.detectChanges();
  }

  public previousMonth(): void {
    const [year, month] = this.actualMonth.split('-');
    const previousMonth = Number(month) - 1;
    if (previousMonth < 1) {
      this.actualMonth = `${Number(year) - 1}-12`;
    } else {
      this.actualMonth = `${year}-${previousMonth.toString().padStart(2, '0')}`;
    }
    this.cdr.detectChanges();
  }

  public nextMonth(): void {
    const [year, month] = this.actualMonth.split('-');
    const nextMonth = Number(month) + 1;
    if (nextMonth > 12) {
      this.actualMonth = `${Number(year) + 1}-01`;
    } else {
      this.actualMonth = `${year}-${nextMonth.toString().padStart(2, '0')}`;
    }
    this.cdr.detectChanges();
  }

  public async resetDistanceColumn(): Promise<void> {
    this.playerNameForDistance = '';
    this.localStorage.removeItem('allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer);
    this.cdr.detectChanges();
    if (this.membersTableHeader.length === 11) {
      this.membersTableHeader.splice(-2, 1);
      this.cdr.detectChanges();
    }
  }

  public getDefaultTableDistanceEntry(): [string, string, (string | undefined)?, (boolean | undefined)?] {
    return ['distance', 'Distance (m)', undefined, undefined];
  }

  public async onAddDistanceColumn(): Promise<void> {
    if (!this.playerNameForDistance?.trim()) return;
    this.isDistanceIsInLoading = true;
    this.localStorage.setItem(
      'allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer,
      this.playerNameForDistance,
    );
    const data = await this.getAllianceMembers();
    this.isDistanceIsInLoading = false;
    if (!data) return;
    this.players = this.mapPlayersFromApi(data.players);
    if (this.membersTableHeader.length === 10) {
      const block: [string, string, (string | undefined)?, (boolean | undefined)?] =
        this.getDefaultTableDistanceEntry();
      this.membersTableHeader.splice(-1, 0, block);
    }
  }

  public cumulSeriesLabels(chartName: keyof typeof ApiPlayerStatsType): void {
    const chart = this.charts[chartName];
    if (!chart) return;
    if (!this.data) return;
    const apiPlayerStatsType = ApiPlayerStatsType[chartName];
    if (apiPlayerStatsType === ApiPlayerStatsType.loot) {
      this.initLootHistoryData(this.data);
    } else {
      this.initGenericEventData(chartName, apiPlayerStatsType, this.data, this.graphPages[apiPlayerStatsType]);
    }
    this.cdr.detectChanges();
  }

  public toggleSeriesLabels(chartName: keyof typeof ApiPlayerStatsType): void {
    const chart = this.charts[chartName];
    if (!chart) return;
    const currentToggleType = this.toggleCharts[chartName];

    // @ts-expect-error: Property 'hidden' does not exist on type 'SeriesOptionsType'
    chart.series.forEach((serie) => (serie['hidden'] = !currentToggleType));
    this.toggleCharts[chartName] = !currentToggleType;
    this.initChartOption(chartName, chart.series, chart.colors);
    this.cdr.detectChanges();
  }

  public sortPlayers(sort: string): void {
    if (this.sort === sort) {
      this.reverse = !this.reverse;
    } else {
      this.reverse = false;
      this.sort = sort;
    }
    // Sort players based on the selected property
    let playerProperty: keyof Player;
    if (sort === 'level') {
      // If the property is 'level', sort by level and legendary level
      this.players = this.players.sort((a, b) => {
        const aLevelValue = (a.level || 0) + (a.legendaryLevel || 0);
        const bLevelValue = (b.level || 0) + (b.legendaryLevel || 0);
        if (this.reverse) return bLevelValue - aLevelValue;
        return aLevelValue - bLevelValue;
      });
    } else {
      playerProperty = sort.replaceAll(/_(\w)/g, (match, p1) => p1.toUpperCase()) as keyof Player;
      // If the property is not 'level', sort by that property
      this.players = this.players.sort((a, b) => {
        const aValue = a[playerProperty] ?? 0;
        const bValue = b[playerProperty] ?? 0;
        const type = typeof a[playerProperty];
        if (type === 'number') {
          if (this.reverse) return Number(bValue) - Number(aValue);
          return Number(aValue) - Number(bValue);
        } else {
          if (this.reverse) return (bValue as string).localeCompare(aValue as string);
          return (aValue as string).localeCompare(bValue as string);
        }
      });
    }
    const nbPlayers = this.players.length;
    this.players = this.players.map((player, index) => {
      player.rank = this.reverse ? index + 1 : nbPlayers - index;
      return player;
    });
    this.cdr.detectChanges();
  }

  /**
   * Open the modal for the first formula.
   * This method uses KaTeX to render the formula in the modal.
   */
  public openModal1(): void {
    const target = this.el.nativeElement.querySelector('.katex-target');
    katex.render(
      String.raw`\text{Might}_{\text{day}} = \frac{1}{N} \sum_{i=1}^{N} \left( M_i^{\text{end}} - M_i^{\text{start}} \right)`,
      target,
      {
        displayMode: true,
        throwOnError: false,
      },
    );
  }

  /**
   * Open the modal for the second formula.
   * This method uses KaTeX to render the formula in the modal.
   */
  public openModal2(): void {
    const target = this.el.nativeElement.querySelector('.katex-target-var');
    katex.render(
      String.raw`\text{Might}_{\text{day}} = \frac{1}{N} \sum_{i=1}^{N} \left( \max(M_i^{\text{day}}) - \min(M_i^{\text{day}}) \right)`,
      target,
      {
        displayMode: true,
        throwOnError: false,
      },
    );
  }

  public getMonthNameByDate(date: string): string {
    const [year, month] = date.split('-');
    return this.translateService.instant(this.monthNames[Number(month) - 1]) + ' ' + year;
  }

  public async changeTab(tab: ISelectedTab): Promise<void> {
    this.selectedTab = tab;
    if ((tab === 'stats' || tab === 'progress') && !this.statsFinished && !this.statsInProgress) {
      this.statsInProgress = true;
      await this.loadDetailsEventPlayerStats();
      this.statsFinished = true;
      this.statsInProgress = false;
    }
    if (tab === 'progress' && !this.progressCalcInProgress && !this.progressCalcFinished) {
      this.progressCalcInProgress = true;
      //await this.loadProgressEventPlayerStats();
      this.progressCalcFinished = true;
      this.progressCalcInProgress = false;
    } else if (tab === 'movements' && this.movementsResponseTime === 0) {
      await this.initMovements();
    }
    if (tab === 'health') {
      await this.loadHealthEventPlayerStats();
    }
    this.cdr.detectChanges();
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 0);
  }

  private async getAllianceMembers(): Promise<ApiAlliancePlayersSearchResponse | undefined> {
    let response = await this.apiRestService.getAllianceStats(this.allianceId, this.playerNameForDistance);
    if (response.success === false) {
      if (response.error === 'Invalid player name') {
        this.toastService.add(ErrorType.NO_PLAYER_FOUND, 20_000);
        void this.resetDistanceColumn();
        this.localStorage.setItem('allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer, '');
        this.playerNameForDistance = '';
        response = await this.apiRestService.getAllianceStats(this.allianceId, '');
        if (response.success === false) {
          this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
          return;
        }
      } else {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
        return;
      }
    }
    return response.data;
  }

  private async processAllianceInit(allianceId: number): Promise<void> {
    const data = await this.getAllianceMembers();
    if (!data) return;
    this.players = this.mapPlayersFromApi(data.players);
    if (this.membersTableHeader.length === 10 && this.playerNameForDistance !== '') {
      const block: [string, string, (string | undefined)?, (boolean | undefined)?] =
        this.getDefaultTableDistanceEntry();
      this.membersTableHeader.splice(-1, 0, block);
    }
    this.addPageTitle(data.alliance_name);
    this.allianceName = data.alliance_name;
    const updatesPlayers = await this.apiRestService.getUpdatePlayersAlliance(allianceId);
    if (updatesPlayers.success === false) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
      return;
    }
    this.updatesPlayers = updatesPlayers.data.updates;
    this.processUpdatesData();
    const globalResponse = await this.apiRestService.getServerGlobalStats();
    if (globalResponse.success === false) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
      return;
    }
    const globalData = globalResponse.data;
    const lastGlobalData = globalData.at(-1);
    if (lastGlobalData) {
      this.initCards(lastGlobalData);
    }
    this.isInLoading = false;
    this.cdr.detectChanges();
  }

  private init(): void {
    const lastUpdate = this.utilitiesService.data$.subscribe((data) => {
      if (data) {
        this.lastUpdate = data.last_update.might;
        lastUpdate.unsubscribe();
        this.cdr.detectChanges();
      }
    });
    const allianceDistancePlayerName = this.localStorage.getItem(
      'allianceDistancePlayerName_' + this.apiRestService.serverService.choosedServer,
    );
    if (allianceDistancePlayerName) {
      this.playerNameForDistance = allianceDistancePlayerName;
    }
    this.intervalId = setInterval(() => {
      this.currentMessageIndex = (this.currentMessageIndex + 1) % this.loadingMessages.length;
      this.message = this.loadingMessages[this.currentMessageIndex];
      this.cdr.detectChanges();
    }, 2000);
    this.route.params.subscribe(async (parameters) => {
      const allianceId = parameters['allianceId'];
      this.allianceId = allianceId;
      if (allianceId && !Number.isNaN(allianceId) && allianceId > 0) {
        try {
          await this.processAllianceInit(allianceId);
        } catch {
          this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
          this.isInLoading = false;
        }
      } else {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
        this.isInLoading = false;
        void this.router.navigate(['/']);
        return;
      }
    });
  }

  private processUpdatesData(): void {
    const groupedByDate = new Map<string, GroupedUpdatesByDate>();
    const currentAllianceId = this.allianceId;

    this.updatesPlayers.forEach((update) => {
      const action = update.new_alliance_id == currentAllianceId ? 'joined' : 'left';

      const levelTranslate = this.translateService.instant('Niveau');
      const mightTranslate = this.translateService.instant('Points de puissance').toLowerCase();

      const level =
        update.level && update.level >= 70 && update.legendary_level
          ? `${levelTranslate} ${update.level}/${update.legendary_level}`
          : `${levelTranslate} ${update.level}`;

      const { v, unit } = this.getUnitByValue(update.might_current);

      const might_change = action === 'joined' ? `+${v}${unit} ${mightTranslate}` : `-${v}${unit} ${mightTranslate}`;

      const eventDate = update.created_at.split(' ')[0];
      if (!groupedByDate.has(eventDate)) {
        groupedByDate.set(eventDate, {
          date: eventDate,
          updates: [],
        });
      }

      groupedByDate.get(eventDate)?.updates.push({
        created_at: update.created_at,
        action,
        player_name: update.player_name,
        level,
        might_change,
      });
    });

    this.groupedUpdates = [...groupedByDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    this.groupedUpdatedByMonths = this.groupedUpdates.reduce(
      (accumulator, update) => {
        const [year, month] = update.date.split('-');
        const key = `${year}-${month}`;
        if (!accumulator[key]) {
          accumulator[key] = [];
        }
        accumulator[key].push(update);
        return accumulator;
      },
      {} as Record<string, GroupedUpdatesByDate[]>,
    );
    this.setNbMovementsForDates();
  }

  private addVariations(data: { date: string; point: number }[]): { date: string; point: number; variation: number }[] {
    const dataWithVariations = data.map((item, index) => {
      const previousItem = data[index - 1];
      if (previousItem) {
        const variation = item.point - previousItem.point;
        return { ...item, variation };
      }
      return { ...item, variation: 0 };
    });
    return dataWithVariations;
  }

  private getAnnotations(data: { date: string; point: number }[]): XAxisAnnotations[] {
    const timestamps = data.map((d) => new Date(d.date).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const annotations: XAxisAnnotations[] = [];
    let currentTime = new Date(minTime);
    currentTime.setHours(6, 0, 0, 0); // We start at 06:00 AM of the first day

    while (currentTime.getTime() < maxTime) {
      const morningStart = new Date(currentTime);
      morningStart.setHours(6, 0, 0, 0);

      const afternoonStart = new Date(morningStart);
      afternoonStart.setHours(12, 0, 0, 0);

      const eveningStart = new Date(afternoonStart);
      eveningStart.setHours(18, 0, 0, 0);

      const nightStart = new Date(eveningStart);
      nightStart.setHours(0, 0, 0, 0);
      nightStart.setDate(nightStart.getDate() + 1);

      const nextMorningStart = new Date(morningStart);
      nextMorningStart.setDate(nextMorningStart.getDate() + 1);

      annotations.push(
        {
          x: new Date(morningStart).setHours(0, 0, 0, 0),
          x2: morningStart.getTime(),
          fillColor: '#2196F3',
          opacity: 0.1,
        },
        {
          x: morningStart.getTime(),
          x2: afternoonStart.getTime(),
          fillColor: '#FFEB3B',
          opacity: 0.2,
        },
        {
          x: afternoonStart.getTime(),
          x2: eveningStart.getTime(),
          fillColor: '#4CAF50',
          opacity: 0.2,
        },
        {
          x: eveningStart.getTime(),
          x2: nightStart.getTime(),
          fillColor: '#F44336',
          opacity: 0.2,
        },
      );

      currentTime = new Date(nextMorningStart);
    }
    return annotations;
  }

  private async loadHealthEventPlayerStats(): Promise<void> {
    const data = await this.apiRestService.getPlayerStatsPulsedForAlliance(this.allianceId);
    if (data.success === false) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
      return;
    }
    const healthResponse = data.data;
    this.mightPerHourTable = this.addVariations(healthResponse['might_per_hour']);
    this.initMightPerHourChart(healthResponse['might_per_hour'], this.getAnnotations(healthResponse['might_per_hour']));
    this.initDailyAvgMightChangeChart(healthResponse['daily_avg_might_change']);
    this.initMightIntraVariationChart(healthResponse['might_intra_variation']);
    this.topMightGain24h = healthResponse['top_might_gain_24h'].map((item) => {
      return {
        playerName: this.getPlayerName(item.player_id),
        ...item,
      };
    });
    this.topMightLoss24h = healthResponse['top_might_loss_24h'].map((item) => {
      return {
        playerName: this.getPlayerName(item.player_id),
        ...item,
      };
    });
    this.topMightGain7d = healthResponse['top_might_gain_7d'].map((item) => {
      return {
        playerName: this.getPlayerName(item.player_id),
        ...item,
      };
    });
    this.topMightLoss7d = healthResponse['top_might_loss_7d'].map((item) => {
      return {
        playerName: this.getPlayerName(item.player_id),
        ...item,
      };
    });
    this.isPulseChartReady = true;
    this.cdr.detectChanges();
  }

  private async getGenericData(): Promise<{ data: ApiMovementsResponse; response: number }> {
    return await this.apiRestService.getGenericData(
      this.apiRestService.getMovementsbyAllianceId.bind(this.apiRestService),
      this.page,
      Number(this.search),
      this.searchType,
      null,
      null,
    );
  }

  private mapMovementsFromApi(movements: ApiMovementsResponse, rankFunction: (rank: number) => number): Movement[] {
    if (movements.pagination) {
      this.maxPage = movements.pagination.total_pages;
    } else {
      this.maxPage = 1;
    }
    return movements.movements.map((movement, index) => {
      return {
        rank: rankFunction(index),
        player: movement.player_name,
        might: movement.player_might,
        level: movement.player_level,
        legendaryLevel: movement.player_legendary_level,
        alliance: movement.alliance_name,
        type: movement.castle_type,
        date: movement.created_at,
        positionOld: [movement.position_x_old, movement.position_y_old],
        positionNew: [movement.position_x_new, movement.position_y_new],
      };
    });
  }

  private async initMovements(): Promise<void> {
    try {
      this.page = 1;
      this.search = this.allianceId.toString();
      this.searchType = 'alliance';
      const data = await this.getGenericData();
      this.responseTime = data.response;
      const movements = data.data;
      this.movements = this.mapMovementsFromApi(movements, (index: number) => index + 1);
      this.movementsResponseTime = data.response;
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    }
  }

  private setNbMovementsForDates(): void {
    const nbByDates = this.groupedUpdatedByMonths;
    for (const key in nbByDates) {
      this.nbMovementsByMonth[key] = { movements: 0, leaves: 0, joins: 0 };
      this.nbMovementsByMonth[key].movements = nbByDates[key].reduce(
        (accumulator, update) => accumulator + update.updates.length,
        0,
      );
      this.nbMovementsByMonth[key].leaves = nbByDates[key].reduce(
        (accumulator, update) => accumulator + update.updates.filter((u) => u.action === 'left').length,
        0,
      );
      this.nbMovementsByMonth[key].joins = nbByDates[key].reduce(
        (accumulator, update) => accumulator + update.updates.filter((u) => u.action === 'joined').length,
        0,
      );
    }
  }

  /**
   * This method groups event data by time gaps.
   * It takes an array of data points, each represented as a tuple of timestamp and value,
   * and groups them into segments based on a specified time gap.
   * @param data Data to group, represented as an array of tuples [timestamp, value].
   * @param timeGap Time gap in milliseconds to determine when to start a new segment.
   * @returns An array of grouped data segments, where each segment is an array of tuples [timestamp, value].
   */
  private groupEventDataByTimeGaps(
    data: [number, number][],
    timeGap: number = 24 * 60 * 60 * 1000,
  ): [number, number][][] {
    data = [...new Set(data.map((item) => JSON.stringify(item)))].map((item) => JSON.parse(item));
    // Data is sorted by timestamp to ensure correct grouping
    data.sort((a, b) => a[0] - b[0]);
    let currentEvent: ApiGenericData[] = [];
    let eventDataSegmentsReference: ApiGenericData[][] = [];
    // Iterate through the data and group by time gaps to create segments
    for (let index = 0; index < data.length; index++) {
      if (index > 0) {
        const date1 = data[index - 1][0];
        const date2 = data[index][0];
        if (date2 - date1 > timeGap) {
          if (currentEvent.length > 0) {
            eventDataSegmentsReference ??= [];
            eventDataSegmentsReference.push(currentEvent);
          }
          currentEvent = [];
        }
      }
      currentEvent.push({
        date: new Date(data[index][0]).toISOString(),
        point: data[index][1],
      });
    }
    if (currentEvent.length > 0) {
      eventDataSegmentsReference ??= [];
      eventDataSegmentsReference.push(currentEvent);
    }
    return eventDataSegmentsReference.map((event) => {
      return event.map((event) => {
        return [new Date(event.date).getTime(), event.point];
      });
    });
  }

  private generateEventTitle(eventTimestamps: [number, number][]): string {
    const currentDate = new Date();
    const lastTimestamp = eventTimestamps.at(-1);
    if (!lastTimestamp) {
      return this.translateService.instant('Événement en cours');
    }
    const lastDate = new Date(lastTimestamp[0]);
    lastDate.setHours(lastDate.getHours() + 3);

    const locale = this.languageService.getCurrentLang();
    if (lastDate.getTime() < currentDate.getTime()) {
      const firstDate = new Date(eventTimestamps[0][0]);
      const lastDate = new Date(eventTimestamps.at(-1)![0]);
      const name = this.translateService.instant('Événement du 0 au 0', {
        start: firstDate.toLocaleDateString(locale).slice(0, -5),
        end: lastDate.toLocaleDateString(locale).slice(0, -5),
      });
      return name;
    } else {
      return this.translateService.instant('Événement en cours');
    }
  }

  private getPointsAndDates(data: EventGenericVariation[]): { dates: string[]; points: number[] } {
    const dates = data.map((point) => {
      const date = point['date'].slice(0, Math.max(0, point['date'].length - 3));
      return date;
    });
    const points = data.map((point) => {
      return point['point'];
    });
    return { dates, points };
  }

  private initMightHistoryData(data: ApiPlayerStatsForAlliance): void {
    this.initGenericEventData('might', ApiPlayerStatsType.might, data, this.graphPages.player_might_history);
  }

  private initBerimondKingdomData(data: ApiPlayerStatsForAlliance): void {
    this.initGenericEventData(
      'berimond_kingdom',
      ApiPlayerStatsType.berimond_kingdom,
      data,
      this.graphPages.player_event_berimond_kingdom_history,
    );
  }

  private initWarRealmsData(data: ApiPlayerStatsForAlliance): void {
    this.initGenericEventData(
      'war_realms',
      ApiPlayerStatsType.war_realms,
      data,
      this.graphPages.player_event_war_realms_history,
    );
  }

  private initBloodcrowData(data: ApiPlayerStatsForAlliance): void {
    this.initGenericEventData(
      'bloodcrow',
      ApiPlayerStatsType.bloodcrow,
      data,
      this.graphPages.player_event_bloodcrow_history,
    );
  }

  private initNomadData(data: ApiPlayerStatsForAlliance): void {
    this.initGenericEventData('nomad', ApiPlayerStatsType.nomad, data, this.graphPages.player_event_nomad_history);
  }

  private initSamuraiData(data: ApiPlayerStatsForAlliance): void {
    this.initGenericEventData(
      'samurai',
      ApiPlayerStatsType.samurai,
      data,
      this.graphPages.player_event_samurai_history,
    );
  }

  private initLootHistoryData(data: ApiPlayerStatsForAlliance): void {
    const serieChoosen = this.graphPages.player_loot_history;
    const playerMap = new Map<number, { playerName: string; segments: [number, number][] }>();
    const now = new Date();
    const currentMonday = new Date(now);
    currentMonday.setUTCDate(currentMonday.getUTCDate() - ((currentMonday.getUTCDay() + 6) % 7));
    currentMonday.setUTCHours(1, 0, 0, 0);
    const startOfWeek = new Date(currentMonday);
    const endOfWeek = new Date(currentMonday);
    endOfWeek.setUTCDate(endOfWeek.getUTCDate() + 7);
    endOfWeek.setUTCHours(0, 0, 0, 0);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - serieChoosen * 7);
    endOfWeek.setUTCDate(endOfWeek.getUTCDate() - serieChoosen * 7);
    const weekHours = this.generateWeekHours(startOfWeek, endOfWeek);
    const timestampsByHour = weekHours.map((hour) => new Date(hour).getTime());
    const showedEndOfWeek = new Date(endOfWeek);
    showedEndOfWeek.setUTCDate(showedEndOfWeek.getUTCDate() - 1);
    if (startOfWeek.getTime() < 1_737_349_200_000) {
      this.graphPages[ApiPlayerStatsType.loot] = serieChoosen - 1;
      return;
    }
    this.eventTitles['loot'] = this.translateService.instant('Événement du 0 au 0', {
      start: startOfWeek.toLocaleDateString().slice(0, -5),
      end: showedEndOfWeek.toLocaleDateString().slice(0, -5),
    });
    const segmentsWithColors: {
      segment: {
        name: string;
        data: [number, number | null][];
        lastValue: number;
      };
      color: string;
    }[] = [];
    const hoursToRemove = new Set<number>();
    for (const record of data[ApiPlayerStatsType.loot]) {
      const { player_id, date, point } = record;
      const dateHour = new Date(date);
      dateHour.setMinutes(0, 0, 0);
      if (!playerMap.has(player_id)) {
        playerMap.set(player_id, {
          playerName: this.getPlayerName(player_id.toString()),
          segments: [],
        });
      }
      const player = playerMap.get(player_id);
      if (player) {
        player.segments.push([dateHour.getTime(), point]);
      }
    }
    for (const [, playerData] of playerMap.entries()) {
      const { segments } = playerData;
      const playerScoresByTimestamp = new Map<number, number>();
      for (const [timestamp, point] of segments) {
        playerScoresByTimestamp.set(timestamp, point);
      }
      const alignedData: [number, number | null][] = timestampsByHour.map((hourTimestamp) => {
        const score = playerScoresByTimestamp.get(hourTimestamp) || 0;
        return [hourTimestamp, score];
      });
      for (let index = 1; index < alignedData.length; index++) {
        const [currentTimestamp, currentScore] = alignedData[index];
        const [, previousScore] = alignedData[index - 1];
        const isMondayReset =
          new Date(currentTimestamp).getUTCDay() === 1 && new Date(currentTimestamp).getUTCHours() === 1;
        if (isMondayReset) continue;
        if (currentScore === 0 && previousScore !== null && previousScore > currentScore) {
          const hasFutureHigherPoint = alignedData.slice(index + 1).some(([, futureScore]) => {
            return futureScore !== null && futureScore > currentScore;
          });
          if (hasFutureHigherPoint) {
            let index_ = index;
            while (index_ < alignedData.length && alignedData[index_][1] === 0) {
              hoursToRemove.add(alignedData[index_][0]);
              index_++;
            }
          }
        }
      }
    }
    const filteredTimestampsByHour = timestampsByHour.filter((hour) => !hoursToRemove.has(hour));
    for (const [, playerData] of playerMap.entries()) {
      playerData.segments = playerData.segments.filter(([timestamp]) => !hoursToRemove.has(timestamp));
    }
    for (const [, playerData] of playerMap.entries()) {
      const { playerName, segments } = playerData;
      const alignedData: [number, number | null][] = filteredTimestampsByHour.map((hourTimestamp) => {
        const score = new Map(segments).get(hourTimestamp) || 0;
        return [hourTimestamp, score];
      });
      let lastValue: number;
      if (serieChoosen === 0) {
        lastValue = Math.max(...alignedData.map(([, score]) => score || 0));
      } else {
        lastValue = alignedData.at(-1)?.[1] ?? 0;
      }
      if (lastValue === 0) continue;
      const { v, unit } = this.getUnitByValue(lastValue);
      const segment = {
        name: `${playerName} (${v}${unit})`,
        data: alignedData,
        lastValue,
      };
      if (!this.playersColors[playerName]) {
        this.playersColors[playerName] = this.getPlayerColor(playerName);
      }
      const color = this.playersColors[playerName];
      segmentsWithColors.push({ segment, color });
    }
    segmentsWithColors.sort((a, b) => (b.segment.lastValue ?? 0) - (a.segment.lastValue ?? 0));
    const selectedSegmentsMapped = segmentsWithColors.map(({ segment }) => segment);
    const filledColorsMapped = segmentsWithColors.map(({ color }) => color);
    if (this.players.length !== selectedSegmentsMapped.length) {
      const playersWithNoData = this.players.filter(
        (player) => !selectedSegmentsMapped.some((segment) => segment.name.includes(player.playerName)),
      );
      for (const player of playersWithNoData) {
        const playerName = player.playerName;
        const lastValue = 0;
        const segment: {
          name: string;
          data: [number, number | null][];
          lastValue: number;
          hidden: boolean;
        } = {
          name: `${playerName} 💤`,
          data: weekHours.map((hour) => [new Date(hour).getTime(), -1]),
          lastValue,
          hidden: true,
        };
        if (!this.playersColors[playerName]) {
          this.playersColors[playerName] = this.getPlayerColor(playerName);
        }
        const color = this.playersColors[playerName];
        selectedSegmentsMapped.push(segment);
        filledColorsMapped.push(color);
      }
    }
    this.initChartOption('loot', selectedSegmentsMapped, filledColorsMapped);
    this.constructParticipationRateChart('loot', selectedSegmentsMapped);
    this.constructRadarChart('loot', selectedSegmentsMapped);
  }

  private getPlayerName(playerId: string): string {
    return this.players.find((player) => player.playerId.toString() === playerId)?.playerName || 'Joueur inconnu';
  }

  private buildGlobalTimeline(selectedSegments: { name: string; data: [number, number][] }[]): number[] {
    const allDates = new Set<number>();
    selectedSegments.forEach((segment) => {
      const segmentData = segment.data;
      segmentData.forEach((point) => allDates.add(point[0]));
    });
    return [...allDates].sort((a, b) => a - b);
  }

  private initGenericEventData(
    chartKey: keyof typeof ApiPlayerStatsType,
    eventKey: ApiPlayerStatsType,
    data: Record<ApiPlayerStatsType, ApiPlayerStatsAlliance[]>,
    serieChoosen: number,
  ): void {
    const eventData = data[eventKey];
    if (!eventData) return;
    const playerMap = new Map<
      number,
      {
        playerName: string;
        segments: { name: string; data: [number, number][]; lastValue: number };
      }
    >();
    const filledSeries: {
      name: string;
      data: [number, number][];
      hidden: boolean;
      custom?: Record<string, unknown>;
    }[] = [];

    if (eventKey === ApiPlayerStatsType.might) {
      for (const record of eventData) {
        const { player_id, date, point } = record;

        if (!playerMap.has(player_id)) {
          playerMap.set(player_id, {
            playerName: this.getPlayerName(player_id.toString()),
            segments: { name: '', data: [], lastValue: 0 },
          });
        }

        const player = playerMap.get(player_id);
        if (player) {
          player.segments.data.push([new Date(date).getTime(), point]);
        }
      }
      this.eventTitles[chartKey] = '-';
      const segmentsWithColors: {
        segment: { name: string; data: [number, number][]; lastValue: number };
        color: string;
      }[] = [];
      for (const [, playerData] of playerMap.entries()) {
        const { playerName, segments } = playerData;

        const lastValue = segments.data.at(-1)?.[1] ?? 0;
        const { v, unit } = this.getUnitByValue(lastValue);

        const segment = {
          name: `${playerName} (${v}${unit})`,
          data: segments.data,
          lastValue,
        };
        if (!this.playersColors[playerName]) {
          this.playersColors[playerName] = this.getPlayerColor(playerName);
        }
        const color = this.playersColors[playerName];
        segmentsWithColors.push({ segment, color });
      }
      segmentsWithColors.sort((a, b) => b.segment.lastValue - a.segment.lastValue);
      const selectedSegmentsMapped = segmentsWithColors.map(({ segment }) => segment);
      const filledColorsMapped = segmentsWithColors.map(({ color }) => color);
      const globalTimeline = this.buildGlobalTimeline(selectedSegmentsMapped);
      for (const segment of selectedSegmentsMapped) {
        const alignedData = this.alignSeriesToTimeline(segment.data, globalTimeline);
        filledSeries.push({
          name: segment.name,
          data: alignedData,
          hidden: false,
        });
      }
      this.initChartOption(chartKey, filledSeries, filledColorsMapped);
      return;
    }

    // Step 1
    for (const record of eventData) {
      const { player_id, date, point } = record;
      if (!playerMap.has(player_id)) {
        playerMap.set(player_id, {
          playerName: this.getPlayerName(player_id.toString()),
          segments: { name: '', data: [], lastValue: 0 },
        });
      }

      const player = playerMap.get(player_id);
      if (player) {
        player.segments.data.push([new Date(date).getTime(), point]);
      }
    }

    // Step 2
    const allEventTimestamps: number[] = [];
    for (const [, { segments }] of playerMap.entries()) {
      for (const [timestamp] of segments.data) {
        allEventTimestamps.push(timestamp);
      }
    }

    // Step 3
    const groupedTimestamps = this.groupEventDataByTimeGaps(allEventTimestamps.map((timestamp) => [timestamp, 0])).map(
      (group) => group.map(([timestamp]) => timestamp),
    );

    // Step 4
    let serieIndex = serieChoosen;
    if (serieChoosen <= -1) serieIndex = groupedTimestamps.length - serieChoosen * -1;
    const selectedTimestamps = groupedTimestamps[serieIndex];
    if (!selectedTimestamps) {
      this.graphPages[eventKey]++;
      return;
    }
    const eventTitle = this.generateEventTitle(selectedTimestamps.map((timestamp) => [timestamp, 0]));
    this.eventTitles[chartKey] = eventTitle;
    const segmentsWithColors: {
      segment: {
        name: string;
        data: [number, number][];
        lastValue: number;
        playerName: string;
      };
      color: string;
    }[] = [];
    // Step 5
    for (const [, playerData] of playerMap.entries()) {
      const { playerName, segments } = playerData;
      const playerScoresByTimestamp: Record<number, number> = {};
      for (const [timestamp, point] of segments.data) {
        playerScoresByTimestamp[timestamp] = point;
      }
      const alignedData: [number, number][] = selectedTimestamps.map((timestamp) => {
        return [timestamp, playerScoresByTimestamp[timestamp] || 0];
      });
      const lastValue = alignedData.at(-1)?.[1] ?? 0;
      if (lastValue === 0) continue; // If the player is completely inactive, skip them
      const { v, unit } = this.getUnitByValue(lastValue);

      const segment = {
        playerName: playerName,
        name: `${playerName} (${v}${unit})`,
        data: alignedData,
        lastValue,
      };
      if (!this.playersColors[playerName]) {
        this.playersColors[playerName] = this.getPlayerColor(playerName);
      }
      const color = this.playersColors[playerName];
      segmentsWithColors.push({ segment, color });
    }
    // Step 6
    segmentsWithColors.sort((a, b) => b.segment.lastValue - a.segment.lastValue);
    const selectedSegmentsMapped = segmentsWithColors.map(({ segment }) => segment);
    const filledColorsMapped = segmentsWithColors.map(({ color }) => color);
    const globalTimeline = this.buildGlobalTimeline(selectedSegmentsMapped);
    for (const segment of selectedSegmentsMapped) {
      const alignedData = this.alignSeriesToTimeline(segment.data, globalTimeline);
      filledSeries.push({
        custom: { playerName: segment.playerName },
        name: segment.name,
        data: alignedData,
        hidden: false,
      });
    }
    if (filledSeries.length != this.players.length) {
      const missingPlayers = this.players.filter(
        (player) => !filledSeries.some((serie) => serie.custom?.['playerName'] === player.playerName),
      );
      for (const player of missingPlayers) {
        filledSeries.push({
          name: player.playerName + ' 💤',
          data: globalTimeline.map((timestamp) => [timestamp, -1]),
          hidden: true,
        });
        filledColorsMapped.push(this.playersColors[player.playerName] || this.getPlayerColor(player.playerName));
      }
    }
    // Now we need to initialize the chart options with the filled series and colors
    this.initChartOption(chartKey, filledSeries, filledColorsMapped);
    this.constructParticipationRateChart(chartKey, filledSeries);
    this.constructRadarChart(chartKey, filledSeries);
  }

  /**
   * This method aligns a series of data points to a global timeline.
   * It takes an array of segment data points, each represented as a tuple of timestamp and
   * value, and a global timeline represented as an array of timestamps.
   * @param segmentData Segment data to align, represented as an array of tuples [timestamp, value].
   * @param globalTimeline Global timeline to align the segment data to, represented as an array of timestamps.
   * @returns An array of tuples [timestamp, value] where each timestamp is from the global timeline,
   * and the value is either the corresponding value from the segment data or 0 if no value exists for that timestamp.
   */
  private alignSeriesToTimeline(segmentData: [number, number][], globalTimeline: number[]): [number, number][] {
    return globalTimeline.map((date) => {
      const point = segmentData.find((point) => point[0] === date);
      return [date, point ? point[1] : 0];
    });
  }

  /**
   * This method returns a formatted value and its corresponding unit based on the input value.
   * @param value The value to format, can be a string or a number.
   * @returns An object containing the formatted value as a string and its unit. For example, if the value is 1500,
   * it returns { v: "1.50", unit: "k" }.
   * The units are defined as follows:
   * - "k" for thousands (1000 to 999999)
   * - "M" for millions (1,000,000 to 999,999,999)
   * - "G" for billions (1,000,000,000 to 999,999,999,999)
   * - "T" for trillions (1,000,000,000,000 and above)
   * If the value is less than 1000, it returns the value as is with no unit.
   */
  private getUnitByValue(value: string | number): { v: string; unit: string } {
    if (typeof value !== 'number' || !Number.isNaN(value)) {
      value = Number(value);
    }
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
    return { v: value.toFixed(2), unit };
  }

  /**
   * This method generates a color based on the player's name using a hash function.
   * @param name The name of the player to generate a color for.
   * @returns A string representing the RGB color in the format 'rgb(r, g, b)'.
   */
  private getPlayerColor(name: string): string {
    let hash = 0;
    for (let index = 0; index < name.length; index++) {
      hash = (name.codePointAt(index) || 0) + ((hash << 5) - hash);
    }
    // Extract RGB values from the hash
    const r = (hash >> 16) & 255;
    const g = (hash >> 8) & 255;
    const b = hash & 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  private getCurrentMonday(): Date {
    const currentDate = new Date();
    const dayOfWeek = currentDate.getDay();
    const currentMonday = new Date(currentDate);
    // Set the date to the most recent Monday (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    currentMonday.setDate(currentDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    // Set the time to 00:00:00.000 UTC
    currentMonday.setUTCHours(0, 0, 0, 0);
    return currentMonday;
  }

  private getCurrentSunday(): Date {
    const currentMonday = this.getCurrentMonday();
    const currentSunday = new Date(currentMonday);
    currentSunday.setDate(currentMonday.getDate() + 6);
    currentSunday.setUTCHours(23, 0, 0, 0);
    return currentSunday;
  }

  private getPreviousMonday(): Date {
    const currentMonday = this.getCurrentMonday();
    const previousMonday = new Date(currentMonday);
    previousMonday.setDate(currentMonday.getDate() - 7);
    return previousMonday;
  }

  private generateWeekHours(start: Date, end: Date): string[] {
    const dates = [];
    const current = new Date(start);
    while (current <= end) {
      dates.push(current.toISOString().replace('T', ' ').slice(0, 16));
      current.setHours(current.getHours() + 1);
    }
    return dates;
  }

  private initChartOption(name: keyof typeof ApiPlayerStatsType, data: ApexAxisChartSeries, color: string[]): void {
    const dateFormat = this.translateService.instant('Date_4');
    const isCumul = this.cumulSeries[name];
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
            return value > 0 ? value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
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
        height: ChartTypeHeights.DEFAULT,
        type: 'area',
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        zoom: {
          type: 'x',
          enabled: true,
          autoScaleYaxis: true,
        },
        stacked: isCumul,
        stackType: isCumul ? 'normal' : undefined,
        toolbar: {},
      },
      colors: color,
      fill: {
        type: 'gradient',
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
  }

  private addPageTitle(allianceName: string): void {
    const title = this.translateService.get('Alliance - 0', { allianceName });
    title.subscribe((translatedTitle) => {
      this.titleService.setTitle(translatedTitle);
    });
  }

  private constructParticipationRateChart(
    chartKey: keyof typeof ApiPlayerStatsType,
    data: { name: string; data: [number, number | null][]; hidden?: boolean }[],
  ): void {
    // Participation chart, in pie chart, with the participation percentage in 2 series: participation and non-participation
    const totalPlayers = data.length;
    const totalParticipations = data.filter((player) => player.data.some((point) => (point[1] || 0) > 0)).length;
    const totalNonParticipations = totalPlayers - totalParticipations;
    const totalParticipationsRate = Number.parseFloat(((totalParticipations / totalPlayers) * 100).toFixed(2));
    const totalNonParticipationsRate = Number.parseFloat(((totalNonParticipations / totalPlayers) * 100).toFixed(2));
    this.initParticipationRateChart(chartKey, [totalParticipationsRate, totalNonParticipationsRate], totalPlayers);
  }

  private constructRadarChart(
    chartKey: keyof typeof ApiPlayerStatsType,
    data: { name: string; data: [number, number | null][]; hidden?: boolean }[],
  ): void {
    const categories = data.map((player) => player.name);
    const series = data.map((player) => {
      const max = Math.max(...player.data.map((point) => point[1] || 0));
      return max;
    });
    const seriesFiltered = series.filter((value) => value > 0);
    const categoriesFiltered = categories.filter((_, index) => series[index] > 0);
    const logBases: Record<keyof typeof ApiPlayerStatsType, number> = {
      might: 10,
      loot: 10,
      berimond_invasion: 10,
      berimond_kingdom: 10,
      nomad: 10,
      samurai: 10,
      bloodcrow: 10,
      war_realms: 10,
    };
    this.initRadarChart(chartKey, categoriesFiltered, { name: 'Points', data: seriesFiltered }, logBases[chartKey]);
  }

  private getDailyAvgMightChange(data: { date: string; avg_diff: number }[]): { x: string; y: number }[] {
    const dailyAvgMightChange: { x: string; y: number }[] = [];
    const formatDate = this.translateService.instant('Date_7'); // 'dd/MM'
    for (const item of data) {
      const currentDate = new Date(item.date);
      const targetedDateString = format(currentDate, formatDate);
      dailyAvgMightChange.push({
        x: targetedDateString,
        y: Number(item.avg_diff.toFixed(0)),
      });
    }
    return dailyAvgMightChange;
  }

  private getBasicBarChart(data: { date: string; avg_diff: number }[], serieName: string): ChartOptions {
    const mp = this.translateService.instant('Points de puissance');
    const getUnitByValue = this.getUnitByValue;
    return {
      series: [
        {
          name: serieName,
          type: 'bar',
          data: this.getDailyAvgMightChange(data),
        },
      ],
      chart: {
        height: ChartTypeHeights.DEFAULT,
        type: 'bar',

        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        zoom: {
          enabled: false,
        },
        animations: {
          enabled: true,
        },
        toolbar: {},
      },
      colors: ['#000000'],
      fill: {
        type: 'gradient',
      },
      dataLabels: {
        enabled: true,
        formatter: function (value: number): string {
          if (value === null || value === undefined) return '0';
          return (
            (value < 0 ? '-' : '+') +
            Number(getUnitByValue(Math.abs(value)).v).toFixed(0) +
            getUnitByValue(Math.abs(value)).unit
          );
        },
        offsetY: -10,
        style: {
          fontSize: '12px',
          colors: ['#333333'],
        },
      },
      stroke: {
        width: 1,
        curve: 'smooth',
      },
      grid: {
        row: {
          colors: ['#f3f3f3', 'transparent'],
          opacity: 0.5,
        },
      },
      legend: {},
      title: {},
      xaxis: {},
      yaxis: {
        labels: {
          formatter: function (value): string {
            return value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
          },
        },
        forceNiceScale: true,
      },
      plotOptions: {
        bar: {
          colors: {
            ranges: [
              {
                from: -9_999_999_999,
                to: -1_000_000,
                color: '#c70000',
              },
              {
                from: -1_000_000,
                to: -50_000,
                color: '#ff0000',
              },
              {
                from: -50_000,
                to: 0,
                color: '#f09797',
              },
              {
                from: 0,
                to: 50_000,
                color: '#afedb7',
              },
              {
                from: 50_000,
                to: 1_000_000,
                color: '#3bc47e',
              },
              {
                from: 1_000_000,
                to: 9_999_999_999,
                color: '#127a45',
              },
            ],
          },
          horizontal: false,
        },
      },
      tooltip: {
        y: {
          formatter: function (value): string {
            return value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ' + mp;
          },
        },
      },
    };
  }

  private initMightIntraVariationChart(data: { date: string; avg_diff: number }[]): void {
    this.mightIntraVariationChart = this.getBasicBarChart(data, this.translateService.instant('Amplitude'));
    // @ts-expect-error: Property 'allowMouseWheelZoom' does not exist on type 'Zoom'
    this.mightIntraVariationChart.chart.zoom.allowMouseWheelZoom = false;
  }

  private initDailyAvgMightChangeChart(data: { date: string; avg_diff: number }[]): void {
    const dailyAvgMightChangeChart = this.getBasicBarChart(data, this.translateService.instant('Moyenne'));
    // @ts-expect-error: Property 'allowMouseWheelZoom' does not exist on type 'Zoom'
    dailyAvgMightChangeChart.chart.zoom.allowMouseWheelZoom = false;
    this.dailyAvgMightChangeChart = dailyAvgMightChangeChart;
  }

  private initMightPerHourChart(data: { date: string; point: number }[], annotations: XAxisAnnotations[]): void {
    const dateFormat = this.translateService.instant('Date_4');
    this.mightPerHourChart = {
      series: [
        {
          type: 'line',
          name: this.translateService.instant('Points de puissance'),
          data: data.map((point) => point.point),
        },
      ],
      chart: {
        height: ChartTypeHeights.DEFAULT,
        type: 'line',
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        zoom: {
          enabled: false,
        },
        animations: {
          enabled: false,
        },
        toolbar: {},
      },
      colors: ['#09753e', '#333333'],
      fill: {
        type: 'gradient',
      },
      dataLabels: {
        enabled: false,
      },
      stroke: {
        width: 2,
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
        position: 'top',
        horizontalAlign: 'right',
        floating: false,
        fontSize: '14px',
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: 400,
        offsetX: 0,
        offsetY: 0,
        labels: {
          colors: ['#a8a8a8'],
          useSeriesColors: false,
        },
        itemMargin: {
          horizontal: 0,
          vertical: 0,
        },
        markers: {},
      },
      title: {},
      tooltip: {
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
      xaxis: {
        type: 'datetime',
        categories: data.map((point) => point.date),
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
      yaxis: {
        labels: {
          formatter: function (value): string {
            return value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
          },
        },
        forceNiceScale: true,
      },
      plotOptions: {},
      annotations: {
        xaxis: annotations,
      },
      forecastDataPoints: {},
    };
    // @ts-expect-error: Property 'allowMouseWheelZoom' does not exist on type 'Zoom'
    this.mightPerHourChart.chart.zoom.allowMouseWheelZoom = false;
  }

  private initRadarChart(
    chartKey: keyof typeof ApiPlayerStatsType,
    categories: string[],
    series: { name: string; data: number[] },
    logBase = 10,
  ): void {
    this.radarCharts[chartKey] = {
      series: [
        {
          name: series.name,
          data: series.data,
        },
      ],
      chart: {
        height: ChartTypeHeights.LARGE,
        type: 'radar',
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
      },
      colors: ['#09753e', '#333333'],
      fill: {},
      dataLabels: {},
      stroke: {},
      legend: {},
      grid: {},
      title: {},
      tooltip: {},
      xaxis: {
        categories: categories,
        labels: {
          show: true,
          style: {
            colors: ['#a8a8a8'],
            fontSize: '9.5px',
            fontFamily: 'Arial, sans-serif',
          },
          offsetY: 0,
          rotateAlways: true,
          rotate: 45,
        },
      },
      yaxis: {
        logarithmic: true,
        min: 0,
        forceNiceScale: true,
        logBase: logBase,
        labels: {
          formatter: function (value): string {
            return value === 0 ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
          },
        },
      },
      annotations: {},
      forecastDataPoints: {},
      markers: {},
      plotOptions: {
        radar: {
          polygons: {
            fill: {
              colors: ['#f8f8f8', '#fff'],
            },
          },
        },
      },
    };
  }

  private initParticipationRateChart(
    chartKey: keyof typeof ApiPlayerStatsType,
    data: number[],
    totalPlayers: number,
  ): void {
    this.participationRateCharts[chartKey] = {
      // @ts-expect-error: Property 'series' does not exist on type 'ApexOptions'
      series: data,
      chart: {
        type: 'donut',
        height: ChartTypeHeights.DEFAULT,
        animations: {
          enabled: false,
        },
        toolbar: {
          show: true,
        },
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
      },
      colors: ['#09753e', '#333333'],
      fill: {
        type: 'gradient',
      },
      labels: [this.translateService.instant('Participation'), this.translateService.instant('Non-participation')],
      dataLabels: {
        enabled: true,
      },
      stroke: {
        width: 2,
      },
      legend: {
        formatter: (value, options): string => {
          return (
            value +
            ':' +
            Math.round((totalPlayers * options.w.globals.series[options.seriesIndex]) / 100) +
            ' ' +
            this.translateService.instant('Membres').toLowerCase() +
            ' (' +
            Math.round(options.w.globals.series[options.seriesIndex]) +
            '%)'
          );
        },
      },
      grid: {
        row: {
          colors: ['#f3f3f3', 'transparent'],
          opacity: 0.5,
        },
      },
      title: {},
      tooltip: {},
      xaxis: {},
      yaxis: {},
      annotations: {},
      forecastDataPoints: {},
      markers: {},
      plotOptions: {},
    };
  }

  private mapPlayersFromApi(players: ApiPlayerSearchResponse[]): Player[] {
    return players.map((player, index) => {
      return {
        rank: index + 1,
        playerId: player.player_id,
        playerName: player.player_name,
        allianceName: player.alliance_name,
        allianceId: player.alliance_id,
        mightCurrent: player.might_current,
        mightAllTime: player.might_all_time,
        lootCurrent: player.loot_current,
        lootAllTime: player.loot_all_time,
        honor: player.honor,
        maxHonor: player.max_honor,
        currentFame: player.current_fame,
        highestFame: player.highest_fame,
        remainingRelocationTime: player.remaining_relocation_time,
        isFavorite: false,
        peaceDisabledAt: player.peace_disabled_at,
        updatedAt: player.updated_at,
        level: player.level,
        distance: player.calculated_distance,
        legendaryLevel: player.legendary_level,
      };
    });
  }

  private async loadDetailsEventPlayerStats(): Promise<void> {
    let playersData: ApiPlayerStatsForAlliance = {
      player_event_berimond_invasion_history: [],
      player_event_berimond_kingdom_history: [],
      player_event_bloodcrow_history: [],
      player_event_nomad_history: [],
      player_event_samurai_history: [],
      player_event_war_realms_history: [],
      player_loot_history: [],
      player_might_history: [],
    };
    this.countQueryFinished = 0;
    this.totalQuery = 1;
    try {
      const response = await this.apiRestService.getPlayersStatsByAllianceId(this.allianceId);
      this.countQueryFinished++;
      this.cdr.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (response.success === false) {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
        return;
      }
      playersData = response.data.points;
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 20_000);
      return;
    }
    this.data = playersData;
    this.initMightHistoryData(playersData);
    this.initLootHistoryData(playersData);
    this.initBloodcrowData(playersData);
    this.initWarRealmsData(playersData);
    this.initNomadData(playersData);
    this.initSamuraiData(playersData);
    this.initBerimondKingdomData(playersData);
  }

  private initCards(serverStatsToCompare: ApiServerStats): void {
    const translatedTitle = this.translateService.instant('Moy. globale');
    const avgHonor = this.players.reduce((accumulator, player) => accumulator + player.honor, 0) / this.players.length;
    const avgMightCurrent =
      this.players.reduce((accumulator, player) => accumulator + player.mightCurrent, 0) / this.players.length;
    const maxMightByAPlayer = this.players.reduce(
      (accumulator, player) => Math.max(accumulator, player.mightCurrent),
      0,
    );
    const maxMightPlayerName = this.players.find((player) => player.mightCurrent === maxMightByAPlayer)?.playerName;
    const avgLevelNormal =
      this.players.reduce((accumulator, player) => accumulator + Number(player.level) || 0, 0) / this.players.length;
    const avgLegendaryLevel =
      this.players.reduce((accumulator, player) => accumulator + Number(player.legendaryLevel) || 0, 0) /
      this.players.length;
    const avgLevel = avgLevelNormal + avgLegendaryLevel;
    const avgLevelFormat =
      Number(avgLevel) > 70
        ? '70/' + this.customFormatter(Number(avgLevel) - 70, 0)
        : this.customFormatter(Number(avgLevel), 0);
    const avgServerLevel = serverStatsToCompare.avg_level;
    const avgServerLevelFormat =
      Number(avgServerLevel) > 70
        ? '70/' + this.customFormatter(Number(avgServerLevel) - 70, 0)
        : this.customFormatter(Number(avgServerLevel), 0);
    const maxLootByAPlayer = this.players.reduce((accumulator, player) => Math.max(accumulator, player.lootCurrent), 0);
    const maxLootPlayerName = this.players.find((player) => player.lootCurrent === maxLootByAPlayer)?.playerName;
    const percentOfTotalLoot =
      this.players.reduce((accumulator, player) => accumulator + player.lootCurrent, 0) /
      serverStatsToCompare.total_loot;
    this.cards.push(
      {
        identifier: 'avg_honor',
        label: 'Honneur moyen',
        logo: 'assets/honor2.png',
        value: this.customFormatter(avgHonor, 0),
        valueCompare: avgHonor - serverStatsToCompare.avg_honor,
        avg: translatedTitle + ' : ' + this.formatAvg(serverStatsToCompare.avg_honor, 0),
      },
      {
        identifier: 'total_honor',
        label: 'Honneur cumulé',
        logo: 'assets/honor2.png',
        value: this.customFormatter(
          this.players.reduce((accumulator, player) => accumulator + player.honor, 0),
          0,
        ),
        valueCompare: 0,
        avg: '',
      },
      {
        identifier: 'avg_might',
        label: 'Puissance moyenne',
        logo: 'assets/pp3.png',
        value: this.customFormatter(avgMightCurrent, 0),
        valueCompare: avgMightCurrent - serverStatsToCompare.avg_might,
        avg: translatedTitle + ' : ' + this.formatAvg(serverStatsToCompare.avg_might, 0),
      },
      {
        identifier: 'max_might',
        label: 'Puissance maximale',
        logo: 'assets/pp3.png',
        value: this.customFormatter(maxMightByAPlayer, 0),
        valueCompare: 0,
        avg: maxMightPlayerName || '-',
      },
      {
        identifier: 'total_might',
        label: 'Puissance cumulée',
        logo: 'assets/pp3.png',
        value: this.customFormatter(
          this.players.reduce((accumulator, player) => accumulator + player.mightCurrent, 0),
          0,
        ),
        valueCompare: 0,
        avg: '',
      },
      {
        identifier: 'avg_level',
        label: 'Niveau moyen',
        logo: 'assets/xp2.png',
        value: avgLevelFormat,
        valueCompare: Number(avgLevel) - Number(avgServerLevel),
        avg: translatedTitle + ' : ' + avgServerLevelFormat,
      },
      {
        identifier: 'avg_loot',
        label: 'Pillage hebdo moyen',
        logo: 'assets/loot4.png',
        value: this.customFormatter(
          this.players.reduce((accumulator, player) => accumulator + player.lootCurrent, 0),
          0,
        ),
        valueCompare: serverStatsToCompare.avg_loot,
        avg: translatedTitle + ' : ' + this.formatAvg(serverStatsToCompare.avg_loot, 0),
      },
      {
        identifier: 'max_loot',
        label: 'Pillage hebdo maximal',
        logo: 'assets/loot4.png',
        value: this.customFormatter(maxLootByAPlayer, 0),
        valueCompare: 0,
        avg: maxLootPlayerName || '-',
      },
      {
        identifier: 'total_loot',
        label: 'Pillage hebdo cumulé',
        logo: 'assets/loot4.png',
        value: this.customFormatter(
          this.players.reduce((accumulator, player) => accumulator + player.lootCurrent, 0),
          0,
        ),
        valueCompare: 0,
        avg: this.formatAvg(percentOfTotalLoot * 100, 2) + this.translateService.instant('% du total'),
      },
      {
        identifier: 'players_count',
        label: 'Nombre de joueurs',
        logo: 'assets/players.png',
        value: this.players.length.toString(),
        valueCompare: 0,
        avg: '',
      },
    );
  }
}
