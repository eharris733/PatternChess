-- Email reminders + progress reports (explicit opt-in).
--
-- * profiles gains the email prefs. Nothing is sent unless `email_opt_in`.
--   The address is the auth email (Google sign-ins); Lichess sign-ins have none,
--   so they type a `contact_email`, which must be confirmed by a link before
--   anything but the confirmation itself goes to it.
-- * email_sends logs every send (dedupe, reminder backoff, /analytics).
-- * email_outbox(now) decides who gets what this hour; the `send-emails` edge
--   function (service role, hourly via pg_cron — see 20261012150000) renders and
--   sends. At most one email per user per 20h, at the user's local `email_hour`:
--   ready (first day, never trained) > report (weekly Sunday / monthly 1st)
--   > reminder (positions due, not trained today). Reminders back off to weekly
--   after 3 unanswered emails and stop after 6 until the user trains again.
-- * Token RPCs (anon-callable) power the no-login /email settings page and the
--   one-click unsubscribe. `email_unsub_token` is a random uuid per user.

-- ----- profiles -----
alter table public.profiles
  add column if not exists email_opt_in boolean not null default false,
  add column if not exists contact_email text
    check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists contact_email_verified_at timestamptz,
  add column if not exists email_reminders text not null default 'daily'
    check (email_reminders in ('daily', 'few_days', 'off')),
  add column if not exists email_reports text not null default 'weekly'
    check (email_reports in ('weekly', 'monthly', 'off')),
  add column if not exists email_hour smallint not null default 18
    check (email_hour between 0 and 23),
  add column if not exists email_unsub_token uuid not null default gen_random_uuid(),
  add column if not exists email_prompted_at timestamptz;

create unique index if not exists profiles_email_unsub_token_key
  on public.profiles (email_unsub_token);

-- Clients may edit their own prefs, but not the verification stamp or the
-- token. The SECURITY DEFINER RPCs below set `pc.email_admin` to get past this.
create or replace function public.profiles_guard_email_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('pc.email_admin', true), '') <> '1'
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.contact_email_verified_at := old.contact_email_verified_at;
    new.email_unsub_token := old.email_unsub_token;
  end if;
  if new.contact_email is distinct from old.contact_email then
    new.contact_email_verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_email_columns on public.profiles;
create trigger profiles_guard_email_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_email_columns();

-- ----- send log -----
create table if not exists public.email_sends (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('confirm', 'ready', 'reminder', 'report')),
  to_email text not null,
  provider_id text,
  sent_at timestamptz not null default now()
);
create index if not exists email_sends_user_sent_idx on public.email_sends (user_id, sent_at desc);
alter table public.email_sends enable row level security;

