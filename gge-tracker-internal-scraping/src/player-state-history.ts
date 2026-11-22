//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//

export const PLAYER_STATE_RETENTION_DAYS = 35;

export const RECORD_PLAYER_STATE_CHANGES = `
  INSERT INTO player_state_history (
    player_id, honor_old, honor_new, peace_old, peace_new, peace_until_old, peace_until_new, ruin_old, ruin_new
  )
  SELECT
    p.id,
    p.honor,
    tmp.honor,
    COALESCE(p.remaining_peace_time, 0) > 0,
    COALESCE(tmp.remaining_peace_time, 0) > 0,
    p.peace_disabled_at,
    tmp.peace_disabled_at,
    COALESCE(p.is_ruin, FALSE),
    tmp.is_ruin
  FROM tmp_players_update tmp
  JOIN players p ON p.id = tmp.id
  WHERE p.honor IS NOT NULL
    AND CASE WHEN jsonb_typeof(p.castles) = 'array' THEN jsonb_array_length(p.castles) > 0 ELSE FALSE END
    AND (
      p.honor IS DISTINCT FROM tmp.honor
      OR (COALESCE(p.remaining_peace_time, 0) > 0) <> (COALESCE(tmp.remaining_peace_time, 0) > 0)
      OR COALESCE(p.is_ruin, FALSE) <> tmp.is_ruin
    )
`;

export const PRUNE_PLAYER_STATE_HISTORY = `
  DELETE FROM player_state_history WHERE created_at < NOW() - INTERVAL '${PLAYER_STATE_RETENTION_DAYS} days'
`;
