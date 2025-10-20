import { DatePipe, NgClass, NgForOf, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { XAxisAnnotations } from 'ng-apexcharts';

import {
  ChartOptions,
  AllianceStatsData,
  Card,
  ApiServerStats,
  ApiResponse,
} from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { LanguageService } from '@ggetracker-services/language.service';
import { WindowService } from '@ggetracker-services/window.service';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ServerBadgeComponent } from '@ggetracker-components/server-badge/server-badge.component';

@Component({
  selector: 'app-server-statistics',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ChartsWrapperComponent,
    NgIf,
    FormsModule,
    NgForOf,
    NgClass,
    DatePipe,
    TranslateModule,
    ServerBadgeComponent,
  ],
  templateUrl: './server-statistics.component.html',
  styleUrl: './server-statistics.component.css',
})
export class ServerStatisticsComponent extends GenericComponent implements OnInit {
  public charts: Record<string, ChartOptions> = {};
  public currentChartUpdateLoading = false;
  public nbAlliances = 0;
  public rangeOptions: { value: number; label: string; selected: boolean }[] = [];
  public rangeSelected = 100;
  public cards: Card[] = [];
  public lastUpdate = '';
  public serverStatsData: ApiServerStats[] = [];
  public selectedCard: Card | null = null;
  public selectedTab: 'graph' | 'table' = 'graph';

  private cdr = inject(ChangeDetectorRef);
  private windowService = inject(WindowService);
  private languageService = inject(LanguageService);
  private data: AllianceStatsData[] = [];

