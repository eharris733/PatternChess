-- Adds the per-user "autoplay refutation on a repeat miss" training preference.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).
-- autoplay_refutation: on a wrong attempt that isn't the drill's first try,
--   automatically step through the engine's refutation of the played move
--   instead of leaving it as a static reveal. Defaults on.

alter table public.profiles
  add column if not exists autoplay_refutation boolean not null default true;
