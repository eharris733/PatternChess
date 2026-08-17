-- Opening repertoire: one chosen move per position per color, keyed by EPD
-- (FEN minus the move counters) rather than a parent-linked tree — any move
-- order that reaches the same position finds the same repertoire choice, so
-- transpositions are handled for free and edits are single-row upserts.
-- Deleting a move merely orphans deeper rows (unreachable, self-healing if the
-- move is re-added).
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).

create table if not exists repertoire_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  color text not null check (color in ('white', 'black')),
  epd text not null,
  uci text not null,
  san text not null,
  created_at timestamptz not null default now(),
  unique (user_id, color, epd)
);

create index if not exists repertoire_moves_user_color_idx on repertoire_moves (user_id, color);

alter table repertoire_moves enable row level security;

drop policy if exists repertoire_moves_select_own on repertoire_moves;
create policy repertoire_moves_select_own on repertoire_moves
  for select using (auth.uid() = user_id);

drop policy if exists repertoire_moves_insert_own on repertoire_moves;
create policy repertoire_moves_insert_own on repertoire_moves
  for insert with check (auth.uid() = user_id);

drop policy if exists repertoire_moves_update_own on repertoire_moves;
create policy repertoire_moves_update_own on repertoire_moves
  for update using (auth.uid() = user_id);

drop policy if exists repertoire_moves_delete_own on repertoire_moves;
create policy repertoire_moves_delete_own on repertoire_moves
  for delete using (auth.uid() = user_id);