  public ngOnInit(): void {
    const lastUpdate = this.utilitiesService.data$.subscribe((data) => {
      if (data) {
        this.lastUpdate = data.last_update.might;
        lastUpdate.unsubscribe();
        this.cdr.detectChanges();
      }
    });
    void this.getGlobalStats().then((data) => {
      if (data.success) {
        const dataStats = data.data;
        this.serverStatsData = dataStats;
        const lastData = this.initLastData(dataStats.at(-1));
        const previousData = this.initLastData(dataStats.at(-2));
        this.cards.push(
          {
            identifier: 'avg_honor',
            label: 'Honneur moyen',
            logo: 'assets/honor2.png',
            value: this.customFormatter(lastData.avg_honor, 0),
            valueCompare: lastData.avg_honor - previousData.avg_honor,
            avg: this.formatAvg(lastData.avg_honor - previousData.avg_honor),
          },
          {
            identifier: 'total_honor',
            label: 'Honneur cumulé',
            logo: 'assets/honor2.png',
            value: this.customFormatter(lastData.total_honor, 0),
            valueCompare: lastData.total_honor - previousData.total_honor,
            avg: this.formatAvg(lastData.total_honor - previousData.total_honor, 0),
          },
          {
            identifier: 'avg_might',
            label: 'Puissance moyenne',
            logo: 'assets/pp3.png',
            value: this.customFormatter(lastData.avg_might, 0),
            valueCompare: lastData.avg_might - previousData.avg_might,
            avg: this.formatAvg(lastData.avg_might - previousData.avg_might, 0),
          },
          {
            identifier: 'max_might',
            label: 'Puissance maximale',
            logo: 'assets/pp3.png',
            value: this.customFormatter(lastData.max_might, 0),
            valueCompare: lastData.max_might - previousData.max_might,
            avg: this.formatAvg(lastData.max_might - previousData.max_might, 0),
          },
          {
            identifier: 'total_might',
            label: 'Puissance cumulée',
            logo: 'assets/pp3.png',
            value: this.customFormatter(lastData.total_might, 0),
            valueCompare: lastData.total_might - previousData.total_might,
            avg: this.formatAvg(lastData.total_might - previousData.total_might, 0),
          },
        );
        const avgLevel =
          Number(this.customFormatter(lastData.avg_level, 0)) > 70
            ? ('70/' + (Number(this.customFormatter(lastData.avg_level, 0)) - 70)).toString()
            : Number(this.customFormatter(lastData.avg_level, 0)).toString();
        this.cards.push(
          {
            identifier: 'avg_level',
            label: 'Niveau moyen',
            logo: 'assets/xp2.png',
            value: avgLevel,
            valueCompare: lastData.avg_level - previousData.avg_level,
            avg: this.formatAvg(lastData.avg_level - previousData.avg_level, 3),
          },
          {
            identifier: 'avg_loot',
            label: 'Pillage hebdo moyen',
            logo: 'assets/loot4.png',
            value: this.customFormatter(lastData.avg_loot, 0),
            valueCompare: lastData.avg_loot - previousData.avg_loot,
            avg: this.formatAvg(lastData.avg_loot - previousData.avg_loot, 0),
          },
          {
            identifier: 'max_loot',
            label: 'Pillage hebdo maximal',
            logo: 'assets/loot4.png',
            value: this.customFormatter(lastData.max_loot, 0),
            valueCompare: lastData.max_loot - previousData.max_loot,
            avg: this.formatAvg(lastData.max_loot - previousData.max_loot, 0),
          },
          {
            identifier: 'total_loot',
            label: 'Pillage hebdo cumulé',
            logo: 'assets/loot4.png',
            value: this.customFormatter(lastData.total_loot, 0),
            valueCompare: lastData.total_loot - previousData.total_loot,
            avg: this.formatAvg(lastData.total_loot - previousData.total_loot, 0),
          },
          {
            identifier: 'players_count',
            label: 'Nombre de joueurs',
            logo: 'assets/players.png',
            value: this.customFormatter(lastData.players_count, 0),
            valueCompare: lastData.players_count - previousData.players_count,
            avg: this.formatAvg(lastData.players_count - previousData.players_count, 0),
          },
          {
            identifier: 'players_who_changed_alliance',
            label: "Nombre de joueurs ayant changé d'alliance",
            logo: 'assets/players.png',
            value: this.customFormatter(lastData.players_who_changed_alliance, 0),
            valueCompare: lastData.players_who_changed_alliance - previousData.players_who_changed_alliance,
            avg: this.formatAvg(lastData.players_who_changed_alliance - previousData.players_who_changed_alliance, 0),
          },
          {
            identifier: 'players_who_changed_name',
            label: 'Nombre de joueurs ayant changé de pseudonyme',
            logo: 'assets/players.png',
            value: this.customFormatter(lastData.players_who_changed_name, 0),
            valueCompare: lastData.players_who_changed_name - previousData.players_who_changed_name,
            avg: this.formatAvg(lastData.players_who_changed_name - previousData.players_who_changed_name, 0),
          },
        );
        const rate = lastData.events_participation_rate;
        Object.keys(rate).forEach((key) => {
          let label = '';
          let logo = '';
          if (Number(key) === 46 && lastData.event_nomad_points && previousData.event_nomad_points) {
            label = 'Taux de participation aux nomades';
            logo = 'assets/nomads.png';
            this.cards.push({
              identifier: 'event_nomad_points',
              label: 'Points nomades cumulés',
              logo: 'assets/nomads.png',
              value: this.customFormatter(lastData.event_nomad_points, 0),
              valueCompare: lastData.event_nomad_points - previousData.event_nomad_points,
              avg: this.formatAvg(lastData.event_nomad_points - previousData.event_nomad_points, 0),
            });
          } else if (Number(key) === 51 && lastData.event_samurai_points && previousData.event_samurai_points) {
            label = 'Taux de participation aux samouraïs';
            logo = 'assets/samurai.png';
            this.cards.push({
              identifier: 'event_samurai_points',
              label: 'Points samouraïs cumulés',
              logo: 'assets/samurai.png',
              value: this.customFormatter(lastData.event_samurai_points, 0),
              valueCompare: lastData.event_samurai_points - previousData.event_samurai_points,
              avg: this.formatAvg(lastData.event_samurai_points - previousData.event_samurai_points, 0),
            });
          } else if (Number(key) === 44 && lastData.event_war_realms_points && previousData.event_war_realms_points) {
            label = 'Taux de participation aux guerres des royaumes';
            logo = 'assets/war_realms.png';
            this.cards.push({
              identifier: 'event_war_realms_points',
              label: 'Points guerre des royaumes cumulés',
              logo: 'assets/war_realms.png',
              value: this.customFormatter(lastData.event_war_realms_points, 0),
              valueCompare: lastData.event_war_realms_points - previousData.event_war_realms_points,
              avg: this.formatAvg(lastData.event_war_realms_points - previousData.event_war_realms_points, 0),
            });
          } else if (
            Number(key) === 30 &&
            lastData.event_berimond_kingdom_points &&
            previousData.event_berimond_kingdom_points
          ) {
            label = 'Taux de participation aux royaumes de Berimond';
            logo = 'assets/berimond.png';
            this.cards.push({
              identifier: 'event_berimond_kingdom_points',
              label: 'Points royaumes de Berimond cumulés',
              logo: 'assets/berimond.png',
              value: this.customFormatter(lastData.event_berimond_kingdom_points, 0),
              valueCompare: lastData.event_berimond_kingdom_points - previousData.event_berimond_kingdom_points,
              avg: this.formatAvg(
                lastData.event_berimond_kingdom_points - previousData.event_berimond_kingdom_points,
                0,
              ),
            });
          } else if (Number(key) === 58 && lastData.event_bloodcrow_points && previousData.event_bloodcrow_points) {
            label = 'Taux de participation aux corbeaux de sang';
            logo = 'assets/bloodcrow.png';
            this.cards.push({
              identifier: 'event_bloodcrow_points',
              label: 'Points corbeaux de sang cumulés',
              logo: 'assets/bloodcrow.png',
              value: this.customFormatter(lastData.event_bloodcrow_points, 0),
              valueCompare: lastData.event_bloodcrow_points - previousData.event_bloodcrow_points,
              avg: this.formatAvg(lastData.event_bloodcrow_points - previousData.event_bloodcrow_points, 0),
            });
          }
          if (label && logo) {
            const nbPlayersParticipating = rate[key][0];
            const percent = (nbPlayersParticipating / lastData.players_count) * 100;
            this.cards.push({
              identifier: 'events_participation_rate',
              label,
              logo,
              value: percent.toFixed(2) + '%',
              valueCompare: percent - rate[key][1],
              avg: this.formatAvg(percent - rate[key][1], 2) + '%',
            });
          }
        });
        this.cards.push(
          {
            identifier: 'alliance_count',
            label: "Nombre d'alliances",
            logo: 'assets/alliance2.png',
            value: this.customFormatter(lastData.alliance_count, 0),
            valueCompare: lastData.alliance_count - previousData.alliance_count,
            avg: this.formatAvg(lastData.alliance_count - previousData.alliance_count, 0),
          },
          {
            identifier: 'alliances_changed_name',
            label: 'Alliances ayant changé de nom',
            logo: 'assets/alliance2.png',
            value: this.customFormatter(lastData.alliances_changed_name, 0),
            valueCompare: lastData.alliances_changed_name - previousData.alliances_changed_name,
            avg: this.formatAvg(lastData.alliances_changed_name - previousData.alliances_changed_name, 0),
          },
        );
        this.isInLoading = false;
        this.cdr.detectChanges();
        this.isInLoading = false;
      }
    });
  }

