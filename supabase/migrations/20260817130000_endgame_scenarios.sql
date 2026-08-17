-- Endgame trainer: endgames where the user dropped a half/full point
-- (should-have-won -> drew/lost, should-have-drawn -> lost), found by crossing
-- existing endgame-phase analysis blunders with the game result. Pass/fail
-- status and attempt counts aren't derivable from existing data, hence the
-- table. The scan upserts with ignoreDuplicates so statuses survive re-scans.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).

create table if not exists endgame_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  -- The first point-dropping endgame mistake in the game.
  blunder_id uuid references blunders(id) on delete set null,
  -- Position just BEFORE that mistake (= blunders.fen); the play-out starts here.
  start_fen text not null,
  user_color text not null check (user_color in ('white', 'black')),
  deserved_result text not null check (deserved_result in ('win', 'draw')),
  actual_result text not null check (actual_result in ('loss', 'draw')),
  status text not null default 'pending' check (status in ('pending', 'passed', 'failed')),
  attempts int not null default 0,
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  -- One scenario per game: the first dropped point.
  unique (user_id, game_id)
);

create index if not exists endgame_scenarios_user_idx on endgame_scenarios (user_id, created_at desc);

alter table endgame_scenarios enable row level security;

drop policy if exists endgame_scenarios_select_own on endgame_scenarios;
create policy endgame_scenarios_select_own on endgame_scenarios
  for select using (auth.uid() = user_id);

drop policy if exists endgame_scenarios_insert_own on endgame_scenarios;
create policy endgame_scenarios_insert_own on endgame_scenarios
  for insert with check (auth.uid() = user_id);

drop policy if exists endgame_scenarios_update_own on endgame_scenarios;
create policy endgame_scenarios_update_own on endgame_scenarios
  for update using (auth.uid() = user_id);

drop policy if exists endgame_scenarios_delete_own on endgame_scenarios;
create policy endgame_scenarios_delete_own on endgame_scenarios
  for delete using (auth.uid() = user_id);
