/* eslint-disable unicorn/consistent-function-scoping */
import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { ModalTableColumn, ModalTableComponent } from '@ggetracker-components/modal-table/modal-table.component';
import { ChartAdvancedOptions } from '@ggetracker-interfaces/empire-ranking';
import { ChartsWrapperComponent } from '@ggetracker-modules/charts-client/charts-wrapper.component';
import { ApiRestService } from '@ggetracker-services/api-rest.service';
import { LanguageService } from '@ggetracker-services/language.service';
import { RankingService } from '@ggetracker-services/ranking.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import Modal from 'bootstrap/js/dist/modal';
import { DUNGEON_REALMS } from '../dungeon-map/dungeon-map.component';
import { AttackSummary, DungeonAttack, summarizeAttacks, toDungeonAttacks } from './dungeon-attack-stats';

export interface DungeonLocation {
  kid: number;
  x: number;
  y: number;
}

interface HeatCell {
  level: number;
  label: string;
}

const PERIODS = [7, 30, 90, 365];
const DEFAULT_PERIOD = 30;
const TOP_TARGETS = 6;
const HOUR_TICKS = new Set([0, 3, 6, 9, 12, 15, 18, 21]);
const REALM_COLORS: Record<number, string> = { 1: '#d57026', 2: '#6aa6d6', 3: '#cbb674' };

@Component({
  selector: 'app-dungeon-attack-history',
  standalone: true,
  imports: [TranslateModule, ChartsWrapperComponent, ModalTableComponent],
  templateUrl: './dungeon-attack-history.component.html',
  styleUrl: './dungeon-attack-history.component.css',
})
export class DungeonAttackHistoryComponent {
  public readonly playerId = input<number | null>(null);
  public readonly locate = output<DungeonLocation>();

  public readonly periods = PERIODS;
  public readonly realms = DUNGEON_REALMS;
  public readonly hours = Array.from({ length: 24 }, (_, hour) => hour);
  public readonly hourTicks = HOUR_TICKS;
  public readonly period = signal(DEFAULT_PERIOD);
  public readonly loading = signal(false);
  public readonly failed = signal(false);
  public readonly attacks = signal<DungeonAttack[]>([]);
  public readonly summary = computed<AttackSummary>(() => summarizeAttacks(this.attacks(), this.period()));
  public readonly topTargets = computed(() => this.summary().targets.slice(0, TOP_TARGETS));
  public readonly realmLegend = computed(() =>
    this.realms
      .map((realm) => ({
        ...realm,
        color: REALM_COLORS[realm.id],
        count: this.summary().realmCounts.get(realm.id) ?? 0,
      }))
      .filter((realm) => realm.count > 0),
  );
  public readonly chart = computed(() => this.buildChart(this.summary()));
  public readonly weekdays = computed(() => this.weekdayNames('short'));
  public readonly heatmap = computed(() => this.buildHeatmap(this.summary()));
  public readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  public readonly columns: ModalTableColumn[] = [
    { label: 'Royaume', sortKey: 'kid' },
    { label: 'Position' },
    { label: "Date de l'attaque", sortKey: 'attackedAt' },
  ];

  private readonly api = inject(ApiRestService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly ranking = inject(RankingService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private requestId = 0;

  constructor() {
    effect(() => {
      const playerId = this.playerId();
      const period = this.period();
      if (playerId !== null) untracked(() => void this.load(playerId, period));
    });
  }

  public get locale(): string {
    return this.language.getCurrentLanguage()?.locale ?? this.language.getCurrentLang();
  }

  public readonly searchFilter = (attack: DungeonAttack, term: string): boolean =>
    this.realmName(attack.kid).toLowerCase().includes(term) ||
    `${attack.x}:${attack.y}`.includes(term) ||
    this.formatDate(attack.attackedAt).toLowerCase().includes(term);

  public realmName(kid: number): string {
    const realm = this.realms.find((candidate) => candidate.id === kid);
    return realm ? this.translate.instant(realm.name) : '?';
  }

  public realmIcon(kid: number): string {
    return this.realms.find((realm) => realm.id === kid)?.icon ?? 'assets/dungeon_default.png';
  }

  public formatDate(time: number): string {
    return new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
  }

  public formatNumber(value: number, maximumFractionDigits = 0): string {
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits }).format(value);
  }

