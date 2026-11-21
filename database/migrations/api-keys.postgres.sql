SELECT current_database() = 'empire-ranking-global' AS is_global_database \gset

\if :is_global_database

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  partner TEXT NOT NULL CHECK (length(partner) BETWEEN 1 AND 64),
  key_hash CHAR(64) NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  rate_limit_points INTEGER NOT NULL CHECK (rate_limit_points BETWEEN 1 AND 100000),
  rate_limit_window_seconds INTEGER NOT NULL CHECK (rate_limit_window_seconds BETWEEN 1 AND 3600),
  game_commands_per_minute INTEGER CONSTRAINT api_keys_game_commands_per_minute_check
    CHECK (game_commands_per_minute IS NULL OR game_commands_per_minute BETWEEN 1 AND 10000),
  game_commands_per_day INTEGER CONSTRAINT api_keys_game_commands_per_day_check
    CHECK (game_commands_per_day IS NULL OR game_commands_per_day BETWEEN 1 AND 1000000),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

COMMENT ON TABLE api_keys IS 'Partner API keys. Only the SHA-256 of a key is stored; the key itself is shown once, when issued';
COMMENT ON COLUMN api_keys.key_prefix IS 'First characters of the key, enough to recognise it in a listing';

\echo api_keys is in place

\else

\echo skipped: api_keys belongs to empire-ranking-global only

\endif

