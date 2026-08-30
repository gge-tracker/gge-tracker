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

import { fixtures } from '../harness/fixtures';
import { rankingWindow } from '../harness/fake-api';
import { withSandbox } from '../harness/sandbox';

describe('fake game API', () => {
  it('reproduces the paging window of the live server', () => {
    const nomads = fixtures.nomadsCategory1();
    assert.equal(nomads.pageSize, 8);
    assert.equal(nomads.totalRanked, 172);

    const ranksAt = (sv: number): number[] => rankingWindow(nomads.rows, 8, 172, sv).map((row) => row[0]);
    assert.deepEqual(ranksAt(1), [1, 2, 3, 4, 5, 6, 7, 8], 'SV below the first window is clamped to the head');
    assert.deepEqual(ranksAt(4), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(ranksAt(5), [2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(ranksAt(12), [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(ranksAt(20), [17, 18, 19, 20, 21, 22, 23, 24]);
    assert.deepEqual(ranksAt(170), [165, 166, 167, 168, 169, 170, 171, 172]);
    assert.deepEqual(ranksAt(175), [165, 166, 167, 168, 169, 170, 171, 172], 'SV past the end is clamped to the tail');
  });

  it('answers an unregistered ranking the way a stopped event does', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.wheel());
      const response = await sandbox.call('genericFetchData', 'hgh', { LT: 999, LID: 1, SV: '1' });
      assert.equal(response.data.return_code, 0);
      assert.deepEqual(response.data.content.L, []);
      assert.equal(response.data.content.LR, 0);
    });
  });

  it('replays a captured response that carried no content', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.socketTimeout());
      const response = await sandbox.call('genericFetchData', 'hgh', { LT: 58, LID: 1, SV: '5' });
      assert.equal(response.data.return_code, -1);
      assert.equal(response.data.content, undefined);
      assert.equal(response.data.error, 'Timeout');
    });
  });

  it('builds the request URL the way production does', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.serveRanking(fixtures.wheel());
      await sandbox.call('genericFetchData', 'hgh', { LT: 72, LID: 1, SV: '4' });
      const [request] = sandbox.api.callsFor('hgh');
      assert.equal(
        request.url,
        'http://empire-api.test:3000/EmpireEx_TEST/hgh/%22LT%22:72,%22LID%22:1,%22SV%22:%224%22',
      );
      assert.deepEqual(request.parameters, { LT: 72, LID: 1, SV: '4' });
    });
  });

  it('serialises a null parameter list the way production does', async () => {
    await withSandbox({}, async (sandbox) => {
      await sandbox.call('genericFetchData', 'gpi', null);
      const [request] = sandbox.api.callsFor('gpi');
      assert.equal(request.url, 'http://empire-api.test:3000/EmpireEx_TEST/gpi/null');
      assert.deepEqual(request.parameters, {});
    });
  });

  it('pins the clock so derived timestamps are reproducible', async () => {
    const now = new Date('2026-01-02T03:04:05.000Z');
    await withSandbox({ now }, async () => {
      assert.equal(new Date().toISOString(), now.toISOString());
      assert.equal(Date.now(), now.getTime());
      assert.equal(new Date('2020-05-06T00:00:00.000Z').getUTCFullYear(), 2020, 'explicit dates still work');
    });
    assert.notEqual(Date.now(), now.getTime(), 'the real clock is restored');
  });
});
