import { DatePipe, NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { Player } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { TranslateModule } from '@ngx-translate/core';

const FIRST_ROWS = 15;
const ROWS_PER_IDLE_CHUNK = 10;
const addChunk = (rows: number): number => rows + ROWS_PER_IDLE_CHUNK;

@Component({
  selector: 'app-player-table-content',
  standalone: true,
  imports: [NgClass, TranslateModule, DatePipe, FormatNumberPipe, RouterLink, NgTemplateOutlet],
  templateUrl: './player-table-content.component.html',
  styleUrls: ['./player-table-content.component.css'],
})
export class PlayerTableContentComponent extends GenericComponent {
  public readonly players = input.required<Player[]>();
  public readonly distanceEnabled = input.required<boolean>();
  public readonly playersTableHeader =
    input.required<[string, string, (string | undefined)?, (boolean | undefined)?][]>();

  public readonly clickOnAlliance = output<string>();
  public readonly toggleFavorite = output<Player>();

  // eslint-disable-next-line unicorn/consistent-function-scoping
  public readonly visiblePlayers = computed(() =>
    this.staggering() ? this.players().slice(0, this.renderedRows()) : this.players(),
  );
  private readonly staggering = signal(true);
  private readonly renderedRows = signal(FIRST_ROWS);

  constructor() {
    super();
    effect(() => {
      const total = this.players().length;
      if (!this.staggering()) return;
      if (this.renderedRows() >= total) {
        if (total > 0) this.staggering.set(false);
        return;
      }
      requestIdleCallback(() => this.renderedRows.update(addChunk), { timeout: 500 });
    });
  }

  public get hasAllianceColumn(): boolean {
    return this.playersTableHeader().some((header) => header[0] === 'alliance_name');
  }

  public get hasAllianceRankColumn(): boolean {
    return this.playersTableHeader().some((header) => header[0] === 'alliance_rank');
  }
}
