import {
  DatePipe,
  isPlatformBrowser,
  KeyValuePipe,
  NgClass,
  NgFor,
  NgIf,
  NgTemplateOutlet,
  NgStyle,
} from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  input,
  OnInit,
  output,
  PLATFORM_ID,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { ApiGenericData, ChartOptions, ChartTypes, EventGenericVariation } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { TranslateModule } from '@ngx-translate/core';
import { ChartComponent } from 'ng-apexcharts';

@Component({
  selector: 'app-player-stats-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    ChartsWrapperComponent,
    NgFor,
    DatePipe,
    FormatNumberPipe,
    NgIf,
    KeyValuePipe,
    TranslateModule,
    NgTemplateOutlet,
    NgStyle,
  ],
  templateUrl: './player-stats-card.component.html',
  styleUrl: './player-stats-card.component.css',
})
export class PlayerStatsCardComponent implements AfterViewInit, OnInit {
  @ViewChildren('chartComp') public chartComps!: QueryList<ChartsWrapperComponent>;
  public platformId = inject(PLATFORM_ID);
  public isBrowser = isPlatformBrowser(this.platformId);
  public isReady = false;
  public title = input.required<string>();
  public onePlayerOnly = input<boolean>(true);
  public subtitle = input<string>();
  public charts = input.required<Partial<Record<ChartTypes, ChartOptions | null>>>();
  public data = input.required<EventGenericVariation[]>();
  public dataName = input.required<string>();
  public backgroundIconImage = input.required<string>();
  public backgroundColour = input.required<string>();
  public isWeekly = input<boolean>(false);
  public ngContentCustom = input<boolean>();
  public playerId = input<number>();
  public needSpecialLoader = input<boolean>(false);
  public eventName = input.required<string>();
  public period = 'week';
  public maxLoadedPeriod = 'week';
  public selectedTab = ChartTypes.EVOLUTION;
  public inversedData: EventGenericVariation[] = [];
  public changeTabOutput = output<ChartTypes>();
  public updateData = output<{ eventName: string; points: ApiGenericData[] }>();

  private cdr = inject(ChangeDetectorRef);
  private apiRestService = inject(ApiRestService);

  public ngOnInit(): void {
    const value = Object.keys(this.charts())[0] as ChartTypes;
    this.selectedTab = value;
    this.cdr.detectChanges();
  }

  public ngAfterViewInit(): void {
    if (!this.needSpecialLoader()) {
      setTimeout(() => {
        this.isReady = true;
        this.cdr.detectChanges();
      }, 200);
    }
  }

  public getPlayerColor(entry: EventGenericVariation): string {
    if (entry.point === 0) {
      return 'gray';
    }
    // We randomize color based on player name to have consistent colors for same players
    let hash = 0;
    if (!entry.playerName) {
      return '#000000';
    }
    for (let index = 0; index < entry.playerName.length; index++) {
      const code = entry.playerName.codePointAt(index);
      if (code) {
        hash = code + ((hash << 5) - hash);
      }
    }
    const color = Math.floor(Math.abs((Math.sin(hash) * 16_777_215) % 16_777_215)).toString(16);
    return `#${'000000'.slice(0, Math.max(0, 6 - color.length)) + color}`;
  }

  public changeTab(tab: string): void {
    this.selectedTab = tab as ChartTypes;
    this.changeTabOutput.emit(tab as ChartTypes);
    this.cdr.detectChanges();
  }

  public originalOrder = (): number => {
    return 0;
  };

  public getHourPeriod(period: 'day' | 'week' | 'month' | 'year'): number {
    switch (period) {
      case 'day': {
        return 1;
      }
      case 'week': {
        return 7;
      }
      case 'month': {
        return 30;
      }
      case 'year': {
        return 365;
      }
      default: {
        return 7;
      }
    }
  }

