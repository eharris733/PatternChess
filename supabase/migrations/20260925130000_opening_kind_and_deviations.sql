-- Openings tab: where each game leaves masters theory, and a third trainable
-- kind for the deviations that cost the user >=10% winning chances.
--
-- A background scan (src/services/openingDeviationService.ts) walks each game
-- through the Lichess masters explorer (stage A, network only), then
-- engine-scores the user's exit move (stage B). One row per game; the
-- games.opening_deviation_version gate is a version (not a timestamp) so
-- re-tuning the rules in src/chess/openingDeviation.ts re-queues every game.

alter table public.blunders drop constraint if exists blunders_kind_check;
alter table public.blunders add constraint blunders_kind_check
  check (kind in ('tactic', 'endgame', 'opening'));

alter table public.games
  add column if not exists opening_deviation_version smallint;

create index if not exists games_opening_deviation_unchecked_idx
  on public.games (user_id)
  where opening_deviation_version is null;

create table if not exists public.opening_deviations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  -- user_left: the user's move left theory (the interesting case).
  -- opponent_left / theory_end / in_book: nobody to blame.
  -- skipped: unreplayable (variants, broken PGN).
  status text not null
    check (status in ('user_left', 'opponent_left', 'theory_end', 'in_book', 'skipped')),
  rule_version smallint not null,
  -- 0-based ply index of the exit move; null unless someone left theory.
  ply int,
  move_number int,
  user_color text check (user_color in ('white', 'black')),
  fen_before text,
  -- FEN minus move counters: the grouping key (transpositions collapse).
  epd_before text,
  played_uci text,
  played_san text,
  reason text check (reason in ('not_in_book', 'losing_line')),
  -- [{uci, san, games, share, moverWinPct}] from the masters DB, best first.
  theory_moves jsonb,
  position_games int,
  played_games int,
  played_mover_win_pct real,
  -- Engine scoring of the exit (user_left only), side-to-move POV cp.
  eval_before int,
  eval_after int,
  chances_lost real,
  classification text check (classification in ('good', 'inaccuracy', 'mistake', 'blunder')),
  eval_depth int,
  evaluated_at timestamptz,
  -- The kind='opening' drill created from this row (>=10% lost), if any.
  blunder_id uuid references public.blunders(id) on delete set null,
  opening_family text,
  opening_name text,
  eco text,
  created_at timestamptz not null default now(),
  unique (user_id, game_id)
);

create index if not exists opening_deviations_family_idx
  on public.opening_deviations (user_id, opening_family);
create index if not exists opening_deviations_epd_idx
  on public.opening_deviations (user_id, epd_before);
create index if not exists opening_deviations_pending_eval_idx
  on public.opening_deviations (user_id)
  where status = 'user_left' and evaluated_at is null;

alter table public.opening_deviations enable row level security;

drop policy if exists opening_deviations_select_own on public.opening_deviations;
create policy opening_deviations_select_own on public.opening_deviations
  for select using ((select auth.uid()) = user_id);

drop policy if exists opening_deviations_insert_own on public.opening_deviations;
create policy opening_deviations_insert_own on public.opening_deviations
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists opening_deviations_update_own on public.opening_deviations;
create policy opening_deviations_update_own on public.opening_deviations
  for update using ((select auth.uid()) = user_id);

drop policy if exists opening_deviations_delete_own on public.opening_deviations;
create policy opening_deviations_delete_own on public.opening_deviations
  for delete using ((select auth.uid()) = user_id);
