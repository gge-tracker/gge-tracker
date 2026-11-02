import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ChevronsDown, ChevronsUp, ChevronsUpDown, LucideAngularModule } from 'lucide-angular';

const HEADER_ICON_SIZES: Record<string, { width: number; height: number }> = {
  '/assets/glory.png': { width: 37, height: 49 },
  '/assets/honor.png': { width: 26, height: 35 },
  '/assets/loot.png': { width: 36, height: 41 },
  '/assets/lvl.png': { width: 40, height: 38 },
  '/assets/member-list-activity.png': { width: 40, height: 39 },
  '/assets/member-list.png': { width: 40, height: 39 },
  '/assets/min-alliance.png': { width: 60, height: 41 },
  '/assets/pp1.png': { width: 46, height: 44 },
  '/assets/aquamarine_15.webp': { width: 39, height: 35 },
  '/assets/aquamarine_16.webp': { width: 156, height: 135 },
  '/assets/aquamarine_17.webp': { width: 110, height: 101 },
  '/assets/aquamarine_18.webp': { width: 41, height: 34 },
  '/assets/aquamarine_19.webp': { width: 40, height: 25 },
  '/assets/aquamarine_20.webp': { width: 39, height: 39 },
  '/assets/aquamarine_100.webp': { width: 40, height: 40 },
};

@Component({
  selector: 'app-table',
  imports: [NgTemplateOutlet, NgClass, TranslateModule, LucideAngularModule],
  standalone: true,
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
  public iconCaptions = input<boolean>(false);
  public sortOutput = output<string>();
  public previousPage = output<void>();
  public nextPage = output<void>();
  public navigateToPage = output<number>();
  public readonly ChevronsUpDown = ChevronsUpDown;
  public readonly ChevronsUp = ChevronsUp;
  public readonly ChevronsDown = ChevronsDown;

  public headerIconSize(source: string): { width: number; height: number } | undefined {
    return HEADER_ICON_SIZES[source];
  }

  public mobileSortHeaders(): [string, string, string?, boolean?][] {
    if (!this.sort()) return [];
    const sortable = this.headers().filter((header) => header[0] && header[1] && !header[3]);
    return sortable.length > 1 ? sortable : [];
  }

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