-- Confirmation links for a typed-in contact_email. Kept out of profiles so the
-- owner can't read the token and confirm an address they don't control.
create table if not exists public.email_confirmations (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.email_confirmations enable row level security;

-- ----- report payload -----
create or replace function public.email_report_data(p_user uuid, p_since timestamptz, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    -- cycle 4 = the ladder length (SPACED_REPETITION_DAYS); exactly 4 with a
    -- drill in the window means it was mastered in this period.
    'newlyMastered', (
      select count(*) from blunders
      where user_id = p_user and cycle_number = 4 and not last_drill_failed
        and last_drilled_at >= p_since),
    'masteredTotal', (
      select count(*) from blunders
      where user_id = p_user and cycle_number >= 4 and retired_at is null),
    'newPositions', (
      select count(*) from blunders
      where user_id = p_user and created_at >= p_since and retired_at is null
        and kind in ('tactic', 'endgame')),
    'topMotif', (
      select m from blunders b, unnest(b.motifs) as m
      where b.user_id = p_user and b.kind = 'tactic' and b.retired_at is null
        and b.cycle_number < 4
      group by m order by count(*) desc, m limit 1),
    'longestStreak', (select longest_streak_days from profiles where id = p_user)
  );
$$;

-- ----- outbox -----
create or replace function public.email_outbox(p_now timestamptz default now())
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
      nullif(u.email, '') as auth_email,
      coalesce(nullif(split_part(p.display_name, ' ', 1), ''), p.lichess_username, p.chesscom_username) as first_name,
      case when p.timezone is not null
             and exists (select 1 from pg_timezone_names z where z.name = p.timezone)
           then p.timezone else 'UTC' end as tz
    from profiles p
    join auth.users u on u.id = p.id
    where p.email_opt_in
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
  pos as (
    select b.user_id,
      count(*) filter (where b.next_drill_at <= p_now and b.retired_at is null) as due_now,
      count(*) filter (where b.retired_at is null) as live_total,
      max(b.last_drilled_at) as last_trained
    from blunders b
    where b.user_id in (select id from base)
    group by b.user_id
  ),
  sends as (
    select s.user_id,
      max(s.sent_at) filter (where s.kind <> 'confirm') as last_any,
      max(s.sent_at) filter (where s.kind = 'reminder') as last_reminder,
      max(s.sent_at) filter (where s.kind = 'report') as last_report,
      max(s.sent_at) filter (where s.kind = 'confirm') as last_confirm,
      bool_or(s.kind = 'ready') as ready_sent
    from email_sends s
    where s.user_id in (select id from base)
    group by s.user_id
  ),
  cand as (
    select a.*,
      coalesce(p.due_now, 0) as due_now,
      coalesce(p.live_total, 0) as live_total,
      p.last_trained,
      s.last_any, s.last_reminder, s.last_report, s.last_confirm,
      coalesce(s.ready_sent, false) as ready_sent,
      (select count(*) from email_sends e
        where e.user_id = a.id and e.kind in ('ready', 'reminder')
          and e.sent_at > coalesce(p.last_trained, '-infinity'::timestamptz)) as unanswered,
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
        when c.send_to is null or not c.at_hour then null
        when c.last_any is not null and c.last_any > p_now - interval '20 hours' then null
        when c.last_trained is null and not c.ready_sent and c.live_total > 0
             and c.created_at <= p_now - interval '20 hours'
             and c.created_at > p_now - interval '14 days' then 'ready'
        when c.live_total > 0 and (
               (c.email_reports = 'weekly' and extract(isodow from c.local_now) = 7
                 and (c.last_report is null or c.last_report < p_now - interval '6 days'))
            or (c.email_reports = 'monthly' and extract(day from c.local_now) = 1
                 and (c.last_report is null or c.last_report < p_now - interval '25 days')))
          then 'report'
        when c.email_reminders <> 'off' and c.due_now > 0
             and coalesce(c.last_drill_local_date, '') <> c.local_today
             and c.created_at <= p_now - interval '20 hours'
             and c.unanswered < 6
             and (c.last_reminder is null or c.last_reminder < p_now - case
                   when c.unanswered >= 3 then interval '6 days 20 hours'
                   when c.email_reminders = 'few_days' then interval '2 days 20 hours'
                   else interval '20 hours' end)
          then 'reminder'
      end as kind
    from cand c
  )
  select
    d.id,
    d.kind,
    case when d.kind = 'confirm' then d.contact_email else d.send_to end,
    d.email_unsub_token,
    jsonb_build_object(
      'firstName', d.first_name,
      'dueNow', d.due_now,
      'liveTotal', d.live_total,
      'streak', d.streak,
      'streakAtRisk', d.last_drill_local_date = d.local_yesterday and d.streak >= 2,
      'reportPeriod', d.email_reports
    ) || case when d.kind = 'report'
              then public.email_report_data(
                d.id,
                case when d.email_reports = 'monthly' then p_now - interval '1 month'
                     else p_now - interval '7 days' end,
                p_now)
              else '{}'::jsonb end
  from decided d
  where d.kind is not null;
$$;

revoke all on function public.email_outbox(timestamptz) from public, anon, authenticated;
revoke all on function public.email_report_data(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.email_outbox(timestamptz) to service_role;
grant execute on function public.email_report_data(uuid, timestamptz, timestamptz) to service_role;

-- ----- token RPCs (no login: /email page + one-click unsubscribe) -----
create or replace function public.email_prefs_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'optIn', p.email_opt_in,
    'reminders', p.email_reminders,
    'reports', p.email_reports,
    'hour', p.email_hour,
    -- Masked: the token page must not leak a full address.
    'email', regexp_replace(
      coalesce(p.contact_email, u.email, ''),
      '^(.)[^@]*(@.*)$', '\1•••\2'),
    'needsConfirm', p.contact_email is not null and p.contact_email_verified_at is null
  )
  from profiles p join auth.users u on u.id = p.id
  where p.id = p_user;
$$;
revoke all on function public.email_prefs_json(uuid) from public, anon, authenticated;

create or replace function public.email_prefs_by_token(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.email_prefs_json(p.id) from profiles p where p.email_unsub_token = p_token;
$$;

create or replace function public.email_update_prefs_by_token(
  p_token uuid, p_opt_in boolean, p_reminders text, p_reports text, p_hour int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid;
begin
  update profiles set
    email_opt_in = p_opt_in,
    email_reminders = p_reminders,
    email_reports = p_reports,
    email_hour = p_hour
  where email_unsub_token = p_token
  returning id into uid;
  if uid is null then return null; end if;
  return public.email_prefs_json(uid);
end;
$$;

create or replace function public.email_unsubscribe(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid;
begin
  update profiles set email_opt_in = false
  where email_unsub_token = p_token
  returning id into uid;
  if uid is null then return null; end if;
  return public.email_prefs_json(uid);
end;
$$;

create or replace function public.email_confirm(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c email_confirmations%rowtype;
begin
  select * into c from email_confirmations where token = p_token;
  if not found then return null; end if;
  perform set_config('pc.email_admin', '1', true);
  update profiles set contact_email_verified_at = now()
  where id = c.user_id and contact_email = c.email;
  delete from email_confirmations where user_id = c.user_id;
  return public.email_prefs_json(c.user_id);
end;
$$;

grant execute on function public.email_prefs_by_token(uuid) to anon, authenticated;
grant execute on function public.email_update_prefs_by_token(uuid, boolean, text, text, int) to anon, authenticated;
grant execute on function public.email_unsubscribe(uuid) to anon, authenticated;
grant execute on function public.email_confirm(uuid) to anon, authenticated;

-- ----- /analytics: opt-ins + did the email bring them back? -----
-- "Returned" = a training session with an attempted position within 24h of
-- the send. Admin-only, like admin_retention().
create or replace function public.admin_email_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'optedIn', (select count(*) from profiles where email_opt_in),
    'prompted', (select count(*) from profiles where email_prompted_at is not null),
    'confirmPending', (select count(*) from profiles
                       where email_opt_in and contact_email is not null and contact_email_verified_at is null),
    'kinds', coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind, 'sent', k.sent, 'returned', k.returned) order by k.kind)
      from (
        select s.kind,
          count(*) as sent,
          count(*) filter (where exists (
            select 1 from training_sessions ts
            where ts.user_id = s.user_id and ts.blunders_attempted > 0
              and ts.started_at between s.sent_at and s.sent_at + interval '24 hours')) as returned
        from email_sends s
        where s.sent_at >= now() - interval '30 days' and s.kind <> 'confirm'
        group by s.kind
      ) k
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_email_stats() from public, anon;
grant execute on function public.admin_email_stats() to authenticated;
