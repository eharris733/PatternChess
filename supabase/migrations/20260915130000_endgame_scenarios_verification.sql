-- Endgame scenarios are derived from the fast depth-12 sync eval. A background
-- verifier (src/services/endgameScenarioVerifier.ts) re-evaluates each start
-- position with a ~3s smart-depth search and retires positions the deeper
-- look says aren't actually holdable/winning. Retired rows are hidden from
-- /endgames and the dashboard card but kept for history.
alter table public.endgame_scenarios
  add column if not exists verified_at timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists verify_eval_cp integer;

create index if not exists endgame_scenarios_unverified_idx
  on public.endgame_scenarios (user_id)
  where verified_at is null and retired_at is null;
