-- One-time milestone flag: has this user ever started a /training session
-- with a picked focus (opening/motif/phase/situation)? Backs the "Focused
-- Training" discovery achievement. Apply via Supabase SQL editor
-- (project: ydfwppthwnlgxnntzrvg).

alter table public.profiles
  add column if not exists used_training_filter boolean not null default false;
