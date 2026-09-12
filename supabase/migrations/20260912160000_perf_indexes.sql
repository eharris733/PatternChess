-- Performance: covering indexes for the unindexed foreign keys flagged by the
-- Supabase advisor, plus a partial index backing the due-queue reads.

-- Unindexed foreign keys (advisor 0001).
create index if not exists endgame_scenarios_blunder_id_idx
  on endgame_scenarios (blunder_id);
create index if not exists endgame_scenarios_game_id_idx
  on endgame_scenarios (game_id);
create index if not exists game_annotations_user_id_idx
  on game_annotations (user_id);

-- Due-queue reads: getDueBlunders / getDueTomorrowCount filter by user_id +
-- next_drill_at and exclude retired rows. A user-scoped partial index beats the
-- existing un-scoped idx_blunders_next_drill.
create index if not exists blunders_user_due_active_idx
  on blunders (user_id, next_drill_at)
  where retired_at is null;

-- Sync unanalyzed filters: getUnanalyzedGameIds / countUnanalyzedGames.
create index if not exists games_user_unanalyzed_idx
  on games (user_id)
  where analyzed_at is null;
