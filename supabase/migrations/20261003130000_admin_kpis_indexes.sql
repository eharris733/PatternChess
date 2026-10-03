-- admin_kpis() intermittently 500s ("Thread killed by timeout manager"):
-- on a cold cache its per-user `games` reads fetch heap pages (wide rows —
-- the PGN lives inline), and the activity / last-active CTEs alone took
-- ~1.4s of a run that has to fit the authenticated role's 8s timeout.
-- These two indexes cover every `games` access in the function, so they
-- become index-only scans:
--   * activity_src / last_active_per_user / game_counts / funnel.synced
--     → (user_id, created_at)
--   * funnel.found_blunders (exists … analyzed_at is not null)
--     → partial (user_id) where analyzed_at is not null

create index if not exists games_user_created_idx
  on public.games (user_id, created_at);

create index if not exists games_user_analyzed_idx
  on public.games (user_id)
  where analyzed_at is not null;
