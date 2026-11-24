//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { rankingWindow } from '../harness/fake-api';
import { RankingRow } from '../harness/fixture-types';
import { RankingCursor, ReverseRankingCursor, svEndingAt, svStartingAt } from '../../src/ranking-cursor';

function rows(total: number): RankingRow[] {
  return Array.from({ length: total }, (_, index): RankingRow => [index + 1, 1000 - index, { OID: index + 1 }]);
}

function ranksAt(all: RankingRow[], pageSize: number, sv: number): number[] {
  return rankingWindow(all, pageSize, all.length, sv).map((row) => row[0]);
}

function walk(total: number, pageSize: number, firstSv: number): number[][] {
  const all = rows(total);
  const cursor = new RankingCursor(firstSv);
  const pages: number[][] = [];
  while (pages.length < 1000) {
    const page = rankingWindow(all, pageSize, total, cursor.sv);
    if (!cursor.advance(page)) continue;
    pages.push(page.map((row) => row[0]));
    if (page.some((row) => row[0] >= total) || cursor.stalled) break;
  }
  return pages;
}

describe('ranking cursor', () => {
  it('matches the window the game answers, measured on 6, 8, 10, 17 and 21 rows a page', () => {
    const all = rows(100);
    for (const pageSize of [6, 8, 10, 17, 21]) {
      assert.deepEqual(ranksAt(all, pageSize, svStartingAt(40, pageSize))[0], 40, `a page of ${pageSize} starts there`);
      assert.deepEqual(ranksAt(all, pageSize, svEndingAt(40, pageSize)).at(-1), 40, `a page of ${pageSize} ends there`);
    }
  });

  it('reads every rank exactly once, whatever the page size and the first SV', () => {
    for (const pageSize of [1, 6, 8, 10, 17, 21]) {
      for (const firstSv of [1, 3, 5, 11]) {
        const ranks = walk(103, pageSize, firstSv).flat();
        const expected = Array.from({ length: 103 }, (_, index) => index + 1);
        assert.deepEqual(
          [...new Set(ranks)].sort((a, b) => a - b),
          expected,
          `${pageSize} a page from SV ${firstSv}`,
        );
      }
    }
  });

  it('asks again for a page that skipped ranks instead of storing it', () => {
    const cursor = new RankingCursor(5);
    const page = rankingWindow(rows(50), 8, 50, 5);
    assert.equal(page[0][0], 2, 'SV 5 centres a page of 8 on ranks 2 to 9');
    assert.equal(cursor.advance(page), false);
    assert.equal(cursor.sv, svStartingAt(1, 8));
    assert.equal(cursor.skippedRanks, 0);
  });

  it('counts the ranks it could not recover rather than asking forever', () => {
    const cursor = new RankingCursor(1);
    const gap: unknown[][] = [[5], [6]];
    assert.equal(cursor.advance(gap), false);
    assert.equal(cursor.advance(gap), true, 'the second answer with the same gap is kept');
    assert.equal(cursor.skippedRanks, 4);
  });

  it('stops on a page that brings no new rank', () => {
    const cursor = new RankingCursor(1);
    cursor.advance([[1], [2]]);
    cursor.advance([[1], [2]]);
    assert.equal(cursor.stalled, true);
  });

  it('walks backwards from the tail without a gap or an overlap', () => {
    const all = rows(50);
    for (const pageSize of [6, 10, 21]) {
      const cursor = new ReverseRankingCursor(50);
      const seen: number[] = [];
      while (!cursor.stalled) {
        const page = rankingWindow(all, pageSize, 50, cursor.sv);
        seen.push(...page.map((row) => row[0]));
        cursor.advance(page);
      }
      assert.deepEqual([...new Set(seen)].length, 50, `${pageSize} a page`);
    }
  });
});
