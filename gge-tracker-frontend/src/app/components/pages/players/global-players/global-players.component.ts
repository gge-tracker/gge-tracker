import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { SearchFormComponent } from '@ggetracker-components/search-form/search-form.component';
import { TableComponent } from '@ggetracker-components/table/table.component';
import { ApiGlobalPlayer, ErrorType } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';

type GlobalGame = 'all' | 'ep' | 'e4k';

@Component({
  selector: 'app-global-players',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DatePipe, RouterLink, TranslateModule, FormatNumberPipe, SearchFormComponent, TableComponent],
  templateUrl: './global-players.component.html',
  styleUrl: './global-players.component.css',
})
export class GlobalPlayersComponent extends GenericComponent implements OnInit {
  private static readonly DEFAULT_SORT = 'might_current';
  private static readonly PAGE_SIZE = 15;
  public readonly games: { value: GlobalGame; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'ep', label: 'Empire' },
    { value: 'e4k', label: 'E4K' },
  ];
  public readonly headers: [string, string, string?, boolean?][] = [
    ['player_name', 'Pseudonyme'],
    ['server', 'Serveur', undefined, true],
    ['level', 'Niveau', '/assets/lvl.png'],
    ['might_current', 'Points de puissance', '/assets/pp1.png'],
    ['loot_current', 'Points de pillage hebdomadaire', '/assets/loot.png'],
    ['current_fame', 'Points de gloire', '/assets/glory.png'],
    ['alliance_name', 'Alliance', '/assets/min-alliance.png', true],
    ['', '', undefined, true],
  ];
  public players: ApiGlobalPlayer[] = [];
  public page = 1;
  public maxPage = 1;
  public playerCount = 0;
  public search = '';
  public game: GlobalGame = 'all';
  public sort = GlobalPlayersComponent.DEFAULT_SORT;
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
    void this.load();
  }

  public rankOf(index: number): number {
    return (this.page - 1) * GlobalPlayersComponent.PAGE_SIZE + index + 1;
  }

  public async selectGame(game: GlobalGame): Promise<void> {
    if (this.isInLoading || this.game === game) return;
    this.game = game;
    this.page = 1;
    await this.load();
  }

  public async searchPlayer(playerName: string): Promise<void> {
    if (this.isInLoading) return;
    this.search = playerName.trim();
    this.page = 1;
    await this.load();
  }

  public async sortPlayers(sort: string): Promise<void> {
    if (this.isInLoading) return;
    if (this.sort === sort) {
      this.reverse = !this.reverse;
    } else {
      this.sort = sort;
      this.reverse = sort !== 'player_name';
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
    const response = await this.apiRestService.getGlobalPlayers(
      this.page,
      this.sort,
      this.reverse ? 'DESC' : 'ASC',
      this.filters(),
    );
    this.isInLoading = false;
    if (!response.success) {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      this.cdr.detectChanges();
      return;
    }
    const { players, pagination } = response.data;
    this.players = players;
    this.maxPage = Math.max(pagination.total_pages, 1);
    this.playerCount = pagination.total_items_count;
    if (this.page > this.maxPage) this.page = this.maxPage;
    void this.updateGenericParamsInUrl(
      {
        page: this.page,
        name: this.search,
        game: this.game,
        sort: this.sort,
        order: this.reverse ? 'desc' : 'asc',
      },
      { page: 1, name: '', game: 'all', sort: GlobalPlayersComponent.DEFAULT_SORT, order: 'desc' },
    );
    this.cdr.detectChanges();
  }

  private filters(): Record<string, string> {
    const filters: Record<string, string> = {};
    if (this.search) filters['playerName'] = this.search;
    if (this.game !== 'all') filters['game'] = this.game;
    return filters;
  }
}
