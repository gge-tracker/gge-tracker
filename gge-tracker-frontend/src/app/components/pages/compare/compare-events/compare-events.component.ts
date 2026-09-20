import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import {
  ApiPlayerEventOccurrence,
  ApiPlayerStatsSummaryEvent,
  ApiPlayerStatsType,
  ApiSpecificEventByPlayerIdResponse,
  ApiWoaEventPlayerData,
  EventType,
} from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { formatThousands } from '@ggetracker-services/text-format.utilities';
import { TranslateModule } from '@ngx-translate/core';

import { CompareSide } from '../compare-metrics';

type EventsState = 'loading' | 'loaded' | 'error';

interface CompareEventMetric {
  caption: string;
  values: [number | null, number | null];
  winner: CompareSide | null;
}

interface CompareEventTile {
  key: string;
  label: string;
  icon: string;
  isRank: boolean;
  runs: [number, number];
  primary: CompareEventMetric;
  secondary: CompareEventMetric;
}

interface PlayerEvents {
  summary: Partial<Record<ApiPlayerStatsType, ApiPlayerStatsSummaryEvent>>;
  occurrences: Partial<Record<ApiPlayerStatsType, ApiPlayerEventOccurrence[]>>;
  outer: ApiSpecificEventByPlayerIdResponse[];
  woa: ApiWoaEventPlayerData[];
}

const KINGDOM_EVENTS = [
  { table: ApiPlayerStatsType.war_realms, label: 'Guerre des royaumes', icon: '/assets/event-logo-id-44.png' },
  { table: ApiPlayerStatsType.nomad, label: 'Nomades', icon: '/assets/event-logo-id-46.png' },
  { table: ApiPlayerStatsType.samurai, label: 'Samouraïs', icon: '/assets/event-logo-id-51.png' },
  { table: ApiPlayerStatsType.bloodcrow, label: 'Corbeaux de sang', icon: '/assets/event-logo-id-58.png' },
  { table: ApiPlayerStatsType.berimond_kingdom, label: 'Royaume de Berimond', icon: '/assets/event-logo-id-30.png' },
  { table: ApiPlayerStatsType.berimond_invasion, label: 'Invasion de Berimond', icon: '/assets/berimond.png' },
];

const RECENT_RUNS = 5;

@Component({
  selector: 'app-compare-events',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './compare-events.component.html',
  styleUrl: './compare-events.component.css',
})
export class CompareEventsComponent {
  public readonly ids = input.required<[string, string]>();

  public readonly state = signal<EventsState>('loading');
  // eslint-disable-next-line unicorn/consistent-function-scoping
  public readonly tiles = computed(() => {
    const pair = this.events();
    return pair === null ? [] : this.buildTiles(pair);
  });

  private readonly events = signal<[PlayerEvents, PlayerEvents] | null>(null);
  private readonly apiRestService = inject(ApiRestService);
  private readonly compactNumber = new FormatNumberPipe();
  private requestToken = 0;

  constructor() {
    effect(() => {
      const ids = this.ids();
      untracked(() => void this.load(ids));
    });
  }

  public display(tile: CompareEventTile, metric: CompareEventMetric, side: CompareSide): string {
    const value = metric.values[side];
    if (value === null) return '—';
    return tile.isRank ? '#' + formatThousands(value) : this.compactNumber.transform(value);
  }

  public runs(tile: CompareEventTile, side: CompareSide): string {
    return tile.isRank && tile.runs[side] > 0 ? String(tile.runs[side]) : '';
  }

  private async load(ids: [string, string]): Promise<void> {
    const token = ++this.requestToken;
    this.state.set('loading');
    try {
      const pair = (await Promise.all(ids.map((id) => this.readPlayerEvents(Number(id))))) as [
        PlayerEvents,
        PlayerEvents,
      ];
      const tables = KINGDOM_EVENTS.map((event) => event.table).filter((table) =>
        pair.some((player) => (player.summary[table]?.row_count ?? 0) > 0),
      );
      const occurrences = await Promise.all(ids.map((id) => this.readOccurrences(Number(id), tables)));
      if (token !== this.requestToken) return;
      pair.forEach((player, side) => (player.occurrences = occurrences[side]));
      this.events.set(pair);
      this.state.set('loaded');
    } catch {
      if (token === this.requestToken) this.state.set('error');
    }
  }

