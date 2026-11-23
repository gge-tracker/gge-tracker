import { Component, input, output } from '@angular/core';
import { EventGame } from '@ggetracker-services/event-game.utilities';

@Component({
  selector: 'app-game-switch',
  standalone: true,
  templateUrl: './game-switch.component.html',
  styleUrl: './game-switch.component.css',
  host: { '[class.compact]': 'compact()' },
})
export class GameSwitchComponent {
  public readonly game = input.required<EventGame>();
  public readonly disabled = input(false);
  public readonly compact = input(false);
  public readonly gameChange = output<EventGame>();
  public readonly games: { value: EventGame; label: string; icon: string }[] = [
    { value: 'ep', label: 'Empire', icon: 'fa-solid fa-desktop' },
    { value: 'e4k', label: 'E4K', icon: 'fa-solid fa-mobile-screen-button' },
  ];

  public select(game: EventGame): void {
    if (game !== this.game() && !this.disabled()) this.gameChange.emit(game);
  }
}
