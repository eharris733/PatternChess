-- Performance: wrap auth.uid() in a scalar subselect so Postgres evaluates it
-- once per query (an InitPlan) instead of once per row. Clears the Supabase
-- advisor `auth_rls_initplan` WARN across all 22 policies. Expressions are
-- otherwise unchanged (including the `OR user_id IS NULL` anonymous-claim
-- clauses on games/blunders insert+update). ALTER POLICY preserves each
-- policy's command and roles.

-- profiles
alter policy profiles_select_own on profiles using ((select auth.uid()) = id);
alter policy profiles_insert_own on profiles with check ((select auth.uid()) = id);
alter policy profiles_update_own on profiles using ((select auth.uid()) = id);

-- games
alter policy games_select_own on games using (user_id = (select auth.uid()));
alter policy games_insert on games with check ((user_id = (select auth.uid())) or (user_id is null));
alter policy games_update_own on games using ((user_id = (select auth.uid())) or (user_id is null));
alter policy games_delete_own on games using ((select auth.uid()) = user_id);

-- blunders
alter policy blunders_select_own on blunders using (user_id = (select auth.uid()));
alter policy blunders_insert on blunders with check ((user_id = (select auth.uid())) or (user_id is null));
alter policy blunders_update_own on blunders using ((user_id = (select auth.uid())) or (user_id is null));
alter policy blunders_delete_own on blunders using ((select auth.uid()) = user_id);

-- training_sessions
alter policy training_sessions_select_own on training_sessions using ((select auth.uid()) = user_id);
alter policy training_sessions_insert_own on training_sessions with check ((select auth.uid()) = user_id);
alter policy training_sessions_update_own on training_sessions using ((select auth.uid()) = user_id);

-- repertoire_moves
alter policy repertoire_moves_select_own on repertoire_moves using ((select auth.uid()) = user_id);
alter policy repertoire_moves_insert_own on repertoire_moves with check ((select auth.uid()) = user_id);
alter policy repertoire_moves_update_own on repertoire_moves using ((select auth.uid()) = user_id);
alter policy repertoire_moves_delete_own on repertoire_moves using ((select auth.uid()) = user_id);

-- endgame_scenarios
alter policy endgame_scenarios_select_own on endgame_scenarios using ((select auth.uid()) = user_id);
alter policy endgame_scenarios_insert_own on endgame_scenarios with check ((select auth.uid()) = user_id);
alter policy endgame_scenarios_update_own on endgame_scenarios using ((select auth.uid()) = user_id);
alter policy endgame_scenarios_delete_own on endgame_scenarios using ((select auth.uid()) = user_id);
