import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { HOME_ROUTE, SITE_NAVIGATION, SiteNavigationSection } from '@ggetracker-components/sidebar/site-navigation';
import {
  ApiAllianceHealthResponse,
  ApiAllianceProfile,
  ApiBulkAlliance,
  ApiBulkPlayer,
  ApiPlayerProfile,
  ApiPlayerStatsByPlayerId,
  ApiPlayerStatsSummary,
  ApiPlayerStatsType,
  ApiPlayerSuggestion,
} from '@ggetracker-interfaces/empire-ranking';
import { FollowService, SubjectSnapshot, VisitSnapshot } from '@ggetracker-services/follow.service';
import { ServerService } from '@ggetracker-services/server.service';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { KINGDOM_EVENTS } from '../compare/compare-events/compare-events.component';
import {
  Delta,
  MS_PER_DAY,
  MS_PER_WEEK,
  MembershipMoves,
  Sparkline,
  WeekEvent,
  deltaOf,
  eventsOfTheWeek,
  formatCompact,
  formatCountdown,
  formatSigned,
  formatSignedPercent,
  formatTopPercent,
  lootWeekOf,
  membershipMovesSince,
  nextWeeklyReset,
  readingsOf,
  sparklineOf,
  trendOf,
  valueAt,
} from './home-dashboard';

interface MightKpi {
  value: number;
  week: Delta | null;
  weekRatio: number | null;
  day: Delta | null;
  sparkline: Sparkline | null;
}

interface RankKpi {
  value: number | null;
  total: number | null;
  share: number | null;
  move: Delta | null;
}

interface LootKpi {
  value: number;
  rank: number | null;
  pace: Delta | null;
  paceRatio: number | null;
  lastWeekTotal: number | null;
  current: Sparkline | null;
  previous: Sparkline | null;
}

interface MeView {
  profile: ApiPlayerProfile;
  might: MightKpi;
  rank: RankKpi;
  loot: LootKpi;
}

interface Gainer {
  playerId: string;
  name: string;
  gain: number;
  isMe: boolean;
}

interface AllianceView {
  id: string;
  name: string;
  might: number;
  week: Delta | null;
  rank: number | null;
  rankedAlliances: number | null;
  members: number;
  moves: MembershipMoves;
  myMightRank: number | null;
  myLootRank: number | null;
  gainers: Gainer[];
}

interface FollowedPlayerView {
  player: ApiBulkPlayer;
  might: Delta | null;
}

interface FollowedAllianceView {
  alliance: ApiBulkAlliance;
  might: Delta | null;
  members: Delta | null;
}

