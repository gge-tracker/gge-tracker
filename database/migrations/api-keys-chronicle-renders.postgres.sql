DO $$
BEGIN
  IF to_regclass('public.api_keys') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS chronicle_renders_per_minute integer;
  ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_chronicle_renders_per_minute_check;
  ALTER TABLE api_keys ADD CONSTRAINT api_keys_chronicle_renders_per_minute_check
    CHECK (chronicle_renders_per_minute IS NULL OR chronicle_renders_per_minute BETWEEN 1 AND 10000);
END $$;
