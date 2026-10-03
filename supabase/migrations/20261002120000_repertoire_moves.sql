-- Opening repertoire: the user's chosen move per position per colour, keyed
-- by EPD (FEN minus the move counters, same EPD as the opening book) so any
-- move order that reaches a position finds the same choice. Written by
-- "Add to repertoire" in opening drills; read by the drill (your move is the
-- expected answer) and by /openings (games where you left your repertoire).
--
-- The table already exists remotely: it was created by the since-deleted
-- 20260817140000_repertoire.sql and its policies were rewritten in
-- 20260912150000_rls_initplan.sql. This file restores the definition to the
-- repo and is idempotent, so pushing it changes nothing on that database.

create table if not exists public.repertoire_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  color text not null check (color in ('white', 'black')),
  epd text not null,
  uci text not null,
  san text not null,
  created_at timestamptz not null default now(),
  unique (user_id, color, epd)
);

create index if not exists repertoire_moves_user_color_idx on public.repertoire_moves (user_id, color);

alter table public.repertoire_moves enable row level security;

drop policy if exists repertoire_moves_select_own on public.repertoire_moves;
create policy repertoire_moves_select_own on public.repertoire_moves
  for select using ((select auth.uid()) = user_id);

drop policy if exists repertoire_moves_insert_own on public.repertoire_moves;
create policy repertoire_moves_insert_own on public.repertoire_moves
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists repertoire_moves_update_own on public.repertoire_moves;
create policy repertoire_moves_update_own on public.repertoire_moves
  for update using ((select auth.uid()) = user_id);

drop policy if exists repertoire_moves_delete_own on public.repertoire_moves;
create policy repertoire_moves_delete_own on public.repertoire_moves
  for delete using ((select auth.uid()) = user_id);
