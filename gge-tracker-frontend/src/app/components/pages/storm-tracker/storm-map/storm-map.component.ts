/* eslint-disable unicorn/consistent-function-scoping */
import { DecimalPipe } from '@angular/common';
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
  RealmMapColorMode,
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
import { extentAround, fetchAllPages } from '@ggetracker-components/realm-map/realm-map-paging';
import { ApiStormFort, ApiStormIsle, ErrorType, StormIsleState } from '@ggetracker-interfaces/empire-ranking';
import { CooldownPipe } from '@ggetracker-pipes/cooldown.pipe';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LocalStorageService } from '@ggetracker-services/local-storage.service';
import { RealmCastleLocatorService } from '@ggetracker-services/realm-castle-locator.service';
import { ToastService } from '@ggetracker-services/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  getStormFortDefinition,
  getStormIsleDefinition,
  getStormIsleImage,
  getStormResourceLabel,
  STORM_FORT_IMAGE,
  StormFortDefinition,
  StormIsleDefinition,
  StormResource,
} from '../../../../definitions/storm-isles.definition';

type FortCategory = 'ready' | 'soon' | 'cooldown' | 'spent';
type IsleCategory = 'ready' | 'held' | 'cooldown';
type ColorMode = 'state' | 'type';

interface StormFortItem {
  id: string;
  x: number;
  y: number;
  attacksLeft: number;
  victoryCount: number;
  effectiveCooldownUntil: string;
  availableAt: number;
  definition: StormFortDefinition | null;
}

interface StormIsleItem {
  id: string;
  x: number;
  y: number;
  isleId: number;
  state: StormIsleState;
  occupierId: string | null;
  occupierName: string | null;
  occupierAllianceName: string | null;
  effectiveCooldownUntil: string;
  availableAt: number;
  definition: StormIsleDefinition | null;
}

interface Category {
  key: string;
  label: string;
  color: string;
  emphasis: RealmMapEmphasis;
}

export interface StormMapFocus {
  id: string;
  x: number;
  y: number;
}

const STORM_KINGDOM_ID = 4;
const MAX_PAGE_SIZE = 4000;
const SOON_MS = 3_600_000;
const REFRESH_MS = 120_000;
const TICK_MS = 20_000;
const NEAREST_LIMIT = 6;
const FORT_RADIUS = 4.4;
const ISLE_RADIUS = 3.4;
const ISLE_ICON = 'assets/storm-tracker/village/6.png';
const LEVEL_COLORS: Record<number, string> = {
  40: '#bdbdbd',
  50: '#81c784',
  60: '#42a5f5',
  70: '#ce93d8',
  80: '#ffb300',
};
const RESOURCE_COLORS: Record<StormResource, string> = {
  aquamarine: '#26c6da',
  stone: '#cbc6c1',
  wood: '#e0b877',
};

