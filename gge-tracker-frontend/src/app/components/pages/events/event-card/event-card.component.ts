/* eslint-disable unicorn/consistent-function-scoping */
import { DatePipe, LowerCasePipe, NgClass, NgStyle, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CalendarCheck, LucideAngularModule, SquareUser, Trophy } from 'lucide-angular';
import { EventList } from '../events.component';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { OuterEventData, WoaEvent, WoaEventList } from '@ggetracker-interfaces/empire-ranking';

interface Events {
  type: string;
  icon: string;
  title: string;
}
@Component({
  standalone: true,
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
  ],
  templateUrl: './event-card.component.html',
  styleUrls: ['./event-card.component.css'],
})
export class EventCardComponent<T extends EventList | OuterEventData | WoaEvent | WoaEventList> {
  public readonly CalendarCheck = CalendarCheck;
  public readonly SquareUser = SquareUser;
  public readonly Trophy = Trophy;
  public event = input.required<T>();
  public loading = input<boolean>();
  public options = input.required<{
    displayMode: 'player-count' | 'ranking' | 'points';
    dateFormat?: string;
  }>();
  public onEventClick = output<T>();

  public readonly events: Events[] = [
    {
      type: 'outer-realms',
      icon: 'fa-trophy',
      title: 'Royaume extérieur',
    },
    {
      type: 'beyond-the-horizon',
      icon: 'fa-shield-alt',
      title: 'Lacis',
    },
    {
      type: 'woa',
      icon: 'fa-ticket',
      title: 'Roue des richesses inimaginables',
    },
  ];

  public playerCount = computed(() => {
    const event = this.event();
    return 'playerCount' in event ? event.playerCount : 0;
  });

  public rank = computed(() => {
    const event = this.event();
    return 'rank' in event ? event.rank : null;
  });

  public eventType = computed(() => {
    const event = this.event();
    return 'type' in event ? event.type : 'unknown';
  });

  public selectedEvent = computed(() => {
    const eventType = this.eventType();
    return (
      this.events.find((event) => event.type === eventType) ?? {
        type: 'unknown',
        icon: 'fa-question',
        title: 'Unknown Event',
      }
    );
  });

  public point = computed(() => {
    const event = this.event();
    return 'point' in event ? event.point : null;
  });
}