  public onChartComponentInitialized(chartComponent: ChartComponent): void {
    if (this.isWeekly()) {
      setTimeout(() => {
        this.chartComps.toArray().forEach((chart) => {
          chart.component = chartComponent;
        });
        this.changePeriod('week');
        setTimeout(() => {
          this.isReady = true;
          this.cdr.detectChanges();
        }, 10);
        this.cdr.detectChanges();
      }, 10);
    }
  }

  public changePeriod(period: 'day' | 'week' | 'month' | 'year'): void {
    if (!this.chartComps) return;
    this.period = period;
    this.chartComps.toArray().forEach((chart) => {
      const categories = chart.xaxis()?.categories as string[];
      const targetChart = chart.component;
      if (!targetChart) return;
      switch (period) {
        case 'day': {
          if (categories.length < 24) {
            targetChart.zoomX(new Date(categories[0]).getTime(), new Date(categories.at(-1)!).getTime());
          } else {
            targetChart.zoomX(new Date(categories.at(-24)!).getTime(), new Date(categories.at(-1)!).getTime());
          }
          break;
        }
        case 'week': {
          if (categories.length < 7 * 24) {
            targetChart.zoomX(new Date(categories[0]).getTime(), new Date(categories.at(-1)!).getTime());
          } else {
            targetChart.zoomX(
              new Date(categories[categories.length - 7 * 24]).getTime(),
              new Date(categories.at(-1)!).getTime(),
            );
          }
          break;
        }
        case 'month': {
          if (categories.length < 30 * 24) {
            targetChart.zoomX(new Date(categories[0]).getTime(), new Date(categories.at(-1)!).getTime());
          } else {
            targetChart.zoomX(
              new Date(categories[categories.length - 30 * 24]).getTime(),
              new Date(categories.at(-1)!).getTime(),
            );
          }
          break;
        }
        case 'year': {
          if (categories.length < 365 * 24) {
            targetChart.zoomX(new Date(categories[0]).getTime(), new Date(categories.at(-1)!).getTime());
          } else {
            targetChart.zoomX(
              new Date(categories[categories.length - 365 * 24]).getTime(),
              new Date(categories.at(-1)!).getTime(),
            );
          }
          break;
        }
      }
    });
    this.cdr.detectChanges();
  }

  public getIcon(selectedChart: string): string {
    switch (selectedChart) {
      case ChartTypes.EVOLUTION: {
        return 'fas fa-chart-line';
      }
      case ChartTypes.PARTICIPATION_RATE: {
        return 'fa-solid fa-circle-notch';
      }
      case ChartTypes.RADAR: {
        return 'fas fa-chart-pie';
      }
      case ChartTypes.TABLE: {
        return 'fas fa-table';
      }
      default: {
        return 'fas fa-chart-line';
      }
    }
  }

  private checkMaxLoadedPeriod(period: 'day' | 'week' | 'month' | 'year'): boolean {
    if (this.maxLoadedPeriod === 'year') return true;
    if (
      period === 'year' &&
      (this.maxLoadedPeriod === 'day' || this.maxLoadedPeriod === 'week' || this.maxLoadedPeriod === 'month')
    ) {
      return false;
    }
    if (period === 'month' && (this.maxLoadedPeriod === 'day' || this.maxLoadedPeriod === 'week')) {
      return false;
    }
    if (period === 'week' && this.maxLoadedPeriod === 'day') {
      return false;
    }
    return true;
  }

  private async loadData(period: 'day' | 'week' | 'month' | 'year'): Promise<void> {
    if (!this.chartComps) return;
    if (this.checkMaxLoadedPeriod(period)) return;
    const eventName = this.eventName();
    const playerId = this.playerId();
    if (!playerId) return;
    void this.apiRestService
      .getPlayerStatsOnSpecificEventByPlayerId(playerId, eventName, this.getHourPeriod(period))
      .then((response) => {
        if (response.success) {
          const data = response.data;
          const points = data.points[eventName as keyof typeof data.points] as ApiGenericData[];
          this.maxLoadedPeriod = period;
          this.updateData.emit({ eventName, points });
        }
      });
  }
}
