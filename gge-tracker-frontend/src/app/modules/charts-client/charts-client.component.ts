import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, input, output, QueryList, ViewChildren } from '@angular/core';
import {
  ApexAnnotations,
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexForecastDataPoints,
  ApexGrid,
  ApexLegend,
  ApexMarkers,
  ApexPlotOptions,
  ApexStroke,
  ApexTitleSubtitle,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
  ChartComponent,
  NgApexchartsModule,
} from 'ng-apexcharts';

@Component({
  selector: 'app-chart-client',
  standalone: true,
  imports: [CommonModule, NgApexchartsModule],
  template: `
    <apx-chart
      #componentRef
      [series]="series()"
      [chart]="chart()"
      [annotations]="annotations() || {}"
      [xaxis]="xaxis() || {}"
      [yaxis]="yaxis() || []"
      [dataLabels]="dataLabels() || {}"
      [plotOptions]="plotOptions() || {}"
      [labels]="labels() || []"
      [grid]="grid() || {}"
      [colors]="colors() || []"
      [markers]="markers() || {}"
      [fill]="fill() || {}"
      [stroke]="stroke() || {}"
      [title]="title() || {}"
      [tooltip]="tooltip() || {}"
      [legend]="legend() || {}"
      [forecastDataPoints]="forecastDataPoints() || {}"
    >
    </apx-chart>
  `,
})
export class ChartsClientComponent implements AfterViewInit {
  public series = input.required<ApexAxisChartSeries>();
  public chart = input.required<ApexChart>();
  public xaxis = input<ApexXAxis>();
  public annotations = input<ApexAnnotations>();
  public yaxis = input<ApexYAxis>();
  public dataLabels = input<ApexDataLabels>();
  public plotOptions = input<ApexPlotOptions>();
  public labels = input<string[]>();
  public grid = input<ApexGrid>();
  public colors = input<string[]>();
  public markers = input<ApexMarkers>();
  public fill = input<ApexFill>();
  public stroke = input<ApexStroke>();
  public title = input<ApexTitleSubtitle>();
  public tooltip = input<ApexTooltip>();
  public legend = input<ApexLegend>();
  public forecastDataPoints = input<ApexForecastDataPoints>();
  public chartComponentOutput = output<ChartComponent>();

  @ViewChildren('componentRef')
  private chartComponent!: QueryList<ChartComponent>;

  public ngAfterViewInit(): void {
    // After the view initializes, we can access the chart component if needed.
    if (this.chartComponent && this.chartComponent.length > 0) {
      const componentReference = this.chartComponent.first;
      this.chartComponentOutput.emit(componentReference);
    }
  }
}
