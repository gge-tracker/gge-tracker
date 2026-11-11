import { ChronicleCardCopy } from './chronicle-card-copy';
import { ShareCardRenderer } from './share-card-renderer';

export interface ChronicleCardSize {
  width: number;
  height: number;
}

export const CHRONICLE_LINK_CARD: ChronicleCardSize = { width: 1200, height: 630 };
export const CHRONICLE_STORY_CARD: ChronicleCardSize = { width: 1080, height: 1920 };

export interface ChronicleCardData {
  year: number;
  server: string;
  name: string;
  allianceName: string | null;
  persona: string | null;
  mightGain: number;
  mightHigherThanPct: number;
  reign: { tier: number; days: number; longest: number } | null;
  climb: { first: number; last: number; places: number } | null;
  lootTotal: number;
  lootHigherThanPct: number;
  eventRuns: number;
  activeDays: number;
  monthly: (number | null)[];
  profile: { might: number; loot: number; events: number; glory: number; activity: number; loyalty: number } | null;
  dataRange: string;
}

export interface ChronicleCardAssets {
  backdrop: string;
  backdropTall: string;
  titleFont: string;
  numberFont: string;
}

interface CardStat {
  label: string;
  value: string;
  note: string | null;
}

// Same rule as the verdict page: a profile with one strong area is a dot, not a shape worth comparing
const PROFILE_STRONG_SCORE = 40;
const PROFILE_MIN_STRONG_AREAS = 2;
const LABEL_LETTER_SPACING = 2;
const LABEL_GLYPH_WIDTH = 0.68;

