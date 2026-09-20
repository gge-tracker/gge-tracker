import { Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

const EMBLEM_DIVISIONS = new Set([1, 2, 3, 4, 5, 6]);

const emblemUrlOf = (division: number): string | null =>
  EMBLEM_DIVISIONS.has(division) ? `/assets/gt/division${division}.png` : null;

@Component({
  selector: 'app-division-badge',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './division-badge.component.html',
  styleUrl: './division-badge.component.css',
})
export class DivisionBadgeComponent {
  public readonly division = input.required<number>();
  public readonly nameKey = input.required<string>();
  public readonly size = input(38);

  public get emblemUrl(): string | null {
    return emblemUrlOf(this.division());
  }
}
