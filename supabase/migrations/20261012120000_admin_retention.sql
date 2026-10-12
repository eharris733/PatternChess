-- admin_retention(): signup-cohort retention for /analytics (RetentionCard).
--
-- "Active" = a training session with at least one attempted position (the only
-- per-day activity history we keep). Day buckets are UTC dates.
--
-- Retention at day N is *unbounded*: of the users who signed up at least N days
-- ago, how many trained again on day N or later. Users too new to have reached
-- day N are left out of that column's denominator, never counted as churned.
-- Admin accounts are excluded so your own testing doesn't inflate the curve.

create or replace function public.admin_retention()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com') then
    raise exception 'not authorized';
  end if;

  with users as (
    select p.id, p.created_at::date as signup
    from profiles p
    left join auth.users u on u.id = p.id
    where coalesce(u.email, '') not in ('elliotmharris@gmail.com')
  ),
  active as (
    select distinct user_id, started_at::date as d
    from training_sessions
    where blunders_attempted > 0
  ),
  per_user as (
    select u.id, u.signup,
      to_char(date_trunc('month', u.signup), 'YYYY-MM') as cohort,
      count(a.d) as active_days,
      max(a.d) - u.signup as last_offset
    from users u
    left join active a on a.user_id = u.id
    group by u.id, u.signup
  ),
  marks as (select unnest(array[1, 7, 14, 30, 60]) as n),
  curve as (
    select coalesce(cohort, 'all') as cohort, m.n,
      count(*) filter (where signup <= current_date - m.n) as eligible,
      count(*) filter (where signup <= current_date - m.n and last_offset >= m.n) as retained
    from per_user cross join marks m
    group by grouping sets ((cohort, m.n), (m.n))
  ),
  cohorts as (
    select coalesce(cohort, 'all') as cohort,
      count(*) as signups,
      count(*) filter (where active_days > 0) as trained,
      count(*) filter (where active_days >= 2) as trained_2_days,
      count(*) filter (where active_days >= 5) as trained_5_days
    from per_user
    group by grouping sets ((cohort), ())
  ),
  weeks as (
    select date_trunc('week', a.d)::date as week,
      count(distinct a.user_id) as active,
      count(distinct a.user_id) filter (where u.signup < date_trunc('week', a.d)::date) as returning
    from active a
    join users u on u.id = a.user_id
    where a.d >= date_trunc('week', current_date)::date - 7 * 11
    group by 1
  )
  select jsonb_build_object(
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'cohort', c.cohort,
          'signups', c.signups,
          'trained', c.trained,
          'trained2Days', c.trained_2_days,
          'trained5Days', c.trained_5_days,
          'curve', (
            select jsonb_agg(jsonb_build_object(
                'day', cv.n, 'eligible', cv.eligible, 'retained', cv.retained
              ) order by cv.n)
            from curve cv where cv.cohort = c.cohort
          )
        ) order by (c.cohort <> 'all'), c.cohort desc), '[]'::jsonb)
      from cohorts c
    ),
    'weeks', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'week', w.week, 'active', w.active, 'returning', w.returning
        ) order by w.week), '[]'::jsonb)
      from weeks w
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_retention() from public, anon;
grant execute on function public.admin_retention() to authenticated;
