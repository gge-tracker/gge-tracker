import { Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

const TITLES_PER_FAMILY = 4;
const FAMILIES = ['brawler', 'hunter', 'guardian', 'warrior', 'warlord', 'annihilator'] as const;

export const HIGHEST_LEAGUE_TITLE = 21;

export type LeagueTitleFamily = (typeof FAMILIES)[number];

export interface LeagueTitleArt {
  family: LeagueTitleFamily;
  level: number;
}

export function leagueTitleArt(title: number): LeagueTitleArt {
  const clamped = Math.min(HIGHEST_LEAGUE_TITLE, Math.max(1, title));
  const familyIndex = Math.floor((clamped - 1) / TITLES_PER_FAMILY);
  return {
    family: FAMILIES[familyIndex],
    level: (clamped - 1) % TITLES_PER_FAMILY,
  };
}

export function leagueTitleFamilies(): {
  family: LeagueTitleFamily;
  firstTitle: number;
  lastTitle: number;
}[] {
  return FAMILIES.map((family, index) => ({
    family,
    firstTitle: index * TITLES_PER_FAMILY + 1,
    lastTitle: Math.min(HIGHEST_LEAGUE_TITLE, (index + 1) * TITLES_PER_FAMILY),
  }));
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
  public readonly compact = input<boolean>(false);

  public get art(): LeagueTitleArt {
    return leagueTitleArt(this.title());
  }

  public get nameKey(): string {
    return `seasonLeague_rank_${this.title()}`;
  }
}
