//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//

export type CaptureJob =
  | { kind: 'ranking'; name: string; describes: string; lt: number; lid: number; maxRows?: number }
  | { kind: 'ranking-tail'; name: string; describes: string; lt: number; lid: number; maxRows: number }
  | { kind: 'alliances'; name: string; describes: string; sourceLt: number; count: number }
  | { kind: 'player-events'; name: string; describes: string; sourceLt: number; eid: number; count: number };

export const CAPTURE_JOBS: CaptureJob[] = [
  {
    kind: 'ranking',
    name: 'hgh-wheel-lt72',
    describes: 'Wheel of Unimaginable Affluence, the whole live ranking',
    lt: 72,
    lid: 1,
  },
  {
    kind: 'ranking',
    name: 'hgh-nomads-lt46-lid1',
    describes: 'Nomad invasion, category 1, the whole live ranking',
    lt: 46,
    lid: 1,
  },
  {
    kind: 'ranking',
    name: 'hgh-nomads-lt46-lid2',
    describes: 'Nomad invasion, category 2, first pages',
    lt: 46,
    lid: 2,
    maxRows: 64,
  },
  {
    kind: 'ranking',
    name: 'hgh-nomads-lt46-lid3',
    describes: 'Nomad invasion, category 3, first pages',
    lt: 46,
    lid: 3,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-nomads-lt46-lid4',
    describes: 'Nomad invasion, category 4, first pages',
    lt: 46,
    lid: 4,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-nomads-lt46-lid5',
    describes: 'Nomad invasion, category 5, first pages',
    lt: 46,
    lid: 5,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-loot-lt2-head',
    describes: 'Weekly loot ranking, top of the ladder',
    lt: 2,
    lid: 1,
    maxRows: 60,
  },
  {
    kind: 'ranking-tail',
    name: 'hgh-loot-lt2-tail',
    describes: 'Weekly loot ranking, bottom of the ladder where scores overflow into negatives',
    lt: 2,
    lid: 1,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-might-lt6-lid1',
    describes: 'Might points, category 1, first pages',
    lt: 6,
    lid: 1,
    maxRows: 60,
  },
  {
    kind: 'ranking',
    name: 'hgh-might-lt6-lid2',
    describes: 'Might points, category 2, first pages',
    lt: 6,
    lid: 2,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-might-lt6-lid3',
    describes: 'Might points, category 3, first pages',
    lt: 6,
    lid: 3,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-might-lt6-lid4',
    describes: 'Might points, category 4, first pages',
    lt: 6,
    lid: 4,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-might-lt6-lid5',
    describes: 'Might points, category 5, first pages',
    lt: 6,
    lid: 5,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-might-lt6-lid6',
    describes: 'Might points, category 6, first pages',
    lt: 6,
    lid: 6,
    maxRows: 40,
  },
  {
    kind: 'ranking',
    name: 'hgh-warrealms-lt44-lid1',
    describes: 'War realms while the event is not running (LR=0, empty page)',
    lt: 44,
    lid: 1,
  },
  {
    kind: 'ranking',
    name: 'hgh-bloodcrow-lt58-lid1',
    describes: 'Bloodcrows while the socket does not answer (return_code -1, no content)',
    lt: 58,
    lid: 1,
  },
  {
    kind: 'alliances',
    name: 'ain-alliances',
    describes: 'Alliance details for the alliances of the loot top 10',
    sourceLt: 2,
    count: 8,
  },
  {
    kind: 'player-events',
    name: 'gpe-aquamarine',
    describes: 'Aquamarine event progress (EID 102) for the loot top 10',
    sourceLt: 2,
    eid: 102,
    count: 10,
  },
];
