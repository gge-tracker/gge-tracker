import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { PlayerLiveRankingExtended } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { TranslateModule } from '@ngx-translate/core';
import { PunctuationPipe } from '@ggetracker-pipes/punctuation.pipe';

@Component({
  selector: 'app-live-outer-realms-statistics-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PunctuationPipe, TranslateModule, ChartsWrapperComponent],
  templateUrl: './live-outer-realms-statistics-modal.component.html',
  styleUrls: ['./live-outer-realms-statistics-modal.component.css'],
})
export class LiveOuterRealmsStatisticsModalComponent {
  public readonly goBack = output<void>();
  public readonly player = input.required<PlayerLiveRankingExtended>();
  public readonly charts = input.required<Record<string, any>>();
  public readonly isBrowser = globalThis.window !== undefined;

  public get chartsArray(): string[] {
    return Object.keys(this.charts());
  }
}
