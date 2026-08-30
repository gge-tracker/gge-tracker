import { Pipe, PipeTransform } from '@angular/core';

import { formatThousands } from '@ggetracker-services/text-format.utilities';

@Pipe({
  name: 'formatNumber',
  standalone: true,
})
export class FormatNumberPipe implements PipeTransform {
  public transform(value: number | string, type?: string): string {
    value = Number(value);
    if (type === 'visual') {
      return formatThousands(value);
    } else {
      if (Math.abs(value) >= 1_000_000_000) {
        return (value / 1_000_000_000).toFixed(2) + 'B';
      }
      if (Math.abs(value) >= 1_000_000) {
        return (value / 1_000_000).toFixed(2) + 'M';
      }
      if (Math.abs(value) >= 1000) {
        return (value / 1000).toFixed(2) + 'K';
      }
      return value.toString();
    }
  }
}
