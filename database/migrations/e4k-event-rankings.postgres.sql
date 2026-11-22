-- E4K final rankings live in the E4K_FR1 database, the way the EP ones live in FR1's (application historical design)
DO $$
BEGIN
  IF current_database() <> 'ggetracker-e4k-fr1' THEN
    RAISE NOTICE 'e4k-event-rankings: % is not the E4K event database, skipped', current_database();
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.outer_realms_event (
    event_num integer PRIMARY KEY,
    collect_date timestamp without time zone NOT NULL,
    fr integer NOT NULL,
    igh integer NOT NULL,
    top1_player_id integer,
    top1_player_score bigint,
    created_at timestamp without time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE IF NOT EXISTS public.outer_realms_ranking (
    id bigserial PRIMARY KEY,
    event_num integer NOT NULL REFERENCES public.outer_realms_event(event_num),
    player_id integer,
    server character varying(40) NOT NULL,
    level smallint NOT NULL,
    legendary_level smallint,
    point bigint NOT NULL,
    rank integer NOT NULL,
    player_name character varying(60),
    alliance_name character varying(30),
    CONSTRAINT uq_event_player UNIQUE (event_num, player_id, server)
  );
  CREATE INDEX IF NOT EXISTS idx_event_rank ON public.outer_realms_ranking USING btree (event_num, rank);
  CREATE INDEX IF NOT EXISTS idx_event_server ON public.outer_realms_ranking USING btree (event_num, server);
  CREATE INDEX IF NOT EXISTS idx_player_participations ON public.outer_realms_ranking USING btree (player_id, event_num);

  CREATE TABLE IF NOT EXISTS public.beyond_the_horizon_event (
    event_num integer PRIMARY KEY,
    collect_date timestamp without time zone NOT NULL,
    fr integer NOT NULL,
    igh integer NOT NULL,
    top1_player_id integer,
    top1_player_score bigint,
    created_at timestamp without time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE IF NOT EXISTS public.beyond_the_horizon_ranking (
    id bigserial PRIMARY KEY,
    event_num integer NOT NULL REFERENCES public.beyond_the_horizon_event(event_num),
    player_id integer,
    server character varying(40) NOT NULL,
    level smallint NOT NULL,
    legendary_level smallint,
    point bigint NOT NULL,
    rank integer NOT NULL,
    player_name character varying(60),
    alliance_name character varying(40),
    CONSTRAINT uq_event_player_horizon UNIQUE (event_num, player_id, server)
  );
  CREATE INDEX IF NOT EXISTS idx_bth_event_point ON public.beyond_the_horizon_ranking USING btree (event_num, point DESC);
  CREATE INDEX IF NOT EXISTS idx_bth_event_rank ON public.beyond_the_horizon_ranking USING btree (event_num, rank);
  CREATE INDEX IF NOT EXISTS idx_bth_player_event ON public.beyond_the_horizon_ranking USING btree (player_id, event_num);
END $$;
