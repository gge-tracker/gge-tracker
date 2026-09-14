/* eslint-disable unicorn/consistent-function-scoping */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { ApiAllianceProfile, ApiPlayerProfile } from '@ggetracker-interfaces/empire-ranking';
import { TranslateModule } from '@ngx-translate/core';
import { ArrowLeftRight, LucideAngularModule } from 'lucide-angular';
import { combineLatest } from 'rxjs';

import {
  CompareContender,
  CompareContenderComponent,
  CompareSubject,
} from './compare-contender/compare-contender.component';
import { CompareLootComponent } from './compare-loot/compare-loot.component';
import { CompareMightComponent } from './compare-might/compare-might.component';
import { ALLIANCE_METRICS, buildMetricRows, CompareMetricRow, CompareSide, PLAYER_METRICS } from './compare-metrics';
import { CompareTapeComponent } from './compare-tape/compare-tape.component';

type LoadedProfile =
  { subject: 'players'; profile: ApiPlayerProfile } | { subject: 'alliances'; profile: ApiAllianceProfile };
type Pair<T> = [T, T];

const SUBJECTS = new Set<string>(['players', 'alliances']);
const SIDE_PARAMS: Pair<string> = ['a', 'b'];

@Component({
  selector: 'app-compare',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslateModule,
    LucideAngularModule,
    CompareContenderComponent,
    CompareTapeComponent,
    CompareMightComponent,
    CompareLootComponent,
  ],
  templateUrl: './compare.component.html',
  styleUrl: './compare.component.css',
})
export class CompareComponent extends GenericComponent implements OnInit {
  public readonly ArrowLeftRight = ArrowLeftRight;
  public readonly subjectTabs: { key: CompareSubject; label: string; icon: string }[] = [
    { key: 'players', label: 'Joueurs', icon: '/assets/tools/players.webp' },
    { key: 'alliances', label: 'Alliances', icon: '/assets/tools/alliances.webp' },
  ];

  public readonly subject = signal<CompareSubject>('players');
  public readonly ids = signal<Pair<string | null>>([null, null]);
  public readonly profiles = signal<Pair<LoadedProfile | null>>([null, null]);
  public readonly loading = signal<Pair<boolean>>([false, false]);
  public readonly errors = signal<Pair<string | null>>([null, null]);

  public readonly contenders = computed(
    () => this.profiles().map((loaded) => this.toContender(loaded)) as Pair<CompareContender | null>,
  );
  public readonly names = computed(() => this.contenders().map((contender) => contender?.name ?? '') as Pair<string>);
  public readonly readyIds = computed(() => {
    const [a, b] = this.contenders();
    return a && b ? ([a.id, b.id] as Pair<string>) : null;
  });
  public readonly rows = computed<CompareMetricRow[] | null>(() => {
    const [a, b] = this.profiles();
    if (!a || !b || a.subject !== b.subject) return null;
    return a.subject === 'players'
      ? buildMetricRows(PLAYER_METRICS, a.profile, b.profile as ApiPlayerProfile)
      : buildMetricRows(ALLIANCE_METRICS, a.profile, b.profile as ApiAllianceProfile);
  });
  public readonly hint = computed(() =>
    this.subject() === 'players'
      ? 'Choisissez deux joueurs pour les comparer'
      : 'Choisissez deux alliances pour les comparer',
  );

  private readonly destroyRef = inject(DestroyRef);
  private readonly cache = new Map<string, LoadedProfile>();

