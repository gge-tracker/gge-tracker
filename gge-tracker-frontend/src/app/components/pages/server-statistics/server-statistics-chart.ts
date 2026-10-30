import { ChartOptions } from '@ggetracker-interfaces/empire-ranking';
import { ApexLocale } from 'ng-apexcharts';

import { StatMetric, StatPoint } from './server-statistics-metrics';

const ACCENT = '#26c6da';

export interface MetricChartContext {
  name: string;
  locales: ApexLocale[];
  defaultLocale: string;
  tooltipDateFormat: string;
}

export function metricChartOptions(metric: StatMetric, points: StatPoint[], context: MetricChartContext): ChartOptions {
  const isCount = metric.kind === 'hourly-count';
  const format = (value: number | null): string => (value === null || value === undefined ? '-' : metric.format(value));
  return {
    series: [{ name: context.name, data: points.map((point) => ({ x: point.at, y: point.value })) }],
    chart: {
      type: isCount ? 'bar' : 'area',
      height: 260,
      background: 'transparent',
      foreColor: '#9aa59d',
      fontFamily: 'Inter, system-ui, sans-serif',
      animations: { enabled: false },
      toolbar: { show: false },
      zoom: { enabled: false },
      locales: context.locales,
      defaultLocale: context.defaultLocale,
    },
    colors: [ACCENT],
    stroke: { width: isCount ? 0 : 2, curve: 'straight' },
    fill: isCount
      ? { type: 'solid', opacity: 0.85 }
      : { type: 'gradient', gradient: { shadeIntensity: 0, opacityFrom: 0.28, opacityTo: 0.02, stops: [0, 100] } },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 4 } },
    plotOptions: { bar: { columnWidth: '70%', borderRadius: 2 } },
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.06)',
      strokeDashArray: 3,
      padding: { left: 8, right: 8 },
    },
    legend: { show: false },
    xaxis: {
      type: 'datetime',
      labels: { datetimeUTC: false, style: { fontSize: '11px' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: { labels: { formatter: format, style: { fontSize: '11px' } }, forceNiceScale: true },
    tooltip: {
      theme: 'dark',
      x: { format: context.tooltipDateFormat },
      y: { formatter: format },
    },
    title: {},
  };
}
