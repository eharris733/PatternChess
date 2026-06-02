-- Admin drill-down + training analytics:
--  * recent-signups card now carries per-user training-session counts + handles
--  * admin_kpis() result gains a `trainingAnalytics` block (duration stats,
--    sessions-per-day for the last 30d, top 5 trainees)
--  * new admin_user_list(category) RPC powers each KPI tile's drill-down
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).

-- ===== admin_kpis(): extend recentSignups with engagement + handles =====
-- Additive only — front-end consumes the existing keys plus the new ones:
--   trainingSessions, lastSessionAt, lastActive, lichessUsername, chesscomUsername
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
  last_active_per_user as (
    select user_id, max(ts) as last_active from activity_src group by user_id
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
  training_session_counts as (
    select user_id, count(*) as sessions, max(started_at) as last_session_at
    from training_sessions
    group by user_id
  ),
  training_durations as (
    select extract(epoch from (ended_at - started_at))::float as duration_sec
    from training_sessions
    where ended_at is not null
      and ended_at > started_at
      and ended_at - started_at < interval '6 hours'
  ),
  training_summary as (
    select
      coalesce(avg(duration_sec), 0)::float as avg_duration_sec,
      coalesce(percentile_cont(0.5) within group (order by duration_sec), 0)::float as median_duration_sec,
      count(*)::int as sessions_with_duration
    from training_durations
  ),
  sessions_by_day as (
    select date_trunc('day', started_at)::date as day, count(*) as count
    from training_sessions
    where started_at >= now() - interval '30 days'
    group by 1
  ),
  top_trainees as (
    select u.email, p.display_name, tsc.sessions
    from training_session_counts tsc
    join profiles p on p.id = tsc.user_id
    join auth.users u on u.id = tsc.user_id
    order by tsc.sessions desc
    limit 5
  ),
  recent as (
    select
      u.email,
      p.display_name,
      p.lichess_username,
      p.chesscom_username,
      f.created_at,
      f.connected,
      f.synced,
      f.found_blunders,
      f.trained,
      coalesce(gc.games, 0) as games,
      coalesce(bc.blunders, 0) as blunders,
      coalesce(tsc.sessions, 0) as training_sessions,
      tsc.last_session_at,
      la.last_active
    from funnel f
    join profiles p on p.id = f.id
    join auth.users u on u.id = f.id
    left join game_counts gc on gc.user_id = f.id
    left join blunder_counts bc on bc.user_id = f.id
    left join training_session_counts tsc on tsc.user_id = f.id
    left join last_active_per_user la on la.user_id = f.id
    order by f.created_at desc
    limit 50
  ),
  -- ----- landing funnel (anonymous, deduped by anon_id) -----
  human_views as (
    select distinct anon_id
    from funnel_events
    where type = 'landing_view'
      and user_agent is not null
      and user_agent !~* '(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|python-requests|curl|wget|monitor|preview|scan|lighthouse|pingdom|uptime)'
  ),
  demo_anon as (
    select distinct anon_id from funnel_events where type = 'demo_submit'
  ),
  signup_anon as (
    select distinct anon_id from profiles where anon_id is not null
  ),
  landing_totals as (
    select
      (select count(*) from human_views) as views,
      (select count(*) from demo_anon) as entered,
      (select count(*) from demo_anon d where exists (
        select 1 from signup_anon s where s.anon_id = d.anon_id)) as converted
  ),
  views_by_day as (
    select date_trunc('day', fe.created_at)::date as day, count(distinct fe.anon_id) as count
    from funnel_events fe
    join human_views hv on hv.anon_id = fe.anon_id
    where fe.type = 'landing_view'
    group by 1
  ),
  leads as (
    select
      fe.username,
      fe.platform,
      count(*) as attempts,
      max(fe.created_at) as last_seen,
      bool_or(exists (select 1 from signup_anon s where s.anon_id = fe.anon_id)) as converted
    from funnel_events fe
    where fe.type = 'demo_submit' and fe.username is not null
    group by fe.username, fe.platform
    order by max(fe.created_at) desc
    limit 200
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
            'lichessUsername', lichess_username,
            'chesscomUsername', chesscom_username,
            'createdAt', created_at,
            'connected', connected,
            'synced', synced,
            'foundBlunders', found_blunders,
            'trained', trained,
            'games', games,
            'blunders', blunders,
            'trainingSessions', training_sessions,
            'lastSessionAt', last_session_at,
            'lastActive', last_active
          ) order by created_at desc
        ),
        '[]'::jsonb
      ) from recent
    ),
    'landingFunnel', (
      select jsonb_build_object(
        'views', views,
        'entered', entered,
        'converted', converted
      ) from landing_totals
    ),
    'viewsByDay', (
      select coalesce(
        jsonb_agg(jsonb_build_object('date', day, 'count', count) order by day),
        '[]'::jsonb
      ) from views_by_day
    ),
    'leads', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'username', username,
            'platform', platform,
            'attempts', attempts,
            'lastSeen', last_seen,
            'converted', converted
          ) order by last_seen desc
        ),
        '[]'::jsonb
      ) from leads
    ),
    'trainingAnalytics', jsonb_build_object(
      'avgDurationSeconds', (select avg_duration_sec from training_summary),
      'medianDurationSeconds', (select median_duration_sec from training_summary),
      'sessionsWithDuration', (select sessions_with_duration from training_summary),
      'sessionsByDay', (
        select coalesce(
          jsonb_agg(jsonb_build_object('date', day, 'count', count) order by day),
          '[]'::jsonb
        ) from sessions_by_day
      ),
      'topTrainees', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'email', email,
              'displayName', display_name,
              'sessions', sessions
            ) order by sessions desc
          ),
          '[]'::jsonb
        ) from top_trainees
      )
    )
  ) into result;

  return result;
