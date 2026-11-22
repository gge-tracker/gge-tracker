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

import { outerRealmsAnnouncement } from '../../src/outer-realms-announcement';
import { outerRealmsGameOf, outerRealmsUniverse } from '../../src/outer-realms-universe';

describe('outerRealmsAnnouncement', () => {
  it('records the first TSID it ever sees without posting, so a deploy never announces the running event', () => {
    assert.equal(outerRealmsAnnouncement('21', null), 'record');
  });

  it('stays silent while the event is the one already announced', () => {
    assert.equal(outerRealmsAnnouncement('21', '21'), 'none');
  });

  it('announces a TSID that differs from the last one announced', () => {
    assert.equal(outerRealmsAnnouncement('23', '21'), 'announce');
  });

  it('does nothing while the bridge has stored no TSID', () => {
    assert.equal(outerRealmsAnnouncement(null, '21'), 'none');
    assert.equal(outerRealmsAnnouncement(null, null), 'none');
  });

  it('posts once per event over the TSIDs the bridge saved in production, a returning id included', () => {
    const minutes = ['21', '21', '23', '23', '23', '24', '24', '21', '23', '23', '21'];
    let announced: string | null = null;
    const posted: string[] = [];
    for (const current of minutes) {
      const decision = outerRealmsAnnouncement(current, announced);
      if (decision === 'announce') posted.push(current);
      if (decision !== 'none') announced = current;
    }
    assert.deepEqual(posted, ['23', '24', '21', '23', '21']);
  });
});

describe('outerRealmsUniverse', () => {
  it('keeps the EP keys under the names a running deploy already reads', () => {
    const ep = outerRealmsUniverse('ep');
    assert.deepEqual(
      [ep.temporaryServerIdKey, ep.fetchErrorKey, ep.lastCheckTimeKey, ep.announcedTsidKey, ep.defaultLiveZone],
      [
        'temporaryServerData',
        'outerRealmsDataFetchError',
        'outerRealmsLastCheckTime',
        'outerRealmsAnnouncedTsid',
        'EmpireEx_42',
      ],
    );
  });

  it('gives E4K its own key for every piece of state, so the two events never share one', () => {
    const ep = outerRealmsUniverse('ep');
    const e4k = outerRealmsUniverse('e4k');
    const keys = (u: typeof ep): string[] => [
      u.temporaryServerIdKey,
      u.fetchErrorKey,
      u.lastCheckTimeKey,
      u.announcedTsidKey,
      u.liveZoneKey,
    ];
    for (const key of keys(e4k)) assert.ok(!keys(ep).includes(key), key);
    assert.equal(e4k.temporaryServerIdKey, 'temporaryServerData:e4k', 'the bridge writes this exact key');
  });

  it('reads the game off the server a job runs for', () => {
    assert.equal(outerRealmsGameOf('E4K_FR1'), 'e4k');
    assert.equal(outerRealmsGameOf('E4KFR1'), 'e4k');
    assert.equal(outerRealmsGameOf('FR1'), 'ep');
    assert.equal(outerRealmsGameOf(undefined), 'ep');
  });
});
