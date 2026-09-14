/* eslint-disable unicorn/consistent-function-scoping */
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import {
  ApiGenericData,
  ApiPlayerEventOccurrence,
  ApiPlayerStatsType,
  ChartOptions,
} from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LanguageService } from '@ggetracker-services/language.service';
import { RankingService } from '@ggetracker-services/ranking.service';
import { TranslateService } from '@ngx-translate/core';

import {
  ChartCardChoice,
  ChartCardState,
  CompareChartCardComponent,
} from '../compare-chart-card/compare-chart-card.component';
import { baseChartOptions, ChartLocale } from '../compare-chart-card/compare-chart-options';
import {
  alignWeeklyScores,
  buildWeekRace,
  HOURS_PER_WEEK,
  mondayKeyOf,
  MS_PER_HOUR,
  weekStartOf,
  WeeklyScoreRow,
} from './compare-loot-weeks';

type LootView = 'current' | 'previous' | 'scores';

interface PlayerLoot {
  points: ApiGenericData[];
  resetOffset: number | null;
  occurrences: ApiPlayerEventOccurrence[];
}

const SERIES_DAYS = 14;
const SCORE_WEEKS = 12;
const WEEKDAY_KEYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const REFERENCE_MONDAY = Date.UTC(2026, 0, 5);

@Component({
  selector: 'app-compare-loot',
  standalone: true,
  imports: [CompareChartCardComponent],
  template: `
    <app-compare-chart-card
      heading="Pillage hebdomadaire"
      [choices]="views"
      [choice]="view()"
      [state]="state()"
      [options]="options()"
      (choose)="view.set($any($event))"
    ></app-compare-chart-card>
  `,
})
export class CompareLootComponent {
  public readonly ids = input.required<[string, string]>();
  public readonly names = input.required<[string, string]>();

  public readonly views: ChartCardChoice[] = [
    { value: 'current', label: 'Semaine courante' },
    { value: 'previous', label: 'Semaine précédente' },
    { value: 'scores', label: 'Scores finaux' },
  ];
  public readonly view = signal<LootView>('current');
  public readonly state = signal<ChartCardState>('loading');
  public readonly options = computed(() => {
    const loot = this.loot();
    if (!loot) return null;
    return this.view() === 'scores' ? this.buildScoresOptions(loot) : this.buildRaceOptions(loot, this.view());
  });

  private readonly loot = signal<[PlayerLoot, PlayerLoot] | null>(null);
  private readonly apiRestService = inject(ApiRestService);
  private readonly translateService = inject(TranslateService);
  private readonly rankingService = inject(RankingService);
  private readonly languageService = inject(LanguageService);
  private requestToken = 0;

  constructor() {
    effect(() => {
      const ids = this.ids();
      untracked(() => void this.load(ids));
    });
  }

  private async load(ids: [string, string]): Promise<void> {
    const token = ++this.requestToken;
    this.state.set('loading');
    try {
      const loot = (await Promise.all(ids.map((id) => this.readPlayerLoot(Number(id))))) as [PlayerLoot, PlayerLoot];
      if (token !== this.requestToken) return;
      this.loot.set(loot);
      this.state.set('loaded');
    } catch {
      if (token === this.requestToken) this.state.set('error');
    }
  }

  private async readPlayerLoot(playerId: number): Promise<PlayerLoot> {
    const [series, occurrences] = await Promise.all([
      this.apiRestService.getPlayerStatsSeriesByPlayerId(playerId, [ApiPlayerStatsType.loot], SERIES_DAYS),
      this.apiRestService.getPlayerEventOccurrencesByPlayerId(playerId, ApiPlayerStatsType.loot),
    ]);
    if (!series.success) throw new Error(series.error);
    if (!occurrences.success) throw new Error(occurrences.error);
    return {
      points: series.data.points[ApiPlayerStatsType.loot] ?? [],
      resetOffset: series.data.timezone_offset,
      occurrences: occurrences.data.occurrences,
    };
  }

