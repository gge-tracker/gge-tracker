import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Search, SquareArrowOutUpRight, X } from 'lucide-angular';

import { CompareSide } from '../compare-metrics';

export type CompareSubject = 'players' | 'alliances';

export interface CompareContender {
  id: string;
  name: string;
  server: string;
  profileLink: string[];
  detail: string | null;
  detailLink: string[] | null;
  level: { level: number; legendary: number } | null;
}

@Component({
  selector: 'app-compare-contender',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule],
  templateUrl: './compare-contender.component.html',
  styleUrl: './compare-contender.component.css',
  host: {
    '[class.side-a]': 'side() === 0',
    '[class.side-b]': 'side() === 1',
  },
})
export class CompareContenderComponent {
  public readonly side = input.required<CompareSide>();
  public readonly subject = input.required<CompareSubject>();
  public readonly contender = input<CompareContender | null>(null);
  public readonly loading = input(false);
  public readonly error = input<string | null>(null);

  public readonly searchName = output<string>();
  public readonly clear = output<void>();

  public readonly Search = Search;
  public readonly X = X;
  public readonly OpenProfile = SquareArrowOutUpRight;
  public query = '';

  public get placeholder(): string {
    return this.subject() === 'players' ? 'Rechercher un joueur' : 'Rechercher une alliance';
  }

  public submit(): void {
    const name = this.query.trim();
    if (name) this.searchName.emit(name);
  }
}