export abstract class ChronicleCard {
  public static html(
    data: ChronicleCardData,
    size: ChronicleCardSize,
    assets: ChronicleCardAssets,
    copy: ChronicleCardCopy,
  ): string {
    const isStory = size.height > size.width;
    const rtl = copy.isRightToLeft;
    const spaced = (pixels: number): number => (rtl ? 0 : pixels);
    const text = (key: string, parameters?: Record<string, string | number>): string =>
      ShareCardRenderer.escape(copy.text(key, parameters));
    const stats = this.stats(data, copy);
    const alliance = data.allianceName ? ` &middot; ${ShareCardRenderer.escape(data.allianceName)}` : '';
    const personaHtml =
      data.persona && copy.has(`p_${data.persona}`)
        ? `<div class="persona"><div class="persona-label">${text('verdictEye')}</div><div class="persona-title">${text(`p_${data.persona}`)}</div><div class="persona-line">${text(`pl_${data.persona}`)}</div></div>`
        : '';
    const figure = this.profile(data, isStory, copy) ?? this.curve(data.monthly, isStory, text('cardCurve'));

    return `<!doctype html>
<html lang="${copy.lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
@font-face { font-family: "Chronicle Title"; src: url("${assets.titleFont}") format("woff2"); }
@font-face { font-family: "Chronicle Number"; src: url("${assets.numberFont}") format("woff2"); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${size.width}px; height: ${size.height}px; overflow: hidden; }
body {
  position: relative; display: flex; flex-direction: column; color: #f6efdf;
  font-family: "Chronicle Number", "Noto Sans", "Noto Sans CJK SC", "Noto Sans Arabic", "DejaVu Sans", sans-serif;
  padding: ${isStory ? '110px 76px 80px' : '46px 60px 34px'};
  background: #0a0d18 url("${isStory ? assets.backdropTall : assets.backdrop}") center ${isStory ? 'top' : 'center'} / cover no-repeat;
}
body::before {
  content: ""; position: absolute; inset: 0;
  background: ${
    isStory
      ? 'linear-gradient(180deg, rgba(8,10,20,.78) 0%, rgba(8,10,20,.25) 22%, rgba(8,10,20,.3) 38%, rgba(8,10,20,.93) 56%, rgba(8,10,20,.98) 100%)'
      : 'linear-gradient(100deg, rgba(8,10,20,.95) 0%, rgba(8,10,20,.84) 55%, rgba(8,10,20,.5) 100%)'
  };
}
body > * { position: relative; }
.eyebrow { font-size: ${isStory ? 38 : 25}px; font-weight: 600; letter-spacing: ${spaced(isStory ? 10 : 7)}px; color: #e6bd6c; text-transform: uppercase; }
.name, .origin { text-align: ${rtl ? 'right' : 'left'}; }
.name {
  font-family: "Chronicle Title", "Noto Serif", "Noto Sans CJK SC", "Noto Sans Arabic", serif;
  margin-top: ${isStory ? 34 : 14}px; line-height: 1.08; text-shadow: 0 4px 22px rgba(0,0,0,.85); font-size: ${this.nameSize(data.name, isStory)}px;
  overflow: hidden; text-overflow: ellipsis; ${isStory ? 'overflow-wrap: anywhere;' : 'white-space: nowrap;'}
}
.origin { margin-top: ${isStory ? 22 : 8}px; font-size: ${isStory ? 40 : 27}px; color: #c9c2b0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.middle { display: flex; ${isStory ? 'flex-direction: column; margin-top: auto; gap: 34px;' : 'align-items: center; justify-content: space-between; gap: 40px; margin-top: 20px;'} }
.curve-box { ${isStory ? 'width: 100%;' : 'width: 400px; flex: none; padding: 14px 18px 10px; border-radius: 14px; background: rgba(14,17,30,.66); border: 1px solid rgba(230,189,108,.26);'} }
.curve-title { font-size: ${isStory ? 28 : 16}px; letter-spacing: ${spaced(2)}px; color: #a9a290; text-transform: uppercase; margin-bottom: ${isStory ? 14 : 6}px; }
.curve { direction: ltr; display: block; width: 100%; height: auto; overflow: visible; }
.curve-value { fill: #fff; font-weight: 800; }
.curve-line { fill: none; stroke: #ffd98a; stroke-width: ${isStory ? 5 : 4}; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 8px rgba(255,217,138,.55)); }
.curve-end { fill: #fff4d6; }
.profile { direction: ltr; display: block; height: ${isStory ? 430 : 300}px; width: auto; max-width: 100%; margin: 0 auto; overflow: visible; }
${this.profileLayout(isStory, rtl)}
.profile .ring { fill: rgba(6,8,15,.3); stroke: rgba(246,239,223,.2); }
.profile .shape { fill: rgba(230,189,108,.42); stroke: #ffd98a; stroke-width: 2.4; }
.profile .axis { fill: #e8e1cf; font-size: 17px; font-weight: 600; }
.profile .score { fill: #e6bd6c; font-weight: 800; }
.persona { min-width: 0; }
.persona-label { font-size: ${isStory ? 28 : 18}px; letter-spacing: ${spaced(4)}px; color: #a9a290; text-transform: uppercase; }
.persona-title { font-family: "Chronicle Title", "Noto Serif", "Noto Sans Arabic", serif; color: #e6bd6c; font-size: ${isStory ? 104 : 56}px; line-height: 1.1; margin-top: ${isStory ? 14 : 2}px; }
.persona-line { font-size: ${isStory ? 40 : 24}px; color: #e8e1cf; margin-top: ${isStory ? 10 : 0}px; }
.stats { margin-top: ${isStory ? '74px' : 'auto'}; display: grid; grid-template-columns: repeat(${isStory ? 2 : Math.max(stats.length, 1)}, 1fr); gap: ${isStory ? '26px' : '16px'}; }
.stat { padding: ${isStory ? '32px 34px' : '16px 20px'}; border-radius: 14px; background: rgba(14,17,30,.76); border: 1px solid rgba(230,189,108,.32); }
.stat { min-width: 0; }
.stat-label { font-size: ${this.labelSize(stats, isStory)}px; letter-spacing: ${spaced(2)}px; color: #a9a290; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stat-value { direction: ltr; text-align: ${rtl ? 'right' : 'left'}; font-weight: 800; font-size: ${isStory ? 88 : 46}px; line-height: 1.15; white-space: nowrap; }
.stat-note { font-size: ${isStory ? 28 : 17}px; color: #e6bd6c; white-space: nowrap; min-height: 1.2em; }
.footer { margin-top: ${isStory ? 56 : 16}px; font-size: ${isStory ? 28 : 17}px; color: #9a9483; display: flex; justify-content: space-between; gap: 24px; }
.site { color: #f6efdf; font-weight: 600; }
</style></head>
<body class="${figure?.includes('profile-box') ? 'has-profile' : ''}">
<div class="eyebrow">${text('title', { year: data.year })}</div>
<div class="name" dir="auto">${ShareCardRenderer.escape(data.name)}</div>
<div class="origin" dir="auto">${ShareCardRenderer.escape(data.server)}${alliance}</div>
<div class="middle">${personaHtml}${figure}</div>
<div class="stats">${stats.map((stat) => this.statHtml(stat)).join('')}</div>
<div class="footer"><span class="site">gge-tracker.com</span><span>${ShareCardRenderer.escape(data.dataRange)}</span></div>
</body></html>`;
  }

