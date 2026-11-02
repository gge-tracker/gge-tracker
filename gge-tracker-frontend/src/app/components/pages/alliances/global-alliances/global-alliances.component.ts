import { DecimalPipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import {
  GlobalRangeField,
  GlobalRankingFiltersComponent,
} from '@ggetracker-components/global-ranking-filters/global-ranking-filters.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { ApiGlobalAlliance, ErrorType } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';

type GlobalGame = 'all' | 'ep' | 'e4k';

@Component({
  selector: 'app-global-alliances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    DecimalPipe,
    RouterLink,
    TranslateModule,
    FormatNumberPipe,
    SearchFormComponent,
    TableComponent,
    GlobalRankingFiltersComponent,
  ],
  templateUrl: './global-alliances.component.html',
  styleUrl: './global-alliances.component.css',
})
export class GlobalAlliancesComponent extends GenericComponent implements OnInit {
  private static readonly DEFAULT_SORT = 'might_current';
  private static readonly PAGE_SIZE = 12;
  public readonly maxMembers = 65;
  public readonly games: { value: GlobalGame; label: string; icon?: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'ep', label: 'Empire', icon: 'fa-solid fa-desktop' },
    { value: 'e4k', label: 'E4K', icon: 'fa-solid fa-mobile-screen-button' },
  ];
  public readonly filterFields: GlobalRangeField[] = [
    {
      icon: '/assets/pp1.png',
      label: 'Puissance',
      title: 'Filtrer par point de puissance',
      min: { key: 'minMight', placeholder: 'Puissance min' },
      max: { key: 'maxMight', placeholder: 'Puissance max' },
    },
    {
      icon: '/assets/loot.png',
      label: 'Pillage',
      title: 'Filtrer par point de pillage',
      min: { key: 'minLoot', placeholder: 'Pillage min.' },
      max: { key: 'maxLoot', placeholder: 'Pillage max.' },
    },
    {
      icon: '/assets/glory.png',
      label: 'Points de gloire',
      title: 'Filtrer par gloire',
      min: { key: 'minFame', placeholder: 'Gloire min.' },
      max: { key: 'maxFame', placeholder: 'Gloire max.' },
    },
    {
      icon: '/assets/member-list.png',
      label: 'Nombre de joueurs',
      title: 'Filtrer par nombre de membres',
      min: { key: 'minPlayerCount', placeholder: 'Nombre de membres min.' },
      max: { key: 'maxPlayerCount', placeholder: 'Nombre de membres max.' },
    },
  ];
  public readonly headers: [string, string, string?, boolean?][] = [
    ['alliance_name', 'Nom'],
    ['server', 'Serveur', undefined, true],
    ['player_count', 'Nombre de joueurs', '/assets/member-list.png'],
    ['might_current', "Puissance de l'alliance", '/assets/pp1.png'],
    ['loot_current', 'Points de pillage hebdomadaire', '/assets/loot.png'],
    ['current_fame', 'Points de gloire', '/assets/glory.png'],
    ['active_player_count', 'Nombre de joueurs actifs', '/assets/member-list-activity.png'],
    ['', '', undefined, true],
  ];
  public alliances: ApiGlobalAlliance[] = [];
  public page = 1;
  public maxPage = 1;
  public allianceCount = 0;
  public search = '';
  public game: GlobalGame = 'all';
  public rangeFilters: Record<string, string> = {};
  public filterBadge: Record<string, string | boolean> = { isFiltered: true };
  public sort = GlobalAlliancesComponent.DEFAULT_SORT;
  public reverse = true;
  public readonly serverService = inject(ServerService);
  private readonly cdr = inject(ChangeDetectorRef);

  public ngOnInit(): void {
    if (globalThis.window === undefined) return;
    const parameters = this.route.snapshot.queryParams;
    this.page = Number(parameters['page']) || 1;
    this.search = parameters['name'] ?? '';
    this.game = this.games.some((game) => game.value === parameters['game']) ? parameters['game'] : 'all';
    if (this.headers.some((header) => header[0] === parameters['sort'] && !header[3])) {
      this.sort = parameters['sort'];
    }
    this.reverse = parameters['order'] !== 'asc';
    this.setRangeFilters(this.readRangeFilters(parameters));
    void this.load();
  }

  public rankOf(index: number): number {
    return (this.page - 1) * GlobalAlliancesComponent.PAGE_SIZE + index + 1;
  }

  public activeShare(alliance: ApiGlobalAlliance): number {
    return alliance.player_count ? (alliance.active_player_count / alliance.player_count) * 100 : 0;
  }

  public async selectGame(game: GlobalGame): Promise<void> {
    if (this.isInLoading || this.game === game) return;
    this.game = game;
    this.page = 1;
    await this.load();
  }

  public async applyRangeFilters(filters: Record<string, string>): Promise<void> {
    if (this.isInLoading) return;
    this.setRangeFilters(filters);
    this.page = 1;
    await this.load();
  }

  public exportData(): void {
    const headers = [
      'Rank',
      'Alliance Name',
      'Server',
      'Player Count',
      'Active Player Count',
      'Current Might',
      'Highest Might',
      'Current Loot',
      'Highest Loot',
      'Current Fame',
      'Highest Fame',
    ];
    const rows = this.alliances.map((alliance, index) => [
      this.rankOf(index),
      this.utilitiesService.escapeCsv(alliance.alliance_name ?? ''),
      alliance.server,
      alliance.player_count,
      alliance.active_player_count,
      alliance.might_current,
      alliance.might_all_time,
      alliance.loot_current,
      alliance.loot_all_time,
      alliance.current_fame,
      alliance.highest_fame,
    ]);
    void this.utilitiesService.exportDataXlsx(
      'Alliances',
      headers,
      rows,
      `alliances_global_${this.game}_page_${this.page}_${new Date().toISOString()}.xlsx`,
    );
  }

  public async searchAlliance(allianceName: string): Promise<void> {
    if (this.isInLoading) return;
    this.search = allianceName.trim();
    this.page = 1;
    await this.load();
  }

  public async sortAlliances(sort: string): Promise<void> {
    if (this.isInLoading) return;
    if (this.sort === sort) {
      this.reverse = !this.reverse;
    } else {
      this.sort = sort;
      this.reverse = sort !== 'alliance_name';
    }
    this.page = 1;
    await this.load();
  }

  public async navigateTo(page: number): Promise<void> {
    if (this.isInLoading) return;
    this.page = page;
    await this.load();
  }

  private async load(): Promise<void> {
    this.isInLoading = true;
    this.cdr.detectChanges();
    const response = await this.apiRestService.getGlobalAlliances(
      this.page,
      this.sort,
      this.reverse ? 'DESC' : 'ASC',
      this.filters(),
      GlobalAlliancesComponent.PAGE_SIZE,
    );
    this.isInLoading = false;
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      this.cdr.detectChanges();
      return;
    }
    const { alliances, pagination } = response.data;
    this.alliances = alliances;
    this.maxPage = Math.max(pagination.total_pages, 1);
    this.allianceCount = pagination.total_items_count;
    if (this.page > this.maxPage) this.page = this.maxPage;
    void this.updateGenericParamsInUrl(
      {
        page: this.page,
        name: this.search,
        game: this.game,
        sort: this.sort,
        order: this.reverse ? 'desc' : 'asc',
        ...this.rangeFilterParams(),
      },
      {
        page: 1,
        name: '',
        game: 'all',
        sort: GlobalAlliancesComponent.DEFAULT_SORT,
        order: 'desc',
        ...this.rangeFilterDefaults(),
      },
    );
    this.cdr.detectChanges();
  }

  private filters(): Record<string, string> {
    const filters: Record<string, string> = { ...this.rangeFilters };
    if (this.search) filters['allianceName'] = this.search;
    if (this.game !== 'all') filters['game'] = this.game;
    return filters;
  }

  private setRangeFilters(filters: Record<string, string>): void {
    this.rangeFilters = filters;
    this.filterBadge = { ...filters, isFiltered: true };
  }

  private readRangeFilters(parameters: Record<string, string>): Record<string, string> {
    const filters: Record<string, string> = {};
    for (const key of this.rangeFilterKeys()) {
      if (parameters[key]) filters[key] = String(parameters[key]);
    }
    return filters;
  }

  private rangeFilterParams(): Record<string, string> {
    return Object.fromEntries(this.rangeFilterKeys().map((key) => [key, this.rangeFilters[key] ?? '']));
  }

  private rangeFilterDefaults(): Record<string, string> {
    return Object.fromEntries(this.rangeFilterKeys().map((key) => [key, '']));
  }

  private rangeFilterKeys(): string[] {
    return this.filterFields.flatMap((field) => [field.min.key, field.max.key]);
  }
}
