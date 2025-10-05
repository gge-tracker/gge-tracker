import { NgClass, NgIf } from '@angular/common';
import { Component, input, OnChanges, OnInit, output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

/**
 * SearchbarComponent provides a customizable search bar UI element.
 *
 * @remarks
 * This component supports various input types and emits search values to parent components.
 * It is designed to be standalone and reusable, with configurable attributes such as placeholder, min/max values, and input type.
 *
 * @example
 * ```html
 * <app-search-bar
 *   [attrListInput]="attributes"
 *   [inputType]="'text'"
 *   [placeholderInput]="'Search...'"
 *   [searchInput]="searchValue"
 *   [name]="'search'"
 *   [min]="0"
 *   [max]="100"
 *   (searchEmitter)="onSearch($event)">
 * </app-search-bar>
 * ```
 *
 * @property attrListInput - List of attribute names for the input element.
 * @property inputType - Type of the input element (e.g., 'text', 'number').
 * @property placeholderInput - Placeholder text for the input field.
 * @property touched - Indicates if the input has been interacted with.
 * @property searchInput - Initial value for the search input.
 * @property name - Name attribute for the input element.
 * @property min - Minimum value for numeric input types.
 * @property max - Maximum value for numeric input types.
 * @property hasContent - Indicates if the input field has content.
 * @property search - Current value of the search input.
 * @property firstValue - Initial value of the search input.
 * @property searchEmitter - Emits the search value when updated.
 *
 * @method ngOnInit - Initializes the component and sets initial values.
 * @method ngOnChanges - Handles changes to input properties.
 * @method updateSearchValue - Emits the updated search value.
 */
@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [FormsModule, RouterModule, NgIf, NgClass],
  templateUrl: './searchbar.component.html',
  styleUrls: ['./searchbar.component.css'],
})
export class SearchbarComponent implements OnInit, OnChanges {
  public attrListInput = input.required<string[]>();
  public inputType = input<string>('text');
  public placeholderInput = input.required<string>();
  public touched = input<boolean>(false);
  public searchInput = input.required<string | null | undefined | number>();
  public name = input.required<string>();
  public min = input<number | null | undefined>(null);
  public max = input<number | null | undefined>(null);
  public hasContent = input<boolean>(false);
  public search: string | number | null | undefined = '';
  public firstValue: string | number | null | undefined = '';
  public searchEmitter = output<string>();

  public ngOnInit(): void {
    this.search = this.searchInput();
    this.firstValue = this.searchInput();
  }

  public ngOnChanges(changes: SimpleChanges): void {
    if (changes['searchInput']) {
      this.search = changes['searchInput'].currentValue;
    }
  }

  public updateSearchValue(value: string | number | null | undefined): void {
    this.searchEmitter.emit(String(value ?? ''));
  }
}
