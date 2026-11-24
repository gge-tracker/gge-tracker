DO $$
BEGIN
  IF to_regclass('public.grand_tournament') IS NULL THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS grand_tournament_division_rounds (
    game varchar(3) NOT NULL CHECK (game IN ('ep', 'e4k')),
    event_id integer NOT NULL,
    division_round_id integer NOT NULL,
    server varchar(32) NOT NULL,
    seen_at timestamp without time zone NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game, event_id)
  );
END $$;
