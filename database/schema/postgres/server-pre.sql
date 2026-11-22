--
-- PostgreSQL database dump
--

\restrict Az2yb4uPMwoKPmeRAF2dmE9v3P0xG4Fu1zcPthbEmuQGmn3047n8myuxkaoQDSO

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: dblink; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA public;


--
-- Name: movement_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.movement_type_enum AS ENUM (
    'add',
    'remove',
    'move'
);


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alliances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alliances (
    id integer NOT NULL,
    name character varying(30) NOT NULL,
    is_searching_alliance boolean,
    auto_join_enabled boolean,
    is_island_king boolean,
    language text,
    description text
);


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    id integer NOT NULL,
    name character varying(40) NOT NULL,
    alliance_id integer,
    might_current bigint,
    might_all_time bigint,
    loot_current bigint,
    loot_all_time bigint,
    level smallint,
    legendary_level smallint,
    highest_fame numeric(20,0) DEFAULT 0 NOT NULL,
    current_fame numeric(20,0) DEFAULT 0 NOT NULL,
    remaining_relocation_time integer DEFAULT 0 NOT NULL,
    castles jsonb,
    castles_realm jsonb,
    honor integer,
    max_honor integer,
    remaining_peace_time integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    peace_disabled_at timestamp with time zone,
    alliance_rank smallint,
    first_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: active_alliances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.active_alliances AS
 SELECT id,
    name
   FROM public.alliances a
  WHERE (EXISTS ( SELECT 1
           FROM public.players p
          WHERE (p.alliance_id = a.id)));


