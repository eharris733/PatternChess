-- Adds the per-user board / page theme preference.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).
-- Valid values: default | inverse | frozen | green | purple
-- New users default to 'default' so the brutalist palette stays the first impression.

alter table public.profiles
  add column if not exists board_theme text not null default 'default';

alter table public.profiles
  drop constraint if exists profiles_board_theme_chk;

alter table public.profiles
  add constraint profiles_board_theme_chk
  check (board_theme in ('default', 'inverse', 'frozen', 'green', 'purple'));
