/* eslint-disable unicorn/consistent-function-scoping */
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  NgZone,
  OnInit,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RealmMapShellComponent } from '@ggetracker-components/realm-map/realm-map-shell.component';
import {
  RealmMapEmphasis,
  RealmMapLegendGroup,
  RealmMapLegendItem,
  RealmMapLocateRequest,
  RealmMapNearest,
  RealmMapOrigin,
  RealmMapPoint,
  REALM_MAP_HIGHLIGHT_COLOR,
  REALM_MAP_STATE_COLORS,
  REALM_WORLD_EXTENT,
} from '@ggetracker-components/realm-map/realm-map.models';
import { fetchAllPages } from '@ggetracker-components/realm-map/realm-map-paging';
import { ApiDungeonsResource, ErrorType } from '@ggetracker-interfaces/empire-ranking';
import { CooldownPipe } from '@ggetracker-pipes/cooldown.pipe';
import { DurationPipe } from '@ggetracker-pipes/duration.pipe';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { RealmCastleLocatorService } from '@ggetracker-services/realm-castle-locator.service';
import { ToastService } from '@ggetracker-services/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

type DungeonState = 'ready' | 'soon' | 'cooldown';

interface DungeonItem {
  id: string;
  x: number;
  y: number;
  attackerId: string | null;
  attackerName: string | null;
  lastAttack: string | null;
  availableDurationSeconds: number;
  effectiveCooldownUntil: string;
  availableAt: number;
}

export interface DungeonRealm {
  id: number;
  name: string;
  icon: string;
  ground: string;
  field: string;
}

export interface DungeonMapFocus {
  id: string;
  kingdomId: number;
  x: number;
  y: number;
}

export const DUNGEON_REALMS: DungeonRealm[] = [
  { id: 2, name: 'Le Glacier éternel', icon: 'assets/dungeon2.png', ground: '#4f6470', field: '#cfe4ec' },
  { id: 1, name: 'Les Sables brûlants', icon: 'assets/dungeon1.png', ground: '#6b5b3c', field: '#e3cd8a' },
  { id: 3, name: 'Les Pics du feu', icon: 'assets/dungeon3.png', ground: '#55392c', field: '#b0603a' },
];

const MAX_PAGE_SIZE = 5000;
const WORLD_SIZE = REALM_WORLD_EXTENT.maxX + 1;
const SOON_MS = 3_600_000;
const REFRESH_MS = 120_000;
const TICK_MS = 20_000;
const NEAREST_LIMIT = 6;
const DUNGEON_RADIUS = 4.2;
const STATE_ORDER: DungeonState[] = ['ready', 'soon', 'cooldown'];
const STATE_LABELS: Record<DungeonState, string> = {
  ready: 'Attaquable',
  soon: 'Bientôt attaquable (< 1h)',
  cooldown: 'En recharge',
};
const STATE_COLORS: Record<DungeonState, string> = {
  ready: REALM_MAP_STATE_COLORS.ready,
  soon: REALM_MAP_STATE_COLORS.soon,
  cooldown: REALM_MAP_STATE_COLORS.cooldown,
};

