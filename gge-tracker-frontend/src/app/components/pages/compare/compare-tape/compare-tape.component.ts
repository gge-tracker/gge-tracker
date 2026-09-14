import { Component, computed, input } from '@angular/core';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LevelPipe } from '@ggetracker-pipes/level.pipe';
import { formatThousands } from '@ggetracker-services/text-format.utilities';
import { TranslateModule } from '@ngx-translate/core';

import { CompareMetricRow, CompareSide, scoreRows } from '../compare-metrics';

@Component({
  selector: 'app-compare-tape',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './compare-tape.component.html',
  styleUrl: './compare-tape.component.css',
})
export class CompareTapeComponent {
  public readonly rows = input.required<CompareMetricRow[]>();
  public readonly names = input.required<[string, string]>();

  // eslint-disable-next-line unicorn/consistent-function-scoping
  public readonly score = computed(() => scoreRows(this.rows()));
  // eslint-disable-next-line unicorn/consistent-function-scoping
  public readonly leader = computed<CompareSide | null>(() => {
    const [a, b] = this.score().wins;
    if (a === b) return null;
    return a > b ? 0 : 1;
  });

  private readonly compactNumber = new FormatNumberPipe();
  private readonly levelPipe = new LevelPipe();

  public display(row: CompareMetricRow, side: CompareSide): string {
    const value = row.values[side];
    if (value === null) return '—';
    switch (row.format) {
      case 'number': {
        return this.compactNumber.transform(value);
      }
      case 'rank': {
        return '#' + formatThousands(value);
      }
      case 'level': {
        return this.levelPipe.transform(value);
      }
      default: {
        return formatThousands(value);
      }
    }
  }

  public exact(row: CompareMetricRow, side: CompareSide): string {
    const value = row.values[side];
    return value === null ? '' : formatThousands(value);
  }

  public delta(row: CompareMetricRow): string {
    if (row.difference === null) return '';
    if (row.format === 'rank') return '▲ ' + formatThousands(row.difference);
    const amount =
      row.format === 'number' ? this.compactNumber.transform(row.difference) : formatThousands(row.difference);
    return row.percent === null ? `+${amount}` : `+${amount} · +${formatThousands(row.percent)}%`;
  }
}
