/* eslint-disable unicorn/consistent-function-scoping */
import { DatePipe, LowerCasePipe, NgClass, NgStyle, TitleCasePipe, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CalendarCheck, LucideAngularModule, SquareUser, Trophy } from 'lucide-angular';
import { EventList } from '../events.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { OuterEventData } from '@ggetracker-interfaces/empire-ranking';

@Component({
    selector: 'app-event-card',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        TranslatePipe,
        NgStyle,
        LucideAngularModule,
        DatePipe,
        LowerCasePipe,
        FormatNumberPipe,
        TitleCasePipe,
        NgClass,
        NgIf,
    ],
    templateUrl: './event-card.component.html',
    styleUrls: ['./event-card.component.css']
})
export class EventCardComponent<T extends EventList | OuterEventData> {
  public readonly CalendarCheck = CalendarCheck;
  public readonly SquareUser = SquareUser;
  public readonly Trophy = Trophy;
  public event = input.required<T>();
  public options = input.required<{
    displayMode: 'player-count' | 'ranking';
  }>();
  public onEventClick = output<T>();

  public playerCount = computed(() => {
    const event = this.event();
    return 'playerCount' in event ? event.playerCount : 0;
  });

  public rank = computed(() => {
    const event = this.event();
    return 'rank' in event ? event.rank : null;
  });
}
