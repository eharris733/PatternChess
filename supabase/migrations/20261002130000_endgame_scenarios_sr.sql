-- Endgame scenarios join the spaced-repetition ladder (same rungs as
-- blunders: SPACED_REPETITION_DAYS [1,3,7,21] + 56-day maintenance; the
-- client computes next_drill_at via the shared advanceSr/nextDrillDate).
-- `status` stays as the play-out outcome (the endgamesRescued achievement
-- and the dashboard card read it); these columns drive "Review N due" and
-- the mastery chain on /endgames.

alter table public.endgame_scenarios
  add column if not exists cycle_number integer not null default 0,
  add column if not exists times_correct integer not null default 0,
  add column if not exists times_attempted integer not null default 0,
  add column if not exists last_drill_failed boolean not null default false,
  add column if not exists last_drilled_at timestamptz,
  add column if not exists next_drill_at timestamptz;

-- Backfill from what each scenario has already been through. Only rows that
-- were never put on the ladder (next_drill_at is null), so re-running is a
-- no-op. A pass counts as the first rung (next review 3 days after it); a
-- fail is a just-failed item (1 day); unplayed scenarios are due now.
update public.endgame_scenarios
set
  cycle_number = case when status = 'passed' then 1 else 0 end,
  times_attempted = greatest(attempts, case when status = 'pending' then 0 else 1 end),
  times_correct = case when status = 'passed' then 1 else 0 end,
  last_drill_failed = (status = 'failed'),
  last_drilled_at = case when status = 'pending' then null else coalesce(last_played_at, created_at) end,
  next_drill_at = case
    when status = 'passed' then coalesce(last_played_at, created_at) + interval '3 days'
    when status = 'failed' then coalesce(last_played_at, created_at) + interval '1 day'
    else created_at
  end
where next_drill_at is null;

create index if not exists endgame_scenarios_user_due_idx
  on public.endgame_scenarios (user_id, next_drill_at)
  where retired_at is null;
