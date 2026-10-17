import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { LayeredSceneComponent } from '@ggetracker-components/layered-scene/layered-scene.component';
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

interface LadderRow {
  index: number;
  rank: number;
  current: number | null;
  target: number | null;
  low: number | null;
  high: number | null;
  progress: number | null;
}

interface EditionRow {
  startedAt: string;
  participants: number;
  value: number;
  share: number;
}

interface PaceTrend {
  key: 'event-thresholds-ahead' | 'event-thresholds-behind' | 'event-thresholds-on-pace';
  percent: number;
}

interface ChartLine {
  series: ApexAxisChartSeries[number];
  color: string;
  width: number;
  dash: number;
  opacity: number;
}

type HourlyCurve = (number | null)[];

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
const ON_PACE_TOLERANCE = 0.03;
const COLORS = { band: '#5b7186', median: '#a9b7c4', last: '#e2b45a', current: '#26c6da' };

@Component({
  selector: 'app-event-thresholds',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule, ChartsWrapperComponent, LayeredSceneComponent],
  templateUrl: './event-thresholds.component.html',
  styleUrl: './event-thresholds.component.css',
})
export class EventThresholdsComponent extends GenericComponent implements OnInit {
  public readonly events = THRESHOLD_EVENTS;
  public selectedEvent: ApiEventThresholdSlug = THRESHOLD_EVENTS[0].slug;
  public data: ApiEventThresholdsResponse | null = null;
  public liveEvents = new Set<ApiEventThresholdSlug>();
  public rankIndex = 0;
  public ladder: LadderRow[] = [];
  public editions: EditionRow[] = [];
  public trend: PaceTrend | null = null;
  public chart: ApexOptions | null = null;
  public showAllRanks = false;

  @ViewChild('detail') private readonly detail?: ElementRef<HTMLElement>;
  private compactFormatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

  public get selectedRank(): number {
    return this.data?.ranks[this.rankIndex] ?? DEFAULT_RANK;
  }

  public get selectedRow(): LadderRow | undefined {
    return this.ladder.find((row) => row.index === this.rankIndex);
  }

  public get lastEdition(): EditionRow | undefined {
    return this.editions[0];
  }

  public get typicalDurationHours(): number | null {
    const durations = this.completedPace().map((occurrence) => occurrence.points.at(-1)!.hour);
    return durations.length > 0 ? this.median(durations) : null;
  }

  public get liveProgress(): number | null {
    const duration = this.typicalDurationHours;
    if (!this.data?.current || !duration) return null;
    return Math.min(100, Math.round((this.data.current.hour / duration) * 100));
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
    this.showAllRanks = false;
    void this.load(this.selectedRank);
  }

  public selectRank(index: number): void {
    this.rankIndex = index;
    this.refreshRankViews();
    this.syncUrl();
    this.revealDetail();
  }

  public compact(value: number | null | undefined): string {
    return value ? this.compactFormatter.format(value) : '-';
  }

  public full(value: number | null | undefined): string {
    return value ? formatThousands(value) : '';
  }

  public deltaToMedian(value: number): string {
    const median = this.data?.typical?.median[this.rankIndex];
    if (!median) return '';
    const delta = Math.round((value / median - 1) * 100);
    if (delta === 0) return '';
    return `${delta > 0 ? '+' : ''}${delta}%`;
  }

  private async load(preferredRank: number): Promise<void> {
    this.isInLoading = true;
    this.syncUrl(preferredRank);
    const response = await this.apiRestService.getEventThresholds(this.selectedEvent);
    this.isInLoading = false;
    if (!response.success) {
      this.data = null;
      this.ladder = [];
      this.editions = [];
      this.chart = null;
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      return;
    }
    this.data = response.data;
    this.liveEvents = new Set(this.data.live_events ?? (this.data.running ? [this.data.event] : []));
    this.ladder = this.buildLadder(this.data);
    const preferred =
      this.ladder.find((row) => row.rank === preferredRank) ?? this.ladder.find((row) => row.rank === DEFAULT_RANK);
    this.rankIndex = (preferred ?? this.ladder.at(-1))?.index ?? 0;
    this.refreshRankViews();
    this.syncUrl();
  }

  private refreshRankViews(): void {
    this.editions = this.buildEditions();
    this.trend = this.buildTrend();
    this.chart = this.buildChart();
  }

