-- Email outbox v2 for the Cloudflare notifier Worker (workers/notifier).
--
-- The Supabase/Resend sender is gone (20261120120000); the provider-neutral
-- schema from 20261012140000 stays. This migration moves the outbox to the
-- Worker's template kinds and payload:
--
--   welcome         new account (< 2 days), once, at any hour
--   confirm         typed-in contact_email awaiting confirmation (unchanged)
--   ready           first day, never trained (unchanged rule)
--   weekly_report   Sunday at email_hour, for players who have trained
--   streak_at_risk  streak >= 2, trained yesterday, not yet today
--   daily_plan      not trained today and positions are due
--
-- Everything except welcome/confirm goes out at the player's local
-- `email_hour`, at most one per 20h. Reminder-type emails (ready,
-- streak_at_risk, daily_plan, and the legacy `reminder`) back off to weekly
-- after 3 unanswered sends and stop after 6 until the player trains again.
-- `email_reports = 'monthly'` is treated as weekly (the Worker has one report).
--
-- email_candidates(now, user) is the shared core: the Worker's admin preview
-- calls it for one user (opted in or not, report data always included);
-- email_outbox(now) is the hourly batch.

-- ----- send log: new kinds (legacy ones stay valid for old rows) -----
alter table public.email_sends drop constraint if exists email_sends_kind_check;
alter table public.email_sends add constraint email_sends_kind_check check (kind in (
  'confirm', 'welcome', 'ready', 'streak_at_risk', 'daily_plan', 'weekly_report',
  'reminder', 'report'));

-- ----- report payload -----
-- Adds gamesPlayed, eloChange (most-played rated time-control bucket, last
-- minus first rating in the window; needs 2+ games) and leaderboardRank
-- (rolling-7-day positions solved, the public_leaderboard() metric; null when
-- nothing was solved or the player opted out of leaderboards). topMotif is now
-- limited to positions found in the window, so "this week" is true.
create or replace function public.email_report_data(p_user uuid, p_since timestamptz, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select coalesce(sum(blunders_correct), 0) as solved
    from training_sessions
    where user_id = p_user and started_at >= p_now - interval '7 days'
  ),
  board as (
    select ts.user_id, sum(ts.blunders_correct) as solved
    from training_sessions ts
    join profiles p on p.id = ts.user_id
    where ts.started_at >= p_now - interval '7 days' and p.leaderboard_opt_out = false
    group by ts.user_id
  ),
  rated as (
    select g.played_at, g.user_rating, g.platform,
      case
        when ts.base_seconds is null then null
        when ts.base_seconds < 180 then 'bullet'
        when ts.base_seconds < 600 then 'blitz'
        when ts.base_seconds < 1800 then 'rapid'
        else 'classical'
      end as category
    from games g
    cross join lateral (
      select nullif(
        substring(split_part(split_part(g.time_control, '+', 1), '/', -1) from '^\d+'),
        '')::int as base_seconds
    ) ts
    where g.user_id = p_user and g.rated is true and g.user_rating is not null
      and g.played_at >= p_since and g.played_at < p_now
      and g.platform in ('lichess', 'chess.com')
  ),
  bucket as (
    select platform, category, count(*) as n,
      (array_agg(user_rating order by played_at desc))[1]
        - (array_agg(user_rating order by played_at asc))[1] as delta
    from rated
    where category is not null
    group by platform, category
    order by count(*) desc
    limit 1
  )
  select jsonb_build_object(
    'periodDays', greatest(1, round(extract(epoch from (p_now - p_since)) / 86400))::int,
    'attempted', coalesce((
      select sum(blunders_attempted) from training_sessions
      where user_id = p_user and started_at >= p_since), 0),
    'solved', coalesce((
      select sum(blunders_correct) from training_sessions
      where user_id = p_user and started_at >= p_since), 0),
    'minutes', coalesce((
      select round(sum(least(extract(epoch from (ended_at - started_at)) / 60, 120)))
      from training_sessions
      where user_id = p_user and started_at >= p_since and ended_at > started_at), 0),
    'activeDays', (
      select count(distinct local_date) from training_sessions
      where user_id = p_user and started_at >= p_since and blunders_correct > 0),
    -- cycle 4 = the ladder length (SPACED_REPETITION_DAYS).
    'newlyMastered', (
      select count(*) from blunders
      where user_id = p_user and cycle_number = 4 and not last_drill_failed
        and last_drilled_at >= p_since),
    'gamesPlayed', (
      select count(*) from games
      where user_id = p_user and played_at >= p_since and played_at < p_now),
    'eloChange', (select delta from bucket where n >= 2),
    'leaderboardRank', (
      select case
        when m.solved <= 0
          or (select leaderboard_opt_out from profiles where id = p_user) then null
        else 1 + (select count(*) from board b where b.solved > m.solved)
      end
      from mine m),
    'topMotif', (
      select mo from blunders b, unnest(b.motifs) as mo
      where b.user_id = p_user and b.kind = 'tactic' and b.retired_at is null
        and b.created_at >= p_since
      group by mo order by count(*) desc, mo limit 1)
  );
