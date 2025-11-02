import { CommonModule } from '@angular/common';
import { Component, inject, input, OnInit, output } from '@angular/core';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ChartAdvancedOptions } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { LanguageService } from '@ggetracker-services/language.service';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, XCircle } from 'lucide-angular';
import { ApexChart, ApexAxisChartSeries, ApexNonAxisChartSeries, ApexPlotOptions, ApexOptions } from 'ng-apexcharts';

interface GenericChartConfig {
  type: ApexChart['type'];
  series: ApexAxisChartSeries | ApexNonAxisChartSeries;
  colors?: string[];
  plotOptions?: ApexPlotOptions;
  title?: string;
  xaxisCategories?: string[];
  horizontal?: boolean;
  extraOptions?: Partial<ApexOptions>;
  tooltipFormatter?: (value: number, options: { dataPointIndex: number }) => string;
}

@Component({
  selector: 'app-grand-tournament-analyze',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, ChartsWrapperComponent],
  templateUrl: './grand-tournament-analyze.component.html',
  styleUrls: ['./grand-tournament-analyze.component.css'],
})
export class GrandTournamentAnalyzeComponent extends GenericComponent implements OnInit {
  public entries = input.required<any[]>();
  public divisionNames = input.required<string[]>();
  public tournamentAllianceData = input.required<{ alliance_id: number; alliance_name: string; server: string }>();
  public exitEmitter = output<void>();
  public readonly XCircle = XCircle;
  public charts: Record<string, ChartAdvancedOptions | any> = {};
  public languageService = inject(LanguageService);

  public get entriesWithDifference(): any[] {
    const entries = this.entries().reverse();
    return entries
      .map((entry, index) => {
        const previousEntry = index > 0 ? entries[index - 1] : null;
        const scoreDifference = previousEntry ? entry.score - previousEntry.score : 0;
        return {
          ...entry,
          scoreDifference: this.formatScoreDifferenceHTML(Math.max(scoreDifference, 0)),
        };
      })
      .reverse();
  }

  public formatScoreDifferenceHTML(difference: number): string {
    if (difference > 0) {
      return `<span class="text-success text-sm"> <i class="fas fa-arrow-up"></i> ${difference.toLocaleString()}</span>`;
    } else {
      return ``;
    }
  }

  public closeAnalyze(): void {
    this.exitEmitter.emit();
  }

  public getChartTimeSeriesData(entries: any[], field: string): [number, number][] {
    return entries.map((entry) => [new Date(entry.date).getTime(), entry[field]]);
  }

  public ngOnInit(): void {
    const entries = this.entries();
    if (!entries || entries.length === 0) {
      return;
    }
    console.log(entries.map((entry) => entry.score));
    const scoreSeries = [
      {
        name: this.translateService.instant('Score'),
        data: this.getChartTimeSeriesData(entries, 'score'),
      },
    ];
    this.initGenericChartOption(
      'scoreOverTime',
      {
        type: 'area',
        series: scoreSeries,
        colors: ['#1E90FF'],
      },
      false,
    );
  }

  private initGenericChartOption(name: string, config: GenericChartConfig, logarithmic = false, height = 450): void {
    const dateFormat = this.translateService.instant('Date_4');
    const defaultOptions: ApexOptions = {
      series: config.series,
      chart: {
        type: config.type,
        height,
        animations: { enabled: false },
        locales: this.rankingService.CHART_LOCALES,
        defaultLocale: this.languageService.getCurrentLang(),
        toolbar: {},
        stacked: false,
      },
      title: { text: config.title ?? '' },
      colors: config.colors,
      tooltip: {
        shared: false,
        x: { format: dateFormat },
        y: {
          formatter: (value: number) =>
            value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ','),
        },
      },
      dataLabels: { enabled: false },
      stroke: { width: [2, 2, 0], curve: 'smooth' },
      legend: { show: true, showForZeroSeries: true },
      yaxis: {
        labels: {
          formatter: (value: number) =>
            value === null ? '?' : value.toString().replaceAll(/\B(?=(\d{3})+(?!\d))/g, ','),
        },
        logarithmic: logarithmic,
        forceNiceScale: true,
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          gradientToColors: config.colors,
          shadeIntensity: 0.8,
          type: 'horizontal',
          opacityFrom: 0.9,
          opacityTo: 0.6,
          stops: [0, 100],
        },
      },
      grid: {
        row: { colors: ['#6d6d6d86', 'transparent'], opacity: 0.5 },
      },
      xaxis: config.xaxisCategories
        ? {
            categories: config.xaxisCategories,
            labels: { rotate: -45, trim: false },
          }
        : {
            type: 'datetime',
            labels: {
              rotate: -45,
              datetimeFormatter: {
                year: 'yyyy',
                month: "MMM 'yy",
                day: 'dd MMM',
                hour: 'HH:mm',
                minute: 'HH:mm',
              },
              datetimeUTC: false,
              trim: false,
            },
          },
      plotOptions: {},
    };
    if (config.type === 'bar' && config.horizontal) {
      defaultOptions.plotOptions = {
        bar: { horizontal: true },
      };
    }
    if (config.type === 'radialBar' && config.extraOptions?.labels) {
      defaultOptions.labels = config.extraOptions.labels;
    }
    const chart = {
      ...defaultOptions,
      ...config.extraOptions,
      chart: {
        ...defaultOptions.chart,
        ...config.extraOptions?.chart,
        type: config.type,
      },
      xaxis: { ...defaultOptions.xaxis, ...config.extraOptions?.xaxis },
      yaxis: { ...defaultOptions.yaxis, ...config.extraOptions?.yaxis },
      tooltip: { ...defaultOptions.tooltip, ...config.extraOptions?.tooltip },
      stroke: { ...defaultOptions.stroke, ...config.extraOptions?.stroke },
      fill: { ...defaultOptions.fill, ...config.extraOptions?.fill },
      legend: { ...defaultOptions.legend, ...config.extraOptions?.legend },
      grid: { ...defaultOptions.grid, ...config.extraOptions?.grid },
      plotOptions: {
        ...defaultOptions.plotOptions,
        ...config.extraOptions?.plotOptions,
      },
    };
    this.charts[name] = chart;
  }
}
