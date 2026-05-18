import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiStormyIslesLeaderboardResponse,
  ApiStormyIslesPlayer,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { TranslateModule } from '@ngx-translate/core';
import { StormyIslesTableContentComponent } from './stormy-isles-table-content/stormy-isles-table-content.component';

const SORTABLE_METRIC_IDS = [100, 15, 16, 17, 18, 19, 20] as const;
const TABLE_SORTABLE_KEYS = [
  'player_name',
  'level',
  'might_current',
  'alliance_name',
  ...SORTABLE_METRIC_IDS.map(String),
] as const;

export type SortableMetricId = (typeof SORTABLE_METRIC_IDS)[number];
export const METRIC_LABELS: Record<SortableMetricId, string> = {
  100: 'Points de cargo',
  15: "Total d'aigues-marines collectées",
  16: 'Aigues-marines collectées dans les îles aux ressources',
  17: 'Aigues-marines collectées dans les forts orageux',
  18: 'Aigues-marines collectées dans les combats JcJ',
  19: 'Aigues-marines dépensées pour des points de cargo',
  20: 'Aigues-marines perdues en combats JcJ',
};

@Component({
  selector: 'app-stormy-isles',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, TableComponent, SearchFormComponent, TranslateModule, StormyIslesTableContentComponent],
  templateUrl: './stormy-isles.component.html',
  styleUrls: ['./stormy-isles.component.css'],
})
export class StormyIslesComponent extends GenericComponent implements OnInit {
  public readonly tableHeaders: [string, string, string?, boolean?][] = [
    ['player_name', 'Pseudonyme'],
    ['level', 'Niveau', '/assets/lvl.png'],
    ['might_current', 'Points de puissance', '/assets/pp1.png'],
    ['alliance_name', 'Alliance', '/assets/min-alliance.png', true],
    ['100', METRIC_LABELS[100], '/assets/aquamarine_100.webp'],
    ['15', METRIC_LABELS[15], '/assets/aquamarine_15.webp'],
    ['16', METRIC_LABELS[16], '/assets/aquamarine_16.webp'],
    ['17', METRIC_LABELS[17], '/assets/aquamarine_17.webp'],
    ['19', METRIC_LABELS[19], '/assets/aquamarine_19.webp'],
    ['20', METRIC_LABELS[20], '/assets/aquamarine_20.webp'],
    ['18', METRIC_LABELS[18], '/assets/aquamarine_18.webp'],
  ];

  public players: ApiStormyIslesPlayer[] = [];
  public page = 1;
  public maxPage = 1;
  public pageSize = 15;
  public totalCount = 0;
  public snapshotDate: string | null = null;
  public responseTime = 0;
  public sort = '100';
  public reverse = true;
  public search = '';
  public searchType: 'player' | 'alliance' = 'player';

  private cdr = inject(ChangeDetectorRef);

  constructor() {
    super();
    this.isInLoading = true;
  }

  public ngOnInit(): void {
    if (globalThis.window === undefined) return;
    const urlParameters = this.route.snapshot.queryParams;
    this.page = urlParameters['page'] ? Number(urlParameters['page']) : 1;
    void this.load();
  }

  public async nextPage(): Promise<void> {
    if (this.isInLoading || this.page >= this.maxPage) return;
    this.page++;
    await this.load();
  }

  public async previousPage(): Promise<void> {
    if (this.isInLoading || this.page <= 1) return;
    this.page--;
    await this.load();
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.page = page;
    await this.load();
  }

  public async sortTable(sortKey: string): Promise<void> {
    if (this.isInLoading) return;
    if (this.sort === sortKey) {
      this.reverse = !this.reverse;
    } else {
      this.sort = sortKey;
      this.reverse = true;
    }
    this.page = 1;
    await this.load();
  }

  public async searchPlayer(playerName: string): Promise<void> {
    this.search = playerName;
    this.searchType = 'player';
    this.page = 1;
    await this.load();
  }

  public async searchAlliance(allianceName: string): Promise<void> {
    this.search = allianceName;
    this.searchType = 'alliance';
    this.page = 1;
    await this.load();
  }

  public onClickAlliance(allianceName: string): void {
    void this.updateGenericParamsInUrl(
      { search: allianceName, searchType: 'alliance' },
      { search: undefined, searchType: undefined },
    );
    void this.searchAlliance(allianceName);
  }

  private async load(): Promise<void> {
    this.isInLoading = true;
    this.cdr.detectChanges();
    try {
      const orderMetricId = this.resolveOrderMetricId();
      const orderDirection = this.reverse ? 'DESC' : 'ASC';
      const playerName = this.searchType === 'player' && this.search ? this.search : undefined;
      const allianceName = this.searchType === 'alliance' && this.search ? this.search : undefined;

      const start = Date.now();
      const result = await this.apiRestService.getStormyIslesLeaderboard(
        this.page,
        orderMetricId,
        orderDirection,
        playerName,
        allianceName,
      );
      this.responseTime = Date.now() - start;

      if (!result.success || !result.data) {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
        this.isInLoading = false;
        this.cdr.detectChanges();
        return;
      }

      const data: ApiStormyIslesLeaderboardResponse = result.data;
      this.players = data.players;
      this.snapshotDate = data.snapshot_date;
      this.maxPage = data.pagination.total_pages;
      this.totalCount = data.pagination.total_items_count;

      void this.updateGenericParamsInUrl({ page: this.page }, { page: 1 });
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    } finally {
      this.isInLoading = false;
      this.cdr.detectChanges();
    }
  }

  private resolveOrderMetricId(): string | undefined {
    if (TABLE_SORTABLE_KEYS.includes(this.sort as any)) {
      return this.sort;
    }
    return '100'; // Default sorting by cargo points';
  }
}
