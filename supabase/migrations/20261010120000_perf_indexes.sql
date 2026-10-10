-- Performance audit 2026-10-10: indexes for the hottest client reads plus the
-- foreign keys the performance advisor flagged as uncovered.

-- getGames (dashboard / vault list): user filter + its exact sort order.
create index if not exists games_user_played_idx
  on public.games (user_id, played_at desc nulls first, created_at desc, id);

-- Openings scan gate: `opening_deviation_version is null or < N`. The old
-- partial index only covered the IS NULL half, so the planner never used it
-- (advisor: unused_index). A plain composite serves both halves via BitmapOr
-- and survives DEVIATION_RULE_VERSION bumps.
create index if not exists games_user_deviation_version_idx
  on public.games (user_id, opening_deviation_version);
drop index if exists public.games_opening_deviation_unchecked_idx;

-- Uncovered foreign keys (advisor: unindexed_foreign_keys). These matter on
-- deletes of the referenced rows (Vault re-analyze, deleteGame).
create index if not exists opening_deviations_game_id_idx
  on public.opening_deviations (game_id);
create index if not exists opening_deviations_blunder_id_idx
  on public.opening_deviations (blunder_id);
create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by);
