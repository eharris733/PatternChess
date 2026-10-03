-- Adds the per-user "show the answer after a miss" drill-feedback preference.
-- show_answer_on_miss: after a wrong attempt (tactic or endgame), draw the
--   best move and offer the solution line alongside the refutation. Defaults
--   off so recall stays unaided unless the user opts in. Toggled from the gear
--   on /training and /endgames, and from /profile.

alter table public.profiles
  add column if not exists show_answer_on_miss boolean not null default false;
