/* eslint-disable unicorn/consistent-function-scoping */
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AlliancesUpdates } from '@ggetracker-interfaces/empire-ranking';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

interface AllianceStint {
  key: string;
  name: string | null;
  formerName: string | null;
  start: Date | null;
  end: Date;
  durationMs: number;
  isCurrent: boolean;
  color: string;
}

interface StintYear {
  label: string;
  stints: AllianceStint[];
}

interface AllianceTotal {
  key: string;
  name: string | null;
  color: string;
  stintCount: number;
  durationMs: number;
  firstStart: Date | null;
  lastEnd: Date;
  isCurrent: boolean;
}

interface TimelineSegment {
  stint: AllianceStint;
  widthPercent: number;
}

interface YearTick {
  year: number;
  leftPercent: number;
}

type HistoryView = 'timeline' | 'alliances';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const PAGE_SIZE = 25;
const NO_ALLIANCE_KEY = 'none';
const NO_ALLIANCE_COLOR = '#b9a885';
const PALETTE = [
  '#4d7a35',
  '#2f6f8f',
  '#a2552e',
  '#7a4f9a',
  '#b0741a',
  '#3d7d6e',
  '#8f3b53',
  '#5d6b2f',
  '#4a5b9c',
  '#9a6b3c',
];

@Component({
  selector: 'app-alliance-history',
  standalone: true,
  imports: [DatePipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alliance-history.component.html',
  styleUrl: './alliance-history.component.css',
})
export class AllianceHistoryComponent {
  public readonly updates = input.required<AlliancesUpdates[]>();

  public readonly view = signal<HistoryView>('timeline');
  public readonly query = signal('');
  public readonly visibleCount = signal(PAGE_SIZE);

  public readonly stints = computed(() => this.toStints(this.updates()));

  public readonly current = computed(() => this.stints()[0] ?? null);

  public readonly changeCount = computed(() => this.stints().filter((stint) => stint.start !== null).length);

  public readonly joinedCount = computed(() => this.totals().filter((total) => total.key !== NO_ALLIANCE_KEY).length);

  public readonly timeWithoutAllianceMs = computed(
    () => this.totals().find((total) => total.key === NO_ALLIANCE_KEY)?.durationMs ?? 0,
  );

  public readonly longest = computed(() => {
    return this.totals().find((total) => total.key !== NO_ALLIANCE_KEY && total.durationMs > 0) ?? null;
  });

  public readonly totals = computed(() => this.toTotals(this.stints()));

  public readonly maxTotalMs = computed(() => Math.max(1, ...this.totals().map((total) => total.durationMs)));

  public readonly maxStintMs = computed(() => Math.max(1, ...this.stints().map((stint) => stint.durationMs)));

  public readonly segments = computed(() => this.toSegments(this.stints()));

  public readonly yearTicks = computed(() => this.toYearTicks(this.stints()));

  public readonly filteredStints = computed(() => this.stints().filter((stint) => this.isMatch(stint)));

  public readonly filteredTotals = computed(() => this.totals().filter((total) => this.matches(total.name, null)));

  public readonly stintYears = computed(() => this.groupByYear(this.filteredStints().slice(0, this.visibleCount())));

  public readonly hiddenStintCount = computed(() => Math.max(0, this.filteredStints().length - this.visibleCount()));

  public readonly hasFilter = computed(() => this.stints().length > 6);

  private readonly translateService = inject(TranslateService);

  public setView(view: HistoryView): void {
    this.view.set(view);
  }

  public setQuery(value: string): void {
    this.query.set(value);
    this.visibleCount.set(PAGE_SIZE);
  }

  public focusAlliance(stint: AllianceStint): void {
    this.setQuery(this.query() === (stint.name ?? '') ? '' : (stint.name ?? ''));
  }

  public showMore(): void {
    this.visibleCount.update((count) => count + PAGE_SIZE * 2);
  }

  public formatDuration(durationMs: number): string {
    if (durationMs < HOUR_MS) return this.translateService.instant("moins d'une heure");
    const units: [number, string, string][] = [
      [YEAR_MS, 'an', 'ans'],
      [MONTH_MS, 'mois', 'moiss'],
      [DAY_MS, 'jour', 'jours'],
      [HOUR_MS, 'heure', 'heures'],
    ];
    const parts: string[] = [];
    let remaining = durationMs;
    for (const [size, singular, plural] of units) {
      const amount = Math.floor(remaining / size);
      if (amount > 0 && parts.length < 2) {
        parts.push(`${amount} ${this.translateService.instant(amount > 1 ? plural : singular)}`);
        remaining -= amount * size;
      } else if (parts.length > 0) {
        break;
      }
    }
    return parts.join(', ');
  }

  public isMatch(stint: AllianceStint): boolean {
    return this.matches(stint.name, stint.formerName);
  }

  private matches(name: string | null, formerName: string | null): boolean {
    const query = this.query().trim().toLowerCase();
    if (!query) return true;
    return [name, formerName].some((value) => value?.toLowerCase().includes(query));
  }

  private toStints(updates: AlliancesUpdates[]): AllianceStint[] {
    const now = new Date();
    const colors = new Map<string, string>();
    return updates.map((update, index) => {
      const key = update.alliance ? String(update.id ?? update.alliance) : NO_ALLIANCE_KEY;
      if (!colors.has(key)) {
        colors.set(key, key === NO_ALLIANCE_KEY ? NO_ALLIANCE_COLOR : PALETTE[colors.size % PALETTE.length]);
      }
      const start = update.date ? new Date(update.date) : null;
      const previousDate = index > 0 ? updates[index - 1].date : null;
      const end = previousDate ? new Date(previousDate) : now;
      return {
        key,
        name: update.alliance,
        formerName: update.original_new_alliance_name,
        start,
        end,
        durationMs: start ? Math.max(0, end.getTime() - start.getTime()) : 0,
        isCurrent: index === 0,
        color: colors.get(key)!,
      };
    });
  }

  private toTotals(stints: AllianceStint[]): AllianceTotal[] {
    const totals = new Map<string, AllianceTotal>();
    for (const stint of stints) {
      const total = totals.get(stint.key);
      if (total) {
        total.stintCount++;
        total.durationMs += stint.durationMs;
        total.firstStart = stint.start;
        total.isCurrent ||= stint.isCurrent;
      } else {
        totals.set(stint.key, {
          key: stint.key,
          name: stint.name,
          color: stint.color,
          stintCount: 1,
          durationMs: stint.durationMs,
          firstStart: stint.start,
          lastEnd: stint.end,
          isCurrent: stint.isCurrent,
        });
      }
    }
    return [...totals.values()].sort((a, b) => b.durationMs - a.durationMs);
  }

  private toSegments(stints: AllianceStint[]): TimelineSegment[] {
    const dated = stints.filter((stint) => stint.start !== null).reverse();
    const spanMs = dated.reduce((sum, stint) => sum + stint.durationMs, 0);
    if (spanMs === 0) return [];
    return dated.map((stint) => ({ stint, widthPercent: (stint.durationMs / spanMs) * 100 }));
  }

  private toYearTicks(stints: AllianceStint[]): YearTick[] {
    const dated = stints.filter((stint) => stint.start !== null);
    const first = dated.at(-1)?.start;
    if (!first) return [];
    const from = first.getTime();
    const spanMs = dated[0].end.getTime() - from;
    const ticks: YearTick[] = [];
    for (let year = first.getFullYear() + 1; year <= dated[0].end.getFullYear(); year++) {
      ticks.push({ year, leftPercent: ((new Date(year, 0, 1).getTime() - from) / spanMs) * 100 });
    }
    return ticks.filter((tick) => tick.leftPercent > 10 && tick.leftPercent < 88);
  }

  private groupByYear(stints: AllianceStint[]): StintYear[] {
    const years: StintYear[] = [];
    for (const stint of stints) {
      const label = stint.start
        ? String(stint.start.getFullYear())
        : this.translateService.instant('Alliance initiale');
      const last = years.at(-1);
      if (last && last.label === label) {
        last.stints.push(stint);
      } else {
        years.push({ label, stints: [stint] });
      }
    }
    return years;
  }
}
