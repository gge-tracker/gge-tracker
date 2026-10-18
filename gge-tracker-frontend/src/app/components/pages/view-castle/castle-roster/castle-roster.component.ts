/* eslint-disable unicorn/consistent-function-scoping */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { LayeredSceneComponent } from '@ggetracker-components/layered-scene/layered-scene.component';
import { ApiPlayerCastleNameResponse, ApiPlayerSuggestion } from '@ggetracker-interfaces/empire-ranking';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { TranslatePipe } from '@ngx-translate/core';
import { ArrowRight, LucideAngularModule, Lock, MapPin, Search, Shuffle, X } from 'lucide-angular';
import { debounceTime, distinctUntilChanged, Subject, switchMap } from 'rxjs';

export interface RosterCastle {
  castle: ApiPlayerCastleNameResponse;
  image: string;
  typeLabel: string;
}

export interface RosterPlayerPick {
  id: number;
  name: string;
}

interface Realm {
  id: number;
  name: string;
  icon: string;
}

interface Defence {
  key: string;
  label: string;
  image: string | null;
  fallback: string;
  level: string;
}

const MIN_QUERY_LENGTH = 2;
const SUGGESTION_DEBOUNCE_MS = 200;
const MAP_SIZE = 1286;
const PLACEHOLDER_COUNT = 6;

const REALMS: Realm[] = [
  { id: 0, name: 'Le Grand Empire', icon: 'assets/dungeon0.png' },
  { id: 2, name: 'Le Glacier éternel', icon: 'assets/dungeon2.png' },
  { id: 1, name: 'Les Sables brûlants', icon: 'assets/dungeon1.png' },
  { id: 3, name: 'Les Pics du feu', icon: 'assets/dungeon3.png' },
];

@Component({
  selector: 'app-castle-roster',
  standalone: true,
  imports: [FormsModule, TranslatePipe, LucideAngularModule, LayeredSceneComponent, FormatNumberPipe],
  templateUrl: './castle-roster.component.html',
  styleUrl: './castle-roster.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CastleRosterComponent implements OnInit {
  public readonly castles = input.required<RosterCastle[]>();
  public readonly loading = input(false);
  public readonly owner = input('');
  public readonly initialQuery = input('');

  public readonly searchName = output<string>();
  public readonly pickPlayer = output<RosterPlayerPick>();
  public readonly openCastle = output<ApiPlayerCastleNameResponse>();
  public readonly shuffle = output<void>();

  public readonly Search = Search;
  public readonly Clear = X;
  public readonly Shuffle = Shuffle;
  public readonly Pin = MapPin;
  public readonly Locked = Lock;
  public readonly Open = ArrowRight;

  public readonly placeholders = Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => index);
  public readonly suggestions = signal<ApiPlayerSuggestion[]>([]);
  public readonly activeIndex = signal(-1);
  public readonly realmFilter = signal<number | null>(null);
  public query = '';

  public readonly realms = computed(() => {
    const counts = new Map<number, number>();
    for (const { castle } of this.castles()) {
      counts.set(castle.kingdomId, (counts.get(castle.kingdomId) ?? 0) + 1);
    }
    return REALMS.filter((realm) => counts.has(realm.id)).map((realm) => ({ ...realm, count: counts.get(realm.id)! }));
  });

  public readonly visibleCastles = computed(() => {
    const realm = this.realmFilter();
    const castles = this.castles();
    return realm === null ? castles : castles.filter(({ castle }) => castle.kingdomId === realm);
  });

  private readonly apiRestService = inject(ApiRestService);
  private readonly typed = new Subject<string>();

  constructor() {
    this.typed
      .pipe(
        debounceTime(SUGGESTION_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((term) => this.fetchSuggestions(term)),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((suggestions) => {
        this.suggestions.set(suggestions);
        this.activeIndex.set(-1);
      });
  }

  public ngOnInit(): void {
    this.query = this.initialQuery();
  }

  public onQueryChange(term: string): void {
    if (term.trim().length < MIN_QUERY_LENGTH) this.suggestions.set([]);
    this.typed.next(term.trim());
  }

  public navigate(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closeSuggestions();
      return;
    }
    const total = this.suggestions().length;
    if (total === 0 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const current = this.activeIndex();
    this.activeIndex.set(current === -1 ? (step > 0 ? 0 : total - 1) : (current + step + total) % total);
  }

  public submit(): void {
    const active = this.suggestions()[this.activeIndex()];
    if (active) {
      this.pick(active);
      return;
    }
    this.closeSuggestions();
    this.realmFilter.set(null);
    this.searchName.emit(this.query.trim());
  }

  public pick(suggestion: ApiPlayerSuggestion): void {
    this.closeSuggestions();
    this.query = suggestion.name;
    this.realmFilter.set(null);
    this.pickPlayer.emit({ id: Number(suggestion.id), name: suggestion.name });
  }

  public reset(): void {
    this.query = '';
    this.closeSuggestions();
    this.realmFilter.set(null);
    this.searchName.emit('');
  }

  public closeSuggestions(): void {
    this.suggestions.set([]);
    this.activeIndex.set(-1);
  }

  public toggleRealm(realmId: number | null): void {
    this.realmFilter.set(this.realmFilter() === realmId ? null : realmId);
  }

  public realmOf(castle: ApiPlayerCastleNameResponse): Realm | undefined {
    return REALMS.find((realm) => realm.id === castle.kingdomId);
  }

  public mapPosition(value: number): string {
    return `${Math.min(100, Math.max(0, (value / MAP_SIZE) * 100))}%`;
  }

  public defencesOf(castle: ApiPlayerCastleNameResponse): Defence[] {
    const moatTier = castle.moatLevel > 4 ? castle.moatLevel - 4 : castle.moatLevel;
    return [
      this.defence('wall', 'castle-roster-wall', castle.wallLevel, `wall_level_${castle.wallLevel}`, 'wall_level_1'),
      this.defence('gate', 'castle-roster-gate', castle.gateLevel, `gate_level_${castle.gateLevel}`, 'gate_level_1'),
      this.defence(
        'tower',
        'castle-roster-tower',
        castle.towerLevel,
        `tower_level_${castle.towerLevel}`,
        'tower_level_1',
      ),
      {
        ...this.defence(
          'moat',
          'castle-roster-moat',
          castle.moatLevel,
          `moat_classic_level_${moatTier}`,
          'moat_classic_level_1',
        ),
        level: castle.moatLevel > 4 ? `${moatTier}★` : String(castle.moatLevel ?? 0),
      },
    ];
  }

  private defence(key: string, label: string, level: number, asset: string, fallback: string): Defence {
    return {
      key,
      label,
      image: level > 0 ? `/assets/object/${asset}.png` : null,
      fallback: `/assets/object/${fallback}.png`,
      level: String(level ?? 0),
    };
  }

  private async fetchSuggestions(term: string): Promise<ApiPlayerSuggestion[]> {
    if (term.length < MIN_QUERY_LENGTH) return [];
    const response = await this.apiRestService.getPlayerSuggestions(term);
    return response.success ? response.data.suggestions.slice(0, 8) : [];
  }
}
