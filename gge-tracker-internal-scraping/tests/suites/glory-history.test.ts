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

import { withSandbox } from '../harness/sandbox';

const TABLE = 'player_glory_history';

function history(highest: unknown, current: unknown, level: unknown = 70): unknown[] {
  const row: unknown[] = [];
  row[8] = level;
  row[10] = highest;
  row[11] = current;
  return row;
}

describe('fillGloryHistory', () => {
  it('stores the current glory of every level 70 player who has any', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {
        '11': history(9000, 4000),
        '12': history(500, 0),
        '13': history(0, 0),
        '14': history(undefined, undefined),
      });
      await sandbox.call('fillGloryHistory');
      assert.deepEqual(sandbox.clickhouse.rows(TABLE), [
        { player_id: 11, point: 4000, created_at: '2026-08-29 12:00:00' },
        { player_id: 12, point: 0, created_at: '2026-08-29 12:00:00' },
      ]);
    });
  });

  it('skips players under level 70 and players whose level is unknown', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', {
        '11': history(9000, 4000, 69),
        '12': history(9000, 4000, null),
        '13': history(9000, 4000, 70),
      });
      await sandbox.call('fillGloryHistory');
      assert.deepEqual(
        sandbox.clickhouse.rows(TABLE).map((row) => row['player_id']),
        [13],
      );
    });
  });

  it('does not fail the run when the table does not exist yet', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', { '11': history(9000, 4000) });
      sandbox.clickhouse.failWith(new Error('UNKNOWN_TABLE'));
      await sandbox.call('fillGloryHistory');
      assert.equal(sandbox.state<{ criticalErrors: number }>('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('writes nothing after a run that already failed', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.setState('playerLootAndMightPointHistoryList', { '11': history(9000, 4000) });
      sandbox.state<{ criticalErrors: number }>('DB_UPDATES').criticalErrors = 1;
      await sandbox.call('fillGloryHistory');
      assert.equal(sandbox.clickhouse.rows(TABLE).length, 0);
    });
  });
});
