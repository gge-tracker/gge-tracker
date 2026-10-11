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

import { judgeServerReset, serversToCheck } from '../../src/loot-reset-check';
import { parseLootReset } from '../../src/loot-reset';
import { ScrapingServer } from '../../src/servers-file';

function server(name: string, olap: string, timezone = 'Europe/Paris', kind = 'ep'): ScrapingServer {
  return {
    name,
    server: name,
    zone: '',
    sql: '',
    olap,
    limit: 1,
    dungeon: false,
    storm: false,
    alertAfterFailures: null,
    kind,
    lootReset: parseLootReset(timezone, 'MON 00:00'),
    enabledBeta: true,
    enabledPublic: true,
  };
}

// DE1 as production stored it: the summer resets at 22h UTC, a few drops of players passing 2^32 between them.
const DE1_SUMMER: string[][] = [
  ['2026-09-20 22', '9800'],
  ['2026-09-20 23', '120'],
  ['2026-09-23 14', '1'],
  ['2026-09-27 22', '9750'],
  ['2026-10-01 20', '2'],
  ['2026-10-04 22', '9900'],
];

describe('loot reset check', () => {
  it('passes a server whose every reset lands on its declared time', () => {
    assert.deepEqual(judgeServerReset(server('DE1', 'db_de1'), DE1_SUMMER), {
      event: 'loot_reset_check',
      server: 'DE1',
      status: 'ok',
      declared: 'Europe/Paris MON 00:00',
      resets: 3,
    });
  });

  it('names every reset that lands elsewhere than declared', () => {
    const record = judgeServerReset(server('DE1', 'db_de1', 'Europe/London'), DE1_SUMMER);
    assert.equal(record.status, 'mismatch');
    assert.equal(
      record.mismatches,
      '2026-09-20 22h UTC instead of 2026-09-20 23h, 2026-09-27 22h UTC instead of 2026-09-27 23h, ' +
        '2026-10-04 22h UTC instead of 2026-10-04 23h',
    );
  });

  it('reports a server with no reset in its history as not measured rather than as passing', () => {
    assert.equal(judgeServerReset(server('SP3', 'db_sp3'), []).status, 'not-measured');
  });

  it('checks each loot database once and skips the jobs that are not servers', () => {
    const checked = serversToCheck([
      server('DE1', 'db_de1'),
      server('LIVE', 'db_de1'),
      server('OR', 'db_or', 'Europe/Paris', 'internal'),
      { ...server('NEW1', 'db_new1'), lootReset: null },
    ]);
    assert.deepEqual(
      checked.map((each) => each.server),
      ['DE1'],
    );
  });
});
