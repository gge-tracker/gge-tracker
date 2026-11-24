//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//

export function svStartingAt(rank: number, pageSize: number): number {
  return rank + Math.floor((Math.max(pageSize, 1) - 1) / 2);
}

export function svEndingAt(rank: number, pageSize: number): number {
  return Math.max(1, rank - Math.ceil((Math.max(pageSize, 1) - 1) / 2));
}

function ranksOf(page: unknown[][]): number[] {
  return page.map((row) => Number(row[0]));
}

export class RankingCursor {
  public skippedRanks = 0;
  public stalled = false;
  private lastRank = 0;
  private realignedAfter = -1;

  constructor(public sv: number = 1) {}

  public advance(page: unknown[][]): boolean {
    const ranks = ranksOf(page);
    const firstRank = Math.min(...ranks);
    if (firstRank > this.lastRank + 1) {
      if (this.realignedAfter !== this.lastRank) {
        this.realignedAfter = this.lastRank;
        this.sv = svStartingAt(this.lastRank + 1, page.length);
        return false;
      }
      this.skippedRanks += firstRank - this.lastRank - 1;
    }
    const pageLastRank = Math.max(...ranks);
    this.stalled = pageLastRank <= this.lastRank;
    this.lastRank = Math.max(this.lastRank, pageLastRank);
    this.sv = svStartingAt(this.lastRank + 1, page.length);
    return true;
  }
}

export class ReverseRankingCursor {
  public stalled = false;
  private firstRank = Number.POSITIVE_INFINITY;

  constructor(public sv: number) {}

  public advance(page: unknown[][]): void {
    const pageFirstRank = Math.min(...ranksOf(page));
    this.stalled = pageFirstRank >= this.firstRank || pageFirstRank <= 1;
    this.firstRank = Math.min(this.firstRank, pageFirstRank);
    this.sv = svEndingAt(this.firstRank - 1, page.length);
  }
}
