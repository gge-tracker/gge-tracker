import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatNumber',
  standalone: true,
})
export class FormatNumberPipe implements PipeTransform {
  public transform(value: number | string, type?: string): string {
    value = Number(value);
    if (type === 'visual') {
      const parts = value.toString().split('.');
      const integerPart = parts[0];
      const decimalPart = parts.length > 1 ? '.' + parts[1] : '';
      const formattedIntegerPart = integerPart.replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
      return formattedIntegerPart + decimalPart;
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