  public ngOnInit(): void {
    setTimeout(() => (this.isInLoading = false));
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([parameters, query]) => {
        const subject = parameters.get('type') as CompareSubject;
        if (!SUBJECTS.has(subject)) {
          void this.router.navigate(['/compare', 'players'], { replaceUrl: true });
          return;
        }
        this.applyRoute(subject, [query.get('a'), query.get('b')]);
      });
  }

  public async searchName(side: CompareSide, name: string): Promise<void> {
    this.patch(this.loading, side, true);
    this.patch(this.errors, side, null);
    const id = await this.findIdByName(name);
    this.patch(this.loading, side, false);
    if (id === null) {
      this.patch(this.errors, side, this.notFoundMessage());
      return;
    }
    this.navigateIds({ [SIDE_PARAMS[side]]: id });
  }

  public clear(side: CompareSide): void {
    this.navigateIds({ [SIDE_PARAMS[side]]: null });
  }

  public swap(): void {
    const [a, b] = this.ids();
    this.navigateIds({ a: b, b: a });
  }

  private applyRoute(subject: CompareSubject, ids: Pair<string | null>): void {
    if (subject !== this.subject()) {
      this.profiles.set([null, null]);
      this.errors.set([null, null]);
    }
    this.subject.set(subject);
    this.ids.set(ids);
    if (!this.isBrowser) return;
    for (const side of [0, 1] as CompareSide[]) {
      void this.loadSide(side, ids[side]);
    }
  }

  private async loadSide(side: CompareSide, id: string | null): Promise<void> {
    const subject = this.subject();
    const current = this.profiles()[side];
    if (id === null) {
      this.patch(this.profiles, side, null);
      this.patch(this.loading, side, false);
      return;
    }
    if (current && this.idOf(current) === id) return;

    const cached = this.cache.get(`${subject}:${id}`);
    if (cached) {
      this.patch(this.profiles, side, cached);
      this.patch(this.loading, side, false);
      this.patch(this.errors, side, null);
      return;
    }
    this.patch(this.profiles, side, null);
    this.patch(this.loading, side, true);
    const loaded = await this.fetchProfile(subject, id);
    if (this.ids()[side] !== id || this.subject() !== subject) return;
    this.patch(this.loading, side, false);
    if (!loaded) {
      this.patch(this.errors, side, this.notFoundMessage());
      return;
    }
    this.cache.set(`${subject}:${id}`, loaded);
    this.patch(this.errors, side, null);
    this.patch(this.profiles, side, loaded);
  }

  private async fetchProfile(subject: CompareSubject, id: string): Promise<LoadedProfile | null> {
    if (subject === 'players') {
      const response = await this.apiRestService.getPlayerProfile(id, 'rank,castles');
      return response.success ? { subject, profile: response.data } : null;
    }
    const response = await this.apiRestService.getAllianceProfile(id);
    return response.success ? { subject, profile: response.data } : null;
  }

  private async findIdByName(name: string): Promise<string | null> {
    const encoded = encodeURIComponent(name);
    if (this.subject() === 'players') {
      const response = await this.apiRestService.getPlayer(encoded);
      return response.success ? String(response.data.player_id) : null;
    }
    const response = await this.apiRestService.getAllianceByName(encoded);
    return response.success ? String(response.data.alliance_id) : null;
  }

  private navigateIds(ids: Partial<Record<string, string | null>>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: ids, queryParamsHandling: 'merge' });
  }

  private notFoundMessage(): string {
    return this.subject() === 'players' ? 'Aucun joueur trouvé' : 'Aucune alliance trouvée';
  }

  private idOf(loaded: LoadedProfile): string {
    return loaded.subject === 'players' ? loaded.profile.player.player_id : loaded.profile.alliance.alliance_id;
  }

  private toContender(loaded: LoadedProfile | null): CompareContender | null {
    if (!loaded) return null;
    if (loaded.subject === 'alliances') {
      const { alliance, server } = loaded.profile;
      return {
        id: alliance.alliance_id,
        name: alliance.alliance_name,
        server,
        profileLink: ['/alliance', alliance.alliance_id],
        detail: null,
        detailLink: null,
        level: null,
      };
    }
    const { player, server } = loaded.profile;
    return {
      id: player.player_id,
      name: player.player_name,
      server,
      profileLink: ['/player', player.player_id],
      detail: player.alliance_name ?? 'Sans alliance',
      detailLink: player.alliance_id ? ['/alliance', player.alliance_id] : null,
      level: { level: player.level, legendary: player.legendary_level },
    };
  }

  private patch<T>(target: WritableSignal<Pair<T>>, side: CompareSide, value: T): void {
    target.update((pair) => {
      const next = [...pair] as Pair<T>;
      next[side] = value;
      return next;
    });
  }
}
