import { NgClass, NgIf } from '@angular/common';
import { Component, input, OnChanges, OnInit, output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

/**
 * SearchbarComponent provides a customizable search bar UI element
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
