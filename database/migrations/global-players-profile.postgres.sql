SELECT to_regclass('public.global_players') IS NOT NULL AS has_global_players \gset
\if :has_global_players

ALTER TABLE global_players
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS alliance_id bigint,
  ADD COLUMN IF NOT EXISTS alliance_name text,
  ADD COLUMN IF NOT EXISTS alliance_rank smallint,
  ADD COLUMN IF NOT EXISTS level smallint,
  ADD COLUMN IF NOT EXISTS legendary_level smallint,
  ADD COLUMN IF NOT EXISTS might_all_time bigint,
  ADD COLUMN IF NOT EXISTS loot_current bigint,
  ADD COLUMN IF NOT EXISTS loot_all_time bigint,
  ADD COLUMN IF NOT EXISTS current_fame numeric(20,0),
  ADD COLUMN IF NOT EXISTS highest_fame numeric(20,0),
  ADD COLUMN IF NOT EXISTS honor integer,
  ADD COLUMN IF NOT EXISTS max_honor integer,
  ADD COLUMN IF NOT EXISTS peace_disabled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;

-- Only ~8% of the players still hold a castle, and the ranking lists only those
CREATE INDEX IF NOT EXISTS global_players_active_might_idx ON global_players (might_current DESC NULLS LAST, region, id) WHERE active;
CREATE INDEX IF NOT EXISTS global_players_active_loot_idx ON global_players (loot_current DESC NULLS LAST, region, id) WHERE active;
CREATE INDEX IF NOT EXISTS global_players_active_fame_idx ON global_players (current_fame DESC NULLS LAST, region, id) WHERE active;
CREATE INDEX IF NOT EXISTS global_players_active_level_idx ON global_players (level DESC NULLS LAST, legendary_level DESC NULLS LAST, region, id) WHERE active;

-- The foreign tables map_global_ranking.sh created only declare id and might_current
DO $$
DECLARE
  source record;
  region text;
BEGIN
  FOR source IN
    SELECT c.relname, s.srvname
    FROM pg_foreign_table f
    JOIN pg_class c ON c.oid = f.ftrelid
    JOIN pg_foreign_server s ON s.oid = f.ftserver
    WHERE c.relname LIKE 'players\_%'
  LOOP
    region := substring(source.relname FROM length('players_') + 1);
    EXECUTE format(
      'ALTER FOREIGN TABLE %I
        ADD COLUMN IF NOT EXISTS name varchar(40),
        ADD COLUMN IF NOT EXISTS alliance_id integer,
        ADD COLUMN IF NOT EXISTS alliance_rank smallint,
        ADD COLUMN IF NOT EXISTS level smallint,
        ADD COLUMN IF NOT EXISTS legendary_level smallint,
        ADD COLUMN IF NOT EXISTS might_all_time bigint,
        ADD COLUMN IF NOT EXISTS loot_current bigint,
        ADD COLUMN IF NOT EXISTS loot_all_time bigint,
        ADD COLUMN IF NOT EXISTS current_fame numeric(20,0),
        ADD COLUMN IF NOT EXISTS highest_fame numeric(20,0),
        ADD COLUMN IF NOT EXISTS honor integer,
        ADD COLUMN IF NOT EXISTS max_honor integer,
        ADD COLUMN IF NOT EXISTS peace_disabled_at timestamp with time zone,
        ADD COLUMN IF NOT EXISTS castles jsonb',
      source.relname
    );
    EXECUTE format(
      'CREATE FOREIGN TABLE IF NOT EXISTS %I (id integer, name varchar(30)) SERVER %I OPTIONS (schema_name %L, table_name %L)',
      'alliances_' || region, source.srvname, 'public', 'alliances'
    );
  END LOOP;
END
$$;

\endif
