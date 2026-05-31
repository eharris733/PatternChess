-- admin_kpis(): aggregate product KPIs for the in-app /analytics page.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).
--
-- SECURITY DEFINER so it can read across all users (the app's anon-key client
-- is per-user and can't). The in-function email check is the real security
-- boundary; the client-side allowlist in src/auth/admin.ts is only UX.
-- Keep the email list here in sync with ADMIN_EMAILS in src/auth/admin.ts.
--
-- Mirrors the funnel defined in analytics-kpis.sql.

create or replace function admin_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com') then
    raise exception 'not authorized';
  end if;

  with funnel as (
    select
      p.id,
      p.created_at,
      (
        p.lichess_username is not null
        or p.chesscom_username is not null
        or p.last_synced_lichess_at is not null
        or p.last_synced_chesscom_at is not null
      ) as connected,
      exists (select 1 from games g where g.user_id = p.id) as synced,
      exists (select 1 from games g where g.user_id = p.id and g.analyzed_at is not null) as found_blunders,
      exists (select 1 from training_sessions ts where ts.user_id = p.id) as trained
    from profiles p
  ),
  totals as (
    select
      count(*) as signups,
      count(*) filter (where connected) as connected,
      count(*) filter (where synced) as synced,
      count(*) filter (where found_blunders) as found_blunders,
      count(*) filter (where trained) as trained
    from funnel
  ),
  signups_by_day as (
    select date_trunc('day', created_at)::date as day, count(*) as count
    from funnel
    group by 1
  ),
  activity_src as (
    select user_id, started_at as ts from training_sessions
    union all
    select user_id, created_at as ts from games
  ),
  activity as (
    select
      count(distinct user_id) filter (where ts >= now() - interval '1 day')  as dau,
      count(distinct user_id) filter (where ts >= now() - interval '7 days') as wau,
      count(distinct user_id) filter (where ts >= now() - interval '30 days') as mau
    from activity_src
  ),
  platforms as (
    select platform, count(distinct user_id) as users, count(*) as games
    from games
    group by platform
  ),
  game_counts as (
    select user_id, count(*) as games from games group by user_id
  ),
  blunder_counts as (
    select user_id, count(*) as blunders from blunders group by user_id
  ),
  recent as (
    select
      u.email,
      p.display_name,
      f.created_at,
      f.connected,
      f.synced,
      f.found_blunders,
      f.trained,
      coalesce(gc.games, 0) as games,
      coalesce(bc.blunders, 0) as blunders
    from funnel f
    join profiles p on p.id = f.id
    join auth.users u on u.id = f.id
    left join game_counts gc on gc.user_id = f.id
    left join blunder_counts bc on bc.user_id = f.id
    order by f.created_at desc
    limit 50
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'signups', signups,
        'connected', connected,
        'synced', synced,
        'foundBlunders', found_blunders,
        'trained', trained
      ) from totals
    ),
    'activity', (
      select jsonb_build_object('dau', dau, 'wau', wau, 'mau', mau) from activity
    ),
    'signupsByDay', (
      select coalesce(
        jsonb_agg(jsonb_build_object('date', day, 'count', count) order by day),
        '[]'::jsonb
      ) from signups_by_day
    ),
    'platforms', (
      select coalesce(
        jsonb_agg(jsonb_build_object('platform', platform, 'users', users, 'games', games) order by games desc),
        '[]'::jsonb
      ) from platforms
    ),
    'recentSignups', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'email', email,
            'displayName', display_name,
            'createdAt', created_at,
            'connected', connected,
            'synced', synced,
            'foundBlunders', found_blunders,
            'trained', trained,
            'games', games,
            'blunders', blunders
          ) order by created_at desc
        ),
        '[]'::jsonb
      ) from recent
    )
  ) into result;

  return result;
end;
$$;

grant execute on function admin_kpis() to authenticated;
