-- landing_stats(): global social-proof stats for the public landing page.
--
-- Returns jsonb: { positionsReviewed, eloGained, computedAt }.
--   positionsReviewed = sum(blunders.times_correct) across all users
--     (same semantics as the per-user getBlunderStats() in supabaseService.ts).
--   eloGained = sum of positive (latest - first) user_rating deltas per
--     (user, platform, time-control category), rated games only, played at or
--     after the profile's created_at, buckets with < 3 games dropped — mirrors
--     useRatingProgress.ts / categoryForTimeControl() in chessApiService.ts.
--
-- SECURITY DEFINER + grant to anon: landing visitors are logged out and RLS
-- blocks cross-user reads. To keep the landing page from pressuring the DB,
-- results are cached in a one-row table; the heavy aggregate runs at most
-- once per 6 hours. Concurrent stale hits serve the stale payload while a
-- single request (advisory lock) recomputes.

create table if not exists landing_stats_cache (
  id int primary key default 1 check (id = 1),
  payload jsonb not null,
  computed_at timestamptz not null default now()
);
alter table landing_stats_cache enable row level security; -- no policies => no client access
revoke all on landing_stats_cache from anon, authenticated, public;

create or replace function landing_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cached record;
  fresh jsonb;
begin
  select payload, computed_at into cached
  from landing_stats_cache where id = 1;

  if found and cached.computed_at > now() - interval '6 hours' then
    return cached.payload;
  end if;

  -- Another request is already recomputing: serve stale (null on first ever call).
  if not pg_try_advisory_xact_lock(hashtext('landing_stats')) then
    return cached.payload;
  end if;

  with reviewed as (
    select coalesce(sum(times_correct), 0)::bigint as positions_reviewed
    from blunders
  ),
  rated_games as (
    select
      g.user_id, g.platform, g.played_at, g.user_rating,
      case
        when ts.base_seconds is null then null
        when ts.base_seconds < 180  then 'bullet'
        when ts.base_seconds < 600  then 'blitz'
        when ts.base_seconds < 1800 then 'rapid'
        else 'classical'
      end as category
    from games g
    join profiles p on p.id = g.user_id
    cross join lateral (
      -- categoryForTimeControl(): base part before '+', last segment after '/',
      -- leading digits only ("300+5" -> 300, "1/86400" -> 86400).
      select nullif(
        substring(split_part(split_part(g.time_control, '+', 1), '/', -1) from '^\d+'),
        ''
      )::int as base_seconds
    ) ts
    where g.rated is true
      and g.user_rating is not null
      and g.played_at is not null
      and g.platform in ('lichess', 'chess.com')
      and g.played_at >= p.created_at
  ),
  buckets as (
    select user_id, platform, category,
      (array_agg(user_rating order by played_at asc))[1]  as first_rating,
      (array_agg(user_rating order by played_at desc))[1] as latest_rating,
      count(*) as n
    from rated_games
    where category is not null
    group by 1, 2, 3
  ),
  elo as (
    select coalesce(sum(greatest(latest_rating - first_rating, 0)), 0)::bigint as elo_gained
    from buckets
    where n >= 3 -- MIN_POINTS_PER_SERIES in useRatingProgress.ts
  )
  select jsonb_build_object(
    'positionsReviewed', (select positions_reviewed from reviewed),
    'eloGained',         (select elo_gained from elo),
    'computedAt',        now()
  ) into fresh;

  insert into landing_stats_cache (id, payload, computed_at)
  values (1, fresh, now())
  on conflict (id) do update
    set payload = excluded.payload, computed_at = excluded.computed_at;

  return fresh;
end;
$$;

revoke all on function landing_stats() from public;
grant execute on function landing_stats() to anon, authenticated;