  private static profileLayout(isStory: boolean, rtl: boolean): string {
    if (isStory) return '';
    const side = rtl ? 'left' : 'right';
    return `.profile-box { position: absolute; top: 46px; ${side}: 60px; width: 480px; height: 364px; display: flex; flex-direction: column; }
.profile-box .profile { margin: auto; }
body.has-profile .middle { position: static; }
body.has-profile .persona { position: relative; }
body.has-profile .name, body.has-profile .origin, body.has-profile .persona { max-width: 580px; }`;
  }

  private static profile(data: ChronicleCardData, isStory: boolean, copy: ChronicleCardCopy): string | null {
    const profile = data.profile;
    if (!profile) return null;
    const axes = [
      { label: copy.text('axisMight'), value: profile.might },
      { label: copy.text('axisLoot'), value: profile.loot },
      { label: copy.text('scoreEvents'), value: profile.events },
      { label: copy.text('axisGlory'), value: profile.glory },
      { label: copy.text('axisActivity'), value: profile.activity },
      { label: copy.text('axisLoyalty'), value: profile.loyalty },
    ];
    if (axes.filter((axis) => axis.value >= PROFILE_STRONG_SCORE).length < PROFILE_MIN_STRONG_AREAS) return null;
    const point = (radius: number, index: number): { x: number; y: number } => {
      const angle = (index / axes.length) * 2 * Math.PI - Math.PI / 2;
      return { x: 100 + radius * Math.cos(angle), y: 100 + radius * Math.sin(angle) };
    };
    const ring = (share: number): string =>
      axes
        .map((_, index) => point(78 * share, index))
        .map(({ x, y }) => `${x},${y}`)
        .join(' ');
    const shape = axes
      .map((axis, index) => point(78 * (Math.max(axis.value, 4) / 100), index))
      .map(({ x, y }) => `${x},${y}`)
      .join(' ');
    const labels = axes
      .map((axis, index) => {
        const { x, y } = point(92, index);
        const anchor = Math.abs(x - 100) < 8 ? 'middle' : x > 100 ? 'start' : 'end';
        const shifted = index === 0 ? y - 4 : index === 3 ? y + 12 : y + 5;
        return `<text x="${x}" y="${shifted}" text-anchor="${anchor}" class="axis">${ShareCardRenderer.escape(axis.label)} <tspan class="score">${axis.value}</tspan></text>`;
      })
      .join('');
    const rings = [0.25, 0.5, 0.75, 1].map((share) => `<polygon class="ring" points="${ring(share)}"/>`).join('');
    const title = ShareCardRenderer.escape(copy.text('cardProfile', { server: data.server }));
    return `<div class="curve-box profile-box"><div class="curve-title">${title}</div><svg class="profile" viewBox="-95 -14 390 232" xmlns="http://www.w3.org/2000/svg">${rings}<polygon class="shape" points="${shape}"/>${labels}</svg></div>`;
  }

  private static curve(monthly: (number | null)[], isStory: boolean, title: string): string {
    const values = monthly.flatMap((value, index) => (value === null ? [] : [{ value, index }]));
    if (values.length < 3 || new Set(values.map((point) => point.value)).size < 2) return '';
    const width = isStory ? 928 : 380;
    const height = isStory ? 210 : 112;
    const labelRoom = isStory ? 150 : 76;
    const plotWidth = width - labelRoom;
    const numbers = values.map((point) => point.value);
    const low = Math.min(...numbers);
    const span = Math.max(Math.max(...numbers) - low, 1);
    const points = values.map(({ value, index }) => ({
      x: (index / Math.max(monthly.length - 1, 1)) * plotWidth,
      y: height - 18 - ((value - low) / span) * (height - 36),
    }));
    const line = points.reduce((path, point, index) => {
      if (index === 0) return `M${point.x} ${point.y}`;
      const previous = points[index - 1];
      const middle = (previous.x + point.x) / 2;
      return `${path} C${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y}`;
    }, '');
    const end = points.at(-1)!;
    const fontSize = isStory ? 38 : 24;
    return `<div class="curve-box"><div class="curve-title">${title}</div><svg class="curve" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e6bd6c" stop-opacity=".42"/><stop offset="1" stop-color="#e6bd6c" stop-opacity="0"/></linearGradient></defs><path d="${line} L${end.x} ${height} L${points[0].x} ${height} Z" fill="url(#fill)"/><path class="curve-line" d="${line}"/><circle class="curve-end" cx="${end.x}" cy="${end.y}" r="${isStory ? 10 : 6}"/><text class="curve-value" x="${end.x + (isStory ? 20 : 12)}" y="${end.y + fontSize / 3}" font-size="${fontSize}">${ShareCardRenderer.compact(values.at(-1)!.value)}</text></svg></div>`;
  }

