import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  PLATFORM_ID,
  ViewContainerRef,
  Injector,
  input,
  inject,
  OnInit,
  output,
  ViewChild,
} from '@angular/core';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexAnnotations,
  ApexYAxis,
  ApexDataLabels,
  ApexPlotOptions,
  ApexGrid,
  ApexMarkers,
  ApexFill,
  ApexStroke,
  ApexTitleSubtitle,
  ApexTooltip,
  ApexLegend,
  ApexForecastDataPoints,
} from 'ng-apexcharts';

type ChartComponentInstance = InstanceType<(typeof import('ng-apexcharts'))['ChartComponent']>;

@Component({
  selector: 'app-charts-wrapper',
  standalone: true,
  template: '<ng-container #container></ng-container>',
})
export class ChartsWrapperComponent implements OnInit {
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
  public chartComponentOutput = output<ChartComponentInstance>();
  public component?: ChartComponentInstance;

  @ViewChild('container', { read: ViewContainerRef, static: true }) private vcr!: ViewContainerRef;
  private platformId = inject(PLATFORM_ID);

  constructor(private injector: Injector) {}

  public async ngOnInit(): Promise<void> {
    if (isPlatformBrowser(this.platformId)) {
      const { ChartsClientComponent } = await import('./charts-client.component');
      const componentRef = this.vcr.createComponent(ChartsClientComponent, {
        injector: this.injector,
      });
      componentRef.setInput('series', this.series());
      componentRef.setInput('chart', this.chart());
      componentRef.setInput('xaxis', this.xaxis());
      componentRef.setInput('annotations', this.annotations());
      componentRef.setInput('yaxis', this.yaxis());
      componentRef.setInput('dataLabels', this.dataLabels());
      componentRef.setInput('plotOptions', this.plotOptions());
      componentRef.setInput('labels', this.labels());
      componentRef.setInput('grid', this.grid());
      componentRef.setInput('colors', this.colors());
      componentRef.setInput('markers', this.markers());
      componentRef.setInput('fill', this.fill());
      componentRef.setInput('stroke', this.stroke());
      componentRef.setInput('title', this.title());
      componentRef.setInput('tooltip', this.tooltip());
      componentRef.setInput('legend', this.legend());
      componentRef.setInput('forecastDataPoints', this.forecastDataPoints());
      componentRef.instance.chartComponentOutput.subscribe((output) => {
        this.chartComponentOutput.emit(output);
      });
    }
  }
}
