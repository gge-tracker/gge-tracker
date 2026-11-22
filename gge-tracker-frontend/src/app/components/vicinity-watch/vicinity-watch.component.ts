/* eslint-disable unicorn/consistent-function-scoping */
import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiVicinity, ApiVicinityNeighbour, ApiVicinityOrigin } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { formatCompact, formatSigned } from '../pages/home/home-dashboard';
import { FeedEntry, VicinityWindow, WINDOW_MS, buildFeed, honorOf, mightChangeOf } from './vicinity-feed';

type TallyFilter = 'all' | 'watch' | 'opportunity' | 'fresh';

interface Preferences {
  radius: number;
  window: VicinityWindow;
  hideAllies: boolean;
}

interface FeedRow {
  entry: FeedEntry;
  params: Record<string, string | number>;
  where: string;
  when: string;
  fresh: boolean;
}

interface RadarDot {
  key: string;
  playerId: string;
  playerName: string;
  x: number;
  y: number;
  side: 'ally' | 'rival' | 'free';
  main: boolean;
  active: boolean;
  fresh: boolean;
  focused: boolean;
  size: number;
}

interface RadarOrigin {
  key: string;
  x: number;
  y: number;
  main: boolean;
  selected: boolean;
}

const PREFERENCES_KEY = 'vicinity-watch';
const LAST_VISIT_KEY = 'vicinity-watch-seen';
const FEED_PREVIEW = 6;
const RADII = [15, 30, 50];
const DEFAULT_PREFERENCES: Preferences = { radius: 30, window: '24h', hideAllies: true };
const MAP_WIDTH = 1287;
const RADAR_MARGIN = 4;
const MAIN_CASTLE = 1;
// Below this card width the map is folded behind its button, matching the stylesheet
const WIDE_CARD_PX = 640;
const DOT_SIZE = 1.7;
const CASTLE_TYPES = new Set([1, 3, 4, 22]);