  private async readPlayerEvents(playerId: number): Promise<PlayerEvents> {
    const [summary, outer, woa] = await Promise.all([
      this.apiRestService.getPlayerStatsSummaryByPlayerId(playerId),
      this.apiRestService.getEventsByPlayerId(playerId, 'all'),
      this.apiRestService.getWoaEventDataByPlayerId(playerId),
    ]);
    return {
      summary: summary.success ? summary.data.events : {},
      occurrences: {},
      outer: outer.success ? outer.data.events : [],
      woa: woa.success ? woa.data.events : [],
    };
  }

  private async readOccurrences(
    playerId: number,
    tables: ApiPlayerStatsType[],
  ): Promise<Partial<Record<ApiPlayerStatsType, ApiPlayerEventOccurrence[]>>> {
    const responses = await Promise.all(
      tables.map((table) => this.apiRestService.getPlayerEventOccurrencesByPlayerId(playerId, table)),
    );
    const byTable: Partial<Record<ApiPlayerStatsType, ApiPlayerEventOccurrence[]>> = {};
    tables.forEach((table, index) => {
      const response = responses[index];
      byTable[table] = response.success ? response.data.occurrences : [];
    });
    return byTable;
  }

  private buildTiles(pair: [PlayerEvents, PlayerEvents]): CompareEventTile[] {
    const tiles = KINGDOM_EVENTS.map((event) => this.scoreTile(event.label, event.icon, pair, event.table));
    tiles.push(
      this.rankTile('Royaume extérieur', '/assets/outer-realms-icon.png', [
        this.outerRanks(pair[0], EventType.OUTER_REALM),
        this.outerRanks(pair[1], EventType.OUTER_REALM),
      ]),
      this.rankTile('Lacis', '/assets/beyond-the-horizon-icon.png', [
        this.outerRanks(pair[0], EventType.BEYOND_THE_HORIZON),
        this.outerRanks(pair[1], EventType.BEYOND_THE_HORIZON),
      ]),
      this.rankTile('Roue des richesses inimaginables', '/assets/woa-icon.png', [
        pair[0].woa.map((run) => run.rank),
        pair[1].woa.map((run) => run.rank),
      ]),
    );
    return tiles.filter((tile) => tile.primary.values.some((value) => value !== null && value > 0));
  }

  private outerRanks(player: PlayerEvents, type: EventType): number[] {
    return player.outer.filter((run) => run.type === type).map((run) => run.rank);
  }

  private scoreTile(
    label: string,
    icon: string,
    pair: [PlayerEvents, PlayerEvents],
    table: ApiPlayerStatsType,
  ): CompareEventTile {
    const averages = pair.map((player) => this.recentAverage(player.occurrences[table])) as [
      number | null,
      number | null,
    ];
    const peaks = pair.map((player) => this.peak(player.summary[table])) as [number | null, number | null];
    return {
      key: label,
      label,
      icon,
      isRank: false,
      runs: [0, 0],
      primary: { caption: 'Moyenne sur 5 événements', values: averages, winner: this.winnerOf(averages, false) },
      secondary: { caption: 'Score maximal', values: peaks, winner: this.winnerOf(peaks, false) },
    };
  }

  private rankTile(label: string, icon: string, ranks: [number[], number[]]): CompareEventTile {
    const played = ranks.map((side) => side.filter((rank) => rank > 0)) as [number[], number[]];
    const averages = played.map((side) => this.average(side)) as [number | null, number | null];
    const medians = played.map((side) => this.median(side)) as [number | null, number | null];
    return {
      key: label,
      label,
      icon,
      isRank: true,
      runs: [played[0].length, played[1].length],
      primary: { caption: 'Classement moyen', values: averages, winner: this.winnerOf(averages, true) },
      secondary: { caption: 'Classement médian', values: medians, winner: this.winnerOf(medians, true) },
    };
  }

  private recentAverage(occurrences: ApiPlayerEventOccurrence[] | undefined): number | null {
    if (!occurrences || occurrences.length === 0) return null;
    const recent = occurrences.slice(-RECENT_RUNS);
    return Math.round(recent.reduce((total, run) => total + Number(run.point), 0) / recent.length);
  }

  private peak(event: ApiPlayerStatsSummaryEvent | undefined): number | null {
    return event && event.row_count > 0 ? event.max_point : null;
  }

  private average(values: number[]): number | null {
    if (values.length === 0) return null;
    return Math.round(values.reduce((total, value) => total + Number(value), 0) / values.length);
  }

  private median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
  }

  private winnerOf(values: [number | null, number | null], lowerIsBetter: boolean): CompareSide | null {
    const [a, b] = values;
    if (a === null && b === null) return null;
    if (a === null) return 1;
    if (b === null) return 0;
    if (a === b) return null;
    return (lowerIsBetter ? a < b : a > b) ? 0 : 1;
  }
}
