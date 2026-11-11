import { Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

const TITLES_PER_TIER = 4;
const HIGHEST_TITLE = 21;

export function leagueTier(title: number): number {
  if (title >= HIGHEST_TITLE) return 6;
  return Math.max(1, Math.ceil(title / TITLES_PER_TIER));
}

@Component({
  selector: 'app-league-title',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './league-title.component.html',
  styleUrl: './league-title.component.css',
})
export class LeagueTitleComponent {
  public readonly title = input.required<number>();

  public get tier(): number {
    return leagueTier(this.title());
  }

  public get nameKey(): string {
    return `seasonLeague_rank_${this.title()}`;
  }
}
