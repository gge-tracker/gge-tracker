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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { LOOT_COUNTER_RANGE, unwrapLoot } from '../../src/loot-counter';
import { formatLootResetTime, lootWeekEnd, lootWeekStart, parseLootReset } from '../../src/loot-reset';
import { readScrapingServers } from '../../src/servers-file';

const HOUR = 3_600_000;
const paris = parseLootReset('Europe/Paris', 'MON 00:00')!;

function weekOf(iso: string, timezone: string, time: string): string {
  return new Date(lootWeekStart(Date.parse(iso), parseLootReset(timezone, time)!)).toISOString();
}

describe('parseLootReset', () => {
  it('reads a weekday and a local time, and keeps a Sunday evening before Monday', () => {
    assert.deepEqual(parseLootReset('Europe/Paris', 'MON 00:00'), { timezone: 'Europe/Paris', minutesFromMonday: 0 });
    assert.deepEqual(parseLootReset('UTC', 'SUN 19:00'), { timezone: 'UTC', minutesFromMonday: -300 });
    assert.equal(formatLootResetTime(parseLootReset('UTC', 'SUN 19:00')!), 'SUN 19:00');
  });

  it('refuses an unknown timezone or a malformed time', () => {
    assert.equal(parseLootReset('Europe/Atlantis', 'MON 00:00'), null);
    assert.equal(parseLootReset('Europe/Paris', 'MON 24:00'), null);
    assert.equal(parseLootReset('Europe/Paris', ''), null);
  });
});

describe('lootWeekStart', () => {
  it('follows Paris summer and winter time, as DE1 does', () => {
    assert.equal(weekOf('2026-10-11T12:00:00Z', 'Europe/Paris', 'MON 00:00'), '2026-10-04T22:00:00.000Z');
    assert.equal(weekOf('2026-11-04T12:00:00Z', 'Europe/Paris', 'MON 00:00'), '2026-11-01T23:00:00.000Z');
    assert.equal(
      weekOf('2026-10-25T22:30:00Z', 'Europe/Paris', 'MON 00:00'),
      '2026-10-18T22:00:00.000Z',
      'not yet midnight',
    );
  });

  it('follows New York and Sydney on their own dates', () => {
    assert.equal(weekOf('2026-03-04T12:00:00Z', 'America/New_York', 'MON 00:00'), '2026-03-02T05:00:00.000Z');
    assert.equal(weekOf('2026-03-11T12:00:00Z', 'America/New_York', 'MON 00:00'), '2026-03-09T04:00:00.000Z');
    assert.equal(weekOf('2026-09-30T12:00:00Z', 'Australia/Sydney', 'MON 00:00'), '2026-09-27T14:00:00.000Z');
    assert.equal(weekOf('2026-10-07T12:00:00Z', 'Australia/Sydney', 'MON 00:00'), '2026-10-04T13:00:00.000Z');
  });

  it('gives the weeks holding a clock change 167 or 169 hours', () => {
    const spring = lootWeekStart(Date.parse('2026-03-25T12:00:00Z'), paris);
    const autumn = lootWeekStart(Date.parse('2026-10-21T12:00:00Z'), paris);
    assert.equal((lootWeekEnd(spring, paris) - spring) / HOUR, 167);
    assert.equal((lootWeekEnd(autumn, paris) - autumn) / HOUR, 169);
  });
});

describe('unwrapLoot across the winter reset', () => {
  it('keeps the last summer-offset hour in the old week instead of reading the reset as a wrap', () => {
    const R = LOOT_COUNTER_RANGE;
    const beforeMidnight = Date.parse('2026-11-01T22:37:00Z');
    const afterMidnight = Date.parse('2026-11-01T23:37:00Z');
    const lastHour = unwrapLoot(
      3_010_000_000,
      beforeMidnight,
      [{ at: beforeMidnight - HOUR, point: R + 3_000_000_000 }],
      paris,
    );
    assert.deepEqual(lastHour, { point: R + 3_010_000_000, kind: 'counted' }, '23:37 Paris is still the old week');
    const reset = unwrapLoot(5_000_000, afterMidnight, [{ at: beforeMidnight, point: lastHour.point }], paris);
    assert.deepEqual(reset, { point: 5_000_000, kind: 'fresh' });
  });
});

describe('readScrapingServers', () => {
  it('reads the reset timezone and time of a server', () => {
    const directory = mkdtempSync(join(tmpdir(), 'servers-'));
    const file = join(directory, 'servers.xml');
    try {
      writeFileSync(
        file,
        `<root><servers><server><name>US1</name><kind>ep</kind>
          <reset-timezone>America/New_York</reset-timezone><reset-time>MON 00:00</reset-time>
          <scraping><section>US1</section></scraping></server></servers></root>`,
      );
      assert.deepEqual(readScrapingServers(file)[0].lootReset, { timezone: 'America/New_York', minutesFromMonday: 0 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
