-- events.patternchess.com → PatternChess funnel.
--
-- event_digest_subscribers  email capture on the events site ("Get <region>
--                           tournaments in your inbox every Monday"). Written
--                           only by the events site's Worker with the service
--                           key (RLS on, no policies: anon/authenticated can't
--                           read or write it). Double opt-in: rows start
--                           'pending' and become 'active' via confirm_token;
--                           unsub_token backs one-click unsubscribe.
--
-- profiles.signup_source    first-touch attribution ("events/event/otb" =
--                           utm source/medium/campaign) captured at boot and
--                           claimed once after sign-in by claim_signup_source.

create table if not exists public.event_digest_subscribers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  country       text not null default 'US',
  region        text,                       -- e.g. 'MA'; null = whole country
  source_path   text,                       -- page the form was submitted from
  status        text not null default 'pending' check (status in ('pending', 'active', 'unsubscribed')),
  confirm_token uuid not null default gen_random_uuid(),
  unsub_token   uuid not null default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  unsubscribed_at timestamptz,
  last_sent_at  timestamptz
);

create unique index if not exists event_digest_subscribers_email_key
  on public.event_digest_subscribers (lower(email));
create index if not exists event_digest_subscribers_active_idx
  on public.event_digest_subscribers (country, region) where status = 'active';
create unique index if not exists event_digest_subscribers_confirm_key
  on public.event_digest_subscribers (confirm_token);
create unique index if not exists event_digest_subscribers_unsub_key
  on public.event_digest_subscribers (unsub_token);

alter table public.event_digest_subscribers enable row level security;

alter table public.profiles add column if not exists signup_source text;

create or replace function public.claim_signup_source(source text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  updated int;
begin
  if me is null or source is null or length(source) > 120 then
    return false;
  end if;
  update public.profiles
  set signup_source = source
  where id = me
    and signup_source is null
    and coalesce(created_at, now()) > now() - interval '7 days';
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;
revoke all on function public.claim_signup_source(text) from public, anon;
grant execute on function public.claim_signup_source(text) to authenticated;

-- Subscribe / re-subscribe. A new or unsubscribed email starts (again) as
-- 'pending' with a fresh confirm token; an existing pending/active row just
-- moves to the new region. Returns what the caller needs to send the opt-in
-- mail (send_confirm = false when the address is already active).
create or replace function public.subscribe_event_digest(
  p_email text, p_country text, p_region text, p_source_path text
)
returns table (confirm_token uuid, unsub_token uuid, status text, send_confirm boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  sub public.event_digest_subscribers;
begin
  select * into sub from public.event_digest_subscribers s where lower(s.email) = lower(trim(p_email));
  if sub.id is null then
    insert into public.event_digest_subscribers (email, country, region, source_path)
    values (trim(p_email), coalesce(p_country, 'US'), p_region, p_source_path)
    returning * into sub;
  elsif sub.status = 'unsubscribed' then
    update public.event_digest_subscribers s
    set status = 'pending', confirm_token = gen_random_uuid(), country = coalesce(p_country, 'US'),
        region = p_region, source_path = p_source_path, unsubscribed_at = null
    where s.id = sub.id
    returning * into sub;
  else
    update public.event_digest_subscribers s
    set country = coalesce(p_country, 'US'), region = p_region
    where s.id = sub.id
    returning * into sub;
  end if;
  return query select sub.confirm_token, sub.unsub_token, sub.status, sub.status = 'pending';
end;
$$;

create or replace function public.confirm_event_digest(p_token uuid)
returns table (country text, region text)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.event_digest_subscribers s
  set status = 'active', confirmed_at = coalesce(s.confirmed_at, now())
  where s.confirm_token = p_token and s.status <> 'unsubscribed'
  returning s.country, s.region;
$$;

create or replace function public.unsubscribe_event_digest(p_token uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with u as (
    update public.event_digest_subscribers s
    set status = 'unsubscribed', unsubscribed_at = now()
    where s.unsub_token = p_token
    returning 1
  )
  select exists (select 1 from u);
$$;

revoke all on function public.subscribe_event_digest(text, text, text, text) from public, anon, authenticated;
revoke all on function public.confirm_event_digest(uuid) from public, anon, authenticated;
revoke all on function public.unsubscribe_event_digest(uuid) from public, anon, authenticated;
grant execute on function public.subscribe_event_digest(text, text, text, text) to service_role;
grant execute on function public.confirm_event_digest(uuid) to service_role;
grant execute on function public.unsubscribe_event_digest(uuid) to service_role;
