import { DatePipe, NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ApiServerStats, ChartOptions } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { LanguageService } from '@ggetracker-services/language.service';
import { ServerService } from '@ggetracker-services/server.service';
import { WindowService } from '@ggetracker-services/window.service';
import { TranslateModule } from '@ngx-translate/core';
import { filter, firstValueFrom } from 'rxjs';

import { metricChartOptions } from './server-statistics-chart';
import {
  buildStatGroups,
  formatCompact,
  KEY_METRICS,
  seriesSince,
  StatGroup,
  StatMetric,
} from './server-statistics-metrics';

type ChartRange = 'day' | 'week';

interface ServerRecord {
  label: string;
  logo: string;
  value: string;
  playerId: string;
  playerName: string | null;
}

const RANGE_MS: Record<ChartRange, number> = { day: 24 * 60 * 60 * 1000, week: Number.POSITIVE_INFINITY };
const STACKED_LAYOUT_MAX_WIDTH = 991;

@Component({
  selector: 'app-server-statistics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ChartsWrapperComponent, NgClass, DatePipe, RouterLink, TranslateModule],
  templateUrl: './server-statistics.component.html',
  styleUrl: './server-statistics.component.css',
})
export class ServerStatisticsComponent extends GenericComponent implements OnInit {
  public readonly serverService = inject(ServerService);
  public readonly groups = signal<StatGroup[]>([]);
  public readonly records = signal<ServerRecord[]>([]);
  public readonly lastSnapshotAt = signal<string | null>(null);
  public readonly selectedKey = signal('players_count');
  public readonly range = signal<ChartRange>('week');
  public readonly loaded = signal(false);

  // eslint-disable-next-line unicorn/consistent-function-scoping
  public readonly keyMetrics = computed(() =>
    KEY_METRICS.map((key) => this.metricOf(key)).filter((metric): metric is StatMetric => metric !== undefined),
  );
  // eslint-disable-next-line unicorn/consistent-function-scoping
  public readonly selectedMetric = computed(() => this.metricOf(this.selectedKey()) ?? this.groups()[0]?.metrics[0]);
  // eslint-disable-next-line unicorn/consistent-function-scoping
  public readonly chart = computed<ChartOptions | null>(() => {
    const metric = this.selectedMetric();
    if (!metric) return null;
    return metricChartOptions(metric, seriesSince(metric, RANGE_MS[this.range()]), {
      name: this.translateService.instant(metric.label),
      locales: this.rankingService.CHART_LOCALES,
      defaultLocale: this.languageService.getCurrentLang(),
      tooltipDateFormat: this.translateService.instant('Date_6'),
    });
  });

  private readonly chartPanel = viewChild<ElementRef<HTMLElement>>('chartPanel');
  private readonly windowService = inject(WindowService);
  private readonly languageService = inject(LanguageService);

  public ngOnInit(): void {
    void this.load();
  }

  public select(metric: StatMetric): void {
    this.selectedKey.set(metric.key);
    const win = this.windowService.getWindow();
    if (win && win.innerWidth <= STACKED_LAYOUT_MAX_WIDTH) {
      this.chartPanel()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  public export(): void {
    const win = this.windowService.getWindow();
    const metric = this.selectedMetric();
    if (!win || !metric) return;
    const label = this.translateService.instant(metric.label);
    const rows = metric.series.map((point) => `${new Date(point.at).toLocaleString()};${point.value ?? ''}`);
    const csv = '﻿' + [`Date;${label}`, ...rows].join('\n');
    const url = win.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = win.document.createElement('a');
    link.href = url;
    link.download = label + '.csv';
    link.click();
    win.URL.revokeObjectURL(url);
  }

  private async load(): Promise<void> {
    const response = await this.apiRestService.getServerGlobalStats();
    if (!response.success) return;
    const history = response.data;
    this.groups.set(buildStatGroups(history));
    this.lastSnapshotAt.set(history.at(-1)?.created_at ?? null);
    this.isInLoading = false;
    this.loaded.set(true);
    const last = history.at(-1);
    if (last) void this.loadRecords(last);
  }

  private async loadRecords(last: ApiServerStats): Promise<void> {
    const { server_code } = await firstValueFrom(this.utilitiesService.data$.pipe(filter((data) => data !== null)));
    const records: ServerRecord[] = [];
    if (last.max_might_player_id) {
      records.push(
        this.recordOf('Puissance maximale', 'assets/pp3.png', last.max_might, last.max_might_player_id, server_code),
      );
    }
    if (last.max_loot_player_id) {
      records.push(
        this.recordOf('Pillage hebdo maximal', 'assets/loot4.png', last.max_loot, last.max_loot_player_id, server_code),
      );
    }
    if (records.length === 0) return;
    this.records.set(records);
    const players = await this.apiRestService.getPlayersBulk([...new Set(records.map((record) => record.playerId))]);
    if (!players.success) return;
    const names = new Map(players.data.players.map((player) => [player.player_id, player.player_name]));
    this.records.set(records.map((record) => ({ ...record, playerName: names.get(record.playerId) ?? null })));
  }

  private recordOf(label: string, logo: string, value: number, playerId: number, serverCode: string): ServerRecord {
    return { label, logo, value: formatCompact(value), playerId: `${playerId}${serverCode}`, playerName: null };
  }

  private metricOf(key: string): StatMetric | undefined {
    for (const group of this.groups()) {
      const metric = group.metrics.find((candidate) => candidate.key === key);
      if (metric) return metric;
    }
    return undefined;
  }
}
