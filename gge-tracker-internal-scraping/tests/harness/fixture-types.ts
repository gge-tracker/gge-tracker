//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//

export type RankingRow = [number, number, Record<string, any>];

export interface FixtureMeta {
  name: string;
  describes: string;
  capturedAt: string;
  capturedFrom: string;
  rowCount: number;
  complete: boolean;
  anonymised: boolean;
  [key: string]: unknown;
}

export interface RankingFixture {
  meta: FixtureMeta;
  lt: number;
  lid: number;
  pageSize: number;
  totalRanked: number;
  fr: number | null;
  igh: number | null;
  rows: RankingRow[];
  rawResponse?: Record<string, any>;
}

export interface AllianceFixture {
  meta: FixtureMeta;
  alliances: Record<string, any>[];
}

export interface PlayerEventFixture {
  meta: FixtureMeta;
  events: Record<string, any>[];
}
