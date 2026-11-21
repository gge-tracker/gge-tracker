DO $$
BEGIN
  IF to_regclass('public.storm_forts') IS NOT NULL THEN
    ALTER TABLE storm_forts ADD COLUMN IF NOT EXISTS available_since_observed boolean NOT NULL DEFAULT false;
    ALTER TABLE storm_forts ADD COLUMN IF NOT EXISTS last_available_seconds integer;
  END IF;

  IF to_regclass('public.storm_isles') IS NOT NULL THEN
    ALTER TABLE storm_isles ADD COLUMN IF NOT EXISTS available_since_observed boolean NOT NULL DEFAULT false;
    ALTER TABLE storm_isles ADD COLUMN IF NOT EXISTS last_available_seconds integer;
  END IF;
END
$$;
