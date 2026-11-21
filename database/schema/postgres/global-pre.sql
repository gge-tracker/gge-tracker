--
-- PostgreSQL database dump
--

\restrict 9ZygnX1ktBqJViu22FrZSHblYr7phXsrM4fZG6WBu1VUxQTdVKs5sW7RxxBK3ST

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: grand_tournament; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grand_tournament (
    server_id smallint CONSTRAINT great_tournament_server_id_not_null NOT NULL,
    division_id smallint CONSTRAINT great_tournament_division_id_not_null NOT NULL,
    subdivision_id smallint CONSTRAINT great_tournament_subdivision_id_not_null NOT NULL,
    alliance_id integer CONSTRAINT great_tournament_alliance_id_not_null NOT NULL,
    alliance_name character varying(40),
    created_at timestamp without time zone DEFAULT now(),
    rank integer,
    score bigint,
    event_id integer DEFAULT 1,
    game character varying(3) DEFAULT 'ep'::character varying NOT NULL
);


--
-- Name: mini_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mini_games (
    id bigint NOT NULL,
    game_date date NOT NULL,
    server character varying(30) NOT NULL,
    player_id bigint NOT NULL,
    castle_id bigint NOT NULL,
    position_x integer NOT NULL,
    position_y integer NOT NULL,
    nb_castles integer,
    skin_equipment_id integer,
    skin_equipment_name character varying(50),
    gate_level integer,
    wall_level integer,
    keep_level integer,
    tower_level integer,
    castle_name character varying(20),
    alliance_rank integer,
    honor integer,
    player_title_1 integer,
    player_title_2 integer,
    is_protection boolean,
    level integer,
    legendary_level integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    might bigint,
    fame bigint,
    name character varying(30)
);


--
-- Name: mini_games_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mini_games_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mini_games_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mini_games_id_seq OWNED BY public.mini_games.id;


--
-- Name: mini_games id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mini_games ALTER COLUMN id SET DEFAULT nextval('public.mini_games_id_seq'::regclass);


--
-- PostgreSQL database dump complete
--

\unrestrict 9ZygnX1ktBqJViu22FrZSHblYr7phXsrM4fZG6WBu1VUxQTdVKs5sW7RxxBK3ST

-- materialized views flattened to tables (their sources are foreign tables)
DROP TABLE IF EXISTS public.global_ranking; CREATE TABLE public.global_ranking (region text, id bigint, global_rank bigint);
DROP TABLE IF EXISTS public.grand_tournament_hours_mv; CREATE TABLE public.grand_tournament_hours_mv (game character varying(3) DEFAULT 'ep'::character varying, event_id integer, hour timestamp without time zone);

-- global_players, as pg_dump writes it once global-players-profile.postgres.sql is applied
CREATE TABLE public.global_players (
    region text NOT NULL,
    id bigint NOT NULL,
    might_current bigint,
    name text,
    alliance_id bigint,
    alliance_name text,
    alliance_rank smallint,
    level smallint,
    legendary_level smallint,
    might_all_time bigint,
    loot_current bigint,
    loot_all_time bigint,
    current_fame numeric(20,0),
    highest_fame numeric(20,0),
    honor integer,
    max_honor integer,
    peace_disabled_at timestamp with time zone,
    active boolean DEFAULT false NOT NULL
);
