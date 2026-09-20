import { Component, computed, input } from '@angular/core';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
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

  public display(row: CompareMetricRow, side: CompareSide): string {
    const value = row.values[side];
    if (value === null) return '-';
    return row.format === 'number' ? this.compactNumber.transform(value) : formatThousands(value);
  }

  public exact(row: CompareMetricRow, side: CompareSide): string {
    const value = row.values[side];
    return value === null ? '' : formatThousands(value);
  }

  public rank(row: CompareMetricRow, side: CompareSide): string {
    const position = row.ranks[side];
    return position === null ? '' : '#' + formatThousands(position);
  }

  public delta(row: CompareMetricRow): string {
    if (row.difference === null) return '';
    const amount =
      row.format === 'number' ? this.compactNumber.transform(row.difference) : formatThousands(row.difference);
    return row.percent === null ? `+${amount}` : `+${amount} · +${formatThousands(row.percent)}%`;
  }
}
