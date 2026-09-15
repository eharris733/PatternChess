-- Leaderboards + social achievements.
--
-- profiles.leaderboard_opt_out  "Show me on leaderboards" (inverted) in /profile
-- profiles.followed_instagram   set when the user clicks through to Instagram
-- profiles.shares_count         bumped by increment_shares_count() on share
--
-- leaderboard(metric, win, limit_n) — SECURITY DEFINER because RLS blocks
-- cross-user reads. It returns ONLY a display label, the value, the rank and
-- an is-me flag: no user ids, no emails. Label = lichess_username →
-- chesscom_username → display_name → 'Player'. Opted-out users are excluded
-- from every board (including their own "me" row).

alter table public.profiles
  add column if not exists leaderboard_opt_out boolean not null default false,
  add column if not exists followed_instagram boolean not null default false,
  add column if not exists shares_count integer not null default 0;

create or replace function public.increment_shares_count()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
  set shares_count = shares_count + 1
  where id = auth.uid()
  returning shares_count;
$$;
revoke all on function public.increment_shares_count() from public, anon;
grant execute on function public.increment_shares_count() to authenticated;

create or replace function public.leaderboard(metric text, win text, limit_n int default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  since timestamptz;
  result jsonb;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if metric not in ('solved', 'mastered', 'elo', 'streak') then
    raise exception 'unknown metric %', metric;
  end if;
  if win not in ('all', 'week') then
    raise exception 'unknown window %', win;
  end if;
  limit_n := least(greatest(coalesce(limit_n, 20), 1), 100);
  -- ISO week (Monday 00:00 UTC).
  since := case when win = 'week' then date_trunc('week', now()) else '-infinity'::timestamptz end;

  with
  -- Positions solved: lifetime = sum(times_correct) (matches StatStrip /
  -- getBlunderStats); this week = first-attempt corrects logged per session.
  solved_all as (
    select user_id, coalesce(sum(times_correct), 0)::bigint as value
    from blunders group by user_id
  ),
  solved_week as (
    select user_id, coalesce(sum(blunders_correct), 0)::bigint as value
    from training_sessions where started_at >= since group by user_id
  ),
  -- Mastered: cycle through the whole ladder (4 rungs) with >= 80% recall —
  -- the same rule as getBlunderStats().mastered.
  mastered as (
    select user_id, count(*)::bigint as value
    from blunders
    where cycle_number >= 4
      and times_attempted > 0
      and times_correct::numeric / times_attempted >= 0.8
      and (win <> 'week' or last_drilled_at >= since)
    group by user_id
  ),
  -- Elo gained: same per-(user, platform, category) positive-delta rule as
  -- landing_stats(), restricted to games after join (and after `since`).
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
      select nullif(
        substring(split_part(split_part(g.time_control, '+', 1), '/', -1) from '^\d+'),
        ''
      )::int as base_seconds
    ) ts
    where g.rated is true
      and g.user_rating is not null
      and g.played_at is not null
      and g.platform in ('lichess', 'chess.com')
      and g.played_at >= greatest(coalesce(p.created_at, '-infinity'::timestamptz), since)
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
    select user_id, coalesce(sum(greatest(latest_rating - first_rating, 0)), 0)::bigint as value
    from buckets where n >= 3 group by user_id
  ),
  scores as (
    select
      p.id as user_id,
      coalesce(
        nullif(p.lichess_username, ''),
        nullif(p.chesscom_username, ''),
        nullif(p.display_name, ''),
        'Player'
      ) as label,
      coalesce(
        case metric
          when 'solved'   then (case when win = 'week' then sw.value else sa.value end)
          when 'mastered' then m.value
          when 'elo'      then e.value
          when 'streak'   then (case when win = 'week' then p.current_streak_days else p.longest_streak_days end)::bigint
        end,
        0
      ) as value
    from profiles p
    left join solved_all  sa on sa.user_id = p.id
    left join solved_week sw on sw.user_id = p.id
    left join mastered    m  on m.user_id  = p.id
    left join elo         e  on e.user_id  = p.id
    where p.leaderboard_opt_out = false
  ),
  ranked as (
    select user_id, label, value,
      rank() over (order by value desc, user_id) as rank
    from scores
    where value > 0
  )
  select jsonb_build_object(
    'metric', metric,
    'window', win,
    'since',  case when win = 'week' then since else null end,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object('rank', rank, 'label', label, 'value', value, 'isMe', user_id = me)
        order by rank
      )
      from (select * from ranked order by rank, user_id limit limit_n) top
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object('rank', rank, 'label', label, 'value', value, 'isMe', true)
      from ranked where user_id = me
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.leaderboard(text, text, int) from public, anon;
grant execute on function public.leaderboard(text, text, int) to authenticated;
