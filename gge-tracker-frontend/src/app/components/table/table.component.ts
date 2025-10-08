import { NgClass, NgForOf, NgIf, NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ChevronsDown, ChevronsUp, ChevronsUpDown, LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-table',
  standalone: true,
  imports: [NgIf, NgForOf, NgTemplateOutlet, NgClass, TranslateModule, LucideAngularModule],
  templateUrl: './table.component.html',
  styleUrl: './table.component.css',
})
export class TableComponent {
  public sort = input.required<string>();
  public reverse = input.required<boolean>();
  public page = input.required<number>();
  public search = input.required<string>();
  public maxPage = input.required<number>();
  public isInLoading = input.required<boolean>();
  public isPaginationHidden = input<boolean>();
  public headers = input.required<[string, string, string?, boolean?][]>();
  public sortOutput = output<string>();
  public previousPage = output<void>();
  public nextPage = output<void>();
  public navigateToPage = output<number>();
  public readonly ChevronsUpDown = ChevronsUpDown;
  public readonly ChevronsUp = ChevronsUp;
  public readonly ChevronsDown = ChevronsDown;

  public sortAlliances(sort: string): void {
    this.sortOutput.emit(sort);
  }

  public visiblePages(): number[] {
    const maxPage = this.maxPage();
    const page = this.page();
    if (!maxPage) return [];
    let pageCutLow = Math.max(1, page - 1);
    let pageCutHigh = Math.min(maxPage, page + 1);
    if (page === 1) pageCutHigh += 2;
    if (page === 2) pageCutHigh += 1;
    if (page === maxPage) pageCutLow -= 2;
    if (page === maxPage) pageCutLow -= 1;
    return Array.from({ length: pageCutHigh - pageCutLow + 1 }, (_, index) => pageCutLow + index);
  }

  public allPages(): number[] {
    return Array.from({ length: this.maxPage() || 1 }, (_, index) => index + 1);
  }
}
