-- Server-side aggregation for the motif-weakness card. The client version
-- downloaded `solution_line` (jsonb, up to ~144KB/user) + `motifs` for every
-- tactic blunder just to tally motif occurrences and tagged/untagged counts.
-- This RPC returns only the handful of resulting numbers. Mirrors the
-- landing_stats() pattern (security definer + scalar auth.uid()).
create or replace function get_blunder_motif_counts()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with rows as (
    select motifs, solution_line
    from blunders
    where user_id = (select auth.uid()) and kind = 'tactic'
  ),
  motif_counts as (
    -- Only enriched rows (solution_line present) can carry motif tags, matching
    -- the client logic that skipped untagged rows before counting.
    select m as motif, count(*)::int as n
    from rows r, unnest(r.motifs) as m
    where r.solution_line is not null
    group by m
  )
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(motif, n) from motif_counts), '{}'::jsonb),
    'tagged', (select count(*)::int from rows where solution_line is not null),
    'untagged', (select count(*)::int from rows where solution_line is null),
    'total', (select count(*)::int from rows)
  );
$$;

grant execute on function get_blunder_motif_counts() to authenticated;
