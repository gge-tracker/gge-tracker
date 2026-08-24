import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ModalFormGroupComponent } from '@ggetracker-components/modal-form-group/modal-form-group.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiStormyIslesLeaderboardResponse,
  ApiStormyIslesPlayer,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { BoundType, FilterKeyMap } from '@ggetracker-interfaces/filter';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { TranslateModule } from '@ngx-translate/core';
import { IconToggleComponent } from '../players/icon-toggle/icon-toggle.component';
import { StormyIslesTableContentComponent } from './stormy-isles-table-content/stormy-isles-table-content.component';

const SORTABLE_METRIC_IDS = [100, 15, 16, 17, 18, 19, 20] as const;
const PG_SORTABLE_KEYS = [
  'player_name',
  'level',
  'might_current',
  'might_all_time',
  'alliance_name',
  'alliance_might',
  'alliance_player_count',
] as const;
const TABLE_SORTABLE_KEYS = [...PG_SORTABLE_KEYS, ...SORTABLE_METRIC_IDS.map(String)] as readonly string[];

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

const METRIC_SHORT_LABELS: Record<SortableMetricId, string> = {
  100: 'Points de cargo',
  15: 'Aigues-marines (total)',
  16: 'Îles de ressources',
  17: 'Forteresses des tempêtes',
  18: 'Combats JcJ',
  19: 'Dépensées (cargo)',
  20: 'Perdues (JcJ)',
};

type MetricFilterField = `metric${SortableMetricId}`;

const FILTERABLE_METRICS: { id: SortableMetricId; field: MetricFilterField; label: string; icon: string }[] =
  SORTABLE_METRIC_IDS.map((id) => ({
    id,
    field: `metric${id}` as MetricFilterField,
    label: METRIC_SHORT_LABELS[id],
    icon: `/assets/aquamarine_${id}.webp`,
  }));

type FilterField = 'might' | 'level' | 'allianceMight' | 'alliancePlayers' | MetricFilterField;

interface FormFilters {
  minMight: string;
  maxMight: string;
  minLevel: string;
  maxLevel: string;
  minAllianceMight: string;
  maxAllianceMight: string;
  minAlliancePlayers: string;
  maxAlliancePlayers: string;
  allianceFilter: string;
  isFiltered: boolean;
  [metricBound: string]: string | boolean;
}

@Component({
  selector: 'app-stormy-isles',
  standalone: true,
  providers: [FormatNumberPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    FormsModule,
    TableComponent,
    SearchFormComponent,
    TranslateModule,
    ModalFormGroupComponent,
    IconToggleComponent,
    StormyIslesTableContentComponent,
  ],
  templateUrl: './stormy-isles.component.html',
  styleUrls: ['./stormy-isles.component.css'],
})
export class StormyIslesComponent extends GenericComponent implements OnInit {
  @ViewChild('searchForm') public searchForm!: SearchFormComponent;

  public readonly tableHeaders: [string, string, string?, boolean?][] = [
    ['player_name', 'Pseudonyme'],
    ['level', 'Niveau', '/assets/lvl.png'],
    ['might_current', 'Points de puissance', '/assets/pp1.png'],
    ['alliance_name', 'Alliance', '/assets/min-alliance.png'],
    ['100', METRIC_LABELS[100], '/assets/aquamarine_100.webp'],
    ['15', METRIC_LABELS[15], '/assets/aquamarine_15.webp'],
    ['16', METRIC_LABELS[16], '/assets/aquamarine_16.webp'],
    ['17', METRIC_LABELS[17], '/assets/aquamarine_17.webp'],
    ['19', METRIC_LABELS[19], '/assets/aquamarine_19.webp'],
    ['20', METRIC_LABELS[20], '/assets/aquamarine_20.webp'],
    ['18', METRIC_LABELS[18], '/assets/aquamarine_18.webp'],
  ];

  public readonly filterableMetrics = FILTERABLE_METRICS;

