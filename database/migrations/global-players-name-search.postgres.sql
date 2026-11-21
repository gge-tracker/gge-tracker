SELECT to_regclass('public.global_players') IS NOT NULL AS has_global_players \gset
\if :has_global_players
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS global_players_active_name_trgm_idx
  ON global_players USING gin (name gin_trgm_ops)
  WHERE active;
\endif