  private static stats(data: ChronicleCardData, copy: ChronicleCardCopy): CardStat[] {
    const stats: (CardStat | null)[] = [
      this.reignStat(data, copy) ?? this.climbStat(data, copy) ?? this.mightStat(data, copy),
      data.lootTotal > 0
        ? {
            label: copy.text('cardLoot'),
            value: ShareCardRenderer.compact(data.lootTotal),
            note: this.rankingNote(data.lootHigherThanPct, data.server, copy),
          }
        : null,
      data.eventRuns > 0
        ? { label: copy.text('eventsLead'), value: ShareCardRenderer.grouped(data.eventRuns), note: null }
        : null,
      data.activeDays > 0
        ? { label: copy.text('cardDays'), value: ShareCardRenderer.grouped(data.activeDays), note: null }
        : null,
    ];
    return stats.filter((stat): stat is CardStat => stat !== null);
  }

  private static reignStat(data: ChronicleCardData, copy: ChronicleCardCopy): CardStat | null {
    const reign = data.reign;
    if (!reign) return null;
    return {
      label: reign.tier === 1 ? copy.text('cardReign1') : copy.text('cardReignTop', { count: reign.tier }),
      value: ShareCardRenderer.grouped(reign.days),
      note: reign.longest < reign.days ? copy.text('cardReignLongest', { count: reign.longest }) : null,
    };
  }

  private static climbStat(data: ChronicleCardData, copy: ChronicleCardCopy): CardStat | null {
    const climb = data.climb;
    if (!climb) return null;
    return {
      label: copy.text('cardPlaces'),
      value: `+${ShareCardRenderer.grouped(climb.places)}`,
      note: `#${ShareCardRenderer.grouped(climb.first)} → #${ShareCardRenderer.grouped(climb.last)}`,
    };
  }

  private static mightStat(data: ChronicleCardData, copy: ChronicleCardCopy): CardStat | null {
    if (data.mightGain <= 0) return null;
    return {
      label: copy.text('cardMight'),
      value: `+${ShareCardRenderer.compact(data.mightGain)}`,
      note: this.rankingNote(data.mightHigherThanPct, data.server, copy),
    };
  }

  private static labelSize(stats: CardStat[], isStory: boolean): number {
    const columns = isStory ? 2 : Math.max(stats.length, 1);
    const [width, gap, padding, largest] = isStory ? [928, 26, 70, 28] : [1080, 16, 42, 17];
    const room = (width - gap * (columns - 1)) / columns - padding;
    const longest = Math.max(...stats.map((stat) => [...stat.label].length), 1);
    return Math.min(largest, Math.floor((room / longest - LABEL_LETTER_SPACING) / LABEL_GLYPH_WIDTH));
  }

  private static rankingNote(higherThanPct: number, server: string, copy: ChronicleCardCopy): string | null {
    return higherThanPct >= 50 ? copy.text('cardTop', { pct: Math.max(1, 100 - higherThanPct), server }) : null;
  }

  private static statHtml(stat: CardStat): string {
    const note = stat.note ? ShareCardRenderer.escape(stat.note) : '&nbsp;';
    return `<div class="stat"><div class="stat-label">${ShareCardRenderer.escape(stat.label)}</div><div class="stat-value">${stat.value}</div><div class="stat-note">${note}</div></div>`;
  }

  private static nameSize(name: string, isStory: boolean): number {
    const length = [...name].length;
    if (isStory) return length <= 12 ? 138 : length <= 20 ? 112 : 84;
    return length <= 14 ? 88 : length <= 22 ? 70 : 52;
  }
}
