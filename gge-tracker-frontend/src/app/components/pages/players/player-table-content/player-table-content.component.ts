import { DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { Player } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-player-table-content',
  standalone: true,
  imports: [NgClass, NgIf, TranslateModule, DatePipe, FormatNumberPipe, RouterLink, NgFor],
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

  public get hasAllianceColumn(): boolean {
    return this.playersTableHeader().some((header) => header[0] === 'alliance_name');
  }
}
