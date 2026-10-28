-- Per-game tactic counts for the Vault Games tab. The client used to page
-- through every tactic row (game_id only) and tally them: six round trips for
-- a 5k-blunder account. One jsonb object { game_id: count } instead. Same
-- shape as get_blunder_motif_counts (security definer + scalar auth.uid()).
create or replace function blunder_counts_by_game()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_object_agg(game_id, n), '{}'::jsonb)
  from (
    select game_id, count(*)::int as n
    from blunders
    where user_id = (select auth.uid()) and kind = 'tactic' and game_id is not null
    group by game_id
  ) c;
$$;

grant execute on function blunder_counts_by_game() to authenticated;
