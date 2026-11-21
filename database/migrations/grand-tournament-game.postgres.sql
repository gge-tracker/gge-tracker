DO $$
BEGIN
  IF to_regclass('public.grand_tournament') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'grand_tournament' AND column_name = 'game'
  ) THEN
    ALTER TABLE grand_tournament ADD COLUMN game varchar(3) NOT NULL DEFAULT 'ep';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grand_tournament_game_check'
  ) THEN
    ALTER TABLE grand_tournament
      ADD CONSTRAINT grand_tournament_game_check CHECK (game IN ('ep', 'e4k')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grand_tournament_game_check' AND NOT convalidated
  ) THEN
    ALTER TABLE grand_tournament VALIDATE CONSTRAINT grand_tournament_game_check;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.grand_tournament') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'grand_tournament_hours_mv' AND column_name = 'game'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'grand_tournament_hours_mv' AND relkind = 'r') THEN
    DROP TABLE grand_tournament_hours_mv;
  ELSE
    DROP MATERIALIZED VIEW IF EXISTS grand_tournament_hours_mv;
  END IF;

  CREATE MATERIALIZED VIEW grand_tournament_hours_mv AS
    SELECT DISTINCT game, event_id, date_trunc('hour'::text, created_at) AS hour
    FROM grand_tournament;

  CREATE UNIQUE INDEX idx_gt_hours_mv_unique ON grand_tournament_hours_mv (game, event_id, hour);
END $$;

DO $$
BEGIN
  IF to_regclass('public.grand_tournament') IS NULL THEN
    RETURN;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_gt_game_created_at ON grand_tournament (game, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_gt_game_event_hour
    ON grand_tournament (game, event_id, date_trunc('hour'::text, created_at));
  CREATE INDEX IF NOT EXISTS idx_gt_game_server_div ON grand_tournament (game, server_id, division_id);
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_gt_game_created_at') IS NULL THEN
    RETURN;
  END IF;

  DROP INDEX IF EXISTS idx_gt_created_at;
  DROP INDEX IF EXISTS idx_gt_event_hour;
  DROP INDEX IF EXISTS idx_gt_server_div;
END $$;