@Component({
  selector: 'app-vicinity-watch',
  standalone: true,
  imports: [DecimalPipe, RouterLink, TranslateModule],
  templateUrl: './vicinity-watch.component.html',
  styleUrl: './vicinity-watch.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VicinityWatchComponent {
  public readonly playerId = input.required<string>();
  public readonly language = input<string>('en');

  public readonly radii = RADII;
  public readonly feedPreview = FEED_PREVIEW;

  public readonly vicinity = signal<ApiVicinity | null>(null);
  public readonly loading = signal(true);
  public readonly failed = signal(false);
  public readonly preferences = signal<Preferences>(DEFAULT_PREFERENCES);
  public readonly origin = signal<number | null>(null);
  public readonly settingsOpen = signal(false);
  public readonly mapOpen = signal(false);
  public readonly feedExpanded = signal(false);
  public readonly tallyFilter = signal<TallyFilter>('all');
  public readonly focusedPlayer = signal<string | null>(null);
  public readonly radius = computed(() => this.preferences().radius);
  public readonly wide = signal(true);
  public readonly mapVisible = computed(() => this.wide() || this.mapOpen());

  public readonly entries = computed(() => this.entriesFor(this.preferences().window));

  public readonly weekEntryCount = computed(() =>
    this.preferences().window === '24h' && this.entries().length === 0 ? this.entriesFor('7d').length : 0,
  );

  public readonly activeTally = computed<TallyFilter>(() => {
    const filter = this.tallyFilter();
    return filter !== 'all' && this.overview()[filter] === 0 ? 'all' : filter;
  });

  public readonly filteredEntries = computed(() => {
    const filter = this.activeTally();
    return this.entries().filter((entry) => this.matchesTally(entry, filter));
  });

  public readonly allFeed = computed<FeedRow[]>(() => {
    const focused = this.focusedPlayer();
    const lastVisit = this.lastVisit;
    return this.filteredEntries()
      .filter((entry) => focused === null || entry.playerId === focused)
      .map((entry) => ({
        entry,
        params: this.paramsOf(entry),
        where: this.whereOf(entry),
        when: this.relative(entry.at),
        fresh: lastVisit !== null && entry.at > lastVisit,
      }));
  });

  public readonly feed = computed(() => (this.feedExpanded() ? this.allFeed() : this.allFeed().slice(0, FEED_PREVIEW)));

  public readonly hiddenFeedCount = computed(() => this.allFeed().length - this.feed().length);

  public readonly customised = computed(() => {
    const { radius, hideAllies } = this.preferences();
    return (
      radius !== DEFAULT_PREFERENCES.radius || hideAllies !== DEFAULT_PREFERENCES.hideAllies || this.origin() !== null
    );
  });

  public readonly selectedOrigin = computed(() => {
    const origin = this.origin();
    return origin === null ? null : (this.vicinity()?.origins[origin] ?? null);
  });

  public readonly overview = computed(() => {
    const hideAllies = this.preferences().hideAllies;
    const shown = (this.vicinity()?.neighbours ?? []).filter((neighbour) => !hideAllies || !neighbour.is_ally);
    const entries = this.entries();
    return {
      changes: entries.length,
      watch: entries.filter((entry) => this.matchesTally(entry, 'watch')).length,
      opportunity: entries.filter((entry) => this.matchesTally(entry, 'opportunity')).length,
      fresh: entries.filter((entry) => this.matchesTally(entry, 'fresh')).length,
      neighbours: shown.length,
      protected: shown.filter((neighbour) => neighbour.in_protection).length,
    };
  });

  public readonly radarCenter = computed<ApiVicinityOrigin | null>(() => {
    const origins = this.vicinity()?.origins ?? [];
    return origins[this.origin() ?? 0] ?? null;
  });

  public readonly radarOrigins = computed<RadarOrigin[]>(() => {
    const center = this.radarCenter();
    const origins = this.vicinity()?.origins ?? [];
    if (!center) return [];
    return origins
      .map((origin) => ({ origin, point: this.radarPoint(center, origin.x, origin.y) }))
      .filter(({ point }) => point !== null)
      .map(({ origin, point }) => ({
        key: `o${origin.origin}`,
        x: point!.x,
        y: point!.y,
        main: origin.castle_type === MAIN_CASTLE,
        selected: origin.origin === center.origin,
      }));
  });

  public readonly radarDots = computed<RadarDot[]>(() => {
    const center = this.radarCenter();
    const vicinity = this.vicinity();
    if (!center || !vicinity) return [];
    const shown = this.filteredEntries();
    const active = new Set(shown.map((entry) => entry.playerId));
    const lastVisit = this.lastVisit;
    const fresh = new Set(
      shown.filter((entry) => lastVisit !== null && entry.at > lastVisit).map((entry) => entry.playerId),
    );
    const size = DOT_SIZE * Math.min(1.4, 30 / this.radius());
    const hideAllies = this.preferences().hideAllies;
    const focused = this.focusedPlayer();
    const dots: RadarDot[] = [];
    for (const neighbour of vicinity.neighbours) {
      if (hideAllies && neighbour.is_ally) continue;
      for (const castle of neighbour.castles) {
        const point = this.radarPoint(center, castle.x, castle.y);
        if (!point) continue;
        dots.push({
          key: `${neighbour.player_id}:${castle.x}:${castle.y}`,
          playerId: neighbour.player_id,
          playerName: neighbour.player_name,
          x: point.x,
          y: point.y,
          side: neighbour.is_ally ? 'ally' : neighbour.alliance_id ? 'rival' : 'free',
          main: castle.castle_type === MAIN_CASTLE,
          active: active.has(neighbour.player_id),
          fresh: fresh.has(neighbour.player_id),
          focused: neighbour.player_id === focused,
          size,
        });
      }
    }
    return dots.sort((a, b) => Number(a.active) - Number(b.active));
  });

  public readonly focusedNeighbour = computed<ApiVicinityNeighbour | null>(() => {
    const focused = this.focusedPlayer();
    return this.vicinity()?.neighbours.find((neighbour) => neighbour.player_id === focused) ?? null;
  });

  public readonly focusedName = computed(() => this.focusedNeighbour()?.player_name ?? null);

  public readonly focusedChanges = computed(() => {
    const focused = this.focusedPlayer();
    return this.entries().filter((entry) => entry.playerId === focused).length;
  });

  private readonly api = inject(ApiRestService);
  private readonly storage = inject(LocalStorageService);
  private readonly translate = inject(TranslateService);
  private readonly lastVisit = this.readLastVisit();
  private readonly host = inject(ElementRef<HTMLElement>);
  private request = 0;

  constructor() {
    this.preferences.set(this.readPreferences());
    this.watchWidth();
    effect(() => {
      const playerId = this.playerId();
      const radius = this.radius();
      untracked(() => void this.load(playerId, radius));
    });
  }

  public setRadius(radius: number): void {
    if (radius === this.preferences().radius) return;
    this.updatePreferences({ radius });
  }

  public setWindow(window: VicinityWindow): void {
    this.feedExpanded.set(false);
    this.tallyFilter.set('all');
    this.updatePreferences({ window });
  }

  public toggleAllies(): void {
    this.updatePreferences({ hideAllies: !this.preferences().hideAllies });
  }

  public setOrigin(origin: number | null): void {
    this.feedExpanded.set(false);
    this.tallyFilter.set('all');
    this.origin.set(origin);
  }

  public setTally(filter: TallyFilter): void {
    this.tallyFilter.set(this.activeTally() === filter ? 'all' : filter);
    this.feedExpanded.set(false);
  }

  public selectOrigin(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.setOrigin(value === '' ? null : Number(value));
  }

  public focus(playerId: string | null): void {
    const next = this.focusedPlayer() === playerId ? null : playerId;
    this.focusedPlayer.set(next);
    this.feedExpanded.set(false);
  }

  public castleLabel(castleType: number | null | undefined): string {
    return CASTLE_TYPES.has(Number(castleType)) ? `vicinity.castle-${castleType}` : 'vicinity.castle-1';
  }

  public originLabel(origin: ApiVicinityOrigin): string {
    return `${this.translate.instant(this.castleLabel(origin.castle_type))} ${origin.x}:${origin.y}`;
  }

  public levelLabel(level: number, legendaryLevel: number): string {
    return legendaryLevel > 0 ? `${level}/${legendaryLevel}` : String(level);
  }

  public compact(value: number): string {
    return formatCompact(value);
  }

  public signed(value: number | null): string {
    return value === null || value === 0 ? '—' : formatSigned(value);
  }

  public trendOf(value: number | null): 'up' | 'down' | 'flat' {
    if (!value) return 'flat';
    return value > 0 ? 'up' : 'down';
  }

  public honorChange(neighbour: ApiVicinityNeighbour): number {
    const honor = honorOf(neighbour, this.preferences().window);
    return honor.gained - honor.lost;
  }

  public honorChanges(neighbour: ApiVicinityNeighbour): number {
    return honorOf(neighbour, this.preferences().window).changes;
  }

  public mightChange(neighbour: ApiVicinityNeighbour): number | null {
    return mightChangeOf(neighbour, this.preferences().window);
  }

  public isNew(neighbour: ApiVicinityNeighbour): boolean {
    return neighbour.first_seen_at !== null && Date.now() - Date.parse(neighbour.first_seen_at) < WINDOW_MS['7d'];
  }

  public neighbourDistance(neighbour: ApiVicinityNeighbour): number {
    return this.distanceFromOrigin(neighbour, this.origin());
  }

  public protectionEnd(neighbour: ApiVicinityNeighbour): string {
    return neighbour.protected_until ? this.relative(Date.parse(neighbour.protected_until)) : '';
  }

  public async retry(): Promise<void> {
    await this.load(this.playerId(), this.preferences().radius);
  }

  private async load(playerId: string, radius: number): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.failed.set(false);
    const response = await this.api.getPlayerVicinity(playerId, radius);
    if (request !== this.request) return;
    if (response.success) {
      this.vicinity.set(response.data);
      this.storage.setItem(LAST_VISIT_KEY, String(Date.now()));
      if ((this.origin() ?? 0) >= response.data.origins.length) this.origin.set(null);
    } else {
      this.failed.set(true);
    }
    this.loading.set(false);
  }

  private watchWidth(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => this.wide.set(entry.contentRect.width >= WIDE_CARD_PX));
    observer.observe(this.host.nativeElement);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  private matchesTally(entry: FeedEntry, filter: TallyFilter): boolean {
    if (filter === 'watch') return entry.tone === 'threat';
    if (filter === 'opportunity') return entry.tone === 'opportunity';
    if (filter === 'fresh') return this.lastVisit !== null && entry.at > this.lastVisit;
    return true;
  }

  private entriesFor(window: VicinityWindow): FeedEntry[] {
    const vicinity = this.vicinity();
    if (!vicinity) return [];
    return buildFeed(vicinity, {
      window,
      now: Date.now(),
      hideAllies: this.preferences().hideAllies,
      origin: this.origin(),
    });
  }

  private distanceFromOrigin(neighbour: ApiVicinityNeighbour, origin: number | null): number {
    if (origin === null) return neighbour.distance;
    const castles = neighbour.castles.filter((castle) => castle.origin === origin);
    return castles.length > 0 ? Math.min(...castles.map((castle) => castle.distance)) : neighbour.distance;
  }

  private radarPoint(center: ApiVicinityOrigin, x: number, y: number): { x: number; y: number } | null {
    const half = this.preferences().radius + RADAR_MARGIN;
    let dx = x - center.x;
    if (dx > MAP_WIDTH / 2) dx -= MAP_WIDTH;
    if (dx < -MAP_WIDTH / 2) dx += MAP_WIDTH;
    const dy = y - center.y;
    if (Math.abs(dx) > half || Math.abs(dy) > half) return null;
    return { x: 50 + (dx / half) * 50, y: 50 + (dy / half) * 50 };
  }

  private paramsOf(entry: FeedEntry): Record<string, string | number> {
    const parameters: Record<string, string | number> = { ...entry.params };
    parameters['castle'] = this.translate.instant(this.castleLabel(entry.castleType));
    if (typeof parameters['change'] === 'number') parameters['change'] = formatSigned(parameters['change']);
    if (typeof parameters['typical'] === 'number') parameters['typical'] = formatCompact(parameters['typical']);
    if (typeof parameters['net'] === 'number') parameters['net'] = formatSigned(parameters['net']);
    if (typeof parameters['peak'] === 'number') parameters['peak'] = formatSigned(parameters['peak']);
    if (entry.distance !== null) parameters['after'] = entry.distance;
    return parameters;
  }

  private whereOf(entry: FeedEntry): string {
    const origin = entry.origin === null ? null : this.vicinity()?.origins[entry.origin];
    if (entry.distance === null || !origin) return '';
    return this.translate.instant('vicinity.distance', {
      distance: new Intl.NumberFormat(this.language(), { maximumFractionDigits: 1 }).format(entry.distance),
      castle: this.translate.instant(this.castleLabel(origin.castle_type)),
    });
  }

  private relative(instant: number): string {
    const seconds = Math.round((instant - Date.now()) / 1000);
    const format = new Intl.RelativeTimeFormat(this.language(), { numeric: 'auto', style: 'short' });
    if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), 'minute');
    if (Math.abs(seconds) < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
    return format.format(Math.round(seconds / 86_400), 'day');
  }

  private readLastVisit(): number | null {
    const stored = Number(this.storage.getItem(LAST_VISIT_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  }

  private readPreferences(): Preferences {
    try {
      const stored = JSON.parse(this.storage.getItem(PREFERENCES_KEY) ?? '{}');
      return {
        radius: RADII.includes(stored.radius) ? stored.radius : DEFAULT_PREFERENCES.radius,
        window: stored.window === '7d' ? '7d' : DEFAULT_PREFERENCES.window,
        hideAllies: typeof stored.hideAllies === 'boolean' ? stored.hideAllies : DEFAULT_PREFERENCES.hideAllies,
      };
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  private updatePreferences(change: Partial<Preferences>): void {
    const next = { ...this.preferences(), ...change };
    this.preferences.set(next);
    this.storage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  }
}
