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

import { AllianceDatabase } from '../../src/interfaces';
import { alliancesById, fixtures } from '../harness/fixtures';
import { timeout } from '../harness/fake-api';
import { Sandbox, withSandbox } from '../harness/sandbox';

const UPDATE_SQL =
  'UPDATE alliances SET is_searching_alliance = $1, auto_join_enabled = $2, is_island_king = $3, language = $4, description = $5 WHERE id = $6';

function storedAs(payload: Record<string, any>, overrides: Partial<AllianceDatabase> = {}): AllianceDatabase {
  return {
    allianceId: Number(payload.AID),
    description: payload.D,
    language: payload.ALL,
    auto_join_enabled: payload.IA !== 0,
    is_island_king: payload.KA !== 0,
    is_searching_alliance: payload.IS !== 0,
    ...overrides,
  };
}

function serveAlliances(sandbox: Sandbox): void {
  const byId = alliancesById();
  sandbox.api.on('ain', (request) => {
    const payload = byId.get(Number(request.parameters.AID));
    if (!payload) return timeout('ain');
    return { server: 'TEST', command: 'ain', return_code: 0, content: { A: payload } };
  });
}

describe('bulkUpdateAlliance', () => {
  it('writes the profile of an alliance the database has never seen', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAlliances(sandbox);
      const [payload] = fixtures.alliances().alliances;
      await sandbox.call('bulkUpdateAlliance', new Set([Number(payload.AID)]));
      const update = sandbox.db.one(/UPDATE alliances SET/);
      assert.equal(update.sql, UPDATE_SQL);
      assert.deepEqual(update.params, [
        payload.IS !== 0,
        payload.IA !== 0,
        payload.KA !== 0,
        payload.ALL,
        payload.D,
        Number(payload.AID),
      ]);
    });
  });

  it('keeps no description history for an alliance it has just discovered', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAlliances(sandbox);
      const [payload] = fixtures.alliances().alliances;
      await sandbox.call('bulkUpdateAlliance', new Set([Number(payload.AID)]));
      assert.deepEqual(
        sandbox.db.matching(/alliance_description_history/),
        [],
        'the first description on record is not an edit',
      );
    });
  });

  it('leaves an unchanged alliance alone', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAlliances(sandbox);
      const payloads = fixtures.alliances().alliances;
      sandbox.setState(
        'currentAlliances',
        payloads.map((payload) => storedAs(payload)),
      );
      await sandbox.call('bulkUpdateAlliance', new Set(payloads.map((payload) => Number(payload.AID))));
      assert.deepEqual(sandbox.db.queries, [], 'nothing changed, so nothing is written');
      assert.equal(sandbox.api.callsFor('ain').length, payloads.length, 'every alliance is still checked');
    });
  });

  it('records the previous description when one is edited', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAlliances(sandbox);
      const [payload] = fixtures.alliances().alliances;
      sandbox.setState('currentAlliances', [storedAs(payload, { description: 'the description it had before' })]);
      await sandbox.call('bulkUpdateAlliance', new Set([Number(payload.AID)]));
      const history = sandbox.db.one(/INSERT INTO alliance_description_history/);
      assert.deepEqual(history.params.slice(0, 3), [Number(payload.AID), 'the description it had before', payload.D]);
      assert.equal((history.params[3] as Date).getTime(), sandbox.now.getTime(), 'stamped with the run instant');
    });
  });

  it('updates the profile without a history row when only a flag moved', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAlliances(sandbox);
      const [payload] = fixtures.alliances().alliances;
      sandbox.setState('currentAlliances', [storedAs(payload, { auto_join_enabled: !(payload.IA !== 0) })]);
      await sandbox.call('bulkUpdateAlliance', new Set([Number(payload.AID)]));
      assert.equal(sandbox.db.matching(/UPDATE alliances SET/).length, 1);
      assert.deepEqual(sandbox.db.matching(/alliance_description_history/), []);
    });
  });

  it('skips an alliance the game does not answer for', async () => {
    await withSandbox({}, async (sandbox) => {
      sandbox.api.on('ain', () => timeout('ain'));
      await sandbox.call('bulkUpdateAlliance', new Set([500001, 500002]));
      assert.deepEqual(sandbox.db.queries, [], 'a missing answer never becomes an empty profile');
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0);
    });
  });

  it('retries a request that throws before giving the alliance up', async () => {
    await withSandbox({}, async (sandbox) => {
      const byId = alliancesById();
      const [payload] = fixtures.alliances().alliances;
      let attempts = 0;
      sandbox.api.on('ain', (request) => {
        if (attempts++ < 2) throw new Error('socket hung up');
        return { return_code: 0, content: { A: byId.get(Number(request.parameters.AID)) } };
      });
      await sandbox.call('bulkUpdateAlliance', new Set([Number(payload.AID)]));
      assert.equal(attempts, 3, 'three attempts, the third one succeeds');
      assert.equal(sandbox.db.matching(/UPDATE alliances SET/).length, 1);
    });
  });

  it('gives up on an alliance whose every attempt throws', async () => {
    await withSandbox({}, async (sandbox) => {
      let attempts = 0;
      sandbox.api.on('ain', () => {
        attempts++;
        throw new Error('socket hung up');
      });
      await sandbox.call('bulkUpdateAlliance', new Set([500001]));
      assert.equal(attempts, 3);
      assert.deepEqual(sandbox.db.queries, []);
    });
  });

  it('keeps going when a batch fails to write', async () => {
    await withSandbox({}, async (sandbox) => {
      serveAlliances(sandbox);
      sandbox.db.when(/UPDATE alliances SET/, { error: Object.assign(new Error('deadlock'), { code: '40P01' }) });
      const payloads = fixtures.alliances().alliances;
      await sandbox.call('bulkUpdateAlliance', new Set(payloads.map((payload) => Number(payload.AID))));
      assert.equal(sandbox.state('DB_UPDATES').criticalErrors, 0, 'an alliance profile is not worth failing a run');
    });
  });
});