  private buildRaceOptions(loot: [PlayerLoot, PlayerLoot], view: LootView): ChartOptions | null {
    const now = Date.now();
    const races = loot.map((player) => {
      const currentWeekStart = weekStartOf(now, player.resetOffset);
      return view === 'current'
        ? buildWeekRace(player.points, currentWeekStart, now)
        : buildWeekRace(player.points, currentWeekStart - HOURS_PER_WEEK * MS_PER_HOUR, currentWeekStart - 1);
    });
    if (races.every((race) => race.every((value) => !value))) return null;

    const names = this.names();
    const options = baseChartOptions(
      races.map((race, side) => ({
        name: names[side],
        data: race.map((value, slot): [number, number | null] => [slot, value]),
      })),
      this.chartLocale(),
    );
    const days = WEEKDAY_KEYS.map((key) => this.translateService.instant(key));
    const language = this.languageService.getCurrentLang();
    const twelveHourClock = language === 'en';
    const shortWeekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' });
    const shortDays = Array.from({ length: 7 }, (_, index) =>
      shortWeekday.format(REFERENCE_MONDAY + index * 24 * MS_PER_HOUR),
    );
    // Slot 0 is the reset: the axis reads in the server's weekly frame, Monday first, like the player page
    const dayOfSlot = (slot: number): string => days[(Math.floor(slot / 24) + 1) % 7];
    options.stroke = { width: 2.5, curve: 'stepline' };
    options.xaxis = {
      type: 'numeric',
      min: 0,
      max: HOURS_PER_WEEK,
      tickAmount: 7,
      tooltip: { enabled: false },
      labels: {
        formatter: (value): string => shortDays[Math.round(Number(value) / 24)] ?? '',
      },
    };
    options.tooltip.x = {
      formatter: (value): string => {
        const hour = Number(value) % 24;
        const clock = twelveHourClock
          ? `${hour % 12 || 12}:00 ${hour >= 12 ? 'PM' : 'AM'}`
          : `${hour.toString().padStart(2, '0')}h00`;
        return `${dayOfSlot(Number(value))} ${clock}`;
      },
    };
    return options;
  }

  private buildScoresOptions(loot: [PlayerLoot, PlayerLoot]): ChartOptions | null {
    const rows = alignWeeklyScores([loot[0].occurrences, loot[1].occurrences], SCORE_WEEKS);
    if (rows.length === 0) return null;

    const names = this.names();
    const options = baseChartOptions(
      [0, 1].map((side) => ({ name: names[side], data: rows.map((row) => row.scores[side]) })),
      this.chartLocale(),
    );
    const currentMonday = mondayKeyOf(weekStartOf(Date.now(), loot[0].resetOffset));
    const isCurrentWeek = (row: WeeklyScoreRow): boolean => row.mondayKey === currentMonday;
    options.chart.type = 'bar';
    options.plotOptions = { bar: { columnWidth: '72%', borderRadius: 3 } };
    options.stroke = { show: true, width: 2, colors: ['transparent'] };
    options.xaxis = {
      type: 'category',
      categories: rows.map((row) =>
        isCurrentWeek(row) ? this.translateService.instant('Semaine courante') : this.shortDate(row.mondayKey),
      ),
    };
    options.tooltip.x = {
      formatter: (_value, context): string => {
        const row = rows[context?.dataPointIndex ?? 0];
        return this.translateService.instant('Semaine du 0 au 0', {
          start: this.shortDate(row.mondayKey),
          end: this.shortDate(row.mondayKey + 6 * 24 * MS_PER_HOUR),
        });
      },
    };
    return options;
  }

  private shortDate(instant: number): string {
    return new Date(instant).toLocaleDateString(this.languageService.getCurrentLang(), {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    });
  }

  private chartLocale(): ChartLocale {
    return { locales: this.rankingService.CHART_LOCALES, defaultLocale: this.languageService.getCurrentLang() };
  }
}