  public readonly sortByOptions: { value: string; label: string }[] = [
    ...SORTABLE_METRIC_IDS.map((id) => ({ value: String(id), label: METRIC_LABELS[id] })),
    { value: 'player_name', label: 'Pseudonyme' },
    { value: 'level', label: 'Niveau' },
    { value: 'might_current', label: 'Points de puissance' },
    { value: 'might_all_time', label: 'Puissance maximale atteinte' },
    { value: 'alliance_name', label: 'Alliance' },
    { value: 'alliance_might', label: "Puissance de l'alliance" },
    { value: 'alliance_player_count', label: 'Nombre de joueurs' },
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
  public popupIsInLoading = false;
  public validated: { [key: string]: boolean } = {};

  public formFilters: FormFilters = {
    minMight: '',
    maxMight: '',
    minLevel: '',
    maxLevel: '',
    minAllianceMight: '',
    maxAllianceMight: '',
    minAlliancePlayers: '',
    maxAlliancePlayers: '',
    allianceFilter: '-1',
    isFiltered: false,
    ...Object.fromEntries(
      SORTABLE_METRIC_IDS.flatMap((id) => [
        [`minMetric${id}`, ''],
        [`maxMetric${id}`, ''],
      ]),
    ),
  };
  public defaultFormFilters!: FormFilters;
  public displayFormValues: Record<FilterField, { min: string; max: string }> = {
    might: { min: '', max: '' },
    level: { min: '', max: '' },
    allianceMight: { min: '', max: '' },
    alliancePlayers: { min: '', max: '' },
    ...(Object.fromEntries(SORTABLE_METRIC_IDS.map((id) => [`metric${id}`, { min: '', max: '' }])) as Record<
      MetricFilterField,
      { min: string; max: string }
    >),
  };

  private readonly FILTER_KEYS: FilterKeyMap<FormFilters, FilterField> = {
    might: { min: 'minMight', max: 'maxMight' },
    level: { min: 'minLevel', max: 'maxLevel' },
    allianceMight: { min: 'minAllianceMight', max: 'maxAllianceMight' },
    alliancePlayers: { min: 'minAlliancePlayers', max: 'maxAlliancePlayers' },
    ...(Object.fromEntries(
      SORTABLE_METRIC_IDS.map((id) => [`metric${id}`, { min: `minMetric${id}`, max: `maxMetric${id}` }]),
    ) as FilterKeyMap<FormFilters, MetricFilterField>),
  };
  private readonly QUERY_PARAM_KEYS: Record<FilterField, { min: string; max: string }> = {
    might: { min: 'min_might', max: 'max_might' },
    level: { min: 'min_level', max: 'max_level' },
    allianceMight: { min: 'min_alliance_might', max: 'max_alliance_might' },
    alliancePlayers: { min: 'min_alliance_players', max: 'max_alliance_players' },
    ...(Object.fromEntries(
      SORTABLE_METRIC_IDS.map((id) => [`metric${id}`, { min: `min_metric_${id}`, max: `max_metric_${id}` }]),
    ) as Record<MetricFilterField, { min: string; max: string }>),
  };

  private cdr = inject(ChangeDetectorRef);
  private localStorage = inject(LocalStorageService);
  private formatNumberPipe = inject(FormatNumberPipe);

  constructor() {
    super();
    this.isInLoading = true;
  }

  public ngOnInit(): void {
    if (globalThis.window === undefined) return;
    this.defaultFormFilters = structuredClone(this.formFilters);
    const urlParameters = this.route.snapshot.queryParams;
    this.page = urlParameters['page'] ? Number(urlParameters['page']) : 1;
    void this.load();
  }

  public get areFiltersSavedInLocalStorage(): boolean {
    return this.localStorage.getItem(this.filtersStorageKey) !== null;
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

  public onGenericFocus(type: BoundType, field: FilterField): void {
    this.displayFormValues[field][type] = String(this.formFilters[this.FILTER_KEYS[field][type]] ?? '');
  }

  public onGenericInput(type: BoundType, field: FilterField, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    let numeric: number | string = raw === '' ? '' : Number(raw.replaceAll(/\s/g, ''));
    if (Number.isNaN(numeric)) {
      numeric = this.utilitiesService.parseValue(raw);
      if (numeric === 0 && raw !== '0' && raw !== '') {
        this.displayFormValues[field][type] = raw;
        return;
      }
    }
    this.formFilters[this.FILTER_KEYS[field][type]] = numeric.toString();
    this.displayFormValues[field][type] = raw;
  }

  public onGenericBlur(type: BoundType, field: FilterField): void {
    const value = this.formFilters[this.FILTER_KEYS[field][type]];
    this.displayFormValues[field][type] =
      value == null || value === '' ? '' : this.utilitiesService.formatNumber(this.formatNumberPipe, Number(value));
  }

  public updateDisplayFormValues(): void {
    for (const field of Object.keys(this.FILTER_KEYS) as FilterField[]) {
      this.displayFormValues[field] = {
        min: String(this.formFilters[this.FILTER_KEYS[field].min] ?? ''),
        max: String(this.formFilters[this.FILTER_KEYS[field].max] ?? ''),
      };
    }
  }

  public areFiltersChanged(): boolean {
    return JSON.stringify(this.formFilters) !== JSON.stringify(this.defaultFormFilters);
  }

  public async applyFilters(): Promise<void> {
    this.popupIsInLoading = true;
    this.page = 1;
    await this.load();
    this.searchForm.updateNbFilterActivated();
    this.popupIsInLoading = false;
  }

  public saveFilters(): void {
    this.validateFilters('saveFilters');
    this.localStorage.setItem(this.filtersStorageKey, JSON.stringify(this.formFilters));
  }

  public loadFiltersFromLocalStorage(): void {
    this.validateFilters('loadFilters');
    const savedFilters = this.localStorage.getItem(this.filtersStorageKey);
    if (!savedFilters) return;
    Object.assign(this.formFilters, JSON.parse(savedFilters) as FormFilters);
    this.updateDisplayFormValues();
    this.cdr.detectChanges();
  }

  public resetFilters(): void {
    this.validateFilters('resetFilters');
    Object.assign(this.formFilters, this.defaultFormFilters);
    this.updateDisplayFormValues();
  }

  public validateFilters(action: 'saveFilters' | 'loadFilters' | 'resetFilters'): void {
    this.validated[action] = true;
    setTimeout(() => {
      this.validated[action] = false;
      this.cdr.detectChanges();
    }, 2000);
  }

  private get filtersStorageKey(): string {
    return 'stormyIslesFilters_' + this.apiRestService.serverService.currentServer?.name;
  }

  private constructFilters(): Record<string, string | number> {
    const filters: Record<string, string | number> = {};
    for (const field of Object.keys(this.QUERY_PARAM_KEYS) as FilterField[]) {
      for (const bound of ['min', 'max'] as BoundType[]) {
        const value = this.formFilters[this.FILTER_KEYS[field][bound]];
        if (value !== '' && value !== undefined) filters[this.QUERY_PARAM_KEYS[field][bound]] = value as string;
      }
    }
    if (this.formFilters.allianceFilter !== '-1') filters['alliance_filter'] = this.formFilters.allianceFilter;
    this.formFilters.isFiltered = Object.keys(filters).length > 0;
    return filters;
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
        this.constructFilters(),
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

  private resolveOrderMetricId(): string {
    return TABLE_SORTABLE_KEYS.includes(this.sort) ? this.sort : '100'; // Default sorting by cargo points
  }
}
