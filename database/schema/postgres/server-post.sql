--
-- PostgreSQL database dump
--

\restrict fkzckfUJZturtyEtzwnhoANOChIpEcYJaDMX4tSvSDgSMTeqj5YZ4GSikHdWi1u

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
-- Name: alliance_description_history alliance_description_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alliance_description_history
    ADD CONSTRAINT alliance_description_history_pkey PRIMARY KEY (id);


--
-- Name: alliance_update_history alliance_update_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alliance_update_history
    ADD CONSTRAINT alliance_update_history_pkey PRIMARY KEY (id);


--
-- Name: alliances alliances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alliances
    ADD CONSTRAINT alliances_pkey PRIMARY KEY (id);


--
-- Name: beyond_the_horizon_event beyond_the_horizon_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beyond_the_horizon_event
    ADD CONSTRAINT beyond_the_horizon_event_pkey PRIMARY KEY (event_num);


--
-- Name: beyond_the_horizon_ranking beyond_the_horizon_ranking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beyond_the_horizon_ranking
    ADD CONSTRAINT beyond_the_horizon_ranking_pkey PRIMARY KEY (id);


--
-- Name: dungeon_player_cooldowns dungeon_player_cooldowns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dungeon_player_cooldowns
    ADD CONSTRAINT dungeon_player_cooldowns_pkey PRIMARY KEY (kid, position_x, position_y, player_id);


--
-- Name: dungeons_history dungeons_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dungeons_history
    ADD CONSTRAINT dungeons_history_pkey PRIMARY KEY (id);


--
-- Name: dungeons dungeons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dungeons
    ADD CONSTRAINT dungeons_pkey PRIMARY KEY (kid, position_x, position_y);


--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);


--
-- Name: outer_realms_event outer_realms_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outer_realms_event
    ADD CONSTRAINT outer_realms_event_pkey PRIMARY KEY (event_num);


--
-- Name: outer_realms_ranking outer_realms_ranking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outer_realms_ranking
    ADD CONSTRAINT outer_realms_ranking_pkey PRIMARY KEY (id);


--
-- Name: parameters parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parameters
    ADD CONSTRAINT parameters_pkey PRIMARY KEY (id);


--
-- Name: player_alliance_update player_alliance_update_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_alliance_update
    ADD CONSTRAINT player_alliance_update_pkey PRIMARY KEY (id);


--
-- Name: player_castle_movements_history player_castle_movements_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_castle_movements_history
    ADD CONSTRAINT player_castle_movements_history_pkey PRIMARY KEY (id);


