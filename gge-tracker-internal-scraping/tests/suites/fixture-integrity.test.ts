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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';

const DIR = path.join(__dirname, '..', 'fixtures');
const DUMMY_PLAYER_FLOOR = 900_000;
const DUMMY_ALLIANCE_RANGE = [500_000, 600_000];
const IDENTIFIER_FIELDS = new Set(['OID', 'AID', 'PID']);

function fixtureFiles(): string[] {
  return fs
    .readdirSync(DIR)
    .filter((file) => file.endsWith('.json') && file !== 'identity-map.json')
    .sort();
}

function walk(node: unknown, visit: (key: string, value: unknown, path: string) => void, at = ''): void {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, visit, `${at}[${index}]`));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    visit(key, value, `${at}/${key}`);
    walk(value, visit, `${at}/${key}`);
  }
}

function isDummyIdentifier(key: string, value: number): boolean {
  if (value <= 0) return true; // -1 and 0 are the game's "none", not an identifier
  if (key === 'AID') return value >= DUMMY_ALLIANCE_RANGE[0] && value < DUMMY_ALLIANCE_RANGE[1];
  return value >= DUMMY_PLAYER_FLOOR;
}

describe('fixtures', () => {
  it('has fixtures to run against', () => {
    assert.ok(fixtureFiles().length > 0);
  });

  it('carries no real player or alliance identifier', () => {
    for (const file of fixtureFiles()) {
      const content = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
      const leaks: string[] = [];
      walk(content, (key, value, at) => {
        if (IDENTIFIER_FIELDS.has(key) && typeof value === 'number' && !isDummyIdentifier(key, value)) {
          leaks.push(`${at} = ${value}`);
        }
      });
      assert.deepEqual(leaks, [], `${file} holds identifiers the anonymiser did not rewrite`);
    }
  });

  it('never puts an identifier in a key position, where the anonymiser cannot reach it', () => {
    for (const file of fixtureFiles()) {
      const content = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
      const numericKeys: string[] = [];
      walk(content, (key, _value, at) => {
        if (/^\d{4,}$/.test(key)) numericKeys.push(at);
      });
      assert.deepEqual(numericKeys, [], `${file} indexes something by a raw identifier`);
    }
  });

  it('carries no real player or alliance name', () => {
    for (const file of fixtureFiles()) {
      const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
      const names = [...raw.matchAll(/"(?:N|NOM|AN)":\s*"([^"]*)"/g)].map((match) => match[1]);
      const leaked = names.filter((name) => name !== '' && !/^(Player|Alliance)_/.test(name));
      assert.deepEqual(leaked, [], `${file} holds names the anonymiser did not rewrite`);
      const descriptions = [...raw.matchAll(/"D":\s*"([^"]*)"/g)].map((match) => match[1]);
      const leakedDescriptions = descriptions.filter(
        (description) => description !== '' && !description.startsWith('Description of alliance '),
      );
      assert.deepEqual(leakedDescriptions, [], `${file} holds alliance descriptions verbatim`);
    }
  });

  it('says where each fixture came from and whether it is the whole ranking', () => {
    for (const file of fixtureFiles()) {
      const { meta } = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
      assert.ok(meta, `${file} has no metadata`);
      assert.equal(meta.name, file.replace(/\.json$/, ''));
      assert.ok(meta.describes?.length > 0, `${file} does not say what it holds`);
      assert.ok(Date.parse(meta.capturedAt) > 0, `${file} does not say when it was captured`);
      assert.equal(typeof meta.complete, 'boolean', `${file} does not say whether it is a slice`);
      assert.equal(meta.anonymised, true);
    }
  });

  it('keeps a ranking consistent with the page size and rank count it declares', () => {
    for (const file of fixtureFiles().filter((name) => name.startsWith('hgh-'))) {
      const fixture = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
      assert.equal(fixture.rows.length, fixture.totalRanked, `${file}: the slice is its own ranking size`);
      if (fixture.rows.length === 0) continue;
      assert.ok(fixture.pageSize > 0, `${file}: a ranking with rows must declare a page size`);
      const ranks = fixture.rows.map((row: any[]) => row[0]);
      assert.deepEqual(
        ranks,
        Array.from({ length: ranks.length }, (_, index) => index + 1),
        `${file}: ranks run from 1 without a gap, which is what the paging window assumes`,
      );
      for (const row of fixture.rows) {
        assert.equal(row.length, 3, `${file}: a row is [rank, points, player]`);
        assert.equal(typeof row[1], 'number');
        assert.equal(typeof row[2].OID, 'number');
      }
    }
  });
});
