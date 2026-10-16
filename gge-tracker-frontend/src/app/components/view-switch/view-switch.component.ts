import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

export type TrackerView = 'list' | 'map';

@Component({
  selector: 'app-view-switch',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './view-switch.component.html',
  styleUrl: './view-switch.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewSwitchComponent {
  public readonly view = input.required<TrackerView>();
  public readonly viewChange = output<TrackerView>();

  public select(view: TrackerView): void {
    if (view !== this.view()) this.viewChange.emit(view);
  }
}