--
-- Name: player_name_update_history player_name_update_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_name_update_history
    ADD CONSTRAINT player_name_update_history_pkey PRIMARY KEY (id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: server_statistics server_statistics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_statistics
    ADD CONSTRAINT server_statistics_pkey PRIMARY KEY (id);


--
-- Name: storm_forts storm_forts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storm_forts
    ADD CONSTRAINT storm_forts_pkey PRIMARY KEY (position_x, position_y);


--
-- Name: storm_isles storm_isles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storm_isles
    ADD CONSTRAINT storm_isles_pkey PRIMARY KEY (position_x, position_y);


--
-- Name: storm_meta storm_meta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storm_meta
    ADD CONSTRAINT storm_meta_pkey PRIMARY KEY (id);


--
-- Name: outer_realms_ranking uq_event_player; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outer_realms_ranking
    ADD CONSTRAINT uq_event_player UNIQUE (event_num, player_id, server);


--
-- Name: beyond_the_horizon_ranking uq_event_player_horizon; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beyond_the_horizon_ranking
    ADD CONSTRAINT uq_event_player_horizon UNIQUE (event_num, player_id, server);


--
-- Name: idx_alliance_description_history_alliance_id_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alliance_description_history_alliance_id_created_at ON public.alliance_description_history USING btree (alliance_id, created_at DESC);


--
-- Name: idx_alliance_update_history_alliance_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alliance_update_history_alliance_id ON public.alliance_update_history USING btree (alliance_id);


--
-- Name: idx_alliance_update_history_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alliance_update_history_created_at ON public.alliance_update_history USING btree (created_at);


--
-- Name: idx_bth_event_point; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bth_event_point ON public.beyond_the_horizon_ranking USING btree (event_num, point DESC);


--
-- Name: idx_bth_event_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bth_event_rank ON public.beyond_the_horizon_ranking USING btree (event_num, rank);


--
-- Name: idx_bth_player_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bth_player_event ON public.beyond_the_horizon_ranking USING btree (player_id, event_num);


--
-- Name: idx_castle_movements_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_castle_movements_created_at ON public.player_castle_movements_history USING btree (created_at);


--
-- Name: idx_castle_movements_movement_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_castle_movements_movement_type ON public.player_castle_movements_history USING btree (movement_type);


--
-- Name: idx_castle_movements_player_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_castle_movements_player_id ON public.player_castle_movements_history USING btree (player_id);


--
-- Name: idx_dh_kid_pos_attacked_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dh_kid_pos_attacked_at_desc ON public.dungeons_history USING btree (kid, position_x, position_y, attacked_at DESC);


--
-- Name: idx_dh_kid_pos_attacked_at_desc_inc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dh_kid_pos_attacked_at_desc_inc ON public.dungeons_history USING btree (kid, position_x, position_y, attacked_at DESC) INCLUDE (player_id);


--
-- Name: idx_dpc_available_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpc_available_at ON public.dungeon_player_cooldowns USING btree (available_at);


--
-- Name: idx_dpc_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpc_lookup ON public.dungeon_player_cooldowns USING btree (kid, position_x, position_y, player_id);


--
-- Name: idx_dungeons_kid_global_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dungeons_kid_global_available ON public.dungeons USING btree (kid, global_available_at);


--
-- Name: idx_event_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_rank ON public.outer_realms_ranking USING btree (event_num, rank);


--
-- Name: idx_event_server; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_server ON public.outer_realms_ranking USING btree (event_num, server);


--
-- Name: idx_parameters_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_parameters_identifier ON public.parameters USING btree (identifier);


--
-- Name: idx_player_alliance_update_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_alliance_update_created_at ON public.player_alliance_update USING btree (created_at);


--
-- Name: idx_player_alliance_update_new_alliance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_alliance_update_new_alliance ON public.player_alliance_update USING btree (new_alliance_id);


--
-- Name: idx_player_alliance_update_old_alliance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_alliance_update_old_alliance ON public.player_alliance_update USING btree (old_alliance_id);


--
-- Name: idx_player_alliance_update_player_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_alliance_update_player_id ON public.player_alliance_update USING btree (player_id);


--
-- Name: idx_player_name_update_history_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_name_update_history_created_at ON public.player_name_update_history USING btree (created_at);


--
-- Name: idx_player_name_update_history_player_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_name_update_history_player_id ON public.player_name_update_history USING btree (player_id);


--
-- Name: idx_player_participations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_participations ON public.outer_realms_ranking USING btree (player_id, event_num);


--
-- Name: idx_players_alliance_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_alliance_id ON public.players USING btree (alliance_id);


--
-- Name: idx_players_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_name ON public.players USING btree (name);


--
-- Name: idx_players_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_players_updated_at ON public.players USING btree (updated_at);


--
-- Name: idx_storm_forts_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storm_forts_available ON public.storm_forts USING btree (available_at) WHERE is_visible;


--
-- Name: idx_storm_forts_victories; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storm_forts_victories ON public.storm_forts USING btree (victory_count, available_at);


--
-- Name: idx_storm_isles_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storm_isles_available ON public.storm_isles USING btree (state, available_at);


--
-- Name: idx_storm_isles_occupier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storm_isles_occupier ON public.storm_isles USING btree (occupier_id) WHERE (occupier_id IS NOT NULL);


--
-- Name: players set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: alliance_update_history alliance_update_history_alliance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alliance_update_history
    ADD CONSTRAINT alliance_update_history_alliance_id_fkey FOREIGN KEY (alliance_id) REFERENCES public.alliances(id);


--
-- Name: dungeon_player_cooldowns dungeon_player_cooldowns_kid_position_x_position_y_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dungeon_player_cooldowns
    ADD CONSTRAINT dungeon_player_cooldowns_kid_position_x_position_y_fkey FOREIGN KEY (kid, position_x, position_y) REFERENCES public.dungeons(kid, position_x, position_y) ON DELETE CASCADE;


--
-- Name: dungeons_history dungeons_history_kid_position_x_position_y_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dungeons_history
    ADD CONSTRAINT dungeons_history_kid_position_x_position_y_fkey FOREIGN KEY (kid, position_x, position_y) REFERENCES public.dungeons(kid, position_x, position_y);


--
-- Name: beyond_the_horizon_ranking fk_event_num; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beyond_the_horizon_ranking
    ADD CONSTRAINT fk_event_num FOREIGN KEY (event_num) REFERENCES public.beyond_the_horizon_event(event_num);


--
-- Name: outer_realms_ranking outer_realms_ranking_event_num_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outer_realms_ranking
    ADD CONSTRAINT outer_realms_ranking_event_num_fkey FOREIGN KEY (event_num) REFERENCES public.outer_realms_event(event_num);


--
-- Name: player_alliance_update player_alliance_update_new_alliance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_alliance_update
    ADD CONSTRAINT player_alliance_update_new_alliance_id_fkey FOREIGN KEY (new_alliance_id) REFERENCES public.alliances(id);


--
-- Name: player_alliance_update player_alliance_update_old_alliance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_alliance_update
    ADD CONSTRAINT player_alliance_update_old_alliance_id_fkey FOREIGN KEY (old_alliance_id) REFERENCES public.alliances(id);


--
-- Name: player_alliance_update player_alliance_update_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_alliance_update
    ADD CONSTRAINT player_alliance_update_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: player_castle_movements_history player_castle_movements_history_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_castle_movements_history
    ADD CONSTRAINT player_castle_movements_history_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: player_name_update_history player_name_update_history_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_name_update_history
    ADD CONSTRAINT player_name_update_history_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: players players_alliance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_alliance_id_fkey FOREIGN KEY (alliance_id) REFERENCES public.alliances(id);


--
-- Name: server_statistics server_statistics_max_loot_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_statistics
    ADD CONSTRAINT server_statistics_max_loot_player_id_fkey FOREIGN KEY (max_loot_player_id) REFERENCES public.players(id);


--
-- Name: server_statistics server_statistics_max_might_player_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_statistics
    ADD CONSTRAINT server_statistics_max_might_player_id_fkey FOREIGN KEY (max_might_player_id) REFERENCES public.players(id);


--
-- PostgreSQL database dump complete
--

\unrestrict fkzckfUJZturtyEtzwnhoANOChIpEcYJaDMX4tSvSDgSMTeqj5YZ4GSikHdWi1u

