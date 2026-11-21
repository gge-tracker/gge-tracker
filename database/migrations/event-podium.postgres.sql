DO $$
BEGIN
  IF to_regclass('public.outer_realms_ranking') IS NULL THEN
    RAISE NOTICE 'event-podium: no event rankings in %, skipped', current_database();
    RETURN;
  END IF;
  CREATE TABLE IF NOT EXISTS public.event_podium (
    event_type character varying(40) NOT NULL,
    event_num integer NOT NULL,
    podium jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (event_type, event_num)
  );
END $$;
