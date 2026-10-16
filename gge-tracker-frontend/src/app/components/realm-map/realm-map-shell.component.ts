/* eslint-disable unicorn/consistent-function-scoping */
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { TranslateModule } from '@ngx-translate/core';
import { RealmMapComponent } from './realm-map.component';
import {
  RealmMapColorMode,
  RealmMapExtent,
  RealmMapLegendGroup,
  RealmMapLocateRequest,
  RealmMapNearest,
  RealmMapOrigin,
  RealmMapPoint,
  REALM_WORLD_EXTENT,
} from './realm-map.models';

const COORDINATES_PATTERN = /^\s*(\d{1,4})\s*[\s,/:;]\s*(\d{1,4})\s*$/;
const SUGGESTION_DELAY_MS = 250;

@Component({
  selector: 'app-realm-map-shell',
  standalone: true,
  imports: [FormsModule, TranslateModule, DatePipe, DecimalPipe, RealmMapComponent],
  templateUrl: './realm-map-shell.component.html',
  styleUrl: './realm-map-shell.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RealmMapShellComponent implements OnDestroy {
  public readonly points = input<RealmMapPoint[]>([]);
  public readonly extent = input<RealmMapExtent>(REALM_WORLD_EXTENT);
  public readonly gridStep = input(100);
  public readonly field = input('#2fa3c4');
  public readonly ground = input('#2c4f5f');
  public readonly origin = input<RealmMapOrigin | null>(null);
  public readonly originQuery = input('');
  public readonly rings = input<number[]>([]);
  public readonly selectedId = input<string | null>(null);
  public readonly legend = input<RealmMapLegendGroup[]>([]);
  public readonly colorModes = input<RealmMapColorMode[]>([]);
  public readonly colorMode = input('');
  public readonly nearest = input<RealmMapNearest[]>([]);
  public readonly loading = input(false);
  public readonly lastScanAt = input<string | null>(null);

  public readonly pointSelected = output<string | null>();
  public readonly locate = output<RealmMapLocateRequest>();
  public readonly clearOrigin = output();
  public readonly toggleGroup = output<string>();
  public readonly toggleItem = output<string>();
  public readonly colorModeChange = output<string>();
  public readonly refresh = output();

  public readonly hasSelection = computed(() => {
    const selectedId = this.selectedId();
    return selectedId !== null && this.points().some((point) => point.id === selectedId);
  });
  public readonly picking = signal(false);
  public readonly isFullscreen = signal(false);
  public readonly suggestions = signal<string[]>([]);
  public readonly suggestionListId = `rmap-suggestions-${Math.random().toString(36).slice(2, 8)}`;
  public query = '';

  private readonly map = viewChild.required(RealmMapComponent);
  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly apiRestService = inject(ApiRestService);
  private readonly documentListeners = new AbortController();
  private suggestionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      this.query = this.originQuery();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'fullscreenchange',
        () => this.isFullscreen.set(document.fullscreenElement === this.stage().nativeElement),
        { signal: this.documentListeners.signal },
      );
    }
  }

  public ngOnDestroy(): void {
    this.documentListeners.abort();
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
  }

  public focus(x: number, y: number): void {
    this.map().focus(x, y);
  }

  public fit(): void {
    this.map().fit();
  }

  public submitLocate(): void {
    const query = this.query.trim();
    if (!query) return;
    this.picking.set(false);
    const coordinates = COORDINATES_PATTERN.exec(query);
    if (coordinates) {
      this.locate.emit({ kind: 'coords', x: Number(coordinates[1]), y: Number(coordinates[2]) });
    } else {
      this.locate.emit({ kind: 'player', name: query });
    }
  }

  public onPicked(coordinates: { x: number; y: number }): void {
    this.picking.set(false);
    this.query = `${coordinates.x}:${coordinates.y}`;
    this.locate.emit({ kind: 'coords', ...coordinates });
  }

  public togglePick(): void {
    this.picking.update((picking) => !picking);
  }

  public selectNearest(target: RealmMapNearest): void {
    this.pointSelected.emit(target.id);
    this.map().focus(target.x, target.y);
  }

  public onQueryChange(query: string): void {
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
    const trimmed = query.trim();
    if (trimmed.length < 2 || COORDINATES_PATTERN.test(trimmed)) {
      this.suggestions.set([]);
      return;
    }
    this.suggestionTimer = setTimeout(() => void this.loadSuggestions(trimmed), SUGGESTION_DELAY_MS);
  }

  public toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.stage().nativeElement.requestFullscreen?.();
    }
  }

  private async loadSuggestions(query: string): Promise<void> {
    const response = await this.apiRestService.getPlayerSuggestions(query);
    if (!response.success || this.query.trim() !== query) return;
    this.suggestions.set(response.data.suggestions.map((suggestion) => suggestion.name).slice(0, 8));
  }
}
