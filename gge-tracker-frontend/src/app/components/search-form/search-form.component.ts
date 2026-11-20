/* eslint-disable unicorn/consistent-function-scoping */
import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnChanges,
  OnInit,
  output,
  SimpleChanges,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { SearchType } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { UtilitiesService } from '@ggetracker-services/utilities.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Download, Eraser, Filter, HardDrive, LucideAngularModule, Search } from 'lucide-angular';
import { FilterComponent } from '../filter/filter.component';
import { SearchSuggestion, SearchSuggestions } from './search-suggestions';

@Component({
  selector: 'app-search-form',
  standalone: true,
  imports: [FormsModule, TranslateModule, LucideAngularModule, FilterComponent, FormatNumberPipe],
  templateUrl: './search-form.component.html',
  styleUrl: './search-form.component.css',
})
export class SearchFormComponent implements OnChanges, OnInit {
  public searchFixed = '';
  public search = '';
  public readonly HardDrive = HardDrive;
  public readonly Search = Search;
  public readonly Download = Download;
  public readonly Reset = Eraser;
  public readonly Funnel = Filter;
  public formFilters = input.required<Record<string, string | boolean | undefined | number | null | string[]> | null>();
  public inputTip = input.required<string>();
  public searchTypes = input.required<Record<SearchType, boolean>>();
  public isInLoading = input.required<boolean>();
  public utilitiesService = inject(UtilitiesService);
  public searchPlayer = output<string>();
  public searchAlliance = output<string>();
  public exportDataEnabled = input<boolean>(false);
  public filtersModalId = input<string>('filtersModal');
  public exportData = output<void>();
  public filterActive = false;
  public defaultSearch = input<string>();
  public alliancePlaceholder = input<string>();
  public countFilterActivated = 0;
  public translateService = inject(TranslateService);
  public suggestionsEnabled = input<boolean>(false);
  public readonly suggestions = new SearchSuggestions(inject(ApiRestService), () => this.suggestedTypes());

  public searchType = computed(() => {
    const types = this.searchTypes();
    return (Object.keys(types) as SearchType[]).find((key) => types[key]);
  });

  public listId = computed(() => {
    const types = this.searchTypes();
    if (types['player'] && types['alliance']) return 'search-list';
    if (types['player']) return 'player-list';
    return 'alliance-list';
  });

  public title = computed(() => {
    const type = this.searchType();
    if (type === 'alliance') {
      return this.translateService.instant('dialog_alliance_noName');
    }
    return this.inputTip();
  });

  private readonly cdr = inject(ChangeDetectorRef);

  constructor() {
    this.suggestions
      .results()
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((items) => this.suggestions.show(items));
  }

  public onSearchChange(term: string): void {
    if (this.suggestionsEnabled()) this.suggestions.type(term);
  }

  public onKeydown(event: KeyboardEvent): void {
    if (!this.suggestionsEnabled()) {
      if (event.key === 'Enter') this.onEnterSearch();
      return;
    }
    switch (event.key) {
      case 'Enter': {
        const active = this.suggestions.active();
        if (active) this.pickSuggestion(active);
        else this.closeAndSearch();
        break;
      }
      case 'Escape': {
        this.suggestions.close();
        break;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        if (this.suggestions.items().length === 0) return;
        event.preventDefault();
        this.suggestions.move(event.key === 'ArrowDown' ? 1 : -1);
        break;
      }
    }
  }

  public pickSuggestion(suggestion: SearchSuggestion): void {
    this.suggestions.close();
    this.search = suggestion.name;
    if (suggestion.type === 'player') this.onPlayerSearch();
    else this.onAllianceSearch();
  }

  public isFirstOfType(index: number): boolean {
    const items = this.suggestions.items();
    return this.suggestedTypes().length > 1 && (index === 0 || items[index - 1].type !== items[index].type);
  }

  public ngOnInit(): void {
    this.updateNbFilterActivated();
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes['defaultSearch']) {
      const search = changes['defaultSearch'].currentValue;
      if (search && search !== '') {
        this.search = search;
      }
    }
    this.updateNbFilterActivated();
  }

  public onEnterSearch(): void {
    const type = this.searchType();
    this.searchFixed = this.search;
    if (type === 'player') {
      this.searchPlayer.emit(this.searchFixed);
      this.saveResultForHistory('player', this.searchFixed);
    } else if (type === 'alliance') {
      this.searchAlliance.emit(this.searchFixed);
      this.saveResultForHistory('alliance', this.searchFixed);
    }
  }

  public onPlayerSearch(): void {
    this.suggestions.close();
    this.searchFixed = this.search;
    this.searchPlayer.emit(this.searchFixed);
    this.saveResultForHistory('player', this.searchFixed);
  }

  public onAllianceSearch(): void {
    this.suggestions.close();
    this.searchFixed = this.search;
    this.searchAlliance.emit(this.searchFixed);
    this.saveResultForHistory('alliance', this.searchFixed);
  }

  public onReset(): void {
    this.suggestions.close();
    this.search = '';
    this.searchFixed = '';
    this.searchPlayer.emit('');
    this.searchAlliance.emit('');
  }

  public getLocalStorageSearchHistory(): Record<string, string[]> {
    try {
      return JSON.parse(globalThis.localStorage.getItem('searchHistory') || '{}');
    } catch (error) {
      console.error('Error parsing search history from localStorage', error);
    }
    return {};
  }

  public saveResultForHistory(category: SearchType, search: string): void {
    try {
      if (globalThis.window === undefined) return;
      const history = this.getLocalStorageSearchHistory();
      if (history[category] && history[category].length > 5) {
        history[category].pop();
      }
      if (!history[category]) {
        history[category] = [];
      }
      const index = history[category].indexOf(search);
      if (index !== -1) {
        history[category].splice(index, 1);
      }
      history[category].unshift(search);
      globalThis.localStorage.setItem('searchHistory', JSON.stringify(history));
    } catch (error) {
      console.error('Error saving search history to localStorage', error);
      try {
        globalThis.localStorage.setItem('searchHistory', JSON.stringify({}));
      } catch (error) {
        console.error('Error clearing search history in localStorage', error);
      }
    }
  }

  public getSearchHistory(category: SearchType | 'all'): string[] {
    try {
      if (globalThis.window === undefined) return [];
      const history = this.getLocalStorageSearchHistory();
      if (category === 'all') {
        return [...new Set(Object.values(history).flat())].filter((_, index) => index % 2 === 0).slice(0, 5);
      }
      return [...new Set(history[category] || [])];
    } catch (error) {
      console.error('Error retrieving search history from localStorage', error);
    }
    return [];
  }

  public updateNbFilterActivated(): void {
    const forms: Record<string, string | boolean | number | null | undefined | string[]> | null = this.formFilters();
    if (!forms) return;
    let nb =
      Object.keys(forms).filter(
        (key) => forms[key] !== '' && forms[key] !== '-1' && forms[key] !== null && typeof forms[key] !== 'object',
      ).length - 1;
    for (const key of Object.keys(forms)) {
      if (Array.isArray(forms[key])) {
        const array = forms[key];
        nb += array.filter((value) => value === '1').length;
      }
    }
    this.countFilterActivated = nb;
    this.cdr.detectChanges();
  }

  private closeAndSearch(): void {
    this.suggestions.close();
    this.onEnterSearch();
  }

  private suggestedTypes(): SearchType[] {
    const types = this.searchTypes();
    return (Object.keys(types) as SearchType[]).filter((key) => types[key]);
  }
}
