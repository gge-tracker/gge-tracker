SET lock_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public.player_castle_movements_history') IS NULL THEN
    RAISE NOTICE 'no player_castle_movements_history in this database, skipped';
    RETURN;
  END IF;

  ALTER TABLE player_castle_movements_history ADD COLUMN IF NOT EXISTS previous_owner_id integer;

  WITH captures AS (
    SELECT
      id,
      player_id,
      created_at,
      CASE castle_type WHEN 26 THEN 2 WHEN 28 THEN 3 END AS reset_day,
      LAG(player_id) OVER same_castle AS previous_player_id,
      LAG(created_at) OVER same_castle AS previous_created_at
    FROM player_castle_movements_history
    WHERE movement_type = 'add'
      AND castle_type NOT IN (1, 12)
      AND position_x_new IS NOT NULL
      AND position_y_new IS NOT NULL
    WINDOW same_castle AS (PARTITION BY castle_type, position_x_new, position_y_new ORDER BY created_at, id)
  ),
  resolved AS (
    SELECT id, previous_player_id
    FROM captures
    WHERE previous_player_id IS NOT NULL
      AND previous_player_id <> player_id
      AND (
        reset_day IS NULL
        OR (
          NOT (
            created_at >= date_trunc('month', created_at) + make_interval(days => reset_day - 2, hours => 12)
            AND created_at < date_trunc('month', created_at) + make_interval(days => reset_day - 1, hours => 8)
          )
          AND date_trunc('month', created_at - make_interval(days => reset_day - 1, hours => 8))
            = date_trunc('month', previous_created_at - make_interval(days => reset_day - 1, hours => 8))
        )
      )
  )
  UPDATE player_castle_movements_history AS movement
  SET previous_owner_id = resolved.previous_player_id
  FROM resolved
  WHERE movement.id = resolved.id
    AND movement.previous_owner_id IS NULL;
END
$$;
