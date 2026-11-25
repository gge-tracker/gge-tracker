DO $$
BEGIN
  IF to_regclass('public.outer_realms_event') IS NULL THEN
    RAISE NOTICE 'event-variant: no event tables in %, skipped', current_database();
    RETURN;
  END IF;
  ALTER TABLE public.outer_realms_event
    ADD COLUMN IF NOT EXISTS setting_id integer,
    ADD COLUMN IF NOT EXISTS scoring character varying(40);
  IF to_regclass('public.beyond_the_horizon_event') IS NOT NULL THEN
    ALTER TABLE public.beyond_the_horizon_event
      ADD COLUMN IF NOT EXISTS setting_id integer,
      ADD COLUMN IF NOT EXISTS scoring character varying(40);
  END IF;
END $$;
