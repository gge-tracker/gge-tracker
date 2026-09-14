import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiGenericData, ApiPlayerStatsType, ChartOptions } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LanguageService } from '@ggetracker-services/language.service';
import { RankingService } from '@ggetracker-services/ranking.service';
import { TranslateService } from '@ngx-translate/core';

import {
  ChartCardChoice,
  ChartCardState,
  CompareChartCardComponent,
} from '../compare-chart-card/compare-chart-card.component';
import { baseChartOptions } from '../compare-chart-card/compare-chart-options';
import { CompareSubject } from '../compare-contender/compare-contender.component';

@Component({
  selector: 'app-compare-might',
  standalone: true,
  imports: [CompareChartCardComponent],
  template: `
    <app-compare-chart-card
      [heading]="subject() === 'players' ? 'Points de puissance' : 'Puissance de l\\'alliance'"
      [caption]="subject() === 'players' ? null : 'Derniers 7 jours'"
      [choices]="subject() === 'players' ? periods : []"
      [choice]="period()"
      [state]="state()"
      [options]="options()"
      (choose)="period.set($event)"
    ></app-compare-chart-card>
  `,
})
export class CompareMightComponent {
  public readonly subject = input.required<CompareSubject>();
  public readonly ids = input.required<[string, string]>();
  public readonly names = input.required<[string, string]>();

  public readonly periods: ChartCardChoice[] = [
    { value: '7', label: 'Derniers 7 jours' },
    { value: '30', label: 'Derniers 30 jours' },
    { value: '365', label: 'Derniers 365 jours' },
  ];
  public readonly period = signal('30');
  public readonly state = signal<ChartCardState>('loading');
  public readonly options = signal<ChartOptions | null>(null);

  private readonly apiRestService = inject(ApiRestService);
  private readonly translateService = inject(TranslateService);
  private readonly rankingService = inject(RankingService);
  private readonly languageService = inject(LanguageService);
  private requestToken = 0;

  constructor() {
    effect(() => {
      const subject = this.subject();
      const ids = this.ids();
      const period = Number(this.period());
      untracked(() => void this.load(subject, ids, period));
    });
  }

  private async load(subject: CompareSubject, ids: [string, string], period: number): Promise<void> {
    const token = ++this.requestToken;
    this.state.set('loading');
    try {
      const pair = subject === 'players' ? await this.readPlayers(ids, period) : await this.readAlliances(ids);
      if (token !== this.requestToken) return;
      this.options.set(pair[0].length === 0 && pair[1].length === 0 ? null : this.buildOptions(pair));
      this.state.set('loaded');
    } catch {
      if (token === this.requestToken) this.state.set('error');
    }
  }

  private async readPlayers(ids: [string, string], period: number): Promise<ApiGenericData[][]> {
    const responses = await Promise.all(
      ids.map((id) =>
        this.apiRestService.getPlayerStatsSeriesByPlayerId(Number(id), [ApiPlayerStatsType.might], period),
      ),
    );
    return responses.map((response) => {
      if (!response.success) throw new Error(response.error);
      return response.data.points[ApiPlayerStatsType.might] ?? [];
    });
  }

  private async readAlliances(ids: [string, string]): Promise<ApiGenericData[][]> {
    const responses = await Promise.all(
      ids.map((id) => this.apiRestService.getPlayerStatsPulsedForAlliance(Number(id))),
    );
    return responses.map((response) => {
      if (!response.success) throw new Error(response.error);
      return response.data.might_per_hour;
    });
  }

  private buildOptions(pair: ApiGenericData[][]): ChartOptions {
    const names = this.names();
    const options = baseChartOptions(
      pair.map((points, side) => ({
        name: names[side],
        data: points.map((point) => [new Date(point.date).getTime(), Number(point.point)]),
      })),
      { locales: this.rankingService.CHART_LOCALES, defaultLocale: this.languageService.getCurrentLang() },
    );
    options.chart.zoom = { enabled: true, type: 'x', autoScaleYaxis: true };
    options.xaxis = { type: 'datetime', labels: { datetimeUTC: false } };
    options.yaxis = { ...options.yaxis, min: undefined };
    options.tooltip.x = { format: this.translateService.instant('Date_4') };
    return options;
  }
}
