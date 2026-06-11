-- Adds the per-user training-screen preferences.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).
-- show_engine_evals: show raw engine evals next to win-chance percentages.
-- reveal_before_solve: show the blunder review step (played move + refutation)
--   before solving; defaults off so new positions are a blind test.

alter table public.profiles
  add column if not exists show_engine_evals boolean not null default false;

alter table public.profiles
  add column if not exists reveal_before_solve boolean not null default false;
