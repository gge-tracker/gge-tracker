import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, input, TemplateRef, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

export interface ModalTableSortContext {
  sortBy: (column: string) => void;
  sortColumn: string | undefined;
  sortAsc: boolean;
}

/**
 * Generic reusable table component designed
 * to be embedded inside modals
 */
@Component({
  selector: 'app-modal-table',
  imports: [FormsModule, TranslatePipe, NgTemplateOutlet],
  templateUrl: './modal-table.component.html',
  styleUrl: './modal-table.component.css',
})
export class ModalTableComponent<T> {
  public readonly items = input.required<T[]>();

  public readonly headerTemplate = input.required<TemplateRef<ModalTableSortContext>>();
  public readonly rowTemplate = input.required<TemplateRef<{ $implicit: T }>>();

  public readonly defaultSortColumn = input<string>();
  public readonly pageSize = input<number>(10);

  /**
   * Keys of `T` whose string values are matched against `searchTerm`
   * When empty, all string-valued properties are searched
   */
  public readonly searchableFields = input<(keyof T)[]>([]);

  /**
   * Custom search predicate. When provided, takes priority over `searchableFields`
   * Receives the item and the lowercase-trimmed search term
   */
  public readonly searchFilter = input<(item: T, term: string) => boolean>();

  /**
   * Custom sort comparator. When provided, replaces the default string/number sort
   * Receives `(a, b, columnKey, isAscending)` and must return a negative/zero/positive number
   */
  public readonly sortComparator = input<(a: T, b: T, column: string, asc: boolean) => number>();

  /**
   * Changing this value resets search, page, and sort state
   * (e.g. a selected player ID or name) to reset the table for the new data
   */
  public readonly resetKey = input<unknown>();

  public searchTerm = '';
  public currentPage = 1;
  public totalPages = 1;
  public sortColumn: string | undefined;
  public sortAsc = true;

  constructor() {
    effect(() => {
      this.resetKey();
      this.searchTerm = '';
      this.currentPage = 1;
      this.sortAsc = true;
      this.sortColumn = untracked(() => this.defaultSortColumn());
    });
  }

  public get paginatedItems(): T[] {
    const term = this.searchTerm.trim().toLowerCase();
    let filtered = this.items();

    // Filter
    if (term) {
      const customFilter = this.searchFilter();
      if (customFilter) {
        filtered = filtered.filter((item) => customFilter(item, term));
      } else {
        const fields = this.searchableFields();
        filtered = filtered.filter((item) => {
          const values = fields.length > 0 ? fields.map((f) => item[f]) : Object.values(item as object);
          return values.some((v) => typeof v === 'string' && v.toLowerCase().includes(term));
        });
      }
    }

    // Sort
    const col = this.sortColumn;
    if (col) {
      const customComparator = this.sortComparator();
      filtered = [...filtered].sort((a, b) => {
        if (customComparator) return customComparator(a, b, col, this.sortAsc);
        const aValue = (a as Record<string, unknown>)[col] ?? '';
        const bValue = (b as Record<string, unknown>)[col] ?? '';
        const cmp =
          typeof aValue === 'number' && typeof bValue === 'number'
            ? aValue - bValue
            : String(aValue).localeCompare(String(bValue), undefined, { sensitivity: 'base' });
        return cmp * (this.sortAsc ? 1 : -1);
      });
    }

    // Paginate
    this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize()));
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    const start = (this.currentPage - 1) * this.pageSize();
    return filtered.slice(start, start + this.pageSize());
  }

  public get sortContext(): ModalTableSortContext {
    return {
      sortBy: this.sortBy.bind(this),
      sortColumn: this.sortColumn,
      sortAsc: this.sortAsc,
    };
  }

  public sortBy(column: string): void {
    if (this.sortColumn === column) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortColumn = column;
      this.sortAsc = true;
    }
    this.currentPage = 1;
  }

  public onSearchChange(): void {
    this.currentPage = 1;
  }

  public changePage(delta: number): void {
    this.currentPage = Math.min(this.totalPages, Math.max(1, this.currentPage + delta));
  }
}
