import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ApiChronicle, ApiChroniclePlayer, ApiChronicleWorldEvent } from '@ggetracker-interfaces/empire-ranking';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { ChronicleDiscoveryService } from '@ggetracker-services/chronicle-discovery.service';
import { LanguageService } from '@ggetracker-services/language.service';
import { RankingService } from '@ggetracker-services/ranking.service';
import { ToastService } from '@ggetracker-services/toast.service';
import { environment } from '../../../../environments/environment';
import { ChronicleMusic } from './chronicle-music';
import {
  ChronicleCalendarComponent,
  ChronicleClockComponent,
  ChronicleCurveComponent,
  ChronicleDayComponent,
  ChronicleLadderComponent,
  ChronicleMeterComponent,
  ChronicleRadarComponent,
  ChronicleRankComponent,
  ChronicleReignComponent,
  ChronicleRibbonComponent,
  ChronicleRingComponent,
  ChronicleWeeksComponent,
  ChronicleWorldComponent,
  LadderRung,
} from './chronicle-charts.component';
import { ChronicleCountUpDirective } from './chronicle-count-up.directive';
import { compact, grouped, longDay, monthName, setChronicleLocale, shortDay } from './chronicle-format';
import { ChronicleNote, scribeNote } from './chronicle-voice';
import { ChronicleSlide, EVENT_NAME_KEYS, SLIDE_SCENES } from './chronicle.copy';

type ChronicleState = 'loading' | 'ready' | 'too-recent' | 'missing';

interface EventRow {
  key: string;
  name: string;
  runs: number;
  bestRank: number;
  width: number;
  favourite: boolean;
}

interface WorldCard {
  name: string;
  key: string;
  event: ApiChronicleWorldEvent;
}

type ChronicleParameters = Record<string, string | number | undefined>;

interface BusiestWindow {
  start: number;
  share: number;
}

interface GloryTitle {
  id: string;
  threshold: number;
}

interface ScoreRow {
  label: string;
  mine: string;
  theirs: string;
  mineWidth: number;
  theirsWidth: number;
  won: boolean;
  lost: boolean;
}

const PREVIOUS_ZONE_SHARE = 0.3;
const BUSIEST_HOURS = 6;
const LATE_ARRIVAL_MS = 30 * 86_400_000;
const CONSTANT_BELOW = 0.35;
const FOCUSED_FROM = 0.5;
const MIN_METER_PCT = 20;
const BEST_PLACE_ALWAYS_SHOWN = 1000;
const SWAP_MS = 240;
const MUSIC_KEY = 'chronicle-music';
const EMBERS = Array.from({ length: 16 }, (_, index) => ({
  left: (index * 61) % 100,
  delay: (index * 1.7) % 11,
  duration: 9 + ((index * 37) % 8),
  size: 2 + (index % 3),
}));

