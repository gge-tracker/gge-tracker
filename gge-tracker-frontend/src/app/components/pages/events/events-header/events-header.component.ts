import { DatePipe, LowerCasePipe, TitleCasePipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { CalendarDays, LucideAngularModule, Users } from 'lucide-angular';

@Component({
  selector: 'app-events-header',
  standalone: true,
  imports: [TranslatePipe, DatePipe, TitleCasePipe, FormatNumberPipe, LowerCasePipe, LucideAngularModule],
  templateUrl: './events-header.component.html',
  styleUrl: './events-header.component.css',
})
export class EventsHeaderComponent {
  public eventName = input.required<string>();
  public from = input.required<Date>();
  public to = input.required<Date>();
  public nbPlayers = input.required<number>();
  public eventType = input.required<string>();

  public readonly CalendarDays = CalendarDays;
  public readonly Users = Users;
}
