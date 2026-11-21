DO $$
BEGIN
  IF to_regclass('public.api_keys') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS game_commands_per_minute integer;
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS game_commands_per_day integer;
  ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_game_commands_per_minute_check;
  ALTER TABLE api_keys ADD CONSTRAINT api_keys_game_commands_per_minute_check
    CHECK (game_commands_per_minute IS NULL OR game_commands_per_minute BETWEEN 1 AND 10000);
  ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_game_commands_per_day_check;
  ALTER TABLE api_keys ADD CONSTRAINT api_keys_game_commands_per_day_check
    CHECK (game_commands_per_day IS NULL OR game_commands_per_day BETWEEN 1 AND 1000000);
END $$;
