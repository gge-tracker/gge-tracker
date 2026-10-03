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

import { FailureStreaks } from '../../src/failure-streaks';
import { withLogSpy } from '../harness/log-spy';

const FAR = { name: 'E4KCN1', alertAfterFailures: 8 };
const NEAR = { name: 'FR1', alertAfterFailures: null };

describe('FailureStreaks', () => {
  it('stays quiet through failures shorter than the threshold', async () => {
    await withLogSpy((logs) => {
      const streaks = new FailureStreaks('Storm map sweep', '422', 3);
      streaks.recordFailure(NEAR, 'timeout');
      streaks.recordFailure(NEAR, 'timeout');
      streaks.recordSuccess(NEAR);
      streaks.recordFailure(NEAR, 'timeout');
      streaks.recordFailure(NEAR, 'timeout');
      assert.deepEqual(logs.calls.logPersistentFailure, [], 'a success in between starts the count again');
    });
  });

  it('raises the alert on every run from the threshold on, with a message that never changes', async () => {
    await withLogSpy((logs) => {
      const streaks = new FailureStreaks('Storm map sweep', '422', 3);
      for (let run = 0; run < 5; run++) streaks.recordFailure(NEAR, `timeout ${run}`);
      const alerts = logs.calls.logPersistentFailure;
      assert.equal(alerts.length, 3, 'runs three, four and five');
      for (const [server, identifier, msg] of alerts) {
        assert.equal(server, 'FR1');
        assert.equal(identifier, '422');
        assert.equal(msg, 'Storm map sweep on FR1 failed 3 runs in a row', 'Grafana groups on it: it must not move');
      }
      assert.match(String(alerts[2][3]), /timeout 4 \(5 failed runs so far\)/);
    });
  });

  it('gives a server its own tolerance when the servers file declares one', async () => {
    await withLogSpy((logs) => {
      const streaks = new FailureStreaks('Storm map sweep', '422', 3);
      for (let run = 0; run < 7; run++) streaks.recordFailure(FAR, 'timeout');
      assert.deepEqual(logs.calls.logPersistentFailure, []);
      streaks.recordFailure(FAR, 'timeout');
      assert.equal(logs.calls.logPersistentFailure.length, 1);
    });
  });

  it('counts each server on its own', async () => {
    await withLogSpy((logs) => {
      const streaks = new FailureStreaks('Storm map sweep', '422', 2);
      streaks.recordFailure(NEAR, 'timeout');
      streaks.recordFailure({ name: 'DE1', alertAfterFailures: null }, 'timeout');
      assert.deepEqual(logs.calls.logPersistentFailure, []);
      assert.equal(streaks.streakOf(NEAR), 1);
    });
  });

  it('says so when a server that was alerting recovers, and only then', async () => {
    await withLogSpy((logs) => {
      const streaks = new FailureStreaks('Storm map sweep', '422', 2);
      streaks.recordFailure(NEAR, 'timeout');
      streaks.recordSuccess(NEAR);
      assert.deepEqual(logs.calls.logMessage, []);
      streaks.recordFailure(NEAR, 'timeout');
      streaks.recordFailure(NEAR, 'timeout');
      streaks.recordSuccess(NEAR);
      assert.deepEqual(logs.calls.logMessage, [['Storm map sweep on FR1 recovered after 2 failed runs in a row']]);
      assert.equal(streaks.streakOf(NEAR), 0);
    });
  });
});
