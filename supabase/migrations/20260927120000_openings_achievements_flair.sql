-- Opening achievements + profile flair.
--
-- profiles.opening_reviews_opened  bumped by increment_opening_reviews() when
--                                  the user opens an /openings review
-- profiles.learn_chapters_done     distinct "<slug>/<chapter>" keys, appended by
--                                  mark_learn_chapter_done(key) (Learn progress
--                                  is otherwise localStorage-only)
-- profiles.flair                   the selected flair id (src/lib/flair.ts);
--                                  cosmetic, unlocks are checked client-side
--
-- training_totals() → { minutes, activeDays }: minutes sums the caller's
-- finished sessions, each capped at 120 so a tab left open doesn't count as
-- hours of training; activeDays counts distinct local dates with ≥1 correct
-- drill (lifetime, so an earned consistency badge never un-earns).
--
-- leaderboard() is re-created unchanged except that every row carries flair.

alter table public.profiles
  add column if not exists opening_reviews_opened integer not null default 0,
  add column if not exists learn_chapters_done text[] not null default '{}',
  add column if not exists flair text;

create or replace function public.increment_opening_reviews()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
  set opening_reviews_opened = opening_reviews_opened + 1
  where id = auth.uid()
  returning opening_reviews_opened;
$$;
revoke all on function public.increment_opening_reviews() from public, anon;
grant execute on function public.increment_opening_reviews() to authenticated;

create or replace function public.mark_learn_chapter_done(key text)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
  set learn_chapters_done = case
    when key = any(learn_chapters_done) or length(key) > 200 then learn_chapters_done
    else array_append(learn_chapters_done, key)
  end
  where id = auth.uid()
  returning coalesce(array_length(learn_chapters_done, 1), 0);
$$;
revoke all on function public.mark_learn_chapter_done(text) from public, anon;
grant execute on function public.mark_learn_chapter_done(text) to authenticated;

create or replace function public.training_totals()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'minutes', coalesce((
      select round(sum(least(extract(epoch from (ended_at - started_at)) / 60.0, 120)))::int
      from public.training_sessions
      where user_id = auth.uid() and ended_at is not null and ended_at > started_at
    ), 0),
    'activeDays', (
      select count(distinct local_date)::int
      from public.training_sessions
      where user_id = auth.uid() and blunders_correct > 0
    )
  );
$$;
revoke all on function public.training_totals() from public, anon;
grant execute on function public.training_totals() to authenticated;

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
      p.flair,
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
    select user_id, label, flair, value,
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
        jsonb_build_object('rank', rank, 'label', label, 'value', value, 'isMe', user_id = me, 'flair', flair)
        order by rank
      )
      from (select * from ranked order by rank, user_id limit limit_n) top
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object('rank', rank, 'label', label, 'value', value, 'isMe', true, 'flair', flair)
      from ranked where user_id = me
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.leaderboard(text, text, int) from public, anon;
grant execute on function public.leaderboard(text, text, int) to authenticated;
