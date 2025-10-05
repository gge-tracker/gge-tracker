import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectorRef, Component, inject, input, OnChanges, OnInit, output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { SearchType } from '@ggetracker-interfaces/empire-ranking';
import { UtilsService } from '@ggetracker-services/utils.service';
import { HardDrive, LucideAngularModule, Search, Filter, Eraser } from 'lucide-angular';
import { FilterComponent } from '../filter/filter.component';

@Component({
  selector: 'app-search-form',
  standalone: true,
  imports: [NgIf, FormsModule, TranslateModule, LucideAngularModule, NgFor, FilterComponent],
  templateUrl: './search-form.component.html',
  styleUrl: './search-form.component.css',
})
export class SearchFormComponent implements OnChanges, OnInit {
  public searchType: SearchType = 'player';
  public searchFixed = '';
  public search = '';
  public readonly HardDrive = HardDrive;
  public readonly Search = Search;
  public readonly Reset = Eraser;
  public readonly Funnel = Filter;
  public formFilters = input.required<Record<string, string | boolean | undefined | null> | null>();
  public inputTip = input.required<string>();
  public searchTypes = input.required<Record<SearchType, boolean>>();
  public isInLoading = input.required<boolean>();
  public utilsService = inject(UtilsService);
  public searchPlayer = output<string>();
  public searchAlliance = output<string>();
  public filterActive = false;
  public defaultSearch = input<string>();
  public alliancePlaceholder = input<string>();
  public countFilterActivated = 0;

  private cdr = inject(ChangeDetectorRef);

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

  public getFormsFilter(): Record<string, string | boolean | null | undefined> | null {
    return this.formFilters();
  }

  public getLocalStorageSearchHistory(): Record<string, string[]> {
    try {
      return JSON.parse(window.localStorage.getItem('searchHistory') || '{}');
    } catch (error) {
      console.error('Error parsing search history from localStorage', error);
    }
    return {};
  }

  public saveResultForHistory(category: SearchType, search: string): void {
    try {
      if (typeof window === 'undefined') return;
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
      window.localStorage.setItem('searchHistory', JSON.stringify(history));
    } catch (error) {
      console.error('Error saving search history to localStorage', error);
      try {
        window.localStorage.setItem('searchHistory', JSON.stringify({}));
      } catch (error) {
        console.error('Error clearing search history in localStorage', error);
      }
    }
  }

  public getSearchHistory(category: SearchType | 'all'): string[] {
    try {
      if (typeof window === 'undefined') return [];
      if (category === 'all') {
        const history = this.getLocalStorageSearchHistory();
        return Object.values(history).flat() as string[];
      }
      const history = this.getLocalStorageSearchHistory();
      return history[category] || [];
    } catch (error) {
      console.error('Error retrieving search history from localStorage', error);
    }
    return [];
  }

  public updateNbFilterActivated(): void {
    const forms: Record<string, string | boolean | null | undefined> | null = this.formFilters();
    if (!forms) return;
    this.countFilterActivated =
      Object.keys(forms).filter((key) => forms[key] !== '' && forms[key] !== '-1' && forms[key] !== null).length - 1;
    this.cdr.detectChanges();
  }
}
