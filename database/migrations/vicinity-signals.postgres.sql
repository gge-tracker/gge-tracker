SET lock_timeout = '10s';

DO $$
BEGIN
  IF to_regclass('public.player_castle_movements_history') IS NULL OR to_regclass('public.players') IS NULL THEN
    RAISE NOTICE 'not a server database, skipped';
    RETURN;
  END IF;

  ALTER TABLE players ADD COLUMN IF NOT EXISTS first_seen_at timestamp without time zone;
  ALTER TABLE players ALTER COLUMN first_seen_at SET DEFAULT CURRENT_TIMESTAMP;

  CREATE TABLE IF NOT EXISTS player_state_history (
    id bigserial PRIMARY KEY,
    player_id integer NOT NULL,
    honor_old integer,
    honor_new integer,
    peace_old boolean NOT NULL,
    peace_new boolean NOT NULL,
    peace_until_old timestamp with time zone,
    peace_until_new timestamp with time zone,
    ruin_old boolean NOT NULL,
    ruin_new boolean NOT NULL,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_player_state_history_created_at ON player_state_history USING btree (created_at);
  CREATE INDEX IF NOT EXISTS idx_player_state_history_player_created
    ON player_state_history USING btree (player_id, created_at);
END
$$;
