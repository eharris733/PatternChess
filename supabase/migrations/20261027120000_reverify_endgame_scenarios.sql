-- Endgame verification moved from a 3s / depth-30 search with a decided-score
-- early stop to a 5s time-capped search (depth 50 backstop, no early stop).
-- Re-queue live scenarios the user hasn't passed so the verifier re-checks them
-- at the new budget. Passed rows are never retired, so re-checking them is moot.
update public.endgame_scenarios
set verified_at = null,
    verify_eval_cp = null
where retired_at is null
  and status <> 'passed'
  and verified_at is not null;
