import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { LeagueMedalsComponent } from '@ggetracker-components/league-medals/league-medals.component';
import { LeagueTitleComponent } from '@ggetracker-components/league-title/league-title.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import {
  ApiKingdomsLeagueAlliance,
  ApiKingdomsLeaguePlayer,
  ApiKingdomsLeaguePlayerHistoryResponse,
  ApiKingdomsLeagueSeason,
  ApiPagination,
  ErrorType,
} from '@ggetracker-interfaces/empire-ranking';
import { TranslateModule } from '@ngx-translate/core';
import { KingdomsLeagueProgressComponent } from './kingdoms-league-progress/kingdoms-league-progress.component';

type LeagueTab = 'players' | 'alliances';
type RankMovement = 'up' | 'down' | 'steady' | 'new' | 'none';

const ROWS_PER_PAGE = 15;
const EMPTY_PAGINATION: ApiPagination = {
  current_page: 1,
  total_pages: 0,
  current_items_count: 0,
  total_items_count: 0,
};

@Component({
  selector: 'app-kingdoms-league',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TranslateModule,
    SearchFormComponent,
    TableComponent,
    LeagueMedalsComponent,
    LeagueTitleComponent,
    KingdomsLeagueProgressComponent,
  ],
  templateUrl: './kingdoms-league.component.html',
  styleUrl: './kingdoms-league.component.css',
})
export class KingdomsLeagueComponent extends GenericComponent implements OnInit {
  public seasons: ApiKingdomsLeagueSeason[] = [];
  public seasonId = 0;
  public day = '';
  public previousDay: string | null = null;
  public tab: LeagueTab = 'players';
  public search = '';
  public players: ApiKingdomsLeaguePlayer[] = [];
  public alliances: ApiKingdomsLeagueAlliance[] = [];
  public pagination: ApiPagination = { ...EMPTY_PAGINATION };
  public isDataLoading = false;
  public isLeagueMissing = false;
  public progress: ApiKingdomsLeaguePlayerHistoryResponse | null = null;
  public loadingProgressFor: number | null = null;

  constructor() {
    super();
    this.isInLoading = true;
  }

  public get season(): ApiKingdomsLeagueSeason | undefined {
    return this.seasons.find((season) => season.season_id === this.seasonId);
  }

  public get latestSeason(): ApiKingdomsLeagueSeason | undefined {
    return this.seasons.at(-1);
  }

  public get isFinalRanking(): boolean {
    const season = this.season;
    return !!season && season !== this.latestSeason && this.day === season.last_day;
  }

  public get rankedCount(): number {
    return this.pagination.total_items_count;
  }

  public get seasonsNewestFirst(): ApiKingdomsLeagueSeason[] {
    return [...this.seasons].reverse();
  }

  public get daysNewestFirst(): string[] {
    return [...(this.season?.days ?? [])].reverse();
  }

  public async ngOnInit(): Promise<void> {
    const parameters = this.route.snapshot.queryParams;
    this.tab = parameters['tab'] === 'alliances' ? 'alliances' : 'players';
    this.search = parameters['search'] ?? '';
    await this.loadSeasons(Number(parameters['season']), parameters['day']);
    await this.refresh(Number(parameters['page']) || 1);
    this.isInLoading = false;
  }

  public async changeSeason(seasonId: number): Promise<void> {
    this.seasonId = Number(seasonId);
    this.day = this.season?.last_day ?? '';
    await this.refresh(1);
  }

  public async changeDay(day: string): Promise<void> {
    this.day = day;
    await this.refresh(1);
  }

  public async changeTab(tab: LeagueTab): Promise<void> {
    if (tab === this.tab) return;
    this.tab = tab;
    this.search = '';
    await this.refresh(1);
  }

  public async searchPlayer(name: string): Promise<void> {
    this.tab = 'players';
    this.search = name.trim();
    await this.refresh(1);
  }

  public async searchAlliance(name: string): Promise<void> {
    this.tab = 'alliances';
    this.search = name.trim();
    await this.refresh(1);
  }

  public async navigateTo(page: number): Promise<void> {
    await this.refresh(page);
  }

  public async previousPage(): Promise<void> {
    if (this.pagination.current_page > 1) await this.refresh(this.pagination.current_page - 1);
  }

  public async nextPage(): Promise<void> {
    if (this.pagination.current_page < this.pagination.total_pages)
      await this.refresh(this.pagination.current_page + 1);
  }

  public async showProgress(player: ApiKingdomsLeaguePlayer): Promise<void> {
    this.loadingProgressFor = player.player_id;
    const response = await this.apiRestService
      .getKingdomsLeaguePlayerHistory(player.player_id, this.seasonId)
      .finally(() => (this.loadingProgressFor = null));
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.progress = response.data;
  }

  public movementOf(row: { rank: number; previous_rank: number | null }): RankMovement {
    if (!this.previousDay) return 'none';
    if (row.previous_rank === null) return 'new';
    if (row.previous_rank > row.rank) return 'up';
    return row.previous_rank < row.rank ? 'down' : 'steady';
  }

  public movementSize(row: { rank: number; previous_rank: number | null }): number {
    return row.previous_rank === null ? 0 : Math.abs(row.previous_rank - row.rank);
  }

  public rowNumber(index: number): number {
    return (this.pagination.current_page - 1) * ROWS_PER_PAGE + index + 1;
  }

  private async loadSeasons(requestedSeason: number, requestedDay: string | undefined): Promise<void> {
    const response = await this.apiRestService.getKingdomsLeagueSeasons();
    if (!response.success) this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
    this.seasons = response.success ? response.data.seasons : [];
    this.isLeagueMissing = this.seasons.length === 0;
    const season =
      this.seasons.find((candidate) => candidate.season_id === requestedSeason) ??
      this.seasons.find((candidate) => !!requestedDay && candidate.days.includes(requestedDay)) ??
      this.latestSeason;
    this.seasonId = season?.season_id ?? 0;
    this.day = season && requestedDay && season.days.includes(requestedDay) ? requestedDay : (season?.last_day ?? '');
  }

  private async refresh(page: number): Promise<void> {
    void this.updateGenericParamsInUrl(
      { season: this.seasonId, day: this.day, tab: this.tab, search: this.search, page },
      {
        season: this.latestSeason?.season_id ?? 0,
        day: this.season?.last_day ?? '',
        tab: 'players',
        search: '',
        page: 1,
      },
    );
    if (!this.day) {
      this.players = [];
      this.alliances = [];
      this.pagination = { ...EMPTY_PAGINATION };
      return;
    }
    this.isDataLoading = true;
    const response =
      this.tab === 'players'
        ? await this.apiRestService.getKingdomsLeaguePlayers(this.day, page, this.search || undefined)
        : await this.apiRestService.getKingdomsLeagueAlliances(this.day, page, this.search || undefined);
    this.isDataLoading = false;
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000, 'error');
      return;
    }
    this.previousDay = response.data.previous_day;
    this.pagination = response.data.pagination;
    this.players = 'players' in response.data ? response.data.players : [];
    this.alliances = 'alliances' in response.data ? response.data.alliances : [];
  }
}