$$;

-- ----- candidates (shared core) -----
create or replace function public.email_candidates(p_now timestamptz default now(), p_user uuid default null)
returns table (user_id uuid, kind text, to_email text, unsub_token uuid, data jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      p.id, p.created_at, p.email_reminders, p.email_reports, p.email_hour,
      p.email_unsub_token, p.current_streak_days, p.last_drill_local_date,
      p.contact_email, p.contact_email_verified_at,
      coalesce(p.streak_freezes, 0) as streak_freezes,
      coalesce(p.daily_positions_goal, 10) as positions_goal,
      coalesce(p.daily_games_goal, 1) as games_goal,
      nullif(u.email, '') as auth_email,
      coalesce(nullif(split_part(p.display_name, ' ', 1), ''), p.lichess_username, p.chesscom_username) as first_name,
      case when p.timezone is not null
             and exists (select 1 from pg_timezone_names z where z.name = p.timezone)
           then p.timezone else 'UTC' end as tz
    from profiles p
    join auth.users u on u.id = p.id
    where (p_user is null and p.email_opt_in) or p.id = p_user
  ),
  addr as (
    select b.*,
      case when b.contact_email is not null
           then case when b.contact_email_verified_at is not null then b.contact_email end
           else b.auth_email end as send_to,
      (p_now at time zone b.tz) as local_now
    from base b
  ),
  addr2 as (
    select a.*,
      extract(hour from a.local_now)::int = a.email_hour as at_hour,
      to_char(a.local_now, 'YYYY-MM-DD') as local_today,
      to_char(a.local_now - interval '1 day', 'YYYY-MM-DD') as local_yesterday
    from addr a
  ),
  sends as (
    select s.user_id,
      max(s.sent_at) filter (where s.kind <> 'confirm') as last_any,
      max(s.sent_at) filter (where s.kind in ('ready', 'reminder', 'daily_plan', 'streak_at_risk')) as last_reminder,
      max(s.sent_at) filter (where s.kind in ('report', 'weekly_report')) as last_report,
      max(s.sent_at) filter (where s.kind = 'confirm') as last_confirm,
      bool_or(s.kind = 'ready') as ready_sent,
      bool_or(s.kind = 'welcome') as welcome_sent
    from email_sends s
    where s.user_id in (select id from base)
    group by s.user_id
  ),
  pos as (
    -- Openings are left out of "due", as in the daily plan's train step.
    select b.user_id,
      count(*) filter (where b.next_drill_at <= p_now and b.retired_at is null
                         and b.kind in ('tactic', 'endgame')) as due_now,
      count(*) filter (where b.retired_at is null) as live_total,
      max(b.last_drilled_at) as last_trained
    from blunders b
    where b.user_id in (select id from base)
    group by b.user_id
  ),
  cand as (
    select a.*,
      coalesce(p.due_now, 0) as due_now,
      coalesce(p.live_total, 0) as live_total,
      p.last_trained,
      s.last_any, s.last_reminder, s.last_report, s.last_confirm,
      coalesce(s.ready_sent, false) as ready_sent,
      coalesce(s.welcome_sent, false) as welcome_sent,
      (select count(*) from email_sends e
        where e.user_id = a.id
          and e.kind in ('ready', 'reminder', 'daily_plan', 'streak_at_risk')
          and e.sent_at > coalesce(p.last_trained, '-infinity'::timestamptz)) as unanswered,
      (select count(*) from blunders f
        where f.user_id = a.id and f.retired_at is null and f.kind in ('tactic', 'endgame')
          and f.created_at > greatest(coalesce(s.last_any, p_now - interval '1 day'), p_now - interval '7 days')
      ) as fresh_blunders,
      case when a.last_drill_local_date in (a.local_today, a.local_yesterday)
           then a.current_streak_days else 0 end as streak
    from addr2 a
    left join pos p on p.user_id = a.id
    left join sends s on s.user_id = a.id
  ),
  decided as (
    select c.*,
      case
        when c.contact_email is not null and c.contact_email_verified_at is null then
          case when c.last_confirm is null or c.last_confirm < p_now - interval '23 hours'
               then 'confirm' end
        when c.send_to is null then null
        when not c.welcome_sent and c.last_any is null
             and c.created_at > p_now - interval '2 days'
             and (c.live_total > 0 or c.created_at <= p_now - interval '3 hours')
          then 'welcome'
        when not c.at_hour then null
        when c.last_any is not null and c.last_any > p_now - interval '20 hours' then null
        when c.last_trained is null and not c.ready_sent and c.live_total > 0
             and c.created_at <= p_now - interval '20 hours'
             and c.created_at > p_now - interval '14 days' then 'ready'
        when c.email_reports <> 'off' and c.last_trained is not null
             and extract(isodow from c.local_now) = 7
             and (c.last_report is null or c.last_report < p_now - interval '6 days')
          then 'weekly_report'
        when c.email_reminders <> 'off' and c.streak >= 2
             and c.last_drill_local_date = c.local_yesterday
             and c.unanswered < 6
          then 'streak_at_risk'
        when c.email_reminders <> 'off' and c.due_now > 0
             and coalesce(c.last_drill_local_date, '') <> c.local_today
             and c.created_at <= p_now - interval '20 hours'
             and c.unanswered < 6
             and (c.last_reminder is null or c.last_reminder < p_now - case
                   when c.unanswered >= 3 then interval '6 days 20 hours'
                   when c.email_reminders = 'few_days' then interval '2 days 20 hours'
                   else interval '20 hours' end)
          then 'daily_plan'
      end as kind
    from cand c
  )
  select
    d.id,
    d.kind,
    case when d.kind = 'confirm' then d.contact_email else coalesce(d.send_to, d.contact_email) end,
    d.email_unsub_token,
    jsonb_build_object(
      'firstName', d.first_name,
      'streak', d.streak,
      'streakFreezes', d.streak_freezes,
      'lastDrillLocalDate', d.last_drill_local_date,
      'localToday', d.local_today,
      'dueNow', d.due_now,
      'liveTotal', d.live_total,
      'positionsGoal', d.positions_goal,
      'gamesGoal', d.games_goal,
      'freshBlunders', d.fresh_blunders,
      'communityElo', coalesce((select (payload ->> 'eloGained')::int from landing_stats_cache where id = 1), 0)
    ) || case when d.kind = 'weekly_report' or p_user is not null
              then jsonb_build_object('report',
                public.email_report_data(d.id, p_now - interval '7 days', p_now))
              else '{}'::jsonb end
  from decided d;
$$;

-- ----- hourly batch -----
create or replace function public.email_outbox(p_now timestamptz default now())
returns table (user_id uuid, kind text, to_email text, unsub_token uuid, data jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.user_id, c.kind, c.to_email, c.unsub_token, c.data
  from public.email_candidates(p_now, null) c
  where c.kind is not null and c.to_email is not null;
$$;

revoke all on function public.email_candidates(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.email_outbox(timestamptz) from public, anon, authenticated;
revoke all on function public.email_report_data(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.email_candidates(timestamptz, uuid) to service_role;
grant execute on function public.email_outbox(timestamptz) to service_role;
grant execute on function public.email_report_data(uuid, timestamptz, timestamptz) to service_role;