  private revealDetail(): void {
    const element = this.detail?.nativeElement;
    if (!element || element.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private syncUrl(rank = this.selectedRank): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { event: this.selectedEvent, rank },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private buildLadder(data: ApiEventThresholdsResponse): LadderRow[] {
    const range = data.current ? data.current.projected : data.typical;
    return data.ranks
      .map((rank, index) => {
        const current = data.current ? data.current.thresholds[index] || null : null;
        const target = range?.median[index] || null;
        return {
          index,
          rank,
          current,
          target,
          low: range?.low[index] || null,
          high: range?.high[index] || null,
          progress: current && target ? Math.min(100, Math.round((current / target) * 100)) : null,
        };
      })
      .filter((row) => row.current || row.target);
  }

  private buildEditions(): EditionRow[] {
    const occurrences = this.data?.occurrences ?? [];
    const values = occurrences.map((occurrence) => occurrence.thresholds[this.rankIndex] ?? 0);
    const max = Math.max(1, ...values);
    return occurrences.map((occurrence, index) => ({
      startedAt: occurrence.started_at,
      participants: occurrence.participants,
      value: values[index],
      share: Math.round((values[index] / max) * 100),
    }));
  }

  private buildTrend(): PaceTrend | null {
    const current = this.data?.current;
    const value = current?.thresholds[this.rankIndex];
    if (!current || !value) return null;
    const usual = this.median(this.pastCurves().flatMap((curve) => curve[current.hour] ?? []));
    if (!usual) return null;
    const ratio = value / usual - 1;
    const percent = Math.round(Math.abs(ratio) * 100);
    if (Math.abs(ratio) < ON_PACE_TOLERANCE) return { key: 'event-thresholds-on-pace', percent };
    return { key: ratio > 0 ? 'event-thresholds-ahead' : 'event-thresholds-behind', percent };
  }

  private completedPace(): ApiEventThresholdsResponse['pace'] {
    return (this.data?.pace ?? []).filter((occurrence) => !occurrence.running && occurrence.points.length > 0);
  }

  private pastCurves(): HourlyCurve[] {
    const completed = this.completedPace();
    const lastHour = Math.max(0, ...completed.map((occurrence) => occurrence.points.at(-1)!.hour));
    return completed.map(({ points }) => {
      const curve: HourlyCurve = [];
      let next = 0;
      let value: number | null = null;
      for (let hour = 0; hour <= lastHour; hour++) {
        while (next < points.length && points[next].hour <= hour) value = points[next++].thresholds[this.rankIndex];
        curve.push(value);
      }
      return curve;
    });
  }

  private buildChart(): ApexOptions | null {
    if (!this.data || this.data.pace.length === 0) return null;
    const curves = this.pastCurves();
    const hours = curves[0]?.map((_, hour) => hour) ?? [];
    const valuesAt = (hour: number): number[] => curves.flatMap((curve) => curve[hour] ?? []);
    const lastCompleted = this.completedPace().at(-1);
    const running = this.data.pace.find((occurrence) => occurrence.running);
    const lines: ChartLine[] = [];
    if (curves.length > 1) {
      lines.push(
        {
          series: {
            type: 'rangeArea',
            name: this.translateService.instant('Écart des éditions passées'),
            data: hours.map((hour) => {
              const values = valuesAt(hour);
              return { x: hour, y: values.length > 0 ? [Math.min(...values), Math.max(...values)] : null };
            }),
          },
          color: COLORS.band,
          width: 0,
          dash: 0,
          opacity: 0.28,
        },
        {
          series: {
            type: 'line',
            name: this.translateService.instant('Médiane'),
            data: hours.map((hour) => ({ x: hour, y: this.median(valuesAt(hour)) })),
          },
          color: COLORS.median,
          width: 2,
          dash: 5,
          opacity: 1,
        },
      );
    }
    if (lastCompleted) lines.push(this.paceLine('Dernière édition', lastCompleted.points, COLORS.last, 2));
    if (running) lines.push(this.paceLine('En cours', running.points, COLORS.current, 3.5));

    const hourLabel = this.translateService.instant('Heure');
    return {
      series: lines.map((line) => line.series),
      colors: lines.map((line) => line.color),
      chart: {
        type: 'rangeArea',
        height: 320,
        background: 'transparent',
        foreColor: '#c8d0c8',
        animations: { enabled: false },
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      stroke: { width: lines.map((line) => line.width), dashArray: lines.map((line) => line.dash), curve: 'smooth' },
      markers: { size: 0, hover: { size: 4 } },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(255,255,255,0.07)', strokeDashArray: 3 },
      legend: { show: true, position: 'top', horizontalAlign: 'left', labels: { colors: '#dfe6df' } },
      xaxis: {
        type: 'numeric',
        tickAmount: 8,
        labels: { formatter: (value: string) => `${Math.round(Number(value))}h` },
        tooltip: { enabled: false },
      },
      yaxis: { labels: { formatter: (value: number) => this.compact(value) } },
      tooltip: {
        theme: 'dark',
        shared: true,
        intersect: false,
        x: { formatter: (value: number) => `${hourLabel} ${value}` },
        y: { formatter: (value: number) => this.full(value) },
      },
      fill: { type: 'solid', opacity: lines.map((line) => line.opacity) },
      title: { text: '' },
      plotOptions: {},
    };
  }

  private paceLine(
    label: string,
    points: ApiEventThresholdsResponse['pace'][number]['points'],
    color: string,
    width: number,
  ): ChartLine {
    const data = points.map((point) => ({ x: point.hour, y: point.thresholds[this.rankIndex] }));
    return {
      series: { type: 'line', name: this.translateService.instant(label), data },
      color,
      width,
      dash: 0,
      opacity: 1,
    };
  }

  private median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}
