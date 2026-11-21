--
-- PostgreSQL database dump
--

\restrict KA1cyCBNTqkJRFAc01cnvrEQGtzdMf4zkoCsM7Iw2DeKleyRyG9huIKrJY9dmiV

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

--
-- Name: mini_games mini_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mini_games
    ADD CONSTRAINT mini_games_pkey PRIMARY KEY (id);


--
-- Name: mini_games uniq_mini_game_per_day_server; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mini_games
    ADD CONSTRAINT uniq_mini_game_per_day_server UNIQUE (game_date, server);


--
-- Name: idx_gt_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gt_created_at ON public.grand_tournament USING btree (created_at DESC);


--
-- Name: idx_gt_event_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gt_event_hour ON public.grand_tournament USING btree (event_id, date_trunc('hour'::text, created_at));


--
-- Name: idx_gt_server_div; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gt_server_div ON public.grand_tournament USING btree (server_id, division_id);


--
-- PostgreSQL database dump complete
--

\unrestrict KA1cyCBNTqkJRFAc01cnvrEQGtzdMf4zkoCsM7Iw2DeKleyRyG9huIKrJY9dmiV


ALTER TABLE ONLY public.global_players ADD CONSTRAINT global_players_pkey PRIMARY KEY (region, id);
CREATE INDEX global_players_active_might_idx ON public.global_players USING btree (might_current DESC NULLS LAST, region, id) WHERE active;
CREATE INDEX global_players_active_loot_idx ON public.global_players USING btree (loot_current DESC NULLS LAST, region, id) WHERE active;
CREATE INDEX global_players_active_fame_idx ON public.global_players USING btree (current_fame DESC NULLS LAST, region, id) WHERE active;
CREATE INDEX global_players_active_level_idx ON public.global_players USING btree (level DESC NULLS LAST, legendary_level DESC NULLS LAST, region, id) WHERE active;