end;
$$;

grant execute on function admin_kpis() to authenticated;

-- ===== admin_user_list(category): drill-down behind a KPI tile =====
-- Categories: signups | connected | synced | foundBlunders | trained
--             | dau | wau | mau
-- Returns the same row shape for every category so the UI can render with one
-- component. Capped at 500.
create or replace function admin_user_list(category text)
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

  if category not in ('signups','connected','synced','foundBlunders','trained','dau','wau','mau') then
    raise exception 'unknown category: %', category;
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
  activity_src as (
    select user_id, started_at as ts from training_sessions
    union all
    select user_id, created_at as ts from games
  ),
  last_active_per_user as (
    select user_id, max(ts) as last_active from activity_src group by user_id
  ),
  game_counts as (
    select user_id, count(*) as games from games group by user_id
  ),
  blunder_counts as (
    select user_id, count(*) as blunders from blunders group by user_id
  ),
  training_session_counts as (
    select user_id, count(*) as sessions, max(started_at) as last_session_at
    from training_sessions
    group by user_id
  ),
  users_full as (
    select
      u.email,
      p.display_name,
      p.lichess_username,
      p.chesscom_username,
      f.created_at,
      f.connected,
      f.synced,
      f.found_blunders,
      f.trained,
      coalesce(gc.games, 0) as games,
      coalesce(bc.blunders, 0) as blunders,
      coalesce(tsc.sessions, 0) as training_sessions,
      tsc.last_session_at,
      la.last_active
    from funnel f
    join profiles p on p.id = f.id
    join auth.users u on u.id = f.id
    left join game_counts gc on gc.user_id = f.id
    left join blunder_counts bc on bc.user_id = f.id
    left join training_session_counts tsc on tsc.user_id = f.id
    left join last_active_per_user la on la.user_id = f.id
  ),
  filtered as (
    select * from users_full
    where case category
      when 'signups' then true
      when 'connected' then connected
      when 'synced' then synced
      when 'foundBlunders' then found_blunders
      when 'trained' then trained
      when 'dau' then last_active >= now() - interval '1 day'
      when 'wau' then last_active >= now() - interval '7 days'
      when 'mau' then last_active >= now() - interval '30 days'
    end
  ),
  ranked as (
    select
      f.*,
      row_number() over (
        order by
          case when category = 'trained'       then training_sessions end desc nulls last,
          case when category = 'trained'       then last_session_at  end desc nulls last,
          case when category = 'foundBlunders' then blunders          end desc nulls last,
          case when category in ('dau','wau','mau','synced') then last_active end desc nulls last,
          created_at desc
      ) as rn
    from filtered f
  ),
  capped as (
    select * from ranked where rn <= 500
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'email', email,
        'displayName', display_name,
        'lichessUsername', lichess_username,
        'chesscomUsername', chesscom_username,
        'createdAt', created_at,
        'connected', connected,
        'synced', synced,
        'foundBlunders', found_blunders,
        'trained', trained,
        'games', games,
        'blunders', blunders,
        'trainingSessions', training_sessions,
        'lastSessionAt', last_session_at,
        'lastActive', last_active
      ) order by rn
    ),
    '[]'::jsonb
  )
  into result
  from capped;

  return result;
end;
$$;

grant execute on function admin_user_list(text) to authenticated;

-- Tell PostgREST to drop its schema cache so the new function is exposed
-- immediately, otherwise the REST layer 404s with "Could not find the function
-- public.admin_user_list(category) in the schema cache" until the next reload.
notify pgrst, 'reload schema';
