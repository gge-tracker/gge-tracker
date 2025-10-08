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
      const componentReference = this.vcr.createComponent(ChartsClientComponent, {
        injector: this.injector,
      });
      componentReference.setInput('series', this.series());
      componentReference.setInput('chart', this.chart());
      componentReference.setInput('xaxis', this.xaxis());
      componentReference.setInput('annotations', this.annotations());
      componentReference.setInput('yaxis', this.yaxis());
      componentReference.setInput('dataLabels', this.dataLabels());
      componentReference.setInput('plotOptions', this.plotOptions());
      componentReference.setInput('labels', this.labels());
      componentReference.setInput('grid', this.grid());
      componentReference.setInput('colors', this.colors());
      componentReference.setInput('markers', this.markers());
      componentReference.setInput('fill', this.fill());
      componentReference.setInput('stroke', this.stroke());
      componentReference.setInput('title', this.title());
      componentReference.setInput('tooltip', this.tooltip());
      componentReference.setInput('legend', this.legend());
      componentReference.setInput('forecastDataPoints', this.forecastDataPoints());
      componentReference.instance.chartComponentOutput.subscribe((output) => {
        this.chartComponentOutput.emit(output);
      });
    }
  }
}
