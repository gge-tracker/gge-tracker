/* eslint-disable unicorn/consistent-function-scoping -- the rule misreads the closures passed to computed() */
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { compact, grouped, monthInitial, monthName, monthShort } from './chronicle-format';

const GOLD = '#e6bd6c';

interface Point {
  x: number;
  y: number;
  value: number;
  index: number;
}

function smoothPath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.reduce((path, point, index) => {
    if (index === 0) return `M${point.x} ${point.y}`;
    const previous = points[index - 1];
    const middle = (previous.x + point.x) / 2;
    return `${path} C${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y}`;
  }, '');
}

function polar(radius: number, fraction: number, center = 100): { x: number; y: number } {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
}

function placeSeries(series: (number | null)[], low: number, high: number, width: number, height: number): Point[] {
  const span = Math.max(high - low, 1);
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  return series.flatMap((value, index) =>
    value === null ? [] : [{ x: index * step, y: height - ((value - low) / span) * height, value, index }],
  );
}

@Component({
  selector: 'app-chronicle-curve',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="curve" direction="ltr" viewBox="-46 -26 412 174" role="img" [attr.aria-label]="label()">
      <defs>
        <linearGradient id="chronicle-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" [attr.stop-color]="gold" stop-opacity=".38" />
          <stop offset="1" [attr.stop-color]="gold" stop-opacity="0" />
        </linearGradient>
      </defs>
      <line class="base" x1="0" x2="320" y1="120" y2="120" />
      @if (!rival()) {
        <path class="area" [attr.d]="area()" fill="url(#chronicle-area)" />
      }
      @if (rival()) {
        <path class="line rival" pathLength="1" [attr.d]="rivalPath()" />
      }
      <path class="line mine" pathLength="1" [attr.d]="minePath()" />
      @if (first(); as point) {
        <circle class="dot" [attr.cx]="point.x" [attr.cy]="point.y" r="3.4" />
        @if (!rival()) {
          <text class="value" [attr.x]="point.x - 7" [attr.y]="point.y + 4" text-anchor="end">
            {{ short(point.value) }}
          </text>
        }
      }
      @if (last(); as point) {
        <circle class="dot end" [attr.cx]="point.x" [attr.cy]="point.y" r="5" />
        <text class="value strong" [attr.x]="point.x + 8" [attr.y]="point.y + 4">{{ short(point.value) }}</text>
      }
      @for (item of monthLabels(); track item.key) {
        <text class="month" [attr.x]="item.x" y="142" text-anchor="middle">{{ item.label }}</text>
      }
    </svg>
  `,
  styles: `
    .curve {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .base {
      stroke: rgb(246 239 223 / 22%);
      stroke-width: 1;
    }
    .area {
      animation: fade 1.2s 0.7s both;
    }
    .line {
      fill: none;
      stroke-width: 3.2;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: draw 1.5s 0.25s cubic-bezier(0.65, 0, 0.2, 1) forwards;
    }
    .mine {
      stroke: #e6bd6c;
    }
    .rival {
      stroke: #7fb4ff;
    }
    .dot {
      fill: #e6bd6c;
      animation: fade 0.4s 1.5s both;
    }
    .dot.end {
      stroke: #fff4d6;
      stroke-width: 2;
    }
    .value {
      fill: #e8e1cf;
      font-size: 13px;
      font-weight: 600;
      animation: fade 0.5s 1.5s both;
    }
    .value.strong {
      fill: #fff;
      font-size: 15px;
      font-weight: 800;
    }
    .month {
      fill: #bdb6a4;
      font-size: 12px;
    }
    @keyframes draw {
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .line {
        animation: none;
        stroke-dashoffset: 0;
      }
    }
  `,
})
export class ChronicleCurveComponent {
  public readonly series = input.required<(number | null)[]>();
  public readonly months = input.required<number[]>();
  public readonly rival = input<(number | null)[] | null>(null);
  public readonly label = input('');
  public readonly gold = GOLD;

  public readonly minePath = computed(() => smoothPath(this.mine()));
  public readonly rivalPath = computed(() =>
    smoothPath(placeSeries(this.rival() ?? [], this.bounds().low, this.bounds().high, 320, 112)),
  );
  public readonly area = computed(() => {
    const points = this.mine();
    if (points.length === 0) return '';
    return `${smoothPath(points)} L${points.at(-1)!.x} 120 L${points[0].x} 120 Z`;
  });
  public readonly first = computed(() => this.mine()[0] ?? null);
  public readonly last = computed(() => this.mine().at(-1) ?? null);
  public readonly monthLabels = computed(() => {
    const step = this.months().length > 1 ? 320 / (this.months().length - 1) : 0;
    return this.months().map((month, index) => ({ key: month, x: index * step, label: monthInitial(month) }));
  });

  private readonly bounds = computed(() => {
    const values = [...this.series(), ...(this.rival() ?? [])].filter((value): value is number => value !== null);
    const low = Math.min(...values);
    const high = Math.max(...values);
    return { low: Math.max(0, low - (high - low) * 0.08), high };
  });
  private readonly mine = computed(() => placeSeries(this.series(), this.bounds().low, this.bounds().high, 320, 112));

  public short(value: number): string {
    return compact(value);
  }
}

@Component({
  selector: 'app-chronicle-meter',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="meter">
      <div class="headline">
        <strong>{{ headline() }}</strong>
        <span>{{ detail() }}</span>
      </div>
      <div class="track" aria-hidden="true">
        <span class="fill" [style.width.%]="higherThanPct()"></span>
        <span class="marker" [style.left.%]="higherThanPct()"
          ><i>{{ 'chronicle.you' | translate }}</i></span
        >
      </div>
      <div class="ends" dir="ltr" aria-hidden="true">
        <span>{{ everyone() || ('chronicle.meterAll' | translate: { server: server() }) }}</span
        ><span>{{ 'chronicle.meterBest' | translate }}</span>
      </div>
    </div>
  `,
  styles: `
    .meter {
      margin-top: 0.8rem;
    }
    .headline {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      flex-wrap: wrap;
    }
    strong {
      color: #e6bd6c;
      font-size: 1.3rem;
      font-weight: 800;
    }
    span {
      color: #d7d0bd;
      font-size: 0.9rem;
    }
    .track {
      position: relative;
      height: 0.55rem;
      margin-top: 1.5rem;
      border-radius: 1rem;
      background: rgb(246 239 223 / 18%);
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: 1rem;
      background: linear-gradient(90deg, #8a6a2d, #e6bd6c);
      animation: grow 1.3s 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    .marker {
      position: absolute;
      top: 50%;
      width: 0.95rem;
      height: 0.95rem;
      margin: -0.475rem 0 0 -0.475rem;
      border: 2px solid #fff4d6;
      border-radius: 50%;
      background: #e6bd6c;
      animation: slide 1.3s 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    i {
      position: absolute;
      bottom: 1.05rem;
      left: 50%;
      transform: translateX(-50%);
      color: #fff;
      font-size: 0.75rem;
      font-style: normal;
      font-weight: 700;
    }
    .ends {
      display: flex;
      justify-content: space-between;
      margin-top: 0.3rem;
    }
    .ends span {
      color: #a9a290;
      font-size: 0.72rem;
    }
    @keyframes grow {
      from {
        width: 0;
      }
    }
    @keyframes slide {
      from {
        left: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .fill,
      .marker {
        animation: none;
      }
    }
  `,
})
export class ChronicleMeterComponent {
  public readonly higherThanPct = input.required<number>();
  public readonly rank = input.required<number>();
  public readonly of = input.required<number>();
  public readonly server = input.required<string>();
  public readonly everyone = input('');
  public readonly detailText = input('');

  public readonly headline = computed(() =>
    this.higherThanPct() >= 50
      ? this.translate.instant('chronicle.meterTop', { pct: Math.max(1, 100 - this.higherThanPct()) })
      : this.translate.instant('chronicle.meterAhead', { pct: this.higherThanPct() }),
  );
  public readonly detail = computed(
    () =>
      this.detailText() ||
      this.translate.instant('chronicle.meterRank', { rank: grouped(this.rank()), of: grouped(this.of()) }),
  );

  private readonly translate = inject(TranslateService);
}

@Component({
  selector: 'app-chronicle-weeks',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" dir="ltr" role="img" [attr.aria-label]="label()">
      <div class="bars">
        @for (bar of bars(); track $index) {
          <span class="bar" [class.best]="bar.best" [style.height.%]="bar.height" [style.--i]="$index">
            @if (bar.best) {
              <em [class.flip]="bar.flip">{{ bestLabel() }}</em>
            }
          </span>
        }
      </div>
      <div class="axis" aria-hidden="true">
        @for (month of axis; track month) {
          <span>{{ month }}</span>
        }
      </div>
    </div>
  `,
  styles: `
    .wrap {
      margin-top: 1.9rem;
    }
    .bars {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: clamp(4.2rem, 13vh, 7rem);
      border-bottom: 1px solid rgb(246 239 223 / 25%);
    }
    .bar {
      position: relative;
      flex: 1;
      min-height: 2px;
      border-radius: 2px 2px 0 0;
      background: rgb(230 189 108 / 55%);
      transform-origin: bottom;
      animation: rise 0.6s calc(0.2s + var(--i) * 18ms) cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    .bar.best {
      background: #ffd98a;
      box-shadow: 0 0 12px rgb(255 217 138 / 75%);
    }
    em {
      position: absolute;
      bottom: calc(100% + 0.25rem);
      left: 50%;
      transform: translateX(-50%);
      padding: 0.1rem 0.4rem;
      border-radius: 0.3rem;
      background: #ffd98a;
      color: #1a1408;
      font-size: 0.75rem;
      font-style: normal;
      font-weight: 800;
      white-space: nowrap;
    }
    em.flip {
      left: auto;
      right: 0;
      transform: none;
    }
    .axis {
      display: flex;
      justify-content: space-between;
      margin-top: 0.25rem;
      color: #bdb6a4;
      font-size: 0.72rem;
    }
    @keyframes rise {
      from {
        transform: scaleY(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bar {
        animation: none;
      }
    }
  `,
})
export class ChronicleWeeksComponent {
  public readonly series = input.required<number[]>();
  public readonly label = input('');
  public readonly axis = [1, 3, 5, 7, 9, 11].map((month) => monthShort(month));

  public readonly bars = computed(() => {
    const series = this.series();
    const peak = Math.max(...series, 1);
    const bestIndex = series.indexOf(peak);
    return series.map((value, index) => ({
      height: value > 0 ? Math.max(4, 100 * Math.sqrt(value / peak)) : 0,
      best: index === bestIndex,
      flip: index > series.length * 0.75,
    }));
  });
  public readonly bestLabel = computed(() => compact(Math.max(...this.series(), 0)));
}

interface CalendarCell {
  key: number;
  x: number;
  y: number;
  kind: 'off' | 'on' | 'streak';
}

const CALENDAR_LEFT = 16;
const CALENDAR_STEP = 12;

@Component({
  selector: 'app-chronicle-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="calendar" direction="ltr" [attr.viewBox]="viewBox()" role="img" [attr.aria-label]="label()">
      @for (mark of dayMarks; track mark.day) {
        <text class="day" [attr.x]="mark.x" y="-3" text-anchor="middle">{{ mark.day }}</text>
      }
      @for (month of monthLabels(); track month.row) {
        <text class="month" x="0" [attr.y]="month.y">{{ month.label }}</text>
      }
      @for (cell of cells(); track cell.key) {
        <rect
          [attr.x]="cell.x"
          [attr.y]="cell.y"
          width="10.4"
          height="10.4"
          rx="2"
          [attr.class]="cell.kind"
          [style.--c]="cell.key"
        />
      }
    </svg>
  `,
  styles: `
    .calendar {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    text {
      fill: #bdb6a4;
    }
    .month {
      font-size: 9.5px;
      font-weight: 700;
    }
    .day {
      font-size: 8px;
    }
    rect {
      animation: appear 0.3s calc(0.15s + var(--c) * 2ms) ease-out backwards;
    }
    .off {
      fill: rgb(246 239 223 / 11%);
    }
    .on {
      fill: #b78f42;
    }
    .streak {
      fill: #ffd98a;
    }
    @keyframes appear {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      rect {
        animation: none;
      }
    }
  `,
})
export class ChronicleCalendarComponent {
  public readonly calendar = input.required<string>();
  public readonly year = input.required<number>();
  public readonly startIndex = input(0);
  public readonly label = input('');
  public readonly dayMarks = [1, 10, 20, 31].map((day) => ({
    day,
    x: CALENDAR_LEFT + (day - 1) * CALENDAR_STEP + 5.2,
  }));

  public readonly cells = computed<CalendarCell[]>(() =>
    [...this.calendar()].slice(this.startIndex()).map((mark, offset) => {
      const index = offset + this.startIndex();
      const date = this.date(index);
      const inStreak = index >= this.streak().start && index < this.streak().start + this.streak().length;
      return {
        key: index,
        x: CALENDAR_LEFT + (date.getUTCDate() - 1) * CALENDAR_STEP,
        y: (date.getUTCMonth() - this.firstMonth()) * CALENDAR_STEP,
        kind: mark === '0' ? 'off' : inStreak ? 'streak' : 'on',
      };
    }),
  );
  public readonly viewBox = computed(() => {
    const rows = this.date(Math.max(this.calendar().length - 1, 0)).getUTCMonth() + 1;
    return `0 -12 ${CALENDAR_LEFT + 31 * CALENDAR_STEP} ${12 + (rows - this.firstMonth()) * CALENDAR_STEP}`;
  });
  public readonly monthLabels = computed(() => {
    const first = this.firstMonth();
    const last = this.date(Math.max(this.calendar().length - 1, 0)).getUTCMonth();
    return Array.from({ length: last - first + 1 }, (_, row) => ({
      row,
      y: row * CALENDAR_STEP + 8.6,
      label: monthInitial(first + row + 1),
    }));
  });

  private readonly firstMonth = computed(() => this.date(this.startIndex()).getUTCMonth());

  private readonly streak = computed(() => {
    let best = { start: 0, length: 0 };
    let start = -1;
    [...`${this.calendar()}0`].forEach((mark, index) => {
      if (mark === '1' && start < 0) start = index;
      if (mark !== '1' && start >= 0) {
        if (index - start > best.length) best = { start, length: index - start };
        start = -1;
      }
    });
    return best;
  });

  private date(index: number): Date {
    return new Date(Date.UTC(this.year(), 0, 1 + index));
  }
}

const RING_TEXT_WIDTH = 84;

function fitRing(text: string, largest: number, glyphWidth: number): number {
  return Math.min(largest, RING_TEXT_WIDTH / ([...text].length * glyphWidth));
}

@Component({
  selector: 'app-chronicle-clock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="clock" direction="ltr" viewBox="0 0 200 200" role="img" [attr.aria-label]="label()">
      <path class="night" [attr.d]="nightArc()" />
      <circle class="ring" cx="100" cy="100" r="46" />
      @for (bar of bars(); track bar.key) {
        <line
          [attr.x1]="bar.x1"
          [attr.y1]="bar.y1"
          [attr.x2]="bar.x2"
          [attr.y2]="bar.y2"
          [class.peak]="bar.peak"
          [class.dim]="bar.dim"
          [style.--i]="bar.key"
        />
      }
      @for (mark of marks; track mark.label) {
        <text [attr.x]="mark.x" [attr.y]="mark.y" text-anchor="middle" dominant-baseline="middle">
          {{ mark.label }}
        </text>
      }
      <text class="center" x="100" y="97" text-anchor="middle" [style.font-size.px]="centerSize()">{{ center() }}</text>
      <text class="caption" x="100" y="115" text-anchor="middle" [style.font-size.px]="captionSize()">
        {{ caption() }}
      </text>
    </svg>
  `,
  styles: `
    .clock {
      display: block;
      width: min(100%, 17.5rem);
      height: auto;
      margin: 0.6rem auto 0;
      overflow: visible;
    }
    .night {
      fill: rgb(127 180 255 / 13%);
    }
    .ring {
      fill: rgb(6 8 15 / 55%);
      stroke: rgb(246 239 223 / 22%);
    }
    line {
      stroke: #b78f42;
      stroke-width: 6;
      stroke-linecap: round;
      animation: appear 0.45s calc(0.2s + var(--i) * 28ms) ease-out backwards;
    }
    line.peak {
      stroke: #ffd98a;
      filter: drop-shadow(0 0 4px rgb(255 217 138 / 90%));
    }
    line.dim {
      stroke: rgb(183 143 66 / 42%);
    }
    text {
      fill: #bdb6a4;
      font-size: 10px;
    }
    .center {
      fill: #fff;
      font-size: 24px;
      font-weight: 800;
    }
    .caption {
      fill: #e6bd6c;
      font-size: 10px;
    }
    @keyframes appear {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      line {
        animation: none;
      }
    }
  `,
})
export class ChronicleClockComponent {
  public readonly hourly = input.required<number[]>();
  public readonly center = input.required<string>();
  public readonly caption = input.required<string>();
  public readonly windowStart = input<number | null>(null);
  public readonly label = input('');

  public readonly centerSize = computed(() => fitRing(this.center(), 24, 0.58));
  public readonly captionSize = computed(() => fitRing(this.caption(), 10, 0.52));
  public readonly marks = [0, 6, 12, 18].map((hour) => {
    const point = polar(95, hour / 24);
    return { label: `${hour}h`, x: point.x, y: point.y };
  });
  public readonly nightArc = computed(() => {
    const from = polar(88, 22 / 24);
    const to = polar(88, 6 / 24);
    return `M100 100 L${from.x} ${from.y} A88 88 0 0 1 ${to.x} ${to.y} Z`;
  });
  public readonly bars = computed(() => {
    const hourly = this.hourly();
    const peak = Math.max(...hourly, 1);
    return hourly.map((count, hour) => {
      const inner = polar(51, (hour + 0.5) / 24);
      const outer = polar(51 + (count / peak) * 32, (hour + 0.5) / 24);
      const start = this.windowStart();
      const inWindow = start !== null && (hour - start + 24) % 24 < 6;
      return {
        key: hour,
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
        peak: start === null ? false : inWindow,
        dim: start !== null && !inWindow,
      };
    });
  });
}

const RADAR_MIN_ROOM = 34;
const RADAR_GLYPH_WIDTH = 6.3;
const RADAR_SIDE_LABEL_INSET = 19.5;

interface ProfileAxis {
  label: string;
  value: number;
}

@Component({
  selector: 'app-chronicle-radar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="radar" direction="ltr" [attr.viewBox]="viewBox()" role="img" [attr.aria-label]="label()">
      @for (ring of rings; track ring) {
        <polygon class="ring" [attr.points]="ringPoints(ring)" />
      }
      @for (axis of labels(); track axis.label) {
        <line class="spoke" x1="100" y1="100" [attr.x2]="axis.tipX" [attr.y2]="axis.tipY" />
      }
      <polygon class="shape" [attr.points]="shape()" />
      @for (axis of labels(); track axis.label) {
        <circle class="node" [attr.cx]="axis.valueX" [attr.cy]="axis.valueY" r="3.4" />
        <text class="name" [attr.x]="axis.x" [attr.y]="axis.y" [attr.text-anchor]="axis.anchor">{{ axis.label }}</text>
        <text class="score" [attr.x]="axis.x" [attr.y]="axis.y + 13" [attr.text-anchor]="axis.anchor">
          {{ axis.value }}
        </text>
      }
    </svg>
  `,
  styles: `
    .radar {
      display: block;
      width: min(100%, 21rem);
      height: auto;
      margin: 0.4rem auto 0;
      overflow: visible;
    }
    .ring {
      fill: rgb(6 8 15 / 28%);
      stroke: rgb(246 239 223 / 20%);
    }
    .spoke {
      stroke: rgb(246 239 223 / 16%);
    }
    .shape {
      fill: rgb(230 189 108 / 42%);
      stroke: #ffd98a;
      stroke-width: 2.2;
      transform-origin: 100px 100px;
      animation: bloom 1s 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.15) backwards;
    }
    .node {
      fill: #fff4d6;
      animation: fade 0.4s 1s backwards;
    }
    .name {
      fill: #e8e1cf;
      font-size: 11.5px;
      font-weight: 600;
    }
    .score {
      fill: #e6bd6c;
      font-size: 13px;
      font-weight: 800;
    }
    @keyframes bloom {
      from {
        opacity: 0;
        transform: scale(0.2);
      }
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .shape,
      .node {
        animation: none;
      }
    }
  `,
})
export class ChronicleRadarComponent {
  public readonly axes = input.required<ProfileAxis[]>();
  public readonly label = input('');
  public readonly rings = [25, 50, 75, 100];
  public readonly viewBox = computed(() => {
    const longest = Math.max(...this.axes().map((axis) => [...axis.label].length));
    const room = Math.max(RADAR_MIN_ROOM, Math.ceil(longest * RADAR_GLYPH_WIDTH - RADAR_SIDE_LABEL_INSET));
    return `${-room} -8 ${200 + 2 * room} 216`;
  });

  public readonly labels = computed(() => {
    const axes = this.axes();
    return axes.map((axis, index) => {
      const fraction = index / axes.length;
      const tip = polar(80, fraction);
      const value = polar(80 * (Math.max(axis.value, 4) / 100), fraction);
      const text = polar(93, fraction);
      const side = text.x - 100;
      return {
        ...axis,
        tipX: tip.x,
        tipY: tip.y,
        valueX: value.x,
        valueY: value.y,
        x: text.x,
        y: index === 0 ? text.y - 8 : text.y,
        anchor: Math.abs(side) < 8 ? 'middle' : side > 0 ? 'start' : 'end',
      };
    });
  });
  public readonly shape = computed(() =>
    this.labels()
      .map((axis) => `${axis.valueX},${axis.valueY}`)
      .join(' '),
  );

  public ringPoints(ring: number): string {
    const count = this.axes().length;
    return Array.from({ length: count }, (_, index) => {
      const point = polar(80 * (ring / 100), index / count);
      return `${point.x},${point.y}`;
    }).join(' ');
  }
}

interface BannerSegment {
  name: string | null;
  from: string;
  to: string;
}

const RIBBON_COLOURS = ['#e6bd6c', '#7fb4ff', '#d98c6a', '#9ed3a4', '#c9a2e6', '#7fd6d0'];

@Component({
  selector: 'app-chronicle-ribbon',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ribbon" dir="ltr" aria-hidden="true">
      @for (part of parts(); track $index) {
        <span class="part" [style.flex-grow]="part.days" [style.background]="part.colour" [style.--i]="$index"></span>
      }
    </div>
    <ul class="legend">
      @for (part of legend(); track part.name) {
        <li>
          <span class="swatch" [style.background]="part.colour"></span>
          <span class="name" dir="auto">{{ part.name }}</span>
          <span class="dates">{{ 'chronicle.daysShort' | translate: { count: part.days } }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    .ribbon {
      display: flex;
      gap: 3px;
      height: 1.5rem;
      margin-top: 1.1rem;
    }
    .part {
      flex-basis: 6px;
      border-radius: 0.25rem;
      transform-origin: left;
      animation: unroll 0.7s calc(0.2s + var(--i) * 170ms) cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    .legend {
      margin: 0.8rem 0 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.15rem 0;
      font-size: 0.95rem;
    }
    .swatch {
      flex: none;
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 0.15rem;
    }
    .name {
      min-width: 0;
      overflow: hidden;
      color: #f6efdf;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dates {
      flex: none;
      margin-left: auto;
      color: #bdb6a4;
      font-size: 0.82rem;
    }
    @keyframes unroll {
      from {
        transform: scaleX(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .part {
        animation: none;
      }
    }
  `,
})
export class ChronicleRibbonComponent {
  public readonly segments = input.required<BannerSegment[]>();

  public readonly parts = computed(() =>
    this.segments().map((segment) => ({
      days: Math.max(1, (Date.parse(segment.to) - Date.parse(segment.from)) / 86_400_000),
      colour: segment.name === null ? 'rgb(246 239 223 / 22%)' : this.colours().get(segment.name),
    })),
  );
  public readonly legend = computed(() => {
    const segments = this.segments();
    const totals = new Map<string | null, number>();
    segments.forEach((segment, index) => {
      const days = Math.round((Date.parse(segment.to) - Date.parse(segment.from)) / 86_400_000);
      totals.set(segment.name, (totals.get(segment.name) ?? 0) + days + (index === segments.length - 1 ? 1 : 0));
    });
    return [...totals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, days]) => ({
        name: name ?? (this.translate.instant('chronicle.noAlly') as string),
        days: Math.max(1, days),
        colour: name === null ? 'rgb(246 239 223 / 22%)' : this.colours().get(name),
      }));
  });

  private readonly translate = inject(TranslateService);
  private readonly colours = computed(() => {
    const names = [...new Set(this.segments().map((segment) => segment.name ?? ''))];
    return new Map(names.map((name, index) => [name, RIBBON_COLOURS[index % RIBBON_COLOURS.length]]));
  });
}

export interface ReignTrack {
  start: number;
  end: number;
  rows: { tier: number; days: number; segments: [number, number][] }[];
  steady: boolean;
  places: { best: number; usual: number; worst: number };
}

const STANDING_TICKS = [100, 50, 20, 10, 5, 1];

@Component({
  selector: 'app-chronicle-reign',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="reign" dir="ltr" role="img" [attr.aria-label]="label()">
      @if (label()) {
        <p class="title">{{ label() }}</p>
      }
      @if (reign().steady) {
        <div class="standing">
          <div class="scale">
            <span class="band" [style.left.%]="standing().from" [style.width.%]="standing().width"></span>
            <span class="marker" [style.left.%]="standing().usual"
              ><i>#{{ standing().usualRank }}</i></span
            >
          </div>
          <div class="ticks" aria-hidden="true">
            @for (tick of standing().ticks; track tick.rank) {
              <span [style.left.%]="tick.left">#{{ tick.rank }}</span>
            }
          </div>
          <p class="standing-caption">{{ standing().caption }}</p>
        </div>
      } @else {
        @for (row of rows(); track row.tier; let position = $index) {
          <div class="row" [class.lead]="position === 0">
            <span class="tier">{{ row.name }}</span>
            <span class="track">
              @for (part of row.parts; track $index) {
                <span
                  class="held"
                  [style.left.%]="part.left"
                  [style.width.%]="part.width"
                  [style.--i]="position"
                ></span>
              }
            </span>
            <span class="days">{{ row.days }}</span>
          </div>
        }
        <div class="axis" aria-hidden="true">
          @for (month of months(); track month.key) {
            <span [style.left.%]="month.left">{{ month.label }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .reign {
      margin-top: 1.2rem;
      padding: 0.7rem 0.8rem 0.4rem;
      border: 1px solid rgb(230 189 108 / 28%);
      border-radius: 0.6rem;
      background: rgb(8 10 19 / 76%);
    }
    .title {
      margin: 0 0 0.35rem;
      color: #a9a290;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    :host-context([dir='rtl']) .title {
      letter-spacing: 0;
      text-align: right;
    }
    .standing {
      padding: 1.9rem 0.6rem 0.2rem;
    }
    .scale {
      position: relative;
      height: 0.7rem;
      border-radius: 0.35rem;
      background: rgb(246 239 223 / 11%);
    }
    .band {
      position: absolute;
      top: 0;
      bottom: 0;
      min-width: 0.7rem;
      border-radius: 0.35rem;
      background: #b78f42;
      transform-origin: right;
      animation: unroll 0.9s 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    .marker {
      position: absolute;
      top: 50%;
      width: 1rem;
      height: 1rem;
      margin: -0.5rem 0 0 -0.5rem;
      border: 2px solid #fff4d6;
      border-radius: 50%;
      background: #ffd98a;
      box-shadow: 0 0 10px rgb(255 217 138 / 80%);
      animation: fade 0.5s 1s backwards;
    }
    .marker i {
      position: absolute;
      bottom: 1.15rem;
      left: 50%;
      transform: translateX(-50%);
      color: #fff;
      font-size: 0.95rem;
      font-style: normal;
      font-weight: 800;
      white-space: nowrap;
    }
    .ticks {
      position: relative;
      height: 1.2rem;
      margin-top: 0.35rem;
      color: #a9a290;
      font-size: 0.7rem;
    }
    .ticks span {
      position: absolute;
      transform: translateX(-50%);
    }
    .ticks span:first-child {
      transform: none;
    }
    .ticks span:last-child {
      transform: translateX(-100%);
    }
    .standing-caption {
      margin: 0.3rem 0 0.2rem;
      color: #ffd98a;
      font-size: 0.92rem;
      font-weight: 700;
      text-align: center;
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    .row {
      display: grid;
      grid-template-columns: 4.2rem minmax(0, 1fr) 3.4rem;
      align-items: center;
      gap: 0.6rem;
      padding: 0.3rem 0;
      color: #bdb6a4;
      font-size: 0.85rem;
    }
    .row.lead {
      color: #ffd98a;
      font-size: 0.98rem;
      font-weight: 800;
    }
    .tier {
      white-space: nowrap;
    }
    .days {
      text-align: right;
      white-space: nowrap;
    }
    .track {
      position: relative;
      height: 0.7rem;
      border-radius: 0.35rem;
      background: rgb(246 239 223 / 11%);
      overflow: hidden;
    }
    .held {
      position: absolute;
      top: 0;
      bottom: 0;
      min-width: 2px;
      border-radius: 0.35rem;
      background: #b78f42;
      transform-origin: left;
      animation: unroll 0.9s calc(0.25s + var(--i) * 220ms) cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    .lead .held {
      background: #ffd98a;
      box-shadow: 0 0 10px rgb(255 217 138 / 70%);
    }
    .axis {
      position: relative;
      height: 1.1rem;
      margin: 0.2rem 4rem 0 4.8rem;
      color: #a9a290;
      font-size: 0.7rem;
    }
    .axis span {
      position: absolute;
      transform: translateX(-50%);
    }
    @keyframes unroll {
      from {
        transform: scaleX(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .held,
      .band,
      .marker {
        animation: none;
      }
    }
  `,
})
export class ChronicleReignComponent {
  public readonly reign = input.required<ReignTrack>();
  public readonly year = input.required<number>();
  public readonly label = input('');

  public readonly rows = computed(() => {
    const { start, rows } = this.reign();
    const span = this.span();
    return rows.map((row) => ({
      tier: row.tier,
      name: row.tier === 1 ? '#1' : (this.translate.instant('chronicle.ladderTop', { count: row.tier }) as string),
      days: this.translate.instant('chronicle.daysShort', { count: grouped(row.days) }) as string,
      parts: row.segments.map(([from, to]) => ({
        left: (100 * (from - start)) / span,
        width: (100 * (to - from + 1)) / span,
      })),
    }));
  });
  public readonly months = computed(() => {
    const { start, end } = this.reign();
    const span = this.span();
    const year = this.year();
    return Array.from({ length: 12 }, (_, index) => {
      const first = Math.round((Date.UTC(year, index, 1) - Date.UTC(year, 0, 1)) / 86_400_000);
      const middle = first + 15;
      return { key: index, first, left: (100 * (middle - start)) / span, label: monthInitial(year * 100 + index + 1) };
    }).filter((month) => month.first + 15 >= start && month.first + 15 < end);
  });

  public readonly standing = computed(() => {
    const { rows, places } = this.reign();
    const ceiling = Math.max(rows.at(-1)?.tier ?? 10, 10);
    const left = (rank: number): number => (100 * (Math.log10(ceiling) - Math.log10(rank))) / Math.log10(ceiling);
    const caption =
      places.best === places.worst
        ? this.translate.instant('chronicle.reignEveryDay', { rank: grouped(places.best) })
        : this.translate.instant('chronicle.reignUsual', { usual: grouped(places.usual), best: grouped(places.best) });
    return {
      from: left(places.worst),
      width: left(places.best) - left(places.worst),
      usual: left(places.usual),
      usualRank: grouped(places.usual),
      ticks: STANDING_TICKS.filter((rank) => rank <= ceiling).map((rank) => ({ rank, left: left(rank) })),
      caption: caption as string,
    };
  });

  private readonly translate = inject(TranslateService);
  private readonly span = computed(() => Math.max(this.reign().end - this.reign().start, 1));
}

@Component({
  selector: 'app-chronicle-day',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" aria-hidden="true">
      <div class="month">{{ monthName() }}</div>
      <div class="grid">
        @for (cell of cells(); track $index) {
          <span [class.blank]="cell === 0" [class.hit]="cell === dayOfMonth()">{{ cell || '' }}</span>
        }
      </div>
    </div>
  `,
  styles: `
    .wrap {
      width: 100%;
      max-width: 13.5rem;
      padding: 0.6rem 0.7rem 0.7rem;
      border: 1px solid rgb(230 189 108 / 35%);
      border-radius: 0.6rem;
      background: rgb(10 12 22 / 72%);
    }
    .month {
      margin-bottom: 0.35rem;
      color: #e6bd6c;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }
    :host-context([dir='rtl']) .month {
      letter-spacing: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    span {
      display: flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1;
      border-radius: 50%;
      color: #a9a290;
      font-size: 0.72rem;
    }
    .blank {
      visibility: hidden;
    }
    .hit {
      background: #ffd98a;
      color: #1a1408;
      font-weight: 800;
      box-shadow: 0 0 14px rgb(255 217 138 / 85%);
      animation: stamp 0.55s 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) backwards;
    }
    @keyframes stamp {
      from {
        opacity: 0;
        transform: scale(2.6);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .hit {
        animation: none;
      }
    }
  `,
})
export class ChronicleDayComponent {
  public readonly day = input.required<string>();

  public readonly dayOfMonth = computed(() => this.date().getUTCDate());
  public readonly monthName = computed(() => monthName(this.date().getUTCMonth() + 1));
  public readonly cells = computed(() => {
    const date = this.date();
    const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const length = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7;
    return [...Array.from({ length: offset }, () => 0), ...Array.from({ length }, (_, index) => index + 1)];
  });

  private readonly date = computed(() => new Date(`${this.day()}T12:00:00Z`));
}

const WORLD_BLUE = '#7fb4ff';

@Component({
  selector: 'app-chronicle-world',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="world" direction="ltr" viewBox="-40 -24 400 164" role="img" [attr.aria-label]="label()">
      <line class="base" x1="0" x2="320" y1="112" y2="112" />
      <text class="better" x="-36" y="-12">{{ 'chronicle.worldBetter' | translate }}</text>
      <path class="arrow" d="M-26 -6 V40 M-30 -1 L-26 -7 L-22 -1" />
      @if (horizonPath()) {
        <path class="line horizon" pathLength="1" [attr.d]="horizonPath()" [attr.stroke]="blue" />
      }
      @for (point of horizonPoints(); track point.index) {
        <circle class="dot" [attr.cx]="point.x" [attr.cy]="point.y" r="3" [attr.fill]="blue" />
      }
      @if (outerPath()) {
        <path class="line outer" pathLength="1" [attr.d]="outerPath()" />
      }
      @for (point of outerPoints(); track point.index) {
        <circle class="dot" [attr.cx]="point.x" [attr.cy]="point.y" r="3" fill="#e6bd6c" />
      }
      @if (best(); as point) {
        <circle class="best" [class.horizon]="point.horizon" [attr.cx]="point.x" [attr.cy]="point.y" r="5.5" />
        <text class="label" [attr.x]="point.x" [attr.y]="point.y - 11" text-anchor="middle">
          #{{ short(point.rank) }}
        </text>
      }
      @for (item of monthLabels(); track item.key) {
        <text class="month" [attr.x]="item.x" y="132" text-anchor="middle">{{ item.label }}</text>
      }
    </svg>
  `,
  styles: `
    .world {
      display: block;
      width: 100%;
      height: auto;
      margin-top: 0.4rem;
      overflow: visible;
    }
    .base {
      stroke: rgb(246 239 223 / 22%);
    }
    .better {
      fill: #bdb6a4;
      font-size: 10px;
    }
    .arrow {
      fill: none;
      stroke: rgb(246 239 223 / 40%);
    }
    .line {
      fill: none;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: draw 1.5s 0.25s cubic-bezier(0.65, 0, 0.2, 1) forwards;
    }
    .outer {
      stroke: #e6bd6c;
    }
    .dot {
      animation: fade 0.4s 1.2s both;
    }
    .best.horizon {
      fill: #7fb4ff;
      stroke: #e6f0ff;
    }
    .best {
      fill: #ffd98a;
      stroke: #fff4d6;
      stroke-width: 2;
      animation: fade 0.4s 1.5s both;
    }
    .label {
      fill: #fff;
      font-size: 14px;
      font-weight: 800;
      animation: fade 0.5s 1.5s both;
    }
    .month {
      fill: #bdb6a4;
      font-size: 12px;
    }
    @keyframes draw {
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .line {
        animation: none;
        stroke-dashoffset: 0;
      }
    }
  `,
})
export class ChronicleWorldComponent {
  public readonly outer = input.required<(number | null)[]>();
  public readonly horizon = input.required<(number | null)[]>();
  public readonly months = input.required<number[]>();
  public readonly label = input('');
  public readonly blue = WORLD_BLUE;

  public readonly outerPoints = computed(() => this.place(this.outer()));
  public readonly horizonPoints = computed(() => this.place(this.horizon()));
  public readonly outerPath = computed(() => smoothPath(this.outerPoints()));
  public readonly horizonPath = computed(() => smoothPath(this.horizonPoints()));
  public readonly best = computed(() => {
    const points = [
      ...this.outerPoints().map((point) => ({ ...point, horizon: false })),
      ...this.horizonPoints().map((point) => ({ ...point, horizon: true })),
    ];
    if (points.length === 0) return null;
    return points.reduce((top, point) => (point.rank < top.rank ? point : top));
  });
  public readonly monthLabels = computed(() => {
    const step = this.months().length > 1 ? 320 / (this.months().length - 1) : 0;
    return this.months().map((month, index) => ({ key: month, x: index * step, label: monthInitial(month) }));
  });

  private readonly scale = computed(() => {
    const ranks = [...this.outer(), ...this.horizon()].filter((rank): rank is number => rank !== null);
    return { worst: Math.log10(Math.max(...ranks, 2)), best: Math.log10(Math.max(Math.min(...ranks), 1)) };
  });

  public short(value: number): string {
    return grouped(value);
  }

  private place(series: (number | null)[]): (Point & { rank: number })[] {
    const { worst, best } = this.scale();
    const span = Math.max(worst - best, 0.0001);
    const step = series.length > 1 ? 320 / (series.length - 1) : 0;
    return series.flatMap((rank, index) => {
      if (rank === null) return [];
      const y = 8 + ((Math.log10(Math.max(rank, 1)) - best) / span) * 92;
      return [{ x: index * step, y, value: rank, index, rank }];
    });
  }
}

@Component({
  selector: 'app-chronicle-rank',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="rank" direction="ltr" viewBox="-40 -30 400 170" role="img" [attr.aria-label]="label()">
      <line class="base" x1="0" x2="320" y1="112" y2="112" />
      <text class="better" x="-36" y="-14">{{ 'chronicle.worldBetter' | translate }}</text>
      <path class="arrow" d="M-26 -6 V40 M-30 -1 L-26 -7 L-22 -1" />
      <path class="area" [attr.d]="area()" />
      <path class="line" pathLength="1" [attr.d]="path()" />
      @if (first(); as point) {
        <circle class="dot" [attr.cx]="point.x" [attr.cy]="point.y" r="3.4" />
        <text class="value" [attr.x]="point.x + 4" [attr.y]="point.y - 10">#{{ short(point.rank) }}</text>
      }
      @if (last(); as point) {
        <circle class="dot end" [attr.cx]="point.x" [attr.cy]="point.y" r="5.5" />
        <text class="value strong" [attr.x]="point.x" [attr.y]="point.y - 12" text-anchor="end">
          #{{ short(point.rank) }}
        </text>
      }
      @for (item of monthLabels(); track item.key) {
        <text class="month" [attr.x]="item.x" y="132" text-anchor="middle">{{ item.label }}</text>
      }
    </svg>
  `,
  styles: `
    .rank {
      display: block;
      width: 100%;
      height: auto;
      margin-top: 0.6rem;
      overflow: visible;
    }
    .base {
      stroke: rgb(246 239 223 / 22%);
    }
    .better {
      fill: #bdb6a4;
      font-size: 10px;
    }
    .arrow {
      fill: none;
      stroke: rgb(246 239 223 / 40%);
    }
    .area {
      fill: rgb(230 189 108 / 16%);
      animation: fade 1.2s 0.7s both;
    }
    .line {
      fill: none;
      stroke: #e6bd6c;
      stroke-width: 3.2;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      animation: draw 1.5s 0.25s cubic-bezier(0.65, 0, 0.2, 1) forwards;
    }
    .dot {
      fill: #e6bd6c;
      animation: fade 0.4s 1.5s both;
    }
    .dot.end {
      fill: #ffd98a;
      stroke: #fff4d6;
      stroke-width: 2;
    }
    .value {
      fill: #e8e1cf;
      font-size: 13px;
      font-weight: 600;
      paint-order: stroke;
      stroke: rgb(8 10 19 / 85%);
      stroke-width: 4px;
      stroke-linejoin: round;
      animation: fade 0.5s 1.5s both;
    }
    .value.strong {
      fill: #fff;
      font-size: 15px;
      font-weight: 800;
    }
    .month {
      fill: #bdb6a4;
      font-size: 12px;
    }
    @keyframes draw {
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes fade {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .line {
        animation: none;
        stroke-dashoffset: 0;
      }
    }
  `,
})
export class ChronicleRankComponent {
  public readonly ranks = input.required<(number | null)[]>();
  public readonly months = input.required<number[]>();
  public readonly label = input('');

  public readonly points = computed(() => {
    const ranks = this.ranks().filter((rank): rank is number => rank !== null);
    const worst = Math.log10(Math.max(...ranks, 2));
    const best = Math.log10(Math.max(Math.min(...ranks), 1));
    const span = Math.max(worst - best, 0.0001);
    const step = this.ranks().length > 1 ? 320 / (this.ranks().length - 1) : 0;
    return this.ranks().flatMap((rank, index) => {
      if (rank === null) return [];
      const y = 8 + ((Math.log10(Math.max(rank, 1)) - best) / span) * 92;
      return [{ x: index * step, y, value: rank, index, rank }];
    });
  });
  public readonly path = computed(() => smoothPath(this.points()));
  public readonly area = computed(() => {
    const points = this.points();
    if (points.length === 0) return '';
    return `${smoothPath(points)} L${points.at(-1)!.x} 112 L${points[0].x} 112 Z`;
  });
  public readonly first = computed(() => this.points()[0] ?? null);
  public readonly last = computed(() => this.points().at(-1) ?? null);
  public readonly monthLabels = computed(() => {
    const step = this.months().length > 1 ? 320 / (this.months().length - 1) : 0;
    return this.months().map((month, index) => ({ key: month, x: index * step, label: monthInitial(month) }));
  });

  public short(value: number): string {
    return grouped(value);
  }
}

export interface LadderRung {
  name: string;
  points: string;
  state: 'past' | 'now' | 'next' | 'ahead';
  progress: number;
}

@Component({
  selector: 'app-chronicle-ladder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="ladder">
      @for (rung of ordered(); track rung.name; let position = $index) {
        <li [class]="rung.state" [style.--i]="position">
          <span class="mark" aria-hidden="true"></span>
          <span class="name">{{ rung.name }}</span>
          <span class="points">{{ rung.points }}</span>
          @if (rung.state === 'next' && rung.progress > 0) {
            <span class="bar" aria-hidden="true"><span [style.width.%]="rung.progress"></span></span>
          }
        </li>
      }
    </ol>
  `,
  styles: `
    .ladder {
      margin: 0.7rem 0 0;
      padding: 0.45rem 0.7rem;
      border: 1px solid rgb(230 189 108 / 28%);
      border-radius: 0.6rem;
      background: rgb(8 10 19 / 76%);
      list-style: none;
    }
    li {
      display: grid;
      grid-template-columns: 0.8rem minmax(0, 1fr) auto;
      grid-template-areas:
        'mark name points'
        'mark bar bar';
      align-items: center;
      gap: 0 0.55rem;
      padding: 0.2rem 0;
      color: #bdb6a4;
      font-size: 0.92rem;
      animation: climb 0.5s calc(0.2s + (3 - var(--i)) * 120ms) cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    .mark {
      grid-area: mark;
      width: 0.62rem;
      height: 0.62rem;
      border: 1px solid #b78f42;
      border-radius: 50%;
    }
    .name {
      grid-area: name;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .points {
      grid-area: points;
      font-size: 0.82rem;
    }
    .past .mark {
      background: #b78f42;
    }
    .now {
      color: #ffd98a;
      font-size: 1.02rem;
      font-weight: 800;
    }
    .now .mark {
      border-color: #fff4d6;
      background: #ffd98a;
      box-shadow: 0 0 10px rgb(255 217 138 / 90%);
    }
    .next {
      color: #f0e9d7;
    }
    .bar {
      grid-area: bar;
      display: block;
      height: 0.3rem;
      margin-top: 0.2rem;
      border-radius: 0.2rem;
      background: rgb(246 239 223 / 14%);
    }
    .bar span {
      display: block;
      height: 100%;
      border-radius: 0.2rem;
      background: #e6bd6c;
      transform-origin: left;
      animation: grow 1s 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    @keyframes climb {
      from {
        opacity: 0;
        transform: translateY(0.6rem);
      }
    }
    @keyframes grow {
      from {
        transform: scaleX(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      li,
      .bar span {
        animation: none;
      }
    }
  `,
})
export class ChronicleLadderComponent {
  public readonly rungs = input.required<LadderRung[]>();
  public readonly ordered = computed(() => [...this.rungs()].reverse());
}

@Component({
  selector: 'app-chronicle-ring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle class="back" cx="60" cy="60" r="50" />
      <circle class="front" cx="60" cy="60" r="50" pathLength="100" [style.--share]="share()" />
      <text x="60" y="66" text-anchor="middle">{{ share() }}%</text>
    </svg>
  `,
  styles: `
    .ring {
      display: block;
      width: 100%;
      max-width: 8rem;
      height: auto;
    }
    circle {
      fill: none;
      stroke-width: 10;
    }
    .back {
      stroke: rgb(246 239 223 / 16%);
    }
    .front {
      stroke: #ffd98a;
      stroke-linecap: round;
      stroke-dasharray: var(--share) 100;
      transform: rotate(-90deg);
      transform-origin: center;
      animation: sweep 1.2s 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    }
    text {
      fill: #fff;
      font-size: 24px;
      font-weight: 800;
    }
    @keyframes sweep {
      from {
        stroke-dasharray: 0 100;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .front {
        animation: none;
      }
    }
  `,
})
export class ChronicleRingComponent {
  public readonly share = input.required<number>();
}