const SUGGESTION_MIN_LENGTH = 2;
const SUGGESTION_DEBOUNCE_MS = 200;
const COUNTDOWN_REFRESH_MS = 30_000;
const TOP_GAINERS = 3;
// Covers the whole previous loot week, which the loot chart draws behind the current one
const SERIES_DAYS = 15;
// Early in the week last week's figure is tiny, and a percentage of it says nothing
const MIN_PACE_BASE_SHARE = 0.02;
// Only in-site pages: the home entry points to itself and external links belong to the sidebar
const [PRIMARY_EXPLORE_SECTION, ...OTHER_EXPLORE_SECTIONS] = SITE_NAVIGATION.map((section) => ({
  ...section,
  items: section.items.filter((item) => item.id && item.id !== HOME_ROUTE),
})).filter((section) => section.items.length > 0);
// Largest groups first after search, so the short ones share the last column instead of sitting alone
const EXPLORE_SECTIONS: SiteNavigationSection[] = [
  PRIMARY_EXPLORE_SECTION,
  ...OTHER_EXPLORE_SECTIONS.sort((a, b) => b.items.length - a.items.length),
];

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, DecimalPipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent extends GenericComponent implements OnInit, OnDestroy {
  public readonly follow = inject(FollowService);
  public readonly serverService = inject(ServerService);
  public readonly exploreSections = EXPLORE_SECTIONS;
  public readonly kpiSkeletons = [0, 1, 2];
  public readonly panelSkeletons = [0, 1];

  public readonly loading = signal(true);
  public readonly meView = signal<MeView | null>(null);
  public readonly weekEvents = signal<WeekEvent[] | null>(null);
  public readonly allianceView = signal<AllianceView | null>(null);
  public readonly followedPlayers = signal<FollowedPlayerView[]>([]);
  public readonly followedAlliances = signal<FollowedAllianceView[]>([]);
  public readonly previousVisitAt = signal<string | null>(null);
  public readonly countdown = signal('');

  public meQuery = '';
  public readonly suggestions = signal<ApiPlayerSuggestion[]>([]);
  public readonly meNotFound = signal(false);

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly queries = new Subject<string>();
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private resetAt: number | null = null;

  constructor() {
    super();
    // The shell has already checked its loading flag when the first route is created
    queueMicrotask(() => (this.isInLoading = false));
    this.queries
      .pipe(
        debounceTime(SUGGESTION_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((term) => this.fetchSuggestions(term)),
      )
      .subscribe((suggestions) => {
        this.suggestions.set(suggestions);
        this.meNotFound.set(this.meQuery.trim().length >= SUGGESTION_MIN_LENGTH && suggestions.length === 0);
        this.cdr.markForCheck();
      });
  }

  public get currentServer(): string {
    return this.serverService.currentServer?.name ?? '';
  }

  public get language(): string {
    return this.langageService.currentLang;
  }

  public get hasFollowed(): boolean {
    return this.followedPlayers().length > 0 || this.followedAlliances().length > 0;
  }

  public ngOnInit(): void {
    void this.load();
    if (this.isBrowser) {
      this.countdownTimer = setInterval(() => this.refreshCountdown(), COUNTDOWN_REFRESH_MS);
    }
  }

  public ngOnDestroy(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.queries.complete();
  }

  public onQueryChange(value: string): void {
    this.meQuery = value;
    if (value.trim().length < SUGGESTION_MIN_LENGTH) {
      this.suggestions.set([]);
      this.meNotFound.set(false);
    }
    this.queries.next(value.trim());
  }

  public pickMe(suggestion: ApiPlayerSuggestion): void {
    this.follow.setMe({ playerId: suggestion.id, playerName: suggestion.name, server: this.currentServer });
    this.meQuery = '';
    this.suggestions.set([]);
    void this.load();
  }

  public forgetMe(): void {
    this.follow.clearMe();
    this.meView.set(null);
    this.weekEvents.set(null);
    this.allianceView.set(null);
    void this.load();
  }

  public compact(value: number): string {
    return formatCompact(value);
  }

  public signed(value: number): string {
    return formatSigned(value);
  }

  public signedPercent(ratio: number): string {
    return formatSignedPercent(ratio, this.language);
  }

  public topShare(rank: RankKpi): string {
    return rank.value !== null && rank.total ? formatTopPercent(rank.value, rank.total, this.language) : '';
  }

  public arrow(trend: string): string {
    if (trend === 'up') return '▲';
    return trend === 'down' ? '▼' : '=';
  }

  public formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  }

  public formatDay(instant: number): string {
    return new Intl.DateTimeFormat(this.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(instant),
    );
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.cdr.markForCheck();
    const me = this.follow.me();
    const [meProfile, summary, series, players, alliances] = await Promise.all([
      me ? this.apiRestService.getPlayerProfile(me.playerId, 'rank') : Promise.resolve(null),
      me ? this.apiRestService.getPlayerStatsSummaryByPlayerId(Number(me.playerId)) : Promise.resolve(null),
      me
        ? this.apiRestService.getPlayerStatsSeriesByPlayerId(
            Number(me.playerId),
            [ApiPlayerStatsType.might, ApiPlayerStatsType.loot],
            SERIES_DAYS,
          )
        : Promise.resolve(null),
      this.readFollowedPlayers(me?.playerId),
      this.readFollowedAlliances(),
    ]);
    const profile = meProfile?.success ? meProfile.data : null;
    const [allianceProfile, pulse] = await this.readAlliance(profile?.player.alliance_id ?? null);

    const previous = this.follow.recordVisit(this.snapshotOf(profile, players, alliances));
    const now = Date.now();
    this.previousVisitAt.set(previous?.at ?? null);
    this.meView.set(profile ? this.toMeView(profile, series?.success ? series.data : null, previous, now) : null);
    this.weekEvents.set(profile && summary?.success ? this.toWeekEvents(summary.data, now) : null);
    this.allianceView.set(
      profile && allianceProfile ? this.toAllianceView(allianceProfile, pulse, profile.player.player_id, now) : null,
    );
    this.followedPlayers.set(
      players
        .map((player) => this.toFollowedPlayer(player, previous))
        .sort((a, b) => b.player.might_current - a.player.might_current),
    );
    this.followedAlliances.set(
      alliances
        .map((entry) => this.toFollowedAlliance(entry, previous))
        .sort((a, b) => b.alliance.might_current - a.alliance.might_current),
    );
    this.resetAt = profile ? nextWeeklyReset(now, profile.weekly_reset_offset_hours ?? null) : null;
    this.refreshCountdown();
    this.loading.set(false);
    this.cdr.markForCheck();
  }

  private async readAlliance(
    allianceId: string | null,
  ): Promise<[ApiAllianceProfile | null, ApiAllianceHealthResponse | null]> {
    if (!allianceId) return [null, null];
    const [profile, pulse] = await Promise.all([
      this.apiRestService.getAllianceProfile(allianceId, 'rank,members,member_changes'),
      this.apiRestService.getPlayerStatsPulsedForAlliance(Number(allianceId)),
    ]);
    return [profile.success ? profile.data : null, pulse.success ? pulse.data : null];
  }

  private async readFollowedPlayers(meId: string | undefined): Promise<ApiBulkPlayer[]> {
    const ids = this.follow.followedPlayers().filter((id) => id !== meId);
    if (ids.length === 0) return [];
    const response = await this.apiRestService.getPlayersBulk(ids.slice(0, 500));
    return response.success ? response.data.players : [];
  }

  private async readFollowedAlliances(): Promise<ApiBulkAlliance[]> {
    const ids = this.follow.followedAlliances();
    if (ids.length === 0) return [];
    const response = await this.apiRestService.getAlliancesBulk(ids.slice(0, 500));
    return response.success ? response.data.alliances : [];
  }

  private refreshCountdown(): void {
    if (this.resetAt === null) return;
    if (this.resetAt <= Date.now()) this.resetAt += MS_PER_WEEK;
    this.countdown.set(formatCountdown(this.resetAt - Date.now(), this.language));
    this.cdr.markForCheck();
  }

  private snapshotOf(
    profile: ApiPlayerProfile | null,
    players: ApiBulkPlayer[],
    alliances: ApiBulkAlliance[],
  ): Omit<VisitSnapshot, 'at'> {
    const snapshotPlayers: Record<string, SubjectSnapshot> = {};
    const snapshotAlliances: Record<string, SubjectSnapshot> = {};
    for (const player of players) snapshotPlayers[player.player_id] = { might: player.might_current };
    for (const entry of alliances) {
      snapshotAlliances[entry.alliance_id] = { might: entry.might_current, members: entry.player_count };
    }
    if (profile) {
      snapshotPlayers[profile.player.player_id] = {
        might: profile.player.might_current,
        loot: profile.player.loot_current,
        honor: profile.player.honor,
        rank: profile.rank?.might_current ?? null,
      };
    }
    return { players: snapshotPlayers, alliances: snapshotAlliances };
  }

  private toMeView(
    profile: ApiPlayerProfile,
    series: ApiPlayerStatsByPlayerId | null,
    previous: VisitSnapshot | null,
    now: number,
  ): MeView {
    const resetOffset = profile.weekly_reset_offset_hours ?? null;
    const mightReadings = readingsOf(series?.points[ApiPlayerStatsType.might]);
    const lootReadings = readingsOf(series?.points[ApiPlayerStatsType.loot]);
    const might = profile.player.might_current;
    const latestMight = mightReadings.at(-1) ?? null;
    const mightWeekAgo = latestMight ? valueAt(mightReadings, latestMight.at - MS_PER_WEEK) : null;
    const mightDayAgo = latestMight ? valueAt(mightReadings, latestMight.at - MS_PER_DAY) : null;
    const lootWeek = lootWeekOf(lootReadings, resetOffset, now);
    const lastWeek = lootWeek.sameTimeLastWeek;
    const paceHasBase = lastWeek !== null && lastWeek > (lootWeek.lastWeekTotal ?? 0) * MIN_PACE_BASE_SHARE;
    const rank = profile.rank?.might_current ?? null;
    const total = profile.rank?.ranked_players ?? null;
    return {
      profile,
      might: {
        value: might,
        week: deltaOf(latestMight?.value, mightWeekAgo),
        weekRatio: latestMight && mightWeekAgo ? (latestMight.value - mightWeekAgo) / mightWeekAgo : null,
        day: deltaOf(latestMight?.value, mightDayAgo),
        sparkline: sparklineOf(mightReadings, now - MS_PER_WEEK, now),
      },
      rank: {
        value: rank,
        total,
        share: rank !== null && total ? 1 - (rank - 1) / total : null,
        move: deltaOf(rank, previous?.players[profile.player.player_id]?.rank, true),
      },
      loot: {
        value: profile.player.loot_current,
        rank: profile.rank?.loot_current ?? null,
        pace: deltaOf(lootWeek.value, lastWeek),
        paceRatio: paceHasBase ? (lootWeek.value - lastWeek!) / lastWeek! : null,
        lastWeekTotal: lootWeek.lastWeekTotal,
        current: lootWeek.current,
        previous: lootWeek.previous,
      },
    };
  }

  private toWeekEvents(summary: ApiPlayerStatsSummary, now: number): WeekEvent[] {
    return eventsOfTheWeek(summary.events, KINGDOM_EVENTS, now);
  }

  private toAllianceView(
    profile: ApiAllianceProfile,
    pulse: ApiAllianceHealthResponse | null,
    myId: string,
    now: number,
  ): AllianceView {
    const members = profile.members ?? [];
    const names = new Map(members.map((member) => [member.player_id, member.player_name]));
    const hourly = pulse?.might_per_hour ?? [];
    const weekAgo = hourly.length > 0 ? Number(hourly[0].point) : null;
    const might = profile.statistics.might_current;
    const byLoot = [...members].sort((a, b) => b.loot_current - a.loot_current);
    const mightIndex = members.findIndex((member) => member.player_id === myId);
    const lootIndex = byLoot.findIndex((member) => member.player_id === myId);
    return {
      id: profile.alliance.alliance_id,
      name: profile.alliance.alliance_name,
      might,
      week: weekAgo === null ? null : { value: might - weekAgo, trend: trendOf(might - weekAgo) },
      rank: profile.rank?.might_current ?? null,
      rankedAlliances: profile.rank?.ranked_alliances ?? null,
      members: profile.statistics.player_count,
      moves: membershipMovesSince(profile.member_changes ?? [], now - MS_PER_WEEK),
      myMightRank: mightIndex === -1 ? null : mightIndex + 1,
      myLootRank: lootIndex === -1 ? null : lootIndex + 1,
      gainers: (pulse?.top_might_gain_7d ?? [])
        .map((entry) => ({
          playerId: String(entry.player_id),
          name: names.get(String(entry.player_id)) ?? '',
          gain: Number(entry.diff),
          isMe: String(entry.player_id) === myId,
        }))
        .filter((gainer) => gainer.name !== '' && gainer.gain > 0)
        .slice(0, TOP_GAINERS),
    };
  }

  private toFollowedPlayer(player: ApiBulkPlayer, previous: VisitSnapshot | null): FollowedPlayerView {
    return {
      player,
      might: deltaOf(player.might_current, previous?.players[player.player_id]?.might),
    };
  }

  private toFollowedAlliance(alliance: ApiBulkAlliance, previous: VisitSnapshot | null): FollowedAllianceView {
    const before = previous?.alliances[alliance.alliance_id];
    return {
      alliance,
      might: deltaOf(alliance.might_current, before?.might),
      members: deltaOf(alliance.player_count, before?.members),
    };
  }

  private async fetchSuggestions(term: string): Promise<ApiPlayerSuggestion[]> {
    if (term.length < SUGGESTION_MIN_LENGTH) return [];
    const response = await this.apiRestService.getPlayerSuggestions(term);
    return response.success ? response.data.suggestions.slice(0, 6) : [];
  }
}
