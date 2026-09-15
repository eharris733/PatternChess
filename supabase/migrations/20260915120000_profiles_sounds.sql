-- Sound preference (move/capture/check + correct/incorrect/achievement cues).
-- On by default; the Profile "Play sounds" toggle writes it.
alter table public.profiles
  add column if not exists sounds_enabled boolean not null default true;
