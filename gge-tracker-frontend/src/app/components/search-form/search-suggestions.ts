import { signal } from '@angular/core';
import {
  ApiAllianceSuggestion,
  ApiPlayerSuggestion,
  ApiSuggestion,
  SearchType,
} from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { debounceTime, distinctUntilChanged, Observable, Subject, switchMap } from 'rxjs';

export interface SearchSuggestion {
  type: SearchType;
  id: string;
  name: string;
  might: number;
  detail: string | number | null;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;
const MAX_PER_TYPE_WHEN_MIXED = 5;

export class SearchSuggestions {
  public readonly items = signal<SearchSuggestion[]>([]);
  public readonly activeIndex = signal(-1);

  private readonly typed = new Subject<string>();

  constructor(
    private readonly apiRestService: ApiRestService,
    private readonly types: () => SearchType[],
  ) {}

  public results(): Observable<SearchSuggestion[]> {
    return this.typed.pipe(
      debounceTime(DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap((term) => this.fetch(term)),
    );
  }

  public show(items: SearchSuggestion[]): void {
    this.items.set(items);
    this.activeIndex.set(-1);
  }

  public type(term: string): void {
    this.typed.next(term.trim());
  }

  public close(): void {
    this.show([]);
  }

  public active(): SearchSuggestion | undefined {
    return this.items()[this.activeIndex()];
  }

  public move(step: 1 | -1): void {
    const total = this.items().length;
    if (total === 0) return;
    const current = this.activeIndex();
    this.activeIndex.set(current === -1 ? (step > 0 ? 0 : total - 1) : (current + step + total) % total);
  }

  private async fetch(term: string): Promise<SearchSuggestion[]> {
    const types = this.types();
    if (term.length < MIN_QUERY_LENGTH || types.length === 0) return [];
    const limit = types.length > 1 ? MAX_PER_TYPE_WHEN_MIXED : Number.POSITIVE_INFINITY;
    const lists = await Promise.all(types.map((type) => this.fetchType(type, term)));
    return lists.flatMap((list) => list.slice(0, limit));
  }

  private async fetchType(type: SearchType, term: string): Promise<SearchSuggestion[]> {
    if (type === 'player') {
      const response = await this.apiRestService.getPlayerSuggestions(term);
      return response.success ? response.data.suggestions.map((player) => this.fromPlayer(player)) : [];
    }
    const response = await this.apiRestService.getAllianceSuggestions(term);
    return response.success ? response.data.suggestions.map((alliance) => this.fromAlliance(alliance)) : [];
  }

  private fromPlayer(player: ApiPlayerSuggestion): SearchSuggestion {
    return this.from('player', player, player.alliance_name);
  }

  private fromAlliance(alliance: ApiAllianceSuggestion): SearchSuggestion {
    return this.from('alliance', alliance, alliance.player_count);
  }

  private from(type: SearchType, suggestion: ApiSuggestion, detail: string | number | null): SearchSuggestion {
    return { type, id: suggestion.id, name: suggestion.name, might: suggestion.might_current, detail };
  }
}
