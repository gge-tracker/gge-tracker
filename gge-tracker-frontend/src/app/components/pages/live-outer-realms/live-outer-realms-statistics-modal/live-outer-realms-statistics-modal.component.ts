import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ChartAdvancedOptions, PlayerLiveRankingExtended } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-live-outer-realms-statistics-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, NgFor, NgIf, ChartsWrapperComponent],
  templateUrl: './live-outer-realms-statistics-modal.component.html',
  styleUrls: ['./live-outer-realms-statistics-modal.component.css'],
})
export class LiveOuterRealmsStatisticsModalComponent {
  public readonly goBack = output<void>();
  public readonly player = input.required<PlayerLiveRankingExtended>();
  public readonly charts = input.required<Record<string, ChartAdvancedOptions | any>>();
  public readonly isBrowser = globalThis.window !== undefined;

  public get chartsArray(): string[] {
    console.log(this.charts);
    return Object.keys(this.charts());
  }
}
