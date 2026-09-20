import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiAllianceSuggestion, ApiPlayerSuggestion, ApiSuggestion } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Search, SquareArrowOutUpRight, X } from 'lucide-angular';
import { debounceTime, distinctUntilChanged, Subject, switchMap } from 'rxjs';

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
  castleCount: number | null;
}

const MIN_QUERY_LENGTH = 2;
const SUGGESTION_DEBOUNCE_MS = 200;

@Component({
  selector: 'app-compare-contender',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule, FormatNumberPipe],
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
  public readonly pickId = output<string>();
  public readonly clear = output<void>();

  public readonly Search = Search;
  public readonly X = X;
  public readonly OpenProfile = SquareArrowOutUpRight;

  public readonly suggestions = signal<ApiSuggestion[]>([]);
  public readonly activeIndex = signal(-1);
  public query = '';

  private readonly apiRestService = inject(ApiRestService);
  private readonly typed = new Subject<string>();

  constructor() {
    this.typed
      .pipe(
        debounceTime(SUGGESTION_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((term) => this.fetchSuggestions(term)),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((suggestions) => {
        this.suggestions.set(suggestions);
        this.activeIndex.set(-1);
      });
  }

  public get placeholder(): string {
    return this.subject() === 'players' ? 'Rechercher un joueur' : 'Rechercher une alliance';
  }

  public search(term: string): void {
    this.typed.next(term.trim());
  }

  public allianceOf(suggestion: ApiSuggestion): string | null {
    return (suggestion as ApiPlayerSuggestion).alliance_name ?? null;
  }

  public membersOf(suggestion: ApiSuggestion): number | null {
    return (suggestion as ApiAllianceSuggestion).player_count ?? null;
  }

  public navigate(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    const total = this.suggestions().length;
    if (total === 0 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const current = this.activeIndex();
    this.activeIndex.set(current === -1 ? (step > 0 ? 0 : total - 1) : (current + step + total) % total);
  }

  public pick(suggestion: ApiSuggestion): void {
    this.close();
    this.query = '';
    this.pickId.emit(suggestion.id);
  }

  public submit(): void {
    const active = this.suggestions()[this.activeIndex()];
    if (active) {
      this.pick(active);
      return;
    }
    const name = this.query.trim();
    if (name) {
      this.close();
      this.searchName.emit(name);
    }
  }

  public close(): void {
    this.suggestions.set([]);
    this.activeIndex.set(-1);
  }

  private async fetchSuggestions(term: string): Promise<ApiSuggestion[]> {
    if (term.length < MIN_QUERY_LENGTH) return [];
    const response =
      this.subject() === 'players'
        ? await this.apiRestService.getPlayerSuggestions(term)
        : await this.apiRestService.getAllianceSuggestions(term);
    return response.success ? response.data.suggestions : [];
  }
}
