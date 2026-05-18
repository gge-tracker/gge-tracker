import { NgClass } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ApiStormyIslesPlayer } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { TranslateModule } from '@ngx-translate/core';
import { METRIC_LABELS } from '../stormy-isles.component';

@Component({
  selector: 'app-stormy-isles-table-content',
  standalone: true,
  imports: [NgClass, TranslateModule, FormatNumberPipe, RouterLink],
  templateUrl: './stormy-isles-table-content.component.html',
  styleUrls: ['./stormy-isles-table-content.component.css'],
})
export class StormyIslesTableContentComponent extends GenericComponent {
  public readonly METRIC_IDS = [100, 15, 16, 17, 19, 20, 18] as const;
  public readonly METRIC_LABELS = METRIC_LABELS;
  public readonly METRIC_ICONS: Record<number, string> = {
    15: 'fas fa-gem',
    16: 'fas fa-water',
    17: 'fas fa-bolt',
    18: 'fas fa-shield-alt',
    19: 'fas fa-coins',
    20: 'fas fa-skull',
    100: 'fas fa-trophy',
  };
  public readonly METRIC_COLORS: Record<number, string> = {
    100: '#ffd700',
  };

  public readonly players = input.required<ApiStormyIslesPlayer[]>();
  public readonly clickOnAlliance = output<string>();
}