--
-- Name: alliance_description_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alliance_description_history (
    id bigint NOT NULL,
    alliance_id integer NOT NULL,
    old_description text,
    new_description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: alliance_description_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alliance_description_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alliance_description_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alliance_description_history_id_seq OWNED BY public.alliance_description_history.id;


--
-- Name: alliance_update_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alliance_update_history (
    id integer NOT NULL,
    alliance_id integer NOT NULL,
    old_name character varying(100),
    new_name character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: alliance_update_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alliance_update_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alliance_update_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alliance_update_history_id_seq OWNED BY public.alliance_update_history.id;


--
-- Name: beyond_the_horizon_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beyond_the_horizon_event (
    event_num integer NOT NULL,
    collect_date timestamp without time zone NOT NULL,
    fr integer NOT NULL,
    igh integer NOT NULL,
    top1_player_id integer,
    top1_player_score bigint,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: beyond_the_horizon_ranking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beyond_the_horizon_ranking (
    id bigint NOT NULL,
    event_num integer NOT NULL,
    player_id integer,
    server character varying(40) NOT NULL,
    level smallint NOT NULL,
    legendary_level smallint,
    point bigint NOT NULL,
    rank integer NOT NULL,
    player_name character varying(60),
    alliance_name character varying(40)
);


--
-- Name: beyond_the_horizon_ranking_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.beyond_the_horizon_ranking_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: beyond_the_horizon_ranking_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.beyond_the_horizon_ranking_id_seq OWNED BY public.beyond_the_horizon_ranking.id;


--
-- Name: dungeon_player_cooldowns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dungeon_player_cooldowns (
    kid smallint NOT NULL,
    position_x smallint NOT NULL,
    position_y smallint NOT NULL,
    player_id integer NOT NULL,
    available_at timestamp without time zone NOT NULL
);


--
-- Name: dungeons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dungeons (
    kid smallint NOT NULL,
    position_x smallint NOT NULL,
    position_y smallint NOT NULL,
    global_available_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: dungeons_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dungeons_history (
    id bigint NOT NULL,
    kid smallint NOT NULL,
    position_x smallint NOT NULL,
    position_y smallint NOT NULL,
    player_id integer NOT NULL,
    attacked_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: dungeons_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dungeons_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dungeons_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dungeons_history_id_seq OWNED BY public.dungeons_history.id;


--
-- Name: offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offers (
    id integer NOT NULL,
    server_type character varying(30) NOT NULL,
    offer_type character varying(30) NOT NULL,
    offer integer,
    world_type character varying(50) NOT NULL,
    start_at timestamp without time zone NOT NULL,
    end_at timestamp without time zone NOT NULL
);


--
-- Name: offers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.offers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: offers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.offers_id_seq OWNED BY public.offers.id;


--
-- Name: outer_realms_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outer_realms_event (
    event_num integer NOT NULL,
    collect_date timestamp without time zone NOT NULL,
    fr integer NOT NULL,
    igh integer NOT NULL,
    top1_player_id integer,
    top1_player_score bigint,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: outer_realms_ranking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outer_realms_ranking (
    id bigint NOT NULL,
    event_num integer NOT NULL,
    player_id integer,
    server character varying(40) NOT NULL,
    level smallint NOT NULL,
    legendary_level smallint,
    point bigint NOT NULL,
    rank integer NOT NULL,
    player_name character varying(60),
    alliance_name character varying(30)
);


--
-- Name: outer_realms_ranking_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outer_realms_ranking_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outer_realms_ranking_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outer_realms_ranking_id_seq OWNED BY public.outer_realms_ranking.id;


--
-- Name: parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parameters (
    id integer NOT NULL,
    identifier character varying(50) NOT NULL,
    value integer,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: parameters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parameters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parameters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parameters_id_seq OWNED BY public.parameters.id;


--
-- Name: player_alliance_update; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_alliance_update (
    id integer NOT NULL,
    player_id integer NOT NULL,
    old_alliance_id integer,
    new_alliance_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    old_alliance_name text,
    new_alliance_name text
);


--
-- Name: player_alliance_update_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.player_alliance_update_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: player_alliance_update_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.player_alliance_update_id_seq OWNED BY public.player_alliance_update.id;


--
-- Name: player_castle_movements_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_castle_movements_history (
    id bigint NOT NULL,
    player_id integer NOT NULL,
    castle_type smallint NOT NULL,
    movement_type character varying(10) NOT NULL,
    position_x_old smallint,
    position_y_old smallint,
    position_x_new smallint,
    position_y_new smallint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: player_castle_movements_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.player_castle_movements_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: player_castle_movements_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.player_castle_movements_history_id_seq OWNED BY public.player_castle_movements_history.id;


--
-- Name: player_state_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_state_history (
    id bigserial PRIMARY KEY,
    player_id integer NOT NULL,
    honor_old integer,
    honor_new integer,
    peace_old boolean NOT NULL,
    peace_new boolean NOT NULL,
    peace_until_old timestamp with time zone,
    peace_until_new timestamp with time zone,
    ruin_old boolean NOT NULL,
    ruin_new boolean NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: player_name_update_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_name_update_history (
    id integer NOT NULL,
    player_id integer NOT NULL,
    old_name character varying(100),
    new_name character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: player_name_update_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.player_name_update_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: player_name_update_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.player_name_update_history_id_seq OWNED BY public.player_name_update_history.id;


--
-- Name: server_statistics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.server_statistics (
    id bigint NOT NULL,
    avg_might double precision,
    avg_loot double precision,
    avg_honor double precision,
    avg_level double precision,
    max_might bigint,
    max_might_player_id integer,
    max_loot_player_id integer,
    max_loot numeric(20,0),
    players_count bigint,
    alliance_count integer NOT NULL,
    players_in_peace integer,
    players_who_changed_alliance smallint NOT NULL,
    players_who_changed_name smallint NOT NULL,
    total_might numeric(20,0),
    total_loot numeric(20,0),
    total_honor numeric(20,0),
    variation_might numeric(20,0) NOT NULL,
    variation_loot numeric(20,0) NOT NULL,
    variation_honor numeric(20,0) NOT NULL,
    alliances_changed_name integer NOT NULL,
    events_count smallint NOT NULL,
    events_top_3_names text NOT NULL,
    events_participation_rate text NOT NULL,
    event_nomad_points numeric(20,0),
    event_war_realms_points numeric(20,0),
    event_bloodcrow_points numeric(20,0),
    event_samurai_points numeric(20,0),
    event_berimond_invasion_points numeric(20,0),
    event_berimond_kingdom_points numeric(20,0),
    event_nomad_players integer,
    event_berimond_invasion_players integer,
    event_berimond_kingdom_players integer,
    event_bloodcrow_players integer,
    event_samurai_players integer,
    event_war_realms_players integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: server_statistics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.server_statistics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: server_statistics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.server_statistics_id_seq OWNED BY public.server_statistics.id;


--
-- Name: storm_forts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storm_forts (
    position_x smallint NOT NULL,
    position_y smallint NOT NULL,
    isle_id smallint NOT NULL,
    victory_count smallint DEFAULT 0 NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storm_forts_victory_count_check CHECK ((victory_count >= 0))
)
WITH (fillfactor='70');


--
-- Name: storm_isles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storm_isles (
    position_x smallint NOT NULL,
    position_y smallint NOT NULL,
    object_id integer NOT NULL,
    isle_id smallint NOT NULL,
    occupier_id integer,
    state smallint NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storm_isles_check CHECK (((state = 1) = (occupier_id IS NOT NULL))),
    CONSTRAINT storm_isles_state_check CHECK ((state = ANY (ARRAY[0, 1, 2])))
)
WITH (fillfactor='70');


--
-- Name: storm_meta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storm_meta (
    id boolean DEFAULT true NOT NULL,
    season_started_at timestamp with time zone DEFAULT now() NOT NULL,
    scan_radius smallint DEFAULT 50 NOT NULL,
    last_scan_at timestamp with time zone,
    CONSTRAINT storm_meta_id_check CHECK (id)
);


--
-- Name: alliance_description_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alliance_description_history ALTER COLUMN id SET DEFAULT nextval('public.alliance_description_history_id_seq'::regclass);


--
-- Name: alliance_update_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alliance_update_history ALTER COLUMN id SET DEFAULT nextval('public.alliance_update_history_id_seq'::regclass);


--
-- Name: beyond_the_horizon_ranking id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beyond_the_horizon_ranking ALTER COLUMN id SET DEFAULT nextval('public.beyond_the_horizon_ranking_id_seq'::regclass);


--
-- Name: dungeons_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dungeons_history ALTER COLUMN id SET DEFAULT nextval('public.dungeons_history_id_seq'::regclass);


--
-- Name: offers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers ALTER COLUMN id SET DEFAULT nextval('public.offers_id_seq'::regclass);


--
-- Name: outer_realms_ranking id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outer_realms_ranking ALTER COLUMN id SET DEFAULT nextval('public.outer_realms_ranking_id_seq'::regclass);


--
-- Name: parameters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parameters ALTER COLUMN id SET DEFAULT nextval('public.parameters_id_seq'::regclass);


--
-- Name: player_alliance_update id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_alliance_update ALTER COLUMN id SET DEFAULT nextval('public.player_alliance_update_id_seq'::regclass);


--
-- Name: player_castle_movements_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_castle_movements_history ALTER COLUMN id SET DEFAULT nextval('public.player_castle_movements_history_id_seq'::regclass);


--
-- Name: player_name_update_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_name_update_history ALTER COLUMN id SET DEFAULT nextval('public.player_name_update_history_id_seq'::regclass);


--
-- Name: server_statistics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_statistics ALTER COLUMN id SET DEFAULT nextval('public.server_statistics_id_seq'::regclass);


--
-- PostgreSQL database dump complete
--

\unrestrict Az2yb4uPMwoKPmeRAF2dmE9v3P0xG4Fu1zcPthbEmuQGmn3047n8myuxkaoQDSO

