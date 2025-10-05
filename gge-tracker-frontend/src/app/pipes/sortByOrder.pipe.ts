import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'sortByOrder',
  standalone: true,
})
export class SortByOrderPipe implements PipeTransform {
  public transform(value: string[], order = 'asc'): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      return value;
    }
    return value.sort((a, b) => {
      return order === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    });
  }
}
