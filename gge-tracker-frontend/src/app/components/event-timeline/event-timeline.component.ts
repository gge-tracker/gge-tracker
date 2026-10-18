/* eslint-disable unicorn/consistent-function-scoping */
import { DatePipe } from '@angular/common';
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

export interface TimelineEvent {
  event_id: number;
  dates: string[];
}

interface Edition {
  id: number;
  start: string;
  end: string;
  hours: string[];
  durationHours: number;
}

const HOUR_MS = 3_600_000;
const LIVE_WINDOW_MS = 2.5 * HOUR_MS; // Snapshots land hourly
const DURATION_SAMPLE = 3;

const hoursBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / HOUR_MS);

@Component({
  selector: 'app-event-timeline',
  standalone: true,
  imports: [DatePipe, TranslateModule],
  templateUrl: './event-timeline.component.html',
  styleUrl: './event-timeline.component.css',
})
export class EventTimelineComponent {
  public readonly events = input.required<TimelineEvent[]>();
  public readonly currentDate = input.required<string>();
  public readonly isLoading = input(false);
  public readonly dateChange = output<string>();

  public readonly editions = computed<Edition[]>(() =>
    this.events()
      .filter((event) => event.dates.length > 0)
      .map((event) => {
        const hours = [...event.dates].sort();
        const start = hours[0];
        const end = hours.at(-1)!;
        return { id: event.event_id, start, end, hours, durationHours: hoursBetween(start, end) + 1 };
      })
      .sort((a, b) => b.id - a.id),
  );

  public readonly liveEdition = computed<Edition | null>(() => {
    const latest = this.editions()[0];
    return latest && Date.now() - Date.parse(latest.end) <= LIVE_WINDOW_MS ? latest : null;
  });

  public readonly lastEdition = computed<Edition | null>(() =>
    this.liveEdition() ? null : (this.editions()[0] ?? null),
  );

  public readonly typicalDurationHours = computed<number | null>(() => {
    const finished = this.editions()
      .filter((edition) => edition !== this.liveEdition())
      .slice(0, DURATION_SAMPLE)
      .map((edition) => edition.durationHours);
    // A partly collected edition is shorter than the event (best estimate)
    return finished.length > 0 ? Math.max(...finished) : null;
  });

  public readonly liveHour = computed(() => {
    const live = this.liveEdition();
    return live ? hoursBetween(live.start, live.end) + 1 : 0;
  });

  public readonly liveProgress = computed<number | null>(() => {
    const typical = this.typicalDurationHours();
    return typical ? Math.min(100, (this.liveHour() / typical) * 100) : null;
  });

  public readonly estimatedEnd = computed<number | null>(() => {
    const live = this.liveEdition();
    const typical = this.typicalDurationHours();
    return live && typical && typical > this.liveHour() ? Date.parse(live.start) + typical * HOUR_MS : null;
  });

  public readonly selectedEdition = computed<Edition | null>(
    () => this.editions().find((edition) => edition.hours.includes(this.currentDate())) ?? null,
  );

  public readonly previewIndex = signal(0);

  public readonly previewDate = computed(
    () => this.selectedEdition()?.hours[this.previewIndex()] ?? this.currentDate(),
  );

  public readonly previewHour = computed(() => {
    const edition = this.selectedEdition();
    return edition ? hoursBetween(edition.start, this.previewDate()) + 1 : 0;
  });

  public readonly lastIndex = computed(() => Math.max(0, (this.selectedEdition()?.hours.length ?? 1) - 1));

  constructor() {
    effect(() => {
      const edition = this.selectedEdition();
      this.previewIndex.set(edition ? Math.max(0, edition.hours.indexOf(this.currentDate())) : 0);
    });
  }

  public isLive(edition: Edition): boolean {
    return edition === this.liveEdition();
  }

  public selectEdition(id: string): void {
    const edition = this.editions().find((candidate) => candidate.id === Number(id));
    if (edition) this.dateChange.emit(edition.end);
  }

  public preview(index: string): void {
    this.previewIndex.set(Number(index));
  }

  public commit(): void {
    const date = this.previewDate();
    if (date !== this.currentDate()) this.dateChange.emit(date);
  }

  public step(offset: number): void {
    const index = Math.min(this.lastIndex(), Math.max(0, this.previewIndex() + offset));
    this.previewIndex.set(index);
    this.commit();
  }

  public jumpToLatest(): void {
    this.previewIndex.set(this.lastIndex());
    this.commit();
  }
}
