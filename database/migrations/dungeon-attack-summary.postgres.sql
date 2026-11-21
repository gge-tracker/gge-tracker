DO $migration$
BEGIN
  IF to_regclass('public.dungeons_history') IS NULL OR to_regclass('public.dungeons') IS NULL THEN
    RAISE NOTICE 'no dungeon tables in %, skipped', current_database();
    RETURN;
  END IF;

  LOCK TABLE public.dungeons_history IN SHARE ROW EXCLUSIVE MODE;

  ALTER TABLE public.dungeons
    ADD COLUMN IF NOT EXISTS attack_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_attack_at timestamp without time zone,
    ADD COLUMN IF NOT EXISTS previous_attack_at timestamp without time zone,
    ADD COLUMN IF NOT EXISTS last_attacker_id integer;

  EXECUTE $function$
    CREATE OR REPLACE FUNCTION public.dungeons_record_attack() RETURNS trigger
    LANGUAGE plpgsql AS $body$
    BEGIN
      UPDATE public.dungeons D
      SET
        attack_count = D.attack_count + 1,
        previous_attack_at = CASE
          WHEN D.last_attack_at IS NULL OR NEW.attacked_at >= D.last_attack_at THEN D.last_attack_at
          ELSE GREATEST(D.previous_attack_at, NEW.attacked_at)
        END,
        last_attacker_id = CASE
          WHEN D.last_attack_at IS NULL OR NEW.attacked_at >= D.last_attack_at THEN NEW.player_id
          ELSE D.last_attacker_id
        END,
        last_attack_at = GREATEST(D.last_attack_at, NEW.attacked_at)
      WHERE D.kid = NEW.kid
        AND D.position_x = NEW.position_x
        AND D.position_y = NEW.position_y;
      RETURN NULL;
    END
    $body$
  $function$;

  DROP TRIGGER IF EXISTS dungeons_history_record_attack ON public.dungeons_history;
  CREATE TRIGGER dungeons_history_record_attack
    AFTER INSERT ON public.dungeons_history
    FOR EACH ROW EXECUTE FUNCTION public.dungeons_record_attack();

  UPDATE public.dungeons D
  SET
    attack_count = COALESCE(S.attack_count, 0),
    last_attack_at = S.last_attack_at,
    previous_attack_at = S.previous_attack_at,
    last_attacker_id = S.last_attacker_id
  FROM public.dungeons D2
  LEFT JOIN (
    SELECT
      kid,
      position_x,
      position_y,
      COUNT(*) AS attack_count,
      MAX(attacked_at) AS last_attack_at,
      (ARRAY_AGG(attacked_at ORDER BY attacked_at DESC))[2] AS previous_attack_at,
      (ARRAY_AGG(player_id ORDER BY attacked_at DESC))[1] AS last_attacker_id
    FROM public.dungeons_history
    GROUP BY kid, position_x, position_y
  ) S
    ON S.kid = D2.kid AND S.position_x = D2.position_x AND S.position_y = D2.position_y
  WHERE D.kid = D2.kid AND D.position_x = D2.position_x AND D.position_y = D2.position_y;
END
$migration$;
