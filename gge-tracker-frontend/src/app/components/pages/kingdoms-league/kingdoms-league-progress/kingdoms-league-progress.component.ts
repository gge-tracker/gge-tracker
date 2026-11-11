/* eslint-disable unicorn/consistent-function-scoping */
import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LeagueMedalsComponent } from '@ggetracker-components/league-medals/league-medals.component';
import { LeagueTitleComponent } from '@ggetracker-components/league-title/league-title.component';
import { ApiKingdomsLeaguePlayerHistoryResponse } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { LanguageService } from '@ggetracker-services/language.service';
import { RankingService } from '@ggetracker-services/ranking.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApexOptions } from 'ng-apexcharts';

const RANK_COLOR = '#f5c518';
const GOLD_COLOR = 'rgba(245, 197, 24, 0.28)';

@Component({
  selector: 'app-kingdoms-league-progress',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TranslateModule,
    ChartsWrapperComponent,
    LeagueMedalsComponent,
    LeagueTitleComponent,
  ],
  templateUrl: './kingdoms-league-progress.component.html',
  styleUrl: './kingdoms-league-progress.component.css',
})
export class KingdomsLeagueProgressComponent {
  public readonly progress = input.required<ApiKingdomsLeaguePlayerHistoryResponse>();
  public readonly exit = output<void>();

  public readonly nightsNewestFirst = computed(() => [...this.progress().history].reverse());
  public readonly latest = computed(() => this.progress().history.at(-1) ?? null);
  public readonly chart = computed<ApexOptions>(() => this.buildChart());

  private readonly translateService = inject(TranslateService);
  private readonly rankingService = inject(RankingService);
  private readonly languageService = inject(LanguageService);

  private buildChart(): ApexOptions {
    const history = this.progress().history;
    const days = history.map((night) => night.day);
    const lowestRank = Math.max(...history.map((night) => night.rank));
    const rankLabel = this.translateService.instant('Rang');
    const goldLabel = this.translateService.instant("Médaille d'or");
    return {
      series: [
        { name: rankLabel, type: 'line', data: history.map((night) => night.rank) },
        { name: goldLabel, type: 'column', data: history.map((night) => night.gold) },
      ],
      chart: {
        type: 'line',
        height: 360,
        background: 'transparent',
        foreColor: '#c8d0c8',
        animations: { enabled: false },
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      colors: [RANK_COLOR, GOLD_COLOR],
      stroke: { width: [3, 0], curve: 'straight' },
      markers: { size: [4, 0] },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(255,255,255,0.08)', strokeDashArray: 3 },
      legend: { show: true, labels: { colors: '#dfe6df' } },
      tooltip: { theme: 'dark', shared: true, intersect: false },
      xaxis: { categories: days, labels: { rotate: -45, trim: false } },
      yaxis: [
        {
          title: { text: rankLabel },
          reversed: true,
          min: 1,
          max: Math.max(lowestRank, 2),
          decimalsInFloat: 0,
          labels: { formatter: (value: number) => `#${Math.round(value)}` },
        },
        { title: { text: goldLabel }, opposite: true, min: 0, forceNiceScale: true },
      ],
    };
  }
}
