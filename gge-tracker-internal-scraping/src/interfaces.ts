//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//
export type Castle = [number, number, number];

export type MovementType = 'add' | 'remove' | 'move';

export interface PlayerDatabase {
  playerId: number;
  allianceId: number | null;
  playerName: string;
  allianceName: string | null;
  castles: Castle[];
}

export interface CastleMovement {
  player_id: number;
  castle_type: number;
  movement_type: MovementType;
  position_x_old?: number;
  position_y_old?: number;
  position_x_new?: number;
  position_y_new?: number;
}

export interface DungeonMap {
  coordinates: [number, number];
  time: number;
  playerId: number;
  updatedAt: Date;
}
