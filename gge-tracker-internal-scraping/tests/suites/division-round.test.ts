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

import {
  DIVISION_ROUND_MAX_ACCOUNTS,
  divisionRoundAccounts,
  findDivisionRound,
  DIVISION_ROUND_EVENT_IDS,
  isKnownDivisionRound,
  readDivisionRoundId,
} from '../../src/division-round';
import { ScrapingServer } from '../../src/servers-file';

const BRIDGE = 'http://bridge.test:3000';

function server(name: string, zone: string, kind: string): ScrapingServer {
  return {
    name,
    server: name,
    outerName: name,
    zone,
    sql: '',
    olap: '',
    limit: 1,
    dungeon: false,
    storm: false,
    alertAfterFailures: null,
    kind,
    lootReset: null,
    enabledBeta: true,
    enabledPublic: true,
  };
}

const SERVERS = [
  server('DE1', 'EmpireEx_2', 'ep'),
  server('FR1', 'EmpireEx_3', 'ep'),
  server('CZ1', 'EmpireEx_4', 'ep'),
  server('PT1', 'EmpireEx_6', 'ep'),
  server('SP3', 'EmpireExSP_3', 'partner'),
  server('E4K_DE1', 'EmpirefourkingdomsExGG', 'e4k'),
  server('E4K_FR1', 'EmpirefourkingdomsExGG_2', 'e4k'),
  server('E4K_DE2', 'EmpirefourkingdomsExGG_28', 'e4k'),
  server('OR', 'EmpireEx_LIVE', 'internal'),
];

function seiWith(...events: Record<string, unknown>[]): { content: { E: Record<string, unknown>[] } } {
  return { content: { E: [{ EID: 124 }, ...events, { EID: 125 }] } };
}

describe('readDivisionRoundId', () => {
  it('reads DRI from the entry of the asked event only', () => {
    const sei = seiWith({ EID: 133, DRI: 11 }, { EID: 129, DRI: 2, A: { LID: 1, SDI: 15 } });
    assert.equal(readDivisionRoundId(sei.content, DIVISION_ROUND_EVENT_IDS['grand-tournament']), 2);
    assert.equal(readDivisionRoundId(sei.content, DIVISION_ROUND_EVENT_IDS['rift-raid']), 11);
  });

  it('answers null when the account was not sent the event, or the answer is not an event list', () => {
    assert.equal(readDivisionRoundId(seiWith().content, DIVISION_ROUND_EVENT_IDS['grand-tournament']), null);
    assert.equal(
      readDivisionRoundId(seiWith({ EID: 129 }).content, DIVISION_ROUND_EVENT_IDS['grand-tournament']),
      null,
    );
    assert.equal(readDivisionRoundId(undefined, DIVISION_ROUND_EVENT_IDS['grand-tournament']), null);
    assert.equal(readDivisionRoundId('Timeout', DIVISION_ROUND_EVENT_IDS['grand-tournament']), null);
  });
});

describe('divisionRoundAccounts', () => {
  it('asks the alliance leaders first, in their order, then the rest of their universe only', () => {
    assert.deepEqual(
      divisionRoundAccounts('ep', SERVERS).map((account) => account.server),
      ['PT1', 'CZ1', 'DE1', 'FR1', 'SP3'],
    );
    assert.deepEqual(
      divisionRoundAccounts('e4k', SERVERS).map((account) => account.server),
      ['E4K_FR1', 'E4K_DE2', 'E4K_DE1'],
    );
  });

  it('never asks more than a handful of accounts', () => {
    const many = Array.from({ length: 20 }, (_, index) => server(`S${index}`, `EmpireEx_${index}`, 'ep'));
    assert.equal(divisionRoundAccounts('ep', many).length, DIVISION_ROUND_MAX_ACCOUNTS);
  });
});

describe('findDivisionRound', () => {
  it('moves on to the next account when one is not sent the event or does not answer', async () => {
    const asked: string[] = [];
    const answers: Record<string, () => unknown> = {
      EmpireEx_6: () => seiWith(),
      EmpireEx_4: () => {
        throw new Error('socket hang up');
      },
      EmpireEx_2: () => seiWith({ EID: 129, DRI: 2 }),
    };
    const sighting = await findDivisionRound(
      'ep',
      DIVISION_ROUND_EVENT_IDS['grand-tournament'],
      SERVERS,
      async (url) => {
        asked.push(url);
        const zone = url.slice(BRIDGE.length + 1).split('/')[0];
        return { data: answers[zone]() };
      },
      BRIDGE,
    );
    assert.deepEqual(sighting, { divisionRoundId: 2, server: 'DE1' });
    assert.deepEqual(asked, [
      `${BRIDGE}/EmpireEx_6/sei/null`,
      `${BRIDGE}/EmpireEx_4/sei/null`,
      `${BRIDGE}/EmpireEx_2/sei/null`,
    ]);
  });

  it('stops at the first account that carries the round', async () => {
    let calls = 0;
    const sighting = await findDivisionRound(
      'e4k',
      DIVISION_ROUND_EVENT_IDS['grand-tournament'],
      SERVERS,
      async () => {
        calls++;
        return { data: seiWith({ EID: 129, DRI: 2 }) };
      },
      BRIDGE,
    );
    assert.deepEqual(sighting, { divisionRoundId: 2, server: 'E4K_FR1' });
    assert.equal(calls, 1);
  });

  it('reads the Rift Raid round from the first account sent that event, not the Grand Tournament one', async () => {
    const answers: Record<string, unknown> = {
      EmpireEx_6: seiWith({ EID: 129, DRI: 2 }),
      EmpireEx_4: seiWith({ EID: 129, DRI: 2 }, { EID: 133, DRI: 11 }),
    };
    const sighting = await findDivisionRound(
      'ep',
      DIVISION_ROUND_EVENT_IDS['rift-raid'],
      SERVERS,
      async (url) => ({ data: answers[url.slice(BRIDGE.length + 1).split('/')[0]] ?? seiWith() }),
      BRIDGE,
    );
    assert.deepEqual(sighting, { divisionRoundId: 11, server: 'CZ1' });
  });

  it('answers null when no account of the universe carries it', async () => {
    const sighting = await findDivisionRound(
      'ep',
      DIVISION_ROUND_EVENT_IDS['grand-tournament'],
      SERVERS,
      async () => ({ data: seiWith() }),
      BRIDGE,
    );
    assert.equal(sighting, null);
  });
});

describe('isKnownDivisionRound', () => {
  const published = JSON.stringify({ ep: [1, 2, 3, 4, -1], e4k: [1, 2, 3, 4] });

  it('tells a round of the published table from one it does not hold, per game', () => {
    assert.equal(isKnownDivisionRound(published, 'ep', 2), true);
    assert.equal(isKnownDivisionRound(published, 'e4k', 5), false);
  });

  it('cannot judge a round before the API published the ids, so it never alerts then', () => {
    assert.equal(isKnownDivisionRound(null, 'ep', 99), null);
    assert.equal(isKnownDivisionRound('not json', 'ep', 99), null);
    assert.equal(isKnownDivisionRound(JSON.stringify({ ep: [1] }), 'e4k', 99), null);
  });
});
