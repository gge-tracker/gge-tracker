import { DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { ApiKingdomsLeagueMedals } from '@ggetracker-interfaces/empire-ranking';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-league-medals',
  standalone: true,
  imports: [DecimalPipe, TranslateModule],
  templateUrl: './league-medals.component.html',
  styleUrl: './league-medals.component.css',
})
export class LeagueMedalsComponent {
  public readonly medals = input.required<ApiKingdomsLeagueMedals>();
}