  /**
   * Formats the average value for display.
   * @param value The value to format.
   * @returns The formatted value and its unit.
   */
  public getUnitByValue(value: number): { value: number; unit: string } {
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
    return { value, unit };
  }

  /**
   * When the user clicks on a card, we open a modal.
   * This modal will create a chart with the data of the card.
   * @param identifier The identifier of the card
   * @param card The card object
   * @returns void
   */
  public openModal(identifier: keyof ApiServerStats, card: Card): void {
    if (identifier === 'events_participation_rate') return;
    this.selectedCard = card;
    const specialIdentifier = identifier == 'alliances_changed_name' || identifier == 'players_who_changed_name';
    const curveStroke = specialIdentifier ? 'straight' : 'straight';
    const chart: ChartOptions = {
      series: [],
      chart: {
        type: specialIdentifier ? 'area' : 'area',
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        zoom: {
          enabled: true,
        },
        events: {
          beforeZoom: function (context): void {
            context.w.config.xaxis.range = undefined;
          },
        },
        toolbar: {
          tools: {
            download: true,
            selection: true,
            zoom: true,
            zoomin: true,
            zoomout: true,
            pan: true,
            reset: true,
          },
        },
      },
      xaxis: {
        type: 'datetime',
        range: 7 * 24 * 60 * 60 * 1000, // 1 day
        categories: Object.keys(this.serverStatsData.map((d) => d.created_at)),
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
      colors: [],
      fill: {
        colors: ['#aaaaaa'],
        type: 'solid',
      },
      plotOptions: {
        bar: {
          horizontal: false,
        },
      },
      yaxis: {},
      dataLabels: {
        enabled: false,
      },
      grid: {
        row: {
          colors: ['#f3f3f3', 'transparent'],
          opacity: 0.5,
        },
      },
      annotations: {},
      legend: {
        show: false,
      },
      stroke: {
        curve: curveStroke,
      },
      forecastDataPoints: {
        count: 1,
      },
      title: {},
      tooltip: {},
    };
    let data = this.serverStatsData.map((d) => {
      return {
        x: d.created_at,
        y: d[identifier]?.toString().includes('.')
          ? Number.parseFloat(Number(d[identifier]).toFixed(3))
          : d[identifier],
      };
    });
    // We need to remove the null values from the data
    data = data.filter((d) => d.y !== null);
    data.sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime());
    chart.yaxis = {
      labels: {
        formatter: (value: number): string => {
          return value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
        },
      },
    };
    chart.tooltip = {
      y: {
        formatter: (value: number): string => {
          return value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
        },
      },
      x: {
        format: this.translateService.instant('Date_6'),
      },
    };
    if (identifier.startsWith('event_')) {
      let lastData: {
        x: string;
        y: string | number | null | Record<string, { id: string; point: number }[]>;
      }[] = [];
      for (let index = data.length - 1; index >= 0; index--) {
        if (data[index].y === 0) {
          const slice = data.slice(index);
          lastData = slice.map((d) => {
            return { x: d.x, y: d.y };
          });
          break;
        }
      }
      chart.series = [
        {
          name: card.label,
          data: lastData,
        },
      ];
      chart.xaxis.min = new Date(lastData[0].x).getTime();
      if (lastData.at(-1)) {
        chart.xaxis.max = new Date(lastData.at(-1)!.x).getTime();
      }
    } else if (identifier === 'avg_level') {
      chart.series = [
        {
          name: card.label,
          data,
        },
      ];
      chart.yaxis = {
        labels: {
          formatter: (value: number): string => {
            const level = value > 70 ? '70/' + (Math.round(value) - 70) : Math.round(value);
            return level.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
          },
        },
      };
      const y = chart.tooltip.y;
      if (y) {
        // @ts-expect-error: formatter is not a recognized property but is used for configuration
        y.formatter = (value: number): string => {
          const level = value > 70 ? '70/' + (Math.round(value) - 70) : Math.round(value);
          return level.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
        };
      }
    } else {
      if (identifier === 'players_who_changed_name' || identifier === 'alliances_changed_name') {
        const groupedData: Record<string, number> = {};
        data.forEach((d) => {
          const date = new Date(d.x);
          const dateString = date.toISOString().split('T')[0];
          if (!groupedData[dateString]) {
            groupedData[dateString] = 0;
          }
          groupedData[dateString] += d.y as number;
        });
        data = Object.entries(groupedData).map(([key, value]) => {
          return { x: key, y: value };
        });
        data.sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime());
      }
      chart.series = [
        {
          name: card.label,
          data,
        },
      ];
    }
    const timestamps = this.serverStatsData.map((d) => new Date(d.created_at).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const annotations: XAxisAnnotations[] = [];
    let currentTime = new Date(minTime);
    currentTime.setHours(6, 0, 0, 0);
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
    const name = chart.series[0].name;
    if (name !== undefined) {
      chart.series[0].name = this.translateService.instant(name);
      const annotations = chart.annotations;
      if (annotations) annotations.xaxis = annotations.xaxis || [];
    }
    // Remove 'statistics' chart if already exists
    if (this.charts['statistics']) {
      delete this.charts['statistics'];
    }
    this.cdr.detectChanges();
    this.charts['statistics'] = chart;
    this.cdr.detectChanges();
  }

