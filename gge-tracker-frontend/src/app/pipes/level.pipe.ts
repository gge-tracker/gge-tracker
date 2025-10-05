import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'level',
  standalone: true,
})
export class LevelPipe implements PipeTransform {
  public transform(value: number): string {
    if (value < 70) return value.toString();
    return '70/' + (value - 70).toString();
  }
}
