-- App-open counter + staged dashboard asks (email now; course and supporter
-- later), and a v2 admin_email_stats for the /analytics Emails card.
--
--   app_opens            bumped once per tab session by AppShell (bump_app_open)
--   <ask>_prompted_at    last time the ask was answered or dismissed
--   <ask>_prompt_count   how many times; an ask comes back once after 14 days,
--                        then never (src/lib/asks.ts)
--   email_unsubscribed_at  stamped by the one-click unsubscribe, for the stats

alter table public.profiles
  add column if not exists app_opens integer not null default 0,
  add column if not exists email_prompt_count smallint not null default 0,
  add column if not exists course_prompted_at timestamptz,
  add column if not exists course_prompt_count smallint not null default 0,
  add column if not exists supporter_prompted_at timestamptz,
  add column if not exists supporter_prompt_count smallint not null default 0,
  add column if not exists email_unsubscribed_at timestamptz;

-- Accounts the old Supabase opt-in card already asked count as asked once, so
-- they get the single 14-day re-offer and no more.
update public.profiles
set email_prompt_count = 1
where email_prompted_at is not null and email_prompt_count = 0;

create or replace function public.bump_app_open()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  update profiles set app_opens = app_opens + 1
  where id = auth.uid()
  returning app_opens;
$$;

revoke all on function public.bump_app_open() from public, anon;
grant execute on function public.bump_app_open() to authenticated;

create or replace function public.mark_ask_prompted(p_ask text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_ask = 'email' then
    update profiles set email_prompted_at = now(), email_prompt_count = email_prompt_count + 1
    where id = auth.uid();
  elsif p_ask = 'course' then
    update profiles set course_prompted_at = now(), course_prompt_count = course_prompt_count + 1
    where id = auth.uid();
  elsif p_ask = 'supporter' then
    update profiles set supporter_prompted_at = now(), supporter_prompt_count = supporter_prompt_count + 1
    where id = auth.uid();
  else
    raise exception 'unknown ask %', p_ask;
  end if;
end;
$$;

revoke all on function public.mark_ask_prompted(text) from public, anon;
grant execute on function public.mark_ask_prompted(text) to authenticated;

-- Same as 20261012140000, plus the unsubscribe stamp.
create or replace function public.email_unsubscribe(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid;
begin
  update profiles set email_opt_in = false, email_unsubscribed_at = now()
  where email_unsub_token = p_token
  returning id into uid;
  if uid is null then return null; end if;
  return public.email_prefs_json(uid);
end;
$$;

-- v2: the Worker's email kinds, reachability, unsubscribes, and the 7-day
-- return rate of opted-in vs not (the number that will replace the vendor
-- retention stat in the email ask once there is enough of it).
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
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  with acct as (
    select p.id, p.email_opt_in, p.created_at,
      (nullif(u.email, '') is not null and p.contact_email is null)
        or p.contact_email_verified_at is not null as has_address,
      exists (select 1 from training_sessions t
              where t.user_id = p.id and t.blunders_attempted > 0
                and t.started_at >= now() - interval '7 days') as trained_7d
    from profiles p
    join auth.users u on u.id = p.id
  ),
  ret as (
    -- Only accounts at least a week old, so new sign-ups don't skew either side.
    select email_opt_in and has_address as reachable,
      count(*) as accounts,
      count(*) filter (where trained_7d) as trained
    from acct
    where created_at <= now() - interval '7 days'
    group by 1
  )
  select jsonb_build_object(
    'optedIn', (select count(*) from acct where email_opt_in),
    'reachable', (select count(*) from acct where email_opt_in and has_address),
    'noAddress', (select count(*) from acct where not has_address),
    'prompted', (select count(*) from profiles where email_prompt_count > 0),
    'confirmPending', (select count(*) from profiles
                       where email_opt_in and contact_email is not null and contact_email_verified_at is null),
    'unsubscribed30d', (select count(*) from profiles where email_unsubscribed_at >= now() - interval '30 days'),
    'returnRate', jsonb_build_object(
      'reachable', coalesce((select jsonb_build_object('accounts', accounts, 'trained', trained) from ret where reachable),
                            '{"accounts":0,"trained":0}'::jsonb),
      'other', coalesce((select jsonb_build_object('accounts', accounts, 'trained', trained) from ret where not reachable),
                        '{"accounts":0,"trained":0}'::jsonb)
    ),
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
