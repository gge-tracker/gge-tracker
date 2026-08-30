//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import * as fs from 'node:fs';
import * as path from 'node:path';

import { AllianceFixture, PlayerEventFixture, RankingFixture, RankingRow } from './fixture-types';

const DIR = path.join(__dirname, '..', 'fixtures');

function read<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8')) as T;
}

export function ranking(name: string, overrides: Partial<RankingFixture> = {}): RankingFixture {
  return { ...read<RankingFixture>(name), ...overrides };
}

export function truncated(fixture: RankingFixture, count: number): RankingFixture {
  const rows = fixture.rows.slice(0, count).map((row, index): RankingRow => [index + 1, row[1], row[2]]);
  return { ...fixture, rows, totalRanked: rows.length };
}

export const fixtures = {
  wheel: (): RankingFixture => ranking('hgh-wheel-lt72'),
  nomadsCategory1: (): RankingFixture => ranking('hgh-nomads-lt46-lid1'),
  nomadsCategory2: (): RankingFixture => ranking('hgh-nomads-lt46-lid2'),
  lootHead: (): RankingFixture => ranking('hgh-loot-lt2-head'),
  lootTail: (): RankingFixture => ranking('hgh-loot-lt2-tail'),
  might: (): RankingFixture => ranking('hgh-might-lt6-lid1'),
  eventNotRunning: (): RankingFixture => ranking('hgh-warrealms-lt44-lid1'),
  socketTimeout: (): RankingFixture => ranking('hgh-bloodcrow-lt58-lid1'),
  alliances: (): AllianceFixture => read<AllianceFixture>('ain-alliances'),
  aquamarine: (): PlayerEventFixture => read<PlayerEventFixture>('gpe-aquamarine'),
};

export function alliancesById(): Map<number, Record<string, any>> {
  return new Map(fixtures.alliances().alliances.map((alliance) => [Number(alliance.AID), alliance]));
}

export function aquamarineByPlayer(): Map<number, Record<string, any>> {
  return new Map(fixtures.aquamarine().events.map((event) => [Number(event.PID), event]));
}

export function playerAt(fixture: RankingFixture, rank: number): Record<string, any> {
  const row = fixture.rows.find((entry) => entry[0] === rank);
  if (!row) throw new Error(`No row at rank ${rank} in ${fixture.meta.name}`);
  return row[2];
}

export function rowAt(fixture: RankingFixture, rank: number): RankingRow {
  const row = fixture.rows.find((entry) => entry[0] === rank);
  if (!row) throw new Error(`No row at rank ${rank} in ${fixture.meta.name}`);
  return row;
}

export function mainRealmCastles(player: Record<string, any>): number[][] {
  return (player.AP ?? []).filter((ap: number[]) => ap[0] === 0).map((ap: number[]) => [ap[2], ap[3], ap[4]]);
}

export function otherRealmCastles(player: Record<string, any>): number[][] {
  return (player.AP ?? [])
    .filter((ap: number[]) => [1, 2, 3, 4].includes(ap[0]))
    .map((ap: number[]) => [ap[0], ap[2], ap[3], ap[4]]);
}
