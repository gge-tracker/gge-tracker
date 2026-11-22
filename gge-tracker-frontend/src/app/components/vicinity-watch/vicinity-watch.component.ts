/* eslint-disable unicorn/consistent-function-scoping */
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiVicinity, ApiVicinityNeighbour, ApiVicinityOrigin } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { formatCompact, formatSigned } from '../pages/home/home-dashboard';
import { FeedCategory, FeedEntry, VicinityWindow, WINDOW_MS, buildFeed, honorOf, mightChangeOf } from './vicinity-feed';

type VicinityTab = 'feed' | 'neighbours';
type NeighbourSort = 'distance' | 'might' | 'change' | 'honor';

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
  focused: boolean;
}

interface RadarOrigin {
  key: string;
  x: number;
  y: number;
  main: boolean;
  selected: boolean;
}

const PREFERENCES_KEY = 'vicinity-watch';
const RADII = [15, 30, 50];
const DEFAULT_PREFERENCES: Preferences = { radius: 30, window: '24h', hideAllies: true };
const MAP_WIDTH = 1287;
const RADAR_MARGIN = 4;
const MAIN_CASTLE = 1;
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
  public readonly categories: FeedCategory[] = ['castles', 'alliances', 'activity'];

  public readonly vicinity = signal<ApiVicinity | null>(null);
  public readonly loading = signal(true);
  public readonly failed = signal(false);
  public readonly preferences = signal<Preferences>(DEFAULT_PREFERENCES);
  public readonly tab = signal<VicinityTab>('feed');
  public readonly origin = signal<number | null>(null);
  public readonly category = signal<FeedCategory | null>(null);
  public readonly focusedPlayer = signal<string | null>(null);
  public readonly neighbourSort = signal<NeighbourSort>('distance');
  public readonly radius = computed(() => this.preferences().radius);

  public readonly entries = computed(() => {
    const vicinity = this.vicinity();
    if (!vicinity) return [];
    const preferences = this.preferences();
    return buildFeed(vicinity, {
      window: preferences.window,
      now: Date.now(),
      hideAllies: preferences.hideAllies,
      origin: this.origin(),
    });
  });

  public readonly feed = computed<FeedRow[]>(() => {
    const category = this.category();
    const focused = this.focusedPlayer();
    return this.entries()
      .filter((entry) => category === null || entry.category === category)
      .filter((entry) => focused === null || entry.playerId === focused)
      .map((entry) => ({
        entry,
        params: this.paramsOf(entry),
        where: this.whereOf(entry),
        when: this.relative(entry.at),
      }));
  });

  public readonly categoryCounts = computed(() => {
    const counts: Record<FeedCategory, number> = { castles: 0, alliances: 0, activity: 0 };
    for (const entry of this.entries()) counts[entry.category]++;
    return counts;
  });

  public readonly neighbours = computed(() => {
    const vicinity = this.vicinity();
    if (!vicinity) return [];
    const { hideAllies, window } = this.preferences();
    const origin = this.origin();
    const focused = this.focusedPlayer();
    const rows = vicinity.neighbours
      .filter((neighbour) => !hideAllies || !neighbour.is_ally)
      .filter((neighbour) => origin === null || neighbour.castles.some((castle) => castle.origin === origin))
      .filter((neighbour) => focused === null || neighbour.player_id === focused);
    const sortKey = this.neighbourSort();
    const value = (neighbour: ApiVicinityNeighbour): number => {
      if (sortKey === 'might') return -neighbour.might_current;
      if (sortKey === 'change') return -(mightChangeOf(neighbour, window) ?? Number.NEGATIVE_INFINITY);
      if (sortKey === 'honor') return -honorOf(neighbour, window).changes;
      return this.distanceFromOrigin(neighbour, origin);
    };
    return [...rows].sort((a, b) => value(a) - value(b));
  });

  public readonly summary = computed(() => {
    const vicinity = this.vicinity();
    const all = vicinity?.neighbours ?? [];
    return {
      neighbours: all.length,
      rivals: all.filter((neighbour) => !neighbour.is_ally).length,
      protected: all.filter((neighbour) => neighbour.in_protection).length,
      alerts: this.entries().filter((entry) => entry.tone === 'threat').length,
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
    const active = new Set(this.entries().map((entry) => entry.playerId));
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
          focused: neighbour.player_id === focused,
        });
      }
    }
    return dots.sort((a, b) => Number(a.active) - Number(b.active));
  });

  public readonly focusedName = computed(() => {
    const focused = this.focusedPlayer();
    return this.vicinity()?.neighbours.find((neighbour) => neighbour.player_id === focused)?.player_name ?? null;
  });

  private readonly api = inject(ApiRestService);
  private readonly storage = inject(LocalStorageService);
  private readonly translate = inject(TranslateService);
  private request = 0;

  constructor() {
    this.preferences.set(this.readPreferences());
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
    this.updatePreferences({ window });
  }

  public toggleAllies(): void {
    this.updatePreferences({ hideAllies: !this.preferences().hideAllies });
  }

  public setOrigin(origin: number | null): void {
    this.origin.set(origin);
  }

  public setCategory(category: FeedCategory | null): void {
    this.category.set(this.category() === category ? null : category);
  }

  public focus(playerId: string | null): void {
    this.focusedPlayer.set(this.focusedPlayer() === playerId ? null : playerId);
  }

  public castleLabel(castleType: number | null | undefined): string {
    return CASTLE_TYPES.has(Number(castleType)) ? `vicinity.castle-${castleType}` : 'vicinity.castle-1';
  }

  public originLabel(origin: ApiVicinityOrigin): string {
    return `${this.translate.instant(this.castleLabel(origin.castle_type))} ${origin.x}:${origin.y}`;
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
      if ((this.origin() ?? 0) >= response.data.origins.length) this.origin.set(null);
    } else {
      this.failed.set(true);
    }
    this.loading.set(false);
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
    const format = new Intl.RelativeTimeFormat(this.language(), { numeric: 'auto' });
    if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), 'minute');
    if (Math.abs(seconds) < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
    return format.format(Math.round(seconds / 86_400), 'day');
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
