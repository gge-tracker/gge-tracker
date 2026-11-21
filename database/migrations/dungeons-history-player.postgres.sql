SELECT to_regclass('public.dungeons_history') IS NOT NULL AS has_dungeons_history \gset
\if :has_dungeons_history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dh_player_attacked_at
  ON dungeons_history (player_id, attacked_at DESC)
  INCLUDE (kid, position_x, position_y);
\endif
