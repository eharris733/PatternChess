-- Landing-page funnel: anonymous view/demo tracking + linkage to signups.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).
--
-- Funnel: landing_view -> demo_submit (chess.com/lichess username entered) ->
-- account created. Linked by anon_id (a localStorage UUID minted on first
-- landing, stamped onto profiles at signup). Bot filtering = human-signal gating
-- on the client (see useLandingView) + the user-agent filter in admin_kpis().

-- ----- profiles: link an anonymous visitor to the account they created -----
alter table profiles
  add column if not exists anon_id text;

create index if not exists profiles_anon_id_idx on profiles (anon_id);

-- ----- funnel_events: anonymous landing events -----
create table if not exists funnel_events (
  id uuid primary key default gen_random_uuid(),
  anon_id text not null,
  type text not null check (type in ('landing_view', 'demo_submit')),
  platform text,
  username text,
  user_agent text,
  referrer text,
  created_at timestamptz not null default now()
);

create index if not exists funnel_events_anon_idx on funnel_events (anon_id);
create index if not exists funnel_events_type_created_idx on funnel_events (type, created_at);
create index if not exists funnel_events_username_idx on funnel_events (username) where username is not null;

-- RLS: the anon (logged-out) visitor may INSERT events but never read them back.
-- All reads happen through admin_kpis() (SECURITY DEFINER), which bypasses RLS.
alter table funnel_events enable row level security;

drop policy if exists funnel_events_insert_anon on funnel_events;
create policy funnel_events_insert_anon on funnel_events
  for insert to anon, authenticated with check (true);

-- ----- admin_kpis(): add landing funnel + leads -----
-- Bot filtering for landing views: drop obvious crawler user-agents and rows
-- with no user-agent. This is best-effort, not perfect.
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
  ),
  -- ----- landing funnel (anonymous, deduped by anon_id) -----
  -- A "human" view = a landing_view whose user-agent isn't an obvious bot.
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
      -- visitors who entered a username AND later created an account
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
  -- ----- leads: every entered username, with attempts + conversion -----
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
    )
  ) into result;

  return result;
end;
$$;

grant execute on function admin_kpis() to authenticated;
