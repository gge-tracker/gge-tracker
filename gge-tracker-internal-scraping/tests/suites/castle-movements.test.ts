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

import { Castle, CastleMovement } from '../../src/interfaces';
import { fixtures, mainRealmCastles } from '../harness/fixtures';
import { Sandbox, withSandbox } from '../harness/sandbox';

const PLAYER = 900001;
const MAIN_CASTLE = 1;
const OUTPOST = 4;

function movements(sandbox: Sandbox, before: Castle[], after: Castle[]): CastleMovement[] {
  return (sandbox.backend as any).getCastleMovements(PLAYER, before, after);
}

describe('getCastleMovements', () => {
  it('reports nothing when the castles did not move', async () => {
    await withSandbox({}, async (sandbox) => {
      const castles: Castle[] = [
        [100, 200, MAIN_CASTLE],
        [300, 400, OUTPOST],
      ];
      assert.deepEqual(movements(sandbox, castles, [...castles]), []);
    });
  });

  it('reports a main castle relocation as a single move', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = movements(sandbox, [[100, 200, MAIN_CASTLE]], [[500, 600, MAIN_CASTLE]]);

      assert.deepEqual(result, [
        {
          player_id: PLAYER,
          castle_type: MAIN_CASTLE,
          movement_type: 'move',
          position_x_old: 100,
          position_y_old: 200,
          position_x_new: 500,
          position_y_new: 600,
        },
      ]);
    });
  });

  it('never splits a main castle relocation into a removal and an addition', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = movements(
        sandbox,
        [
          [100, 200, MAIN_CASTLE],
          [300, 400, OUTPOST],
        ],
        [
          [500, 600, MAIN_CASTLE],
          [300, 400, OUTPOST],
        ],
      );

      assert.deepEqual(
        result.map((movement) => movement.movement_type),
        ['move'],
      );
    });
  });

  it('reports a new outpost as an addition', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = movements(
        sandbox,
        [[100, 200, MAIN_CASTLE]],
        [
          [100, 200, MAIN_CASTLE],
          [300, 400, OUTPOST],
        ],
      );

      assert.deepEqual(result, [
        {
          player_id: PLAYER,
          castle_type: OUTPOST,
          movement_type: 'add',
          position_x_new: 300,
          position_y_new: 400,
        },
      ]);
    });
  });

  it('reports a lost outpost as a removal', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = movements(
        sandbox,
        [
          [100, 200, MAIN_CASTLE],
          [300, 400, OUTPOST],
        ],
        [[100, 200, MAIN_CASTLE]],
      );

      assert.deepEqual(result, [
        {
          player_id: PLAYER,
          castle_type: OUTPOST,
          movement_type: 'remove',
          position_x_old: 300,
          position_y_old: 400,
        },
      ]);
    });
  });

  it('does not claim a removal while another castle of the same type is still standing', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = movements(
        sandbox,
        [
          [300, 400, OUTPOST],
          [700, 800, OUTPOST],
        ],
        [
          [300, 400, OUTPOST],
          [900, 1000, OUTPOST],
        ],
      );

      assert.deepEqual(
        result.map((movement) => movement.movement_type),
        ['add'],
      );
      assert.equal(result[0].position_x_new, 900);
    });
  });

  it('treats a player with no castle on record as holding none', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = movements(sandbox, null as any, [[100, 200, MAIN_CASTLE]]);

      assert.deepEqual(
        result.map((movement) => movement.movement_type),
        ['add'],
      );
      assert.deepEqual(movements(sandbox, null as any, null as any), []);
    });
  });

  it('reports no move when the player is wiped off the map entirely', async () => {
    await withSandbox({}, async (sandbox) => {
      const result = movements(sandbox, [[100, 200, MAIN_CASTLE]], []);

      assert.deepEqual(
        result.map((movement) => movement.movement_type),
        ['remove'],
      );
    });
  });

  it('holds up on the castles of a captured player', async () => {
    await withSandbox({}, async (sandbox) => {
      const player = fixtures.lootHead().rows[0][2];
      const before = mainRealmCastles(player) as Castle[];
      assert.ok(before.length >= 2);

      assert.deepEqual(
        movements(
          sandbox,
          before,
          before.map((castle) => [...castle] as Castle),
        ),
        [],
      );

      const relocated = before.map(
        (castle): Castle => (castle[2] === MAIN_CASTLE ? [castle[0] + 1, castle[1] + 1, castle[2]] : castle),
      );
      const result = movements(sandbox, before, relocated);
      const main = before.find((castle) => castle[2] === MAIN_CASTLE);
      if (main) {
        assert.deepEqual(result, [
          {
            player_id: PLAYER,
            castle_type: MAIN_CASTLE,
            movement_type: 'move',
            position_x_old: main[0],
            position_y_old: main[1],
            position_x_new: main[0] + 1,
            position_y_new: main[1] + 1,
          },
        ]);
      }
    });
  });
});

describe('detectMainCastleMove', () => {
  it('says nothing when either side has no main castle', async () => {
    await withSandbox({}, async (sandbox) => {
      const detect = (before: Castle[], after: Castle[]): unknown =>
        (sandbox.backend as any).detectMainCastleMove(PLAYER, before, after);

      assert.equal(detect([[300, 400, OUTPOST]], [[100, 200, MAIN_CASTLE]]), null);
      assert.equal(detect([[100, 200, MAIN_CASTLE]], [[300, 400, OUTPOST]]), null);
      assert.equal(detect([[100, 200, MAIN_CASTLE]], [[100, 200, MAIN_CASTLE]]), null);
    });
  });
});
