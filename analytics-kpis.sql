-- PatternChess product KPIs. Supabase project: ydfwppthwnlgxnntzrvg
--
-- Read-only. Run in: Supabase dashboard -> SQL Editor (runs as owner, so it
-- bypasses RLS and can read across all users + join auth.users for email).
-- These are the same metrics the in-app /analytics page exposes via the
-- admin_kpis() RPC (see supabase/migrations/20260531120000_admin_kpis.sql).
--
-- Funnel stages (one source of truth):
--   signed up      -> row in profiles
--   connected      -> a lichess/chesscom username or a last_synced_* timestamp
--   synced games   -> >=1 row in games
--   found blunders -> >=1 game with analyzed_at set (analysis actually ran)
--   trained        -> >=1 row in training_sessions

-- ===== 1. All signups (most recent first) =====
select
  u.email,
  p.display_name,
  p.lichess_username,
  p.chesscom_username,
  p.created_at,
  p.current_streak_days,
  p.longest_streak_days
from profiles p
join auth.users u on u.id = p.id
order by p.created_at desc;

-- ===== 2. Signups over time =====
-- daily
select date_trunc('day', created_at)::date as day, count(*) as signups
from profiles
group by 1
order by 1;

-- weekly
select date_trunc('week', created_at)::date as week, count(*) as signups
from profiles
group by 1
order by 1;

-- ===== 3. Per-user funnel (which accounts reached each stage) =====
select
  u.email,
  p.display_name,
  p.created_at as signed_up_at,
  (
    p.lichess_username is not null
    or p.chesscom_username is not null
    or p.last_synced_lichess_at is not null
    or p.last_synced_chesscom_at is not null
  ) as connected_account,
  coalesce(g.games, 0) as games_synced,
  coalesce(g.analyzed_games, 0) as games_analyzed,
  coalesce(b.blunders, 0) as blunders_found,
  coalesce(t.training_sessions, 0) as training_sessions,
  coalesce(t.drills_correct, 0) as drills_correct
from profiles p
join auth.users u on u.id = p.id
left join (
  select user_id,
         count(*) as games,
         count(*) filter (where analyzed_at is not null) as analyzed_games
  from games
  group by user_id
) g on g.user_id = p.id
left join (
  select user_id, count(*) as blunders
  from blunders
  group by user_id
) b on b.user_id = p.id
left join (
  select user_id,
         count(*) as training_sessions,
         coalesce(sum(blunders_correct), 0) as drills_correct
  from training_sessions
  group by user_id
) t on t.user_id = p.id
order by p.created_at desc;

-- ===== 4. Funnel summary (counts + conversion %) =====
with funnel as (
  select
    p.id,
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
)
select
  count(*) as signups,
  count(*) filter (where connected) as connected,
  count(*) filter (where synced) as synced,
  count(*) filter (where found_blunders) as found_blunders,
  count(*) filter (where trained) as trained,
  round(100.0 * count(*) filter (where connected)      / nullif(count(*), 0), 1) as pct_connected,
  round(100.0 * count(*) filter (where synced)         / nullif(count(*), 0), 1) as pct_synced,
  round(100.0 * count(*) filter (where found_blunders) / nullif(count(*), 0), 1) as pct_found_blunders,
  round(100.0 * count(*) filter (where trained)        / nullif(count(*), 0), 1) as pct_trained
from funnel;

-- ===== 5. Active users (DAU / WAU / MAU) =====
-- "Active" = synced a game or ran a training session in the window.
with activity as (
  select user_id, started_at as ts from training_sessions
  union all
  select user_id, created_at as ts from games
)
select
  count(distinct user_id) filter (where ts >= now() - interval '1 day')  as dau,
  count(distinct user_id) filter (where ts >= now() - interval '7 days') as wau,
  count(distinct user_id) filter (where ts >= now() - interval '30 days') as mau
from activity;

-- ===== 6. Platform breakdown =====
select platform,
       count(distinct user_id) as users,
       count(*) as games
from games
group by platform
order by games desc;

-- ===== 7. Engagement leaders =====
-- by blunders found
select u.email, count(*) as blunders
from blunders b
join auth.users u on u.id = b.user_id
group by u.email
order by blunders desc
limit 20;

-- by training activity
select u.email,
       count(*) as training_sessions,
       coalesce(sum(t.blunders_correct), 0) as drills_correct
from training_sessions t
join auth.users u on u.id = t.user_id
group by u.email
order by training_sessions desc
limit 20;

-- by streak
select u.email, p.current_streak_days, p.longest_streak_days
from profiles p
join auth.users u on u.id = p.id
order by p.longest_streak_days desc
limit 20;

-- ===== 8. Landing funnel (anonymous) =====
-- Requires the 20260601120000_landing_funnel migration. Funnel:
--   landing_view -> demo_submit (username entered) -> account created.
-- Linked by anon_id (localStorage UUID stamped onto profiles at signup).
-- "Human" views exclude obvious bot user-agents; still approximate.
with human_views as (
  select distinct anon_id
  from funnel_events
  where type = 'landing_view'
    and user_agent is not null
    and user_agent !~* '(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|python-requests|curl|wget|monitor|preview|scan|lighthouse|pingdom|uptime)'
),
demo_anon as (select distinct anon_id from funnel_events where type = 'demo_submit'),
signup_anon as (select distinct anon_id from profiles where anon_id is not null)
select
  (select count(*) from human_views) as human_views,
  (select count(*) from demo_anon) as entered_username,
  (select count(*) from demo_anon d
     where exists (select 1 from signup_anon s where s.anon_id = d.anon_id)) as created_account;

-- ===== 9. Leads — every entered chess.com/lichess username (for follow-up) =====
-- converted = that browser later created an account.
select
  fe.username,
  fe.platform,
  count(*) as attempts,
  max(fe.created_at) as last_seen,
  bool_or(exists (
    select 1 from profiles p where p.anon_id = fe.anon_id
  )) as converted
from funnel_events fe
where fe.type = 'demo_submit' and fe.username is not null
group by fe.username, fe.platform
order by max(fe.created_at) desc;