@Component({
  selector: 'app-chronicle',
  standalone: true,
  imports: [
    RouterLink,
    ChronicleCalendarComponent,
    ChronicleClockComponent,
    ChronicleCountUpDirective,
    ChronicleCurveComponent,
    ChronicleDayComponent,
    ChronicleLadderComponent,
    ChronicleMeterComponent,
    ChronicleRadarComponent,
    ChronicleRankComponent,
    ChronicleReignComponent,
    ChronicleRibbonComponent,
    ChronicleRingComponent,
    ChronicleWeeksComponent,
    ChronicleWorldComponent,
  ],
  templateUrl: './chronicle.component.html',
  styleUrl: './chronicle.component.css',
})
export class ChronicleComponent implements OnInit, OnDestroy {
  public readonly state = signal<ChronicleState>('loading');
  public readonly chronicle = signal<ApiChronicle | null>(null);
  public readonly index = signal(0);
  public readonly leaving = signal(false);
  public readonly year = signal(0);
  public readonly playerId = signal('');
  public readonly musicOn = signal(false);
  public readonly cardState = signal<'loading' | 'ready' | 'failed'>('loading');
  public readonly embers = EMBERS;
  public readonly canShareFiles = typeof globalThis.navigator?.canShare === 'function';
  public readonly gloryLadder = signal<GloryTitle[]>([]);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiRestService);
  private readonly rankingService = inject(RankingService);
  private readonly toast = inject(ToastService);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly discovery = inject(ChronicleDiscoveryService);
  private readonly music = new ChronicleMusic();

  private swapTimer: ReturnType<typeof setTimeout> | undefined;

  public player(): ApiChroniclePlayer | null {
    return this.chronicle()?.player ?? null;
  }

  public slides(): ChronicleSlide[] {
    return this.player()?.slides ?? [];
  }

  public slide(): ChronicleSlide {
    return this.slides()[this.index()] ?? 'cover';
  }

  public server(): string {
    return this.chronicle()?.serverLabel ?? '';
  }

  public get direction(): 'rtl' | 'ltr' {
    return this.language.getCurrentLang() === 'ar' ? 'rtl' : 'ltr';
  }

  public t(key: string, parameters?: ChronicleParameters): string {
    return this.translate.instant(`chronicle.${key}`, parameters);
  }

  public root(key: string): string {
    return this.translate.instant(key);
  }

  public persona(): { title: string; line: string } | null {
    const id = this.player()?.persona;
    return id ? { title: this.t(`p_${id}`), line: this.t(`pl_${id}`) } : null;
  }

  public async ngOnInit(): Promise<void> {
    setChronicleLocale(this.language.getCurrentLocale());
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.year.set(Number(this.route.snapshot.paramMap.get('year')));
    this.playerId.set(this.route.snapshot.paramMap.get('playerId') ?? '');
    queueMicrotask(() => (this.rankingService.isInLoading = false));

    const response = await this.api.getChronicle(this.year(), this.playerId());
    if (!response.success) {
      this.state.set('missing');
      return;
    }
    this.chronicle.set(response.data);
    this.discovery.markOpened();
    void this.loadGloryTitles();
    this.state.set(response.data.status === 'too-recent' ? 'too-recent' : 'ready');
    if (this.state() === 'ready') this.playMusicByDefault();
    if (response.data.player) await this.setPageTitle(response.data.player.name);
  }

  public ngOnDestroy(): void {
    this.meta.removeTag('name="robots"');
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopWaitingForGesture();
    globalThis.clearTimeout(this.swapTimer);
    this.music.destroy();
  }

  @HostListener('document:keydown', ['$event'])
  public onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' || event.key === ' ') this.next();
    if (event.key === 'ArrowLeft') this.previous();
    if (event.key === 'Escape') void this.close();
  }

  public onStoryClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('a, button')) return;
    const frame = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (event.clientX - frame.left < frame.width * PREVIOUS_ZONE_SHARE) this.previous();
    else this.next();
  }

  public begin(withMusic: boolean): void {
    if (withMusic) void this.startMusic();
    else this.muteMusic();
    this.next();
  }

  public async toggleMusic(): Promise<void> {
    if (this.musicOn()) {
      this.muteMusic();
    } else {
      await this.startMusic();
    }
  }

  public next(): void {
    this.goTo(this.index() + 1);
  }

  public previous(): void {
    this.goTo(this.index() - 1);
  }

  public restart(): void {
    this.goTo(0);
  }

  public async close(): Promise<void> {
    await this.router.navigate(['/player', this.playerId()]);
  }

  public scene(slide: ChronicleSlide): string {
    return SLIDE_SCENES[slide];
  }

  public isSceneLoaded(position: number): boolean {
    return position <= this.index() + 1;
  }

  public compact(value: number): string {
    return compact(value);
  }

  public grouped(value: number): string {
    return grouped(value);
  }

  public day(value: string | null): string {
    return longDay(value);
  }

  public shortDay(value: string | null): string {
    return value ? shortDay(value) : '';
  }

  public showsMeter(higherThanPct: number): boolean {
    return higherThanPct >= MIN_METER_PCT;
  }

  public climbSeries(): (number | null)[] {
    const might = this.player()?.might;
    return might ? [might.start, ...might.monthly.slice(1)] : [];
  }

  public shareOfYear(): number {
    const might = this.player()?.might;
    if (!might || might.gain <= 0) return 0;
    return Math.min(100, Math.max(1, Math.round((100 * might.bestDayGain) / might.gain)));
  }

  public ordinaryDays(): number {
    const might = this.player()?.might;
    const days = this.windowDays();
    if (!might || might.gain <= 0 || days === 0 || this.shareOfYear() >= 50) return 0;
    return Math.round(might.bestDayGain / (might.gain / days));
  }

  public showsProfile(): boolean {
    return this.profileAxes().filter((axis) => axis.value >= MIN_METER_PCT * 2).length >= 2;
  }

  public bestWeekText(): string {
    const loot = this.player()?.loot;
    if (!loot) return '';
    const amount = compact(loot.bestWeek);
    const start = loot.bestWeekStart;
    if (!start || start < `${this.year()}-01-01`) return this.t('bestWeekFirst', { amount });
    return this.t('bestWeek', { amount, date: longDay(start) });
  }

  public storyStartIndex(): number {
    const hero = this.player();
    const from = this.chronicle()?.dataFrom ?? 0;
    const firstMs = hero?.firstDay ? Date.parse(`${hero.firstDay}T00:00:00Z`) : 0;
    const start = Math.max(firstMs, from * 1000);
    return Math.max(0, Math.floor((start - Date.UTC(this.year(), 0, 1)) / 86_400_000));
  }

  public windowDays(): number {
    return Math.max(0, (this.player()?.rhythm.calendar.length ?? 0) - this.storyStartIndex());
  }

  public eventRows(): EventRow[] {
    const events = this.player()?.events;
    if (!events) return [];
    const entries = Object.entries(events.perEvent).sort((a, b) => b[1].runs - a[1].runs);
    const most = Math.max(...entries.map(([, event]) => event.runs), 1);
    return entries.map(([key, event]) => ({
      key,
      name: this.eventName(key),
      runs: event.runs,
      bestRank: event.bestRank,
      width: Math.max(6, Math.round((100 * event.runs) / most)),
      favourite: key === events.favourite,
    }));
  }

  public bestEventName(): string {
    const events = this.player()?.events;
    const best = Object.entries(events?.perEvent ?? {}).find(([, event]) => event.bestRank === events?.bestRank);
    return best ? this.eventName(best[0]) : '';
  }

  public busiestWindow(): BusiestWindow {
    const hourly = this.player()?.rhythm.hourly ?? [];
    const total = Math.max(
      hourly.reduce((sum, count) => sum + count, 0),
      1,
    );
    let best = { start: 0, share: 0 };
    for (let start = 0; start < 24; start++) {
      const held = Array.from({ length: BUSIEST_HOURS }, (_, offset) => hourly[(start + offset) % 24] ?? 0);
      const share = held.reduce((sum, count) => sum + count, 0) / total;
      if (share > best.share) best = { start, share };
    }
    return best;
  }

  public isConstant(): boolean {
    return this.busiestWindow().share < CONSTANT_BELOW;
  }

  public hoursHeading(): string {
    if (this.isConstant()) return this.t('hoursClock');
    const period = this.periodOf((this.busiestWindow().start + BUSIEST_HOURS / 2) % 24);
    return this.t(`${this.busiestWindow().share < FOCUSED_FROM ? 'lean' : 'strike'}${period}`);
  }

  public quip(): string {
    const hero = this.player();
    const note = hero ? scribeNote(this.slide(), hero, this.server(), this.hoursNote(), this.windowDays()) : null;
    return note ? this.t(note.key, note.params) : '';
  }

  public isNearlyEmpty(): boolean {
    return this.slides().length <= 2;
  }

  public arrivalDay(): string {
    const first = this.player()?.firstDay;
    const from = this.chronicle()?.dataFrom ?? 0;
    if (!first || Date.parse(`${first}T12:00:00Z`) - from * 1000 < LATE_ARRIVAL_MS) return '';
    return longDay(first);
  }

  public bestRankMonth(): string {
    const month = this.player()?.might.rankBestMonth;
    return month ? monthName(month) : '';
  }

  public showsBestPlace(): boolean {
    const hero = this.player();
    const best = hero?.might.rankBest;
    if (!hero || !best || hero.slides.includes('ranking')) return false;
    return best <= BEST_PLACE_ALWAYS_SHOWN || best < (hero.might.rankEnd ?? Infinity) * 0.8;
  }

  public reignLead(): string {
    const reign = this.player()?.might.reign;
    if (!reign) return '';
    if (reign.tier === 1) return this.t('reignLead1', { server: this.server() });
    return this.t('reignLeadTop', { count: reign.tier, server: this.server() });
  }

  public reignLongest(): string {
    const reign = this.player()?.might.reign;
    if (!reign) return '';
    const count = grouped(reign.longest);
    return reign.tier === 1
      ? this.t('reignLongest1', { count })
      : this.t('reignLongestTop', { tier: reign.tier, count });
  }

  public reignComebacks(): string {
    const reign = this.player()?.might.reign;
    if (!reign || reign.comebacks === 0) return '';
    const count = reign.comebacks;
    return reign.tier === 1 ? this.t('reignBack1', { count }) : this.t('reignBackTop', { tier: reign.tier, count });
  }

  public rankFrom(): string {
    const ranking = this.player()?.might.ranking;
    if (!ranking) return '';
    return this.t('rankFrom', {
      from: grouped(ranking.first),
      fromMonth: monthName(ranking.firstMonth),
      to: grouped(ranking.last),
      toMonth: monthName(ranking.lastMonth),
    });
  }

  public rankBest(): string {
    const ranking = this.player()?.might.ranking;
    if (!ranking || ranking.best >= ranking.last) return '';
    return this.t('rankBest', { rank: grouped(ranking.best), month: monthName(ranking.bestMonth) });
  }

  public rankMilestone(): string {
    const milestone = this.player()?.might.ranking?.milestone;
    if (!milestone) return '';
    return this.t('rankMilestone', { top: grouped(milestone.top), month: monthName(milestone.month) });
  }

  public meterDetail(key: string, standing: { rank: number; of: number }): string {
    return this.t(key, { rank: grouped(standing.rank), of: grouped(standing.of) });
  }

  public hoursWindowText(): string {
    const { start } = this.busiestWindow();
    return this.t('hoursWindow', {
      pct: this.busiestPct(),
      from: `${start}:00`,
      to: `${(start + BUSIEST_HOURS) % 24}:00`,
    });
  }

  public busiestPct(): number {
    return Math.round(this.busiestWindow().share * 100);
  }

  public nightPct(): number {
    return Math.round((this.player()?.rhythm.nightShare ?? 0) * 100);
  }

  public worldCards(): WorldCard[] {
    const world = this.player()?.world;
    if (!world) return [];
    const cards: WorldCard[] = [];
    if (world.outerRealms) cards.push({ name: this.root('Royaume extérieur'), key: 'outer', event: world.outerRealms });
    if (world.horizon) cards.push({ name: this.root('Lacis'), key: 'horizon', event: world.horizon });
    return cards;
  }

  public worldBest(): WorldCard | null {
    const cards = this.worldCards();
    if (cards.length === 0) return null;
    return cards.reduce((top, card) => (card.event.higherThanPct > top.event.higherThanPct ? card : top));
  }

  public yearMonths(): number[] {
    const until = new Date(((this.chronicle()?.dataUntil ?? 0) - 1) * 1000);
    const last = until.getUTCFullYear() === this.year() ? until.getUTCMonth() + 1 : 12;
    return Array.from({ length: last }, (_, index) => this.year() * 100 + index + 1);
  }

  public worldSeries(event: ApiChronicleWorldEvent | null): (number | null)[] {
    return this.yearMonths().map((month) => {
      const position = event?.months.indexOf(month) ?? -1;
      return position >= 0 && event ? event.ranks[position] : null;
    });
  }

  public worldDetail(card: WorldCard): string {
    const beaten = Math.max(0, card.event.of - card.event.rank);
    return this.t('worldAhead', { count: grouped(beaten) });
  }

  // The rank titles are held live, so a peak only ever proves the points titles
  public peakGloryIndex(): number {
    const highest = this.player()?.glory.highest ?? 0;
    return this.gloryLadder().reduce((found, title, index) => (title.threshold <= highest ? index : found), 0);
  }

  public gloryTitleName(): string {
    const title = this.gloryLadder()[this.peakGloryIndex()];
    return title ? this.titleName(title.id) : '';
  }

  public gloryRungs(): LadderRung[] {
    const ladder = this.gloryLadder();
    const peak = this.peakGloryIndex();
    const from = Math.max(0, peak - 2);
    return ladder.slice(from, peak + 2).map((title, offset) => {
      const index = from + offset;
      return {
        name: this.titleName(title.id),
        points: compact(title.threshold),
        state: index < peak ? 'past' : index === peak ? 'now' : 'ahead',
        progress: 0,
      };
    });
  }

  public reachedTopGloryTitle(): boolean {
    const ladder = this.gloryLadder();
    return ladder.length > 0 && this.peakGloryIndex() === ladder.length - 1;
  }

  public scoreRows(): ScoreRow[] {
    const hero = this.player();
    const rival = hero?.rival;
    if (!hero || !rival) return [];
    const row = (label: string, mine: number, theirs: number): ScoreRow => {
      const most = Math.max(mine, theirs, 1);
      return {
        label,
        mine: compact(mine),
        theirs: compact(theirs),
        mineWidth: Math.round((100 * mine) / most),
        theirsWidth: Math.round((100 * theirs) / most),
        won: mine > theirs,
        lost: mine < theirs,
      };
    };
    return [
      row(this.root('Puissance'), hero.might.end, rival.might),
      row(this.root('Butin'), hero.loot.total, rival.loot),
      row(this.t('scoreEvents'), hero.events.runs, rival.events),
      row(this.t('scoreDays'), hero.rhythm.activeDays, rival.activeDays),
    ];
  }

  public scoreVerdict(): string {
    const rows = this.scoreRows();
    const won = rows.filter((row) => row.won).length;
    const lost = rows.filter((row) => row.lost).length;
    if (won > lost) return this.t('scoreWin', { won, lost });
    if (lost > won) return this.t('scoreLose', { won: lost, lost: won });
    return this.t('scoreTie', { won, lost });
  }

  public profileAxes(): { label: string; value: number }[] {
    const profile = this.player()?.profile;
    if (!profile) return [];
    return [
      { label: this.root('Puissance'), value: profile.might },
      { label: this.root('Butin'), value: profile.loot },
      { label: this.t('scoreEvents'), value: profile.events },
      { label: this.t('axisGlory'), value: profile.glory },
      { label: this.t('axisActivity'), value: profile.activity },
      { label: this.t('axisLoyalty'), value: profile.loyalty },
    ];
  }

  public personaReason(): string {
    const hero = this.player();
    if (!hero) return '';
    const server = this.server();
    switch (hero.persona) {
      case 'conqueror': {
        return this.t('whyMight', { pct: hero.might.higherThanPct, server });
      }
      case 'plunderer': {
        return this.t('whyLoot', { pct: hero.loot.higherThanPct, server });
      }
      case 'tournament-knight': {
        return this.t('whyEvents', { pct: hero.events.higherThanPct, server });
      }
      case 'night-watch': {
        return this.t('whyNight', { pct: this.nightPct() });
      }
      case 'iron-banner': {
        return this.t('whyLoyal', { count: grouped(hero.alliance.daysUnderCurrent) });
      }
      case 'wanderer': {
        return this.t('whyWander', { count: hero.alliance.changes });
      }
      case 'risen': {
        return this.t('whyRisen', { low: compact(hero.might.low), end: compact(hero.might.end) });
      }
      case 'rising-star': {
        return this.t('whyStar', { times: (hero.might.end / Math.max(hero.might.start, 1)).toFixed(1) });
      }
      case 'veteran': {
        return this.t('streak', { count: hero.rhythm.longestStreak });
      }
      case 'glorious': {
        return this.t('whyGloryPeak', { pct: hero.glory.best.higherThanPct, server });
      }
      case 'hermit-king': {
        return this.t('whyHermit', { loot: compact(hero.loot.total) });
      }
      default: {
        return this.t('whySteady');
      }
    }
  }

  public trackedSince(): string {
    const from = this.chronicle()?.dataFrom ?? 0;
    return longDay(new Date(from * 1000).toISOString().slice(0, 10));
  }

  public get pageUrl(): string {
    return `${globalThis.location.origin}/chronicle/${this.year()}/${this.playerId()}${this.languageQuery()}`;
  }

  public imageUrl(format: 'link' | 'story'): string {
    const query = new URLSearchParams(this.languageQuery());
    if (format === 'story') query.set('format', 'story');
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return `${environment.chronicleApiUrl}assets/og/chronicle/${this.year()}/${this.playerId()}.jpg${suffix}`;
  }

  public async copyLink(): Promise<void> {
    try {
      await globalThis.navigator.clipboard.writeText(this.pageUrl);
      this.toast.info(this.root('Lien copié'));
    } catch {
      this.toast.error(this.t('linkFail'));
    }
  }

  // Browsers only accept PNG on the clipboard, and the card is a JPEG
  public async copyImage(): Promise<void> {
    try {
      const png = await this.pngFrom(await this.fetchCard('link'));
      await globalThis.navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      this.toast.info(this.t('imageCopied'));
    } catch {
      this.toast.error(this.t('imageCopyFail'));
    }
  }

  public async download(format: 'link' | 'story'): Promise<void> {
    try {
      const url = URL.createObjectURL(await this.fetchCard(format));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = this.fileName(format);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      this.toast.error(this.t('downloadFail'));
    }
  }

  public async shareStory(): Promise<void> {
    try {
      const blob = await this.fetchCard('story');
      const file = new File([blob], this.fileName('story'), { type: 'image/jpeg' });
      if (globalThis.navigator.canShare?.({ files: [file] })) {
        await globalThis.navigator.share({ files: [file], url: this.pageUrl });
      } else {
        await this.download('story');
      }
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') this.toast.error(this.t('shareFail'));
    }
  }
  private readonly onVisibility = (): void => this.music.suspendWhileHidden(document.hidden);

  private hoursNote(): ChronicleNote {
    if (this.isConstant()) return { key: 'n_hoursClock' };
    const hour = (this.busiestWindow().start + BUSIEST_HOURS / 2) % 24;
    if (hour >= 22 || hour < 5) return { key: 'n_hoursNight' };
    if (hour < 9) return { key: 'n_hoursDawn' };
    if (hour >= 18) return { key: 'n_hoursEvening' };
    return { key: 'n_hoursDay' };
  }

  private periodOf(hour: number): string {
    if (hour >= 5 && hour < 9) return 'Dawn';
    if (hour >= 9 && hour < 12) return 'Morning';
    if (hour >= 12 && hour < 14) return 'Midday';
    if (hour >= 14 && hour < 18) return 'Afternoon';
    if (hour >= 18 && hour < 22) return 'Evening';
    return 'Night';
  }

  private eventName(key: string): string {
    const nameKey = EVENT_NAME_KEYS[key];
    return nameKey ? this.root(nameKey) : key;
  }

  private languageQuery(): string {
    const lang = this.language.getCurrentLang();
    return lang === 'en' ? '' : `?lang=${lang}`;
  }

  private async setPageTitle(playerName: string): Promise<void> {
    const heading = await firstValueFrom(this.translate.get('chronicle.title', { year: this.year() }));
    this.title.setTitle(`${playerName} - ${heading}`);
  }

  private titleName(id: string): string {
    const key = `titles.playerTitle_${id}`;
    const name: string = this.translate.instant(key);
    return name === key ? `Title ${id}` : name;
  }

  private async loadGloryTitles(): Promise<void> {
    const response = await fetch('/assets/titles/titles.json');
    const titles = (await response.json()) as { titleID: string; type: string; threshold?: string; topX?: string }[];
    this.gloryLadder.set(
      titles
        .filter((title) => title.type === 'FAME' && title.topX === undefined)
        .map((title) => ({ id: title.titleID, threshold: Number(title.threshold ?? 0) }))
        .sort((a, b) => a.threshold - b.threshold),
    );
  }

  private playMusicByDefault(): void {
    if (localStorage.getItem(MUSIC_KEY) === 'off') return;
    this.musicOn.set(true);
    if (navigator.userActivation?.hasBeenActive) void this.music.play().catch(() => false);
    document.addEventListener('click', this.onFirstGesture, { capture: true });
    document.addEventListener('keydown', this.onFirstGesture, { capture: true });
  }

  private readonly onFirstGesture = (): void => {
    this.stopWaitingForGesture();
    if (this.musicOn()) void this.startMusic();
  };

  private stopWaitingForGesture(): void {
    document.removeEventListener('click', this.onFirstGesture, { capture: true });
    document.removeEventListener('keydown', this.onFirstGesture, { capture: true });
  }

  private muteMusic(): void {
    this.music.pause();
    this.musicOn.set(false);
    localStorage.setItem(MUSIC_KEY, 'off');
  }

  private async startMusic(): Promise<void> {
    if (localStorage.getItem(MUSIC_KEY) === 'off') localStorage.removeItem(MUSIC_KEY);
    this.musicOn.set(true);
    try {
      await this.music.play();
    } catch {
      if (!this.music.isPlaying) return;
      this.musicOn.set(false);
      this.toast.error(this.t('musicFail'));
    }
  }

  private goTo(target: number): void {
    if (this.leaving() || target < 0 || target >= this.slides().length || target === this.index()) return;
    this.leaving.set(true);
    this.swapTimer = globalThis.setTimeout(() => {
      this.index.set(target);
      if (this.slides()[target] === 'wall') this.cardState.set('loading');
      if (target >= this.slides().length - 2) this.prepareCard();
      this.leaving.set(false);
    }, SWAP_MS);
  }

  private prepareCard(): void {
    new Image().src = this.imageUrl('link');
  }

  private fileName(format: 'link' | 'story'): string {
    return `gge-tracker-chronicle-${this.year()}-${this.playerId()}-${format}.jpg`;
  }

  private async fetchCard(format: 'link' | 'story'): Promise<Blob> {
    const response = await fetch(this.imageUrl(format));
    if (!response.ok) throw new Error(`Card answered ${response.status}`);
    return response.blob();
  }

  private async pngFrom(image: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(image);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png'),
    );
  }
}
