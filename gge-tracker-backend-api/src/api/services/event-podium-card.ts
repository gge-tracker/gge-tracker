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
  private static readonly STEP_HEIGHTS: Record<number, number> = { 1: 228, 2: 190, 3: 162 };
  private static readonly MEDAL_COLORS: Record<number, string> = { 1: '#f5c451', 2: '#cfd8e3', 3: '#d9895b' };

  public static toHtml(podium: EventPodium, displayUrl: string): string {
    const escape = ShareCardRenderer.escape.bind(ShareCardRenderer);
    const pointsSize = this.pointsSize(podium.entries);
    const steps = this.STEP_ORDER.map((rank) =>
      this.stepHtml(
        rank,
        podium.entries.find((entry) => entry.rank === rank),
        pointsSize,
      ),
    );
    const date = podium.collectedAt ? `<div class="date">${escape(this.formatDate(podium.collectedAt))}</div>` : '';
    return `<!doctype html>
    <html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${SHARE_CARD_WIDTH}px; height: ${SHARE_CARD_HEIGHT}px; overflow: hidden; }
    body {
      font-family: "DejaVu Sans", "FreeSans", "Liberation Sans", Arial, sans-serif;
      color: #eef2ff;
      background:
        radial-gradient(420px 360px at 50% 62%, rgba(245, 196, 81, 0.22), transparent 70%),
        radial-gradient(900px 520px at 88% -10%, rgba(58, 83, 221, 0.55), transparent 60%),
        radial-gradient(700px 420px at -5% 110%, rgba(62, 157, 149, 0.35), transparent 60%),
        linear-gradient(160deg, #0b1636 0%, #060d1f 70%);
      padding: 36px 64px 30px;
      display: flex; flex-direction: column;
    }
    .top { display: flex; align-items: center; justify-content: space-between; }
    .brand { font-size: 24px; font-weight: bold; letter-spacing: 6px; color: #c7d2fe; }
    .brand span { color: #6ee7d8; }
    .event {
      font-size: 22px; font-weight: bold; letter-spacing: 2px; padding: 8px 20px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.08); border: 2px solid rgba(199, 210, 254, 0.35);
    }
    .heading { margin-top: 18px; display: flex; align-items: baseline; justify-content: space-between; }
    .kind { font-size: 34px; font-weight: bold; letter-spacing: 1px; }
    .kind small { font-size: 20px; letter-spacing: 4px; color: #6ee7d8; margin-left: 14px; text-transform: uppercase; }
    .date { font-size: 20px; color: #94a3d8; }
    .podium { margin-top: auto; display: flex; align-items: flex-end; justify-content: center; gap: 26px; }
    .column { width: 336px; display: flex; flex-direction: column; align-items: center; }
    .medal {
      width: 58px; height: 58px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 30px; font-weight: bold; color: #0b1636; border: 3px solid rgba(255, 255, 255, 0.55);
    }
    .name {
      margin-top: 10px; max-width: 100%; font-weight: bold; line-height: 1.15;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .alliance {
      margin-top: 4px; max-width: 100%; font-size: 21px; color: #a5b4fc;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .meta { margin-top: 4px; margin-bottom: 12px; font-size: 18px; color: #94a3d8; letter-spacing: 1px; white-space: nowrap; }
    .step {
      width: 100%; border-radius: 18px 18px 0 0; padding: 18px 22px 0;
      border: 1px solid rgba(199, 210, 254, 0.18); border-bottom: none;
      display: flex; flex-direction: column; align-items: center;
    }
    .points { font-weight: bold; white-space: nowrap; }
    .label { font-size: 15px; letter-spacing: 3px; color: #94a3d8; text-transform: uppercase; white-space: nowrap; }
    .tracked {
      margin-top: 14px; width: 100%; padding-top: 12px; border-top: 1px solid rgba(199, 210, 254, 0.18);
      display: flex; justify-content: space-around; text-align: center;
    }
    .tracked .value { font-size: 26px; font-weight: bold; white-space: nowrap; }
    .tracked.unknown .value { color: #7c8bc4; }
    .empty { color: #7c8bc4; font-size: 26px; }
    .footer { margin-top: 0; display: flex; justify-content: space-between; font-size: 20px; color: #7c8bc4; letter-spacing: 1px; padding-top: 14px; border-top: 1px solid rgba(199, 210, 254, 0.18); }
    </style></head>
    <body>
    <div class="top"><div class="brand">GGE <span>TRACKER</span></div><div class="event">EVENT #${podium.eventNumber}</div></div>
    <div class="heading"><div class="kind">${escape(podium.eventName)}<small>Final leaderboard</small></div>${date}</div>
    <div class="podium">${steps.join('')}</div>
    <div class="footer"><div>${escape(displayUrl)}</div><div>${ShareCardRenderer.grouped(podium.playerCount)} players · ${ShareCardRenderer.grouped(podium.serverCount)} servers</div></div>
    </body></html>`;
  }

  private static stepHtml(rank: number, entry: PodiumEntry | undefined, pointsSize: number): string {
    const escape = ShareCardRenderer.escape.bind(ShareCardRenderer);
    const color = this.MEDAL_COLORS[rank];
    const stepStyle =
      `height: ${this.STEP_HEIGHTS[rank]}px; border-top: 4px solid ${color};` +
      ` background: linear-gradient(180deg, ${color}33 0%, rgba(255, 255, 255, 0.04) 100%);`;
    const medal = `<div class="medal" style="background: ${color}">${rank}</div>`;
    if (!entry) {
      return `<div class="column">${medal}<div class="name empty" style="font-size: 30px">-</div><div class="meta">&nbsp;</div><div class="step" style="${stepStyle}"></div></div>`;
    }
    const points = ShareCardRenderer.grouped(entry.points);
    const level = entry.legendaryLevel > 0 ? `Lvl ${entry.level} · LL ${entry.legendaryLevel}` : `Lvl ${entry.level}`;
    return `<div class="column">${medal}
      <div class="name" style="font-size: ${this.nameSize(entry.name)}px">${escape(entry.name)}</div>
      <div class="alliance">${escape(entry.alliance ?? 'No alliance')}</div>
      <div class="meta">${escape(entry.server)} · ${level}</div>
      <div class="step" style="${stepStyle}">
      <div class="points" style="font-size: ${pointsSize}px">${points}</div><div class="label">points</div>
      ${this.trackedHtml(entry)}
      </div></div>`;
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
