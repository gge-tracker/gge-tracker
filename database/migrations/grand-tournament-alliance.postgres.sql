SELECT to_regclass('public.grand_tournament') IS NOT NULL AS has_grand_tournament \gset
\if :has_grand_tournament
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gt_game_server_alliance_event
  ON grand_tournament (game, server_id, alliance_id, event_id);
\endif