  public formatRelative(time: number): string {
    const seconds = Math.round((time - Date.now()) / 1000);
    const format = new Intl.RelativeTimeFormat(this.locale, { numeric: 'auto' });
    if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), 'minute');
    if (Math.abs(seconds) < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
    return format.format(Math.round(seconds / 86_400), 'day');
  }

  public openProfile(event: MouseEvent): void {
    event.preventDefault();
    const playerId = this.playerId();
    if (playerId === null) return;
    this.closeModal(() => void this.router.navigate(['/player', playerId]));
  }

  public showOnMap(location: DungeonLocation): void {
    this.closeModal(() => this.locate.emit({ kid: location.kid, x: location.x, y: location.y }));
  }

  private async load(playerId: number, period: number): Promise<void> {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.failed.set(false);
    const response = await this.api.getDungeonsByPlayerId(playerId, period);
    if (requestId !== this.requestId) return;
    this.attacks.set(response.success ? toDungeonAttacks(response.data.dungeons) : []);
    this.failed.set(!response.success);
    this.loading.set(false);
  }

  private closeModal(then: () => void): void {
    const modal = (this.host.nativeElement as HTMLElement).closest('.modal');
    if (!modal) return then();
    modal.addEventListener('hidden.bs.modal', then, { once: true });
    Modal.getOrCreateInstance(modal).hide();
  }

  private weekdayNames(weekday: 'short' | 'long'): string[] {
    const format = new Intl.DateTimeFormat(this.locale, { weekday });
    const firstMondayOf2024 = 1;
    return Array.from({ length: 7 }, (_, index) => format.format(new Date(2024, 0, firstMondayOf2024 + index)));
  }

  private buildHeatmap(summary: AttackSummary): HeatCell[][] {
    const days = this.weekdayNames('long');
    const unit = this.translate.instant('heures_h');
    return summary.activity.map((hours, day) =>
      hours.map((count, hour) => ({
        level: summary.activityMax === 0 ? 0 : count / summary.activityMax,
        label: `${days[day]} ${hour} ${unit} - ${hour + 1} ${unit} : ${count}`,
      })),
    );
  }

  private buildChart(summary: AttackSummary): ChartAdvancedOptions {
    const realms = this.realmLegend();
    const dense = summary.bucketStarts.length > 45;
    return {
      series: realms.map((realm) => ({
        name: this.translate.instant(realm.name),
        color: realm.color,
        data: summary.bucketStarts.map((start, index) => ({
          x: start,
          y: summary.countsByRealm.get(realm.id)?.[index] ?? 0,
        })),
      })),
      chart: {
        type: 'bar',
        stacked: true,
        height: 240,
        background: 'transparent',
        foreColor: '#a3aec0',
        fontFamily: 'inherit',
        parentHeightOffset: 0,
        animations: { enabled: false },
        toolbar: { show: false },
        zoom: { enabled: false },
        locales: this.ranking.CHART_LOCALES,
        defaultLocale: this.language.getCurrentLang(),
      },
      plotOptions: {
        bar: {
          columnWidth: dense ? '88%' : '62%',
          borderRadius: dense ? 1 : 3,
          borderRadiusApplication: 'end',
          borderRadiusWhenStacked: 'last',
        },
      },
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: {
        borderColor: 'rgba(148, 163, 184, 0.14)',
        strokeDashArray: 3,
        xaxis: { lines: { show: false } },
        padding: { left: 6, right: 6 },
      },
      xaxis: {
        type: 'datetime',
        labels: { datetimeUTC: false, style: { fontSize: '11px' } },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        min: 0,
        forceNiceScale: true,
        labels: { formatter: (value: number): string => this.formatNumber(value), style: { fontSize: '11px' } },
      },
      tooltip: {
        theme: 'dark',
        shared: true,
        intersect: false,
        x: { formatter: (start: number): string => this.formatBucket(start, summary.bucket) },
      },
    };
  }

  private formatBucket(start: number, bucket: AttackSummary['bucket']): string {
    const format = new Intl.DateTimeFormat(this.locale, { weekday: 'short', day: 'numeric', month: 'short' });
    if (bucket === 'day') return format.format(start);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${format.format(start)} - ${format.format(end)}`;
  }
}
