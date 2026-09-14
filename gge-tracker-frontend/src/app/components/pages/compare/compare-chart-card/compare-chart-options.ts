import { ApexLocale } from 'ng-apexcharts';

import { ChartOptions } from '@ggetracker-interfaces/empire-ranking';
import { formatThousands } from '@ggetracker-services/text-format.utilities';

export const SIDE_COLORS = ['#f2c14e', '#5aa8ff'];

export interface ChartLocale {
  locales: ApexLocale[];
  defaultLocale: string;
}

export function formatChartValue(value: number | null): string {
  return value === null || value === undefined ? '?' : formatThousands(Math.round(value));
}

export function baseChartOptions(series: ChartOptions['series'], locale: ChartLocale): ChartOptions {
  return {
    series,
    chart: {
      type: 'line',
      height: 320,
      background: 'transparent',
      foreColor: '#c8d0c8',
      animations: { enabled: false },
      toolbar: { show: false },
      zoom: { enabled: false },
      locales: locale.locales,
      defaultLocale: locale.defaultLocale,
    },
    colors: SIDE_COLORS,
    stroke: { width: 2.5, curve: 'straight' },
    fill: { type: 'solid', opacity: 1 },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 4 } },
    grid: { borderColor: 'rgba(255, 255, 255, 0.08)', strokeDashArray: 3 },
    legend: { show: true, position: 'top', horizontalAlign: 'left', labels: { colors: '#dfe6df' } },
    xaxis: {},
    yaxis: { labels: { formatter: formatChartValue }, min: 0, forceNiceScale: true },
    tooltip: { theme: 'dark', shared: true, intersect: false, y: { formatter: formatChartValue } },
    plotOptions: {},
    title: {},
  };
}
