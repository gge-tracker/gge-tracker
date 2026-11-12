import { ShareCardChrome } from './share-card-chrome';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH, ShareCardRenderer } from './share-card-renderer';

export interface PodiumTrackedStats {
  might: number;
  mightRank: number;
}

export interface PodiumEntry {
  rank: number;
  name: string;
  server: string;
  alliance: string | null;
  points: number;
  level: number;
  legendaryLevel: number;
  tracked: PodiumTrackedStats | null;
}

export interface EventPodium {
  eventName: string;
  eventNumber: number;
  collectedAt: string | null;
  playerCount: number;
  serverCount: number;
  path: string;
  entries: PodiumEntry[];
}

export abstract class EventPodiumCard {
  private static readonly STEP_ORDER = [2, 1, 3];
  private static readonly STEP_HEIGHTS: Record<number, number> = { 1: 300, 2: 276, 3: 252 };
  private static readonly RANK_LABELS: Record<number, string> = { 1: '1st place', 2: '2nd place', 3: '3rd place' };

  public static toHtml(podium: EventPodium, displayUrl: string): string {
    const escape = ShareCardRenderer.escape.bind(ShareCardRenderer);
    const pointsSize = this.pointsSize(podium.entries);
    const columns = this.STEP_ORDER.map((rank) =>
      this.columnHtml(
        rank,
        podium.entries.find((entry) => entry.rank === rank),
        pointsSize,
      ),
    );
    const date = podium.collectedAt ? `${this.formatDate(podium.collectedAt)} · ` : '';
    const css = `
.title { margin-top: 8px; font-size: 64px; font-weight: 800; line-height: 1.05; letter-spacing: -1.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subtitle { margin-top: 6px; font-size: 24px; font-weight: 500; color: #8a94a3; }
.podium { margin-top: auto; display: flex; align-items: flex-end; gap: 20px; }
.step { flex: 1; min-width: 0; padding: 16px 24px 18px; display: flex; flex-direction: column; }
.rank { font-size: 16px; font-weight: 800; letter-spacing: 2.5px; color: #6b4423; text-transform: uppercase; }
.name { margin-top: 6px; font-weight: 800; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alliance { margin-top: 2px; font-size: 19px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alliance.none, .meta { color: #7a6038; }
.meta { margin-top: 2px; font-size: 16px; font-weight: 600; white-space: nowrap; }
.points-row { margin-top: auto; display: flex; align-items: baseline; gap: 10px; }
.points { font-weight: 800; letter-spacing: -1px; white-space: nowrap; }
.tracked { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(110, 78, 36, 0.22); display: flex; gap: 22px; }
.tracked > div { display: flex; align-items: baseline; gap: 8px; }
.tracked .value { font-size: 20px; font-weight: 800; white-space: nowrap; }
.tracked .label { font-size: 13px; letter-spacing: 2px; }
.empty { color: #7a6038; font-size: 28px; }`;
    const body =
      ShareCardChrome.topBar(displayUrl, escape) +
      `<div class="content">
${ShareCardChrome.kicker(`#${podium.eventNumber}`, 'Final leaderboard', escape)}
<div class="title">${escape(podium.eventName)}</div>
<div class="subtitle">${escape(date)}${ShareCardRenderer.grouped(podium.playerCount)} players · ${ShareCardRenderer.grouped(podium.serverCount)} servers</div>
<div class="podium">${columns.join('')}</div>
</div>`;
    return ShareCardChrome.document(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT, css, body);
  }

  private static columnHtml(rank: number, entry: PodiumEntry | undefined, pointsSize: number): string {
    const escape = ShareCardRenderer.escape.bind(ShareCardRenderer);
    const open = `<div class="step parchment" style="height: ${this.STEP_HEIGHTS[rank]}px"><div class="rank">${this.RANK_LABELS[rank]}</div>`;
    if (!entry) return `${open}<div class="name empty">-</div></div>`;
    const level = entry.legendaryLevel > 0 ? `Lvl ${entry.level} · ${entry.legendaryLevel}` : `Lvl ${entry.level}`;
    const alliance = entry.alliance
      ? `<div class="alliance">${escape(entry.alliance)}</div>`
      : '<div class="alliance none">No alliance</div>';
    return `${open}
      <div class="name" style="font-size: ${this.nameSize(entry.name)}px">${escape(entry.name)}</div>
      ${alliance}
      <div class="meta">${escape(entry.server)} · ${level}</div>
      <div class="points-row"><div class="points" style="font-size: ${pointsSize}px">${ShareCardRenderer.grouped(entry.points)}</div><div class="label">points</div></div>
      ${this.trackedHtml(entry)}
      </div>`;
  }

  private static trackedHtml(entry: PodiumEntry): string {
    const tracked = entry.tracked;
    if (!tracked) {
      return `<div class="tracked unknown"><div><div class="value">?</div><div class="label">not on gge tracker</div></div></div>`;
    }
    return `<div class="tracked">
      <div><div class="value">${ShareCardRenderer.compact(tracked.might)}</div><div class="label">might</div></div>
      <div><div class="value">#${ShareCardRenderer.grouped(tracked.mightRank)}</div><div class="label">might rank</div></div>
      </div>`;
  }

  private static nameSize(name: string): number {
    const length = [...name].length;
    if (length <= 10) return 34;
    if (length <= 14) return 29;
    if (length <= 18) return 24;
    return 21;
  }

  private static pointsSize(entries: PodiumEntry[]): number {
    const longest = Math.max(...entries.map((entry) => ShareCardRenderer.grouped(entry.points).length));
    if (longest <= 10) return 40;
    if (longest <= 13) return 34;
    return 28;
  }

  private static formatDate(value: string): string {
    return new Date(value).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
}