  public changeTab(tab: 'graph' | 'table'): void {
    this.selectedTab = tab;
  }

  public customFormatter(value: number, precision: number): string {
    return value.toFixed(precision).replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  public formatAvg(value: number, toFixed = 3): string {
    return (value > 0 ? '+' + value.toFixed(toFixed) : value.toFixed(toFixed)).replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  public async changeRange(range: Event): Promise<void> {
    if (!this.data) return;
    const value = (range.target as HTMLSelectElement).value;
    this.currentChartUpdateLoading = true;
    setTimeout(() => {
      this.rangeSelected = Number.parseInt(value);
      this.initChartOption('mights', this.data, Number.parseInt(value));
      this.currentChartUpdateLoading = false;
    }, 100);
  }

  public export(): void {
    const win = this.windowService.getWindow();
    if (!win) return;
    const selectedCard = this.selectedCard;
    if (!selectedCard) return;
    const data = this.serverStatsData.map((d) => {
      return {
        x: new Date(d.created_at).toLocaleString(),
        y: d[selectedCard.identifier],
      };
    });
    data.unshift({
      x: 'Date',
      y: this.translateService.instant(selectedCard.label),
    });
    const csv = '\uFEFF' + data.map((d) => `${d.x};${d.y}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = win.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.translateService.instant(selectedCard.label) + '.csv';
    a.click();
    win.URL.revokeObjectURL(url);
  }

  private getRangeOptions(): { value: number; label: string; selected: boolean }[] {
    const nbAlliances = this.nbAlliances;
    const indice = 100;
    const rangeOptions = [];
    for (let index = 100; index <= nbAlliances; index += indice) {
      rangeOptions.push({
        value: index,
        label: `${index}`,
        selected: index === this.rangeSelected,
      });
    }
    if (!rangeOptions.some((r) => r.value === nbAlliances)) {
      rangeOptions.push({
        value: nbAlliances,
        label: `Toutes les alliances (${nbAlliances})`,
        selected: nbAlliances === this.rangeSelected,
      });
    }

    return rangeOptions;
  }

  private async getGlobalStats(): Promise<ApiResponse<ApiServerStats[]>> {
    return await this.apiRestService.getServerGlobalStats();
  }

  private initLastData(data: ApiServerStats | undefined): ApiServerStats {
    if (!data) {
      const emptyData: ApiServerStats = {
        avg_honor: 0,
        total_honor: 0,
        avg_might: 0,
        total_might: 0,
        avg_level: 0,
        avg_loot: 0,
        max_might: 0,
        max_loot: 0,
        total_loot: 0,
        players_count: 0,
        players_who_changed_alliance: 0,
        players_who_changed_name: 0,
        event_nomad_points: 0,
        event_samurai_points: 0,
        event_war_realms_points: 0,
        event_bloodcrow_points: 0,
        alliance_count: 0,
        alliances_changed_name: 0,
        event_berimond_invasion_players: 0,
        event_berimond_invasion_points: 0,
        created_at: '',
        event_berimond_kingdom_players: 0,
        event_berimond_kingdom_points: 0,
        event_bloodcrow_players: 0,
        event_nomad_players: 0,
        event_samurai_players: 0,
        event_war_realms_players: 0,
        events_count: 0,
        events_participation_rate: {},
        events_top_3_names: {},
        variation_honor: 0,
        variation_loot: 0,
        variation_might: 0,
      };
      return emptyData;
    }
    return data;
  }

  private initChartOption(name: string, data: AllianceStatsData[], limit: number): void {
    const series = data.map((d: AllianceStatsData) => {
      return { x: d.alliance_name ?? '❗Sans alliance', y: d.total_might };
    });
    series.sort((a, b) => b.y - a.y);
    if (series.length > limit) {
      series.length = limit;
    }
    const total = series.reduce((accumulator, current) => accumulator + current.y, 0);
    series.forEach((d) => {
      d.x = `${d.x} (${((d.y / total) * 100).toFixed(2)}%)`;
    });
    this.charts[name] = {
      series: [
        {
          name: 'Might',
          data: series,
        },
      ],
      title: {},
      tooltip: {
        y: {
          formatter: (value: number): string => {
            return value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',') + ' (points de puissance)';
          },
        },
      },
      plotOptions: {
        treemap: {
          enableShades: true,
          shadeIntensity: 0.7,
          reverseNegativeShade: true,
          colorScale: {
            ranges: [
              {
                from: 0,
                to: 1_000_000,
                color: '#CD363A',
              },
              {
                from: 1_000_000,
                to: 10_000_000,
                color: '#FFA500',
              },
              {
                from: 10_000_000,
                to: 50_000_000,
                color: '#f0fc03',
              },
              {
                from: 50_000_000,
                to: 200_000_000,
                color: '#32CD32',
              },
              {
                from: 200_000_000,
                to: 1_000_000_000,
                color: '#3eb5c7',
              },
              {
                from: 1_000_000_000,
                to: 5_000_000_000,
                color: '#0000FF',
              },
              {
                from: 5_000_000_000,
                to: this.data[0].total_might + 1,
                color: '#701cba',
              },
            ],
          },
        },
      },
      legend: {},
      chart: {
        type: 'treemap',
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        zoom: {
          enabled: true,
        },
        toolbar: {
          tools: {
            download: true,
            selection: false,
            zoom: false,
            zoomin: false,
            zoomout: false,
            pan: false,
            reset: false,
          },
        },
      },
      colors: [],
      fill: {},
      dataLabels: {},
      stroke: {
        curve: 'smooth',
      },
      grid: {
        row: {
          colors: ['#f3f3f3', 'transparent'],
          opacity: 0.5,
        },
      },
      xaxis: {
        type: 'category',
      },
      yaxis: {
        labels: {
          formatter: (value: number): string => {
            return value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
          },
        },
      },
    };
    if (this.charts[name].chart.zoom) {
      // @ts-expect-error: allowMouseWheelZoom is not a recognized property but is used for configuration
      this.charts[name].chart.zoom.allowMouseWheelZoom = false;
    }
  }
}