@Component({
  selector: 'app-dungeon-map',
  standalone: true,
  imports: [RealmMapShellComponent, TranslateModule, DecimalPipe, DatePipe, CooldownPipe, DurationPipe],
  templateUrl: './dungeon-map.component.html',
  styleUrls: ['../../../realm-map/realm-map-detail.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DungeonMapComponent implements OnInit {
  public readonly kingdomId = input.required<number>();
  public readonly originPlayerName = input<string | null>(null);
  public readonly originX = input<number | null>(null);
  public readonly originY = input<number | null>(null);
  public readonly focusTarget = input<DungeonMapFocus | null>(null);
  public readonly lastScanAt = input<string | null>(null);
  public readonly originChange = output<RealmMapLocateRequest | null>();
  public readonly attackHistoryRequested = output<{ playerId: string; playerName: string }>();

  public readonly rings = [50, 100, 200];
  public readonly extent = REALM_WORLD_EXTENT;
  public readonly dungeons = signal<DungeonItem[]>([]);
  public readonly loading = signal(false);
  public readonly selectedId = signal<string | null>(null);
  public readonly hidden = signal<ReadonlySet<string>>(new Set());
  public readonly origin = signal<RealmMapOrigin | null>(null);

  public readonly realm = computed(
    () => DUNGEON_REALMS.find((realm) => realm.id === this.kingdomId()) ?? DUNGEON_REALMS[0],
  );
  public readonly originQuery = computed(() => {
    const x = this.originX();
    const y = this.originY();
    return this.originPlayerName() ?? (x !== null && y !== null ? `${x}:${y}` : '');
  });
  public readonly points = computed(() => this.buildPoints());
  public readonly legend = computed(() => this.buildLegend());
  public readonly nearest = computed(() => this.buildNearest());
  public readonly selected = computed(() => this.dungeons().find((item) => item.id === this.selectedId()) ?? null);

  private readonly shell = viewChild.required(RealmMapShellComponent);
  private readonly apiRestService = inject(ApiRestService);
  private readonly locator = inject(RealmCastleLocatorService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly toastService = inject(ToastService);
  private readonly translateService = inject(TranslateService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly now = signal(Date.now());
  private readonly languageTick = signal(0);
  private readonly attackerId = signal<string | null>(null);
  private resolvedOriginKey = '';
  private handledFocusId: string | null = null;
  private loadedKingdomId: number | null = null;

  constructor() {
    this.restoreHidden();
    effect(() => {
      const kingdomId = this.kingdomId();
      untracked(() => {
        if (kingdomId === this.loadedKingdomId) return;
        this.selectedId.set(null);
        this.dungeons.set([]);
        this.resolvedOriginKey = '';
        void this.reload();
      });
    });
    effect(() => {
      const name = this.originPlayerName();
      const x = this.originX();
      const y = this.originY();
      this.kingdomId();
      untracked(() => void this.resolveOrigin(name, x, y));
    });
    effect(() => {
      const target = this.focusTarget();
      const loaded = this.dungeons().length > 0 && this.loadedKingdomId === this.kingdomId();
      if (target && loaded && target.id !== this.handledFocusId) untracked(() => this.focusOn(target));
    });
    this.translateService.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.languageTick.update((tick) => tick + 1));
  }

  public ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      const tick = setInterval(() => this.now.set(Date.now()), TICK_MS);
      const refresh = setInterval(() => void this.reload(), REFRESH_MS);
      this.destroyRef.onDestroy(() => {
        clearInterval(tick);
        clearInterval(refresh);
      });
    });
  }

  public async reload(): Promise<void> {
    if (this.loading()) return;
    const kingdomId = this.kingdomId();
    this.loading.set(true);
    try {
      const pages = await fetchAllPages((page) =>
        this.apiRestService.getDungeonsList({
          page,
          size: MAX_PAGE_SIZE,
          filterByKid: JSON.stringify([kingdomId]),
          filterByAttackCooldown: null,
          filterByPlayerName: null,
          positionX: null,
          positionY: null,
          nearPlayerName: null,
        }),
      );
      if (kingdomId !== this.kingdomId()) return;
      this.loadedKingdomId = kingdomId;
      this.dungeons.set(pages.flatMap((page) => page.dungeons).map((dungeon) => this.toItem(dungeon)));
      this.now.set(Date.now());
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    } finally {
      this.loading.set(false);
      if (kingdomId !== this.kingdomId()) void this.reload();
    }
  }

  public async onLocate(request: RealmMapLocateRequest): Promise<void> {
    if (request.kind === 'coords') {
      this.originChange.emit(request);
      return;
    }
    const castle = await this.locator.locate(request.name, this.kingdomId());
    if (!castle) {
      this.toastService.add(ErrorType.NO_PLAYER_FOUND, 5000);
      return;
    }
    this.originChange.emit({ kind: 'player', name: castle.playerName });
  }

  public onClearOrigin(): void {
    this.originChange.emit(null);
  }

  public toggleKey(key: string): void {
    const hidden = new Set(this.hidden());
    if (hidden.has(key)) {
      hidden.delete(key);
    } else {
      hidden.add(key);
    }
    this.hidden.set(hidden);
    this.localStorage.setItem('dungeonMapHidden', JSON.stringify([...hidden]));
  }

  public copyCoordinates(x: number, y: number): void {
    globalThis.navigator.clipboard
      .writeText(`${x}:${y}`)
      .then(() => this.toastService.add(ErrorType.COPIED_TO_CLIPBOARD, 3000, 'info'))
      .catch(() => this.toastService.add(ErrorType.ERROR_OCCURRED, 5000));
  }

  public stateOf(dungeon: DungeonItem): DungeonState {
    const wait = dungeon.availableAt - this.now();
    if (wait <= 0) return 'ready';
    return wait <= SOON_MS ? 'soon' : 'cooldown';
  }

  public distanceTo(dungeon: DungeonItem): number | null {
    const origin = this.origin();
    return origin ? this.wrappedDistance(dungeon, origin) : null;
  }

  public openAttackHistory(dungeon: DungeonItem): void {
    if (dungeon.attackerId && dungeon.attackerName) {
      this.attackHistoryRequested.emit({ playerId: dungeon.attackerId, playerName: dungeon.attackerName });
    }
  }

  private isAttackedByOrigin(dungeon: DungeonItem): boolean {
    const attackerId = this.attackerId();
    return attackerId !== null && dungeon.attackerId === attackerId;
  }

  // The realm map wraps around at its edges, as the API distance does
  private wrappedDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return Math.hypot(Math.min(dx, WORLD_SIZE - dx), Math.min(dy, WORLD_SIZE - dy));
  }

  private focusOn(target: DungeonMapFocus): void {
    this.handledFocusId = target.id;
    const dungeon = this.dungeons().find((item) => item.id === target.id);
    for (const key of ['dungeon', dungeon ? `dungeon:${this.stateOf(dungeon)}` : null]) {
      if (key && this.hidden().has(key)) this.toggleKey(key);
    }
    this.selectedId.set(target.id);
    setTimeout(() => this.shell().focus(target.x, target.y), 50);
  }

  private async resolveOrigin(name: string | null, x: number | null, y: number | null): Promise<void> {
    const kingdomId = this.kingdomId();
    const key = `${kingdomId}|${name ?? ''}|${x ?? ''}|${y ?? ''}`;
    if (key === this.resolvedOriginKey) return;
    this.resolvedOriginKey = key;
    if (name) {
      const castle = await this.locator.locate(name, kingdomId);
      if (key !== this.resolvedOriginKey) return;
      this.origin.set(castle ? { x: castle.x, y: castle.y, label: castle.playerName } : null);
      this.attackerId.set(castle?.playerId ?? null);
      return;
    }
    this.attackerId.set(null);
    this.origin.set(x !== null && y !== null ? { x, y, label: `${x} : ${y}` } : null);
  }

  private buildPoints(): RealmMapPoint[] {
    const hidden = this.hidden();
    if (hidden.has('dungeon')) return [];
    this.languageTick();
    const highlightAttacked = !hidden.has('dungeon:attacked');
    const title = this.translate('Forteresse');
    return this.dungeons()
      .filter((dungeon) => !hidden.has(`dungeon:${this.stateOf(dungeon)}`))
      .map((dungeon): RealmMapPoint => {
        const state = this.stateOf(dungeon);
        return {
          id: dungeon.id,
          x: dungeon.x,
          y: dungeon.y,
          shape: 'circle',
          color: STATE_COLORS[state],
          emphasis: this.emphasisOf(state),
          radius: DUNGEON_RADIUS,
          highlighted: highlightAttacked && this.isAttackedByOrigin(dungeon),
          title,
          subtitle: this.stateText(dungeon),
        };
      });
  }

  private buildLegend(): RealmMapLegendGroup[] {
    this.languageTick();
    const hidden = this.hidden();
    const counts = new Map<DungeonState, number>();
    this.dungeons().forEach((dungeon) => {
      const state = this.stateOf(dungeon);
      counts.set(state, (counts.get(state) ?? 0) + 1);
    });
    const items: RealmMapLegendItem[] = STATE_ORDER.filter((state) => counts.has(state)).map((state) => ({
      key: `dungeon:${state}`,
      label: this.translate(STATE_LABELS[state]),
      color: STATE_COLORS[state],
      shape: 'circle',
      emphasis: this.emphasisOf(state),
      count: counts.get(state) ?? 0,
      hidden: hidden.has(`dungeon:${state}`),
    }));
    const attacked = this.dungeons().filter((dungeon) => this.isAttackedByOrigin(dungeon)).length;
    const origin = this.origin();
    if (attacked > 0 && origin) {
      items.push({
        key: 'dungeon:attacked',
        label: origin.label,
        color: REALM_MAP_HIGHLIGHT_COLOR,
        shape: 'circle',
        emphasis: 'faded',
        count: attacked,
        hidden: hidden.has('dungeon:attacked'),
      });
    }
    const realm = this.realm();
    return [
      {
        key: 'dungeon',
        label: this.translate(realm.name),
        icon: realm.icon,
        count: this.dungeons().length,
        hidden: hidden.has('dungeon'),
        items,
      },
    ];
  }

  private buildNearest(): RealmMapNearest[] {
    const origin = this.origin();
    const hidden = this.hidden();
    if (!origin || hidden.has('dungeon') || hidden.has('dungeon:ready')) return [];
    const icon = this.realm().icon;
    return this.dungeons()
      .filter((dungeon) => this.stateOf(dungeon) === 'ready')
      .map((dungeon) => ({
        id: dungeon.id,
        x: dungeon.x,
        y: dungeon.y,
        label: `${dungeon.x} : ${dungeon.y}`,
        icon,
        distance: this.wrappedDistance(dungeon, origin),
        color: STATE_COLORS.ready,
        shape: 'circle' as const,
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEAREST_LIMIT);
  }

  private emphasisOf(state: DungeonState): RealmMapEmphasis {
    return state === 'cooldown' ? 'faded' : 'solid';
  }

  private stateText(dungeon: DungeonItem): string {
    const state = this.stateOf(dungeon);
    if (state === 'ready') return this.translate('Attaquable');
    const time = new Date(dungeon.availableAt).toLocaleTimeString(this.translateService.currentLang || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const attacker = dungeon.attackerName ? ` · ${dungeon.attackerName}` : '';
    return `${this.translate('En recharge')} · ${time}${attacker}`;
  }

  private translate(key: string): string {
    return this.translateService.instant(key) as string;
  }

  private toItem(dungeon: ApiDungeonsResource): DungeonItem {
    return {
      id: `${dungeon.kid}:${dungeon.position_x}:${dungeon.position_y}`,
      x: dungeon.position_x,
      y: dungeon.position_y,
      attackerId: dungeon.player_id ? String(dungeon.player_id) : null,
      attackerName: dungeon.player_name ?? null,
      lastAttack: dungeon.last_attack ?? null,
      availableDurationSeconds: dungeon.available_duration_seconds ?? 0,
      effectiveCooldownUntil: dungeon.effective_cooldown_until,
      availableAt: new Date(dungeon.effective_cooldown_until).getTime(),
    };
  }

  private restoreHidden(): void {
    try {
      const stored: unknown = JSON.parse(this.localStorage.getItem('dungeonMapHidden') ?? '[]');
      if (Array.isArray(stored)) this.hidden.set(new Set(stored.filter((key) => typeof key === 'string')));
    } catch {
      this.hidden.set(new Set());
    }
  }
}