@Component({
  selector: 'app-storm-map',
  standalone: true,
  imports: [RealmMapShellComponent, TranslateModule, DecimalPipe, CooldownPipe],
  templateUrl: './storm-map.component.html',
  styleUrls: ['../../../realm-map/realm-map-detail.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StormMapComponent implements OnInit {
  public readonly originPlayerName = input<string | null>(null);
  public readonly originX = input<number | null>(null);
  public readonly originY = input<number | null>(null);
  public readonly focusTarget = input<StormMapFocus | null>(null);
  public readonly lastScanAt = input<string | null>(null);
  public readonly originChange = output<RealmMapLocateRequest | null>();

  public readonly rings = [25, 50, 100];
  public readonly maxVictories = 10;
  public readonly fortImage = STORM_FORT_IMAGE;
  public readonly getStormIsleImage = getStormIsleImage;
  public readonly getStormResourceLabel = getStormResourceLabel;
  public readonly StormIsleState = StormIsleState;

  public readonly forts = signal<StormFortItem[]>([]);
  public readonly isles = signal<StormIsleItem[]>([]);
  public readonly loading = signal(false);
  public readonly selectedId = signal<string | null>(null);
  public readonly colorMode = signal<ColorMode>('state');
  public readonly hidden = signal<ReadonlySet<string>>(new Set());
  public readonly origin = signal<RealmMapOrigin | null>(null);

  public readonly extent = computed(() => extentAround([...this.forts(), ...this.isles()], 15, REALM_WORLD_EXTENT));
  public readonly originQuery = computed(() => {
    const x = this.originX();
    const y = this.originY();
    return this.originPlayerName() ?? (x !== null && y !== null ? `${x}:${y}` : '');
  });
  public readonly colorModes = computed<RealmMapColorMode[]>(() => {
    this.languageTick();
    return [
      { value: 'state', label: this.translate('Etat') },
      { value: 'type', label: this.translate('Type') },
    ];
  });
  public readonly points = computed(() => this.buildPoints());
  public readonly legend = computed(() => this.buildLegend());
  public readonly nearest = computed(() => this.buildNearest());
  public readonly selectedFort = computed(() => this.forts().find((fort) => fort.id === this.selectedId()) ?? null);
  public readonly selectedIsle = computed(() => this.isles().find((isle) => isle.id === this.selectedId()) ?? null);

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
  private readonly ownerId = signal<string | null>(null);
  private resolvedOriginKey = '';
  private handledFocusId: string | null = null;

  constructor() {
    this.restoreSettings();
    effect(() => {
      const name = this.originPlayerName();
      const x = this.originX();
      const y = this.originY();
      untracked(() => void this.resolveOrigin(name, x, y));
    });
    effect(() => {
      const target = this.focusTarget();
      const loaded = this.forts().length + this.isles().length > 0;
      if (target && loaded && target.id !== this.handledFocusId) untracked(() => this.focusOn(target));
    });
    this.translateService.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.languageTick.update((tick) => tick + 1));
  }

  public ngOnInit(): void {
    void this.reload();
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
    this.loading.set(true);
    try {
      const [fortPages, islePages] = await Promise.all([
        fetchAllPages((page) => this.apiRestService.getStormFortsList({ page, size: MAX_PAGE_SIZE })),
        fetchAllPages((page) => this.apiRestService.getStormIslesList({ page, size: MAX_PAGE_SIZE })),
      ]);
      this.forts.set(fortPages.flatMap((page) => page.forts).map((fort) => this.toFortItem(fort)));
      this.isles.set(islePages.flatMap((page) => page.isles).map((isle) => this.toIsleItem(isle)));
      this.now.set(Date.now());
    } catch {
      this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
    } finally {
      this.loading.set(false);
    }
  }

  public async onLocate(request: RealmMapLocateRequest): Promise<void> {
    if (request.kind === 'coords') {
      this.originChange.emit(request);
      return;
    }
    const castle = await this.locator.locate(request.name, STORM_KINGDOM_ID);
    if (!castle) {
      this.toastService.add(ErrorType.NO_PLAYER_FOUND, 5000);
      return;
    }
    this.originChange.emit({ kind: 'player', name: castle.playerName });
  }

  public onClearOrigin(): void {
    this.originChange.emit(null);
  }

  public setColorMode(mode: string): void {
    const colorMode: ColorMode = mode === 'type' ? 'type' : 'state';
    this.colorMode.set(colorMode);
    this.localStorage.setItem('stormMapColorMode', colorMode);
  }

  public toggleKey(key: string): void {
    const hidden = new Set(this.hidden());
    if (hidden.has(key)) {
      hidden.delete(key);
    } else {
      hidden.add(key);
    }
    this.hidden.set(hidden);
    this.localStorage.setItem('stormMapHidden', JSON.stringify([...hidden]));
  }

  public copyCoordinates(x: number, y: number): void {
    globalThis.navigator.clipboard
      .writeText(`${x}:${y}`)
      .then(() => this.toastService.add(ErrorType.COPIED_TO_CLIPBOARD, 3000, 'info'))
      .catch(() => this.toastService.add(ErrorType.ERROR_OCCURRED, 5000));
  }

  public distanceTo(item: { x: number; y: number }): number | null {
    const origin = this.origin();
    return origin ? Math.hypot(item.x - origin.x, item.y - origin.y) : null;
  }

  public fortCategoryOf(fort: StormFortItem): FortCategory {
    if (fort.attacksLeft <= 0) return 'spent';
    const wait = fort.availableAt - this.now();
    if (wait <= 0) return 'ready';
    return wait <= SOON_MS ? 'soon' : 'cooldown';
  }

  public isleCategoryOf(isle: StormIsleItem): IsleCategory {
    if (isle.state === StormIsleState.OCCUPIED) return 'held';
    if (isle.state === StormIsleState.RESPAWNING && isle.availableAt > this.now()) return 'cooldown';
    return 'ready';
  }

  public isOwnedIsle(isle: StormIsleItem): boolean {
    const ownerId = this.ownerId();
    return ownerId !== null && isle.occupierId === ownerId;
  }

  private focusOn(target: StormMapFocus): void {
    this.handledFocusId = target.id;
    const fort = this.forts().find((item) => item.id === target.id);
    const isle = fort ? undefined : this.isles().find((item) => item.id === target.id);
    const categoryKey = fort ? this.fortCategory(fort).key : isle ? this.isleCategory(isle).key : null;
    for (const key of [target.id.split(':')[0], categoryKey]) {
      if (key && this.hidden().has(key)) this.toggleKey(key);
    }
    this.selectedId.set(target.id);
    setTimeout(() => this.shell().focus(target.x, target.y), 50);
  }

  private async resolveOrigin(name: string | null, x: number | null, y: number | null): Promise<void> {
    const key = `${name ?? ''}|${x ?? ''}|${y ?? ''}`;
    if (key === this.resolvedOriginKey) return;
    this.resolvedOriginKey = key;
    if (name) {
      const castle = await this.locator.locate(name, STORM_KINGDOM_ID);
      if (key !== this.resolvedOriginKey) return;
      this.origin.set(castle ? { x: castle.x, y: castle.y, label: castle.playerName } : null);
      this.ownerId.set(castle?.playerId ?? null);
      return;
    }
    this.ownerId.set(null);
    this.origin.set(x !== null && y !== null ? { x, y, label: `${x} : ${y}` } : null);
  }

  private buildPoints(): RealmMapPoint[] {
    const hidden = this.hidden();
    const points: RealmMapPoint[] = [];
    if (!hidden.has('fort')) {
      for (const fort of this.forts()) {
        const category = this.fortCategory(fort);
        if (hidden.has(category.key)) continue;
        points.push({
          id: fort.id,
          x: fort.x,
          y: fort.y,
          shape: 'diamond',
          color: category.color,
          emphasis: category.emphasis,
          radius: FORT_RADIUS,
          highlighted: false,
          title: this.fortTitle(fort),
          subtitle: this.fortStateText(fort),
        });
      }
    }
    if (!hidden.has('isle')) {
      const highlightOwned = !hidden.has('isle:owned');
      for (const isle of this.isles()) {
        const category = this.isleCategory(isle);
        if (hidden.has(category.key)) continue;
        points.push({
          id: isle.id,
          x: isle.x,
          y: isle.y,
          shape: 'circle',
          color: category.color,
          emphasis: category.emphasis,
          radius: ISLE_RADIUS,
          highlighted: highlightOwned && this.isOwnedIsle(isle),
          title: this.isleTitle(isle),
          subtitle: this.isleStateText(isle),
        });
      }
    }
    return points;
  }

  private buildLegend(): RealmMapLegendGroup[] {
    this.languageTick();
    const hidden = this.hidden();
    const fortItems = this.countByCategory(
      this.forts().map((fort) => this.fortCategory(fort)),
      'diamond',
      hidden,
    );
    const isleItems = this.countByCategory(
      this.isles().map((isle) => this.isleCategory(isle)),
      'circle',
      hidden,
    );
    const owned = this.isles().filter((isle) => this.isOwnedIsle(isle)).length;
    const origin = this.origin();
    if (owned > 0 && origin) {
      isleItems.push({
        key: 'isle:owned',
        label: origin.label,
        color: REALM_MAP_HIGHLIGHT_COLOR,
        shape: 'circle',
        emphasis: 'faded',
        count: owned,
        hidden: hidden.has('isle:owned'),
      });
    }
    return [
      {
        key: 'fort',
        label: this.translate('Forteresses des tempêtes'),
        icon: STORM_FORT_IMAGE,
        count: this.forts().length,
        hidden: hidden.has('fort'),
        items: fortItems,
      },
      {
        key: 'isle',
        label: this.translate('Îles de ressources'),
        icon: ISLE_ICON,
        count: this.isles().length,
        hidden: hidden.has('isle'),
        items: isleItems,
      },
    ];
  }

  private countByCategory(
    categories: Category[],
    shape: RealmMapLegendItem['shape'],
    hidden: ReadonlySet<string>,
  ): RealmMapLegendItem[] {
    const items = new Map<string, RealmMapLegendItem>();
    for (const category of categories) {
      const item = items.get(category.key);
      if (item) {
        item.count++;
      } else {
        items.set(category.key, { ...category, shape, count: 1, hidden: hidden.has(category.key) });
      }
    }
    return [...items.values()].sort((a, b) => this.categoryRank(a.key) - this.categoryRank(b.key));
  }

  private categoryRank(key: string): number {
    const order = ['ready', 'soon', 'held', 'cooldown', 'spent', 'aquamarine', 'stone', 'wood', 'owned'];
    const suffix = key.split(':')[1] ?? '';
    const level = /^level-(\d+)$/.exec(suffix);
    if (level) return Number(level[1]);
    const index = order.indexOf(suffix);
    return index === -1 ? order.length : index;
  }

  private buildNearest(): RealmMapNearest[] {
    const origin = this.origin();
    if (!origin) return [];
    this.languageTick();
    const hidden = this.hidden();
    const targets: RealmMapNearest[] = [];
    if (!hidden.has('fort')) {
      for (const fort of this.forts()) {
        const category = this.fortCategory(fort);
        if (this.fortCategoryOf(fort) !== 'ready' || hidden.has(category.key)) continue;
        targets.push(this.nearestEntry(fort, origin, this.fortTitle(fort), STORM_FORT_IMAGE, 'diamond', category));
      }
    }
    if (!hidden.has('isle')) {
      for (const isle of this.isles()) {
        const category = this.isleCategory(isle);
        if (this.isleCategoryOf(isle) !== 'ready' || hidden.has(category.key)) continue;
        const icon = getStormIsleImage(isle.isleId);
        targets.push(this.nearestEntry(isle, origin, this.isleTitle(isle), icon, 'circle', category));
      }
    }
    return targets.sort((a, b) => a.distance - b.distance).slice(0, NEAREST_LIMIT);
  }

  private nearestEntry(
    item: { id: string; x: number; y: number },
    origin: RealmMapOrigin,
    label: string,
    icon: string,
    shape: RealmMapNearest['shape'],
    category: Category,
  ): RealmMapNearest {
    const distance = Math.hypot(item.x - origin.x, item.y - origin.y);
    return { id: item.id, x: item.x, y: item.y, label, icon, distance, shape, color: category.color };
  }

  private fortCategory(fort: StormFortItem): Category {
    const state = this.fortCategoryOf(fort);
    if (this.colorMode() === 'type') {
      const level = fort.definition?.level ?? 0;
      return {
        key: `fort:level-${level}`,
        label: level ? `${this.translate('Niveau')} ${level}` : this.translate('Inconnu'),
        color: LEVEL_COLORS[level] ?? '#9aa3ad',
        emphasis: state === 'ready' ? 'solid' : 'faded',
      };
    }
    const labels: Record<FortCategory, string> = {
      ready: 'Attaquable',
      soon: 'Bientôt attaquable (< 1h)',
      cooldown: 'En réapparition',
      spent: 'Coulée',
    };
    const colors: Record<FortCategory, string> = {
      ready: REALM_MAP_STATE_COLORS.ready,
      soon: REALM_MAP_STATE_COLORS.soon,
      cooldown: REALM_MAP_STATE_COLORS.cooldown,
      spent: REALM_MAP_STATE_COLORS.spent,
    };
    return {
      key: `fort:${state}`,
      label: this.translate(labels[state]),
      color: colors[state],
      emphasis: state === 'ready' || state === 'soon' ? 'solid' : 'faded',
    };
  }

  private isleCategory(isle: StormIsleItem): Category {
    const state = this.isleCategoryOf(isle);
    if (this.colorMode() === 'type') {
      const resource = isle.definition?.resource;
      return {
        key: `isle:${resource ?? 'unknown'}`,
        label: this.translate(resource ? getStormResourceLabel(resource) : 'Inconnu'),
        color: resource ? RESOURCE_COLORS[resource] : '#9aa3ad',
        emphasis: state === 'ready' ? 'solid' : 'faded',
      };
    }
    const labels: Record<IsleCategory, string> = { ready: 'Libre', held: 'Occupée', cooldown: 'En réapparition' };
    const colors: Record<IsleCategory, string> = {
      ready: REALM_MAP_STATE_COLORS.ready,
      held: REALM_MAP_STATE_COLORS.held,
      cooldown: REALM_MAP_STATE_COLORS.cooldown,
    };
    return {
      key: `isle:${state}`,
      label: this.translate(labels[state]),
      color: colors[state],
      emphasis: state === 'cooldown' ? 'faded' : 'solid',
    };
  }

  private fortTitle(fort: StormFortItem): string {
    return fort.definition ? `${this.translate('Niveau')} ${fort.definition.level}` : this.translate('Inconnu');
  }

  private isleTitle(isle: StormIsleItem): string {
    return this.translate(isle.definition ? getStormResourceLabel(isle.definition.resource) : 'Inconnu');
  }

  private fortStateText(fort: StormFortItem): string {
    const state = this.fortCategoryOf(fort);
    if (state === 'spent') return this.translate('Coulée');
    if (state === 'ready') return `${this.translate('Attaquable')} · ${fort.attacksLeft}/${this.maxVictories}`;
    return `${this.translate('En réapparition')} · ${this.clockTime(fort.availableAt)}`;
  }

  private isleStateText(isle: StormIsleItem): string {
    const state = this.isleCategoryOf(isle);
    if (state === 'held') return `${this.translate('Occupée')} · ${isle.occupierName ?? '?'}`;
    if (state === 'cooldown') return `${this.translate('En réapparition')} · ${this.clockTime(isle.availableAt)}`;
    return this.translate('Libre');
  }

  private clockTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString(this.translateService.currentLang || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private translate(key: string): string {
    return this.translateService.instant(key) as string;
  }

  private toFortItem(fort: ApiStormFort): StormFortItem {
    return {
      id: `fort:${fort.position_x}:${fort.position_y}`,
      x: fort.position_x,
      y: fort.position_y,
      attacksLeft: fort.attacks_left,
      victoryCount: fort.victory_count,
      effectiveCooldownUntil: fort.available_at,
      availableAt: new Date(fort.available_at).getTime(),
      definition: getStormFortDefinition(fort.isle_id),
    };
  }

  private toIsleItem(isle: ApiStormIsle): StormIsleItem {
    return {
      id: `isle:${isle.position_x}:${isle.position_y}`,
      x: isle.position_x,
      y: isle.position_y,
      isleId: isle.isle_id,
      state: isle.state as StormIsleState,
      occupierId: isle.occupier_id === null ? null : String(isle.occupier_id),
      occupierName: isle.occupier_name,
      occupierAllianceName: isle.occupier_alliance_name,
      effectiveCooldownUntil: isle.available_at,
      availableAt: new Date(isle.available_at).getTime(),
      definition: getStormIsleDefinition(isle.isle_id),
    };
  }

  private restoreSettings(): void {
    if (this.localStorage.getItem('stormMapColorMode') === 'type') this.colorMode.set('type');
    try {
      const stored: unknown = JSON.parse(this.localStorage.getItem('stormMapHidden') ?? '[]');
      if (Array.isArray(stored)) this.hidden.set(new Set(stored.filter((key) => typeof key === 'string')));
    } catch {
      this.hidden.set(new Set());
    }
  }
}
