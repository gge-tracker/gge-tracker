import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import {
  ApiEventThresholdSlug,
  ApiEventThresholdsResponse,
  ApiPlayerStatsType,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { KINGDOM_EVENTS } from '@ggetracker-pages/compare/compare-events/compare-events.component';
import { formatThousands } from '@ggetracker-services/text-format.utilities';
import { TranslateModule } from '@ngx-translate/core';
import { ApexAxisChartSeries, ApexOptions } from 'ng-apexcharts';

interface ThresholdEvent {
  slug: ApiEventThresholdSlug;
  label: string;
  icon: string;
}

interface SummaryRow {
  rank: number;
  value: number | null;
  median: number | null;
  low: number | null;
  high: number | null;
}

const SLUG_BY_TABLE: Partial<Record<ApiPlayerStatsType, ApiEventThresholdSlug>> = {
  [ApiPlayerStatsType.nomad]: 'nomad',
  [ApiPlayerStatsType.samurai]: 'samurai',
  [ApiPlayerStatsType.bloodcrow]: 'bloodcrow',
  [ApiPlayerStatsType.war_realms]: 'war-realms',
  [ApiPlayerStatsType.berimond_kingdom]: 'berimond-kingdom',
  [ApiPlayerStatsType.berimond_invasion]: 'berimond-invasion',
};

const THRESHOLD_EVENTS: ThresholdEvent[] = KINGDOM_EVENTS.flatMap((event) => {
  const slug = SLUG_BY_TABLE[event.table];
  return slug ? [{ slug, label: event.label, icon: event.icon }] : [];
});

const DEFAULT_RANK = 100;
const PAST_RUN_COLOR = '#6b7f8f';
const CURRENT_RUN_COLOR = '#26c6da';

@Component({
  selector: 'app-event-thresholds',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule, ChartsWrapperComponent],
  templateUrl: './event-thresholds.component.html',
  styleUrl: './event-thresholds.component.css',
})
export class EventThresholdsComponent extends GenericComponent implements OnInit {
  public readonly events = THRESHOLD_EVENTS;
  public selectedEvent: ApiEventThresholdSlug = THRESHOLD_EVENTS[0].slug;
  public data: ApiEventThresholdsResponse | null = null;
  public rankIndex = 0;
  public summary: SummaryRow[] = [];
  public chart: ApexOptions | null = null;

  private compactFormatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

  public get selectedEventLabel(): string {
    return this.events.find((event) => event.slug === this.selectedEvent)?.label ?? '';
  }

  public get selectedRank(): number {
    return this.data?.ranks[this.rankIndex] ?? DEFAULT_RANK;
  }

  public get typicalDurationHours(): number | null {
    const durations = (this.data?.pace ?? [])
      .filter((occurrence) => !occurrence.running && occurrence.points.length > 0)
      .map((occurrence) => occurrence.points.at(-1)!.hour);
    if (durations.length === 0) return null;
    return [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  }

  public get daysUntilNext(): number | null {
    if (!this.data?.next_expected_start) return null;
    return Math.max(0, Math.ceil((Date.parse(this.data.next_expected_start) - Date.now()) / 86_400_000));
  }

  public ngOnInit(): void {
    this.compactFormatter = new Intl.NumberFormat(this.langageService.getCurrentLang() || 'en', {
      notation: 'compact',
      maximumFractionDigits: 1,
    });
    const parameters = this.route.snapshot.queryParamMap;
    const event = parameters.get('event');
    if (this.events.some((candidate) => candidate.slug === event)) this.selectedEvent = event as ApiEventThresholdSlug;
    void this.load(Number(parameters.get('rank')) || DEFAULT_RANK);
  }

  public selectEvent(slug: ApiEventThresholdSlug): void {
    if (slug === this.selectedEvent) return;
    this.selectedEvent = slug;
    void this.load(this.selectedRank);
  }

  public selectRank(index: number): void {
    this.rankIndex = index;
    this.chart = this.buildChart();
    this.syncUrl();
  }

  public compact(value: number | null | undefined): string {
    return value ? this.compactFormatter.format(value) : '-';
  }

  public full(value: number | null | undefined): string {
    return value ? formatThousands(value) : '';
  }

  private async load(preferredRank: number): Promise<void> {
    this.isInLoading = true;
    this.syncUrl(preferredRank);
    const response = await this.apiRestService.getEventThresholds(this.selectedEvent);
    this.isInLoading = false;
    if (!response.success) {
      this.data = null;
      this.summary = [];
      this.chart = null;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.data = response.data;
    const rankIndex = this.data.ranks.indexOf(preferredRank);
    this.rankIndex = rankIndex === -1 ? this.data.ranks.indexOf(DEFAULT_RANK) : rankIndex;
    this.summary = this.buildSummary(this.data);
    this.chart = this.buildChart();
    this.syncUrl();
  }

  private syncUrl(rank = this.selectedRank): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { event: this.selectedEvent, rank },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private buildSummary(data: ApiEventThresholdsResponse): SummaryRow[] {
    const range = data.current ? data.current.projected : data.typical;
    return data.ranks.map((rank, index) => ({
      rank,
      value: data.current ? data.current.thresholds[index] : null,
      median: range?.median[index] ?? null,
      low: range?.low[index] ?? null,
      high: range?.high[index] ?? null,
    }));
  }

  private buildChart(): ApexOptions | null {
    if (!this.data || this.data.pace.length === 0) return null;
    const rankIndex = this.rankIndex;
    const series: ApexAxisChartSeries = this.data.pace.map((occurrence) => ({
      name: occurrence.running
        ? this.translateService.instant('En cours')
        : new Date(occurrence.started_at).toLocaleDateString(this.langageService.getCurrentLang() || 'en', {
            day: 'numeric',
            month: 'short',
          }),
      data: occurrence.points.map((point) => ({ x: point.hour, y: point.thresholds[rankIndex] })),
    }));
    const colors = this.data.pace.map((occurrence) => (occurrence.running ? CURRENT_RUN_COLOR : PAST_RUN_COLOR));
    const widths = this.data.pace.map((occurrence) => (occurrence.running ? 3.5 : 1.5));
    const hourLabel = this.translateService.instant('Heure');
    return {
      series,
      colors,
      chart: {
        type: 'line',
        height: 340,
        background: 'transparent',
        foreColor: '#c8d0c8',
        animations: { enabled: false },
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      stroke: { width: widths, curve: 'smooth' },
      markers: { size: 0, hover: { size: 4 } },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(255,255,255,0.08)', strokeDashArray: 3 },
      legend: { show: true, labels: { colors: '#dfe6df' } },
      xaxis: {
        type: 'numeric',
        tickAmount: 8,
        title: { text: hourLabel },
        labels: { formatter: (value: string) => `${Math.round(Number(value))}h` },
      },
      yaxis: { labels: { formatter: (value: number) => this.compact(value) } },
      tooltip: {
        theme: 'dark',
        shared: false,
        x: { formatter: (value: number) => `${hourLabel} ${value}` },
        y: { formatter: (value: number) => this.full(value) },
      },
      fill: { type: 'solid' },
      title: { text: '' },
      plotOptions: {},
    };
  }
}
