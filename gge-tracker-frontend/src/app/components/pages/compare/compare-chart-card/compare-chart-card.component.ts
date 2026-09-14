import { Component, input, output } from '@angular/core';
import { ChartOptions } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { TranslateModule } from '@ngx-translate/core';

export type ChartCardState = 'loading' | 'loaded' | 'error';

export interface ChartCardChoice {
  value: string;
  label: string;
}

@Component({
  selector: 'app-compare-chart-card',
  standalone: true,
  imports: [TranslateModule, ChartsWrapperComponent],
  templateUrl: './compare-chart-card.component.html',
  styleUrl: './compare-chart-card.component.css',
})
export class CompareChartCardComponent {
  public readonly heading = input.required<string>();
  public readonly caption = input<string | null>(null);
  public readonly choices = input<ChartCardChoice[]>([]);
  public readonly choice = input<string | null>(null);
  public readonly state = input.required<ChartCardState>();
  public readonly options = input<ChartOptions | null>(null);

  public readonly choose = output<string>();
}
