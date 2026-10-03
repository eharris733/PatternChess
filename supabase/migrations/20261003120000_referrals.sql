-- Referrals: "Invite a friend to compete" on /leaderboards.
--
-- profiles.referral_code    short public code used in invite links (?ref=CODE);
--                           never the user id
-- profiles.referred_by      who invited this user (set once by claim_referral)
-- profiles.referrals_count  friends who joined through your link — backs the
--                           invite-1 / invite-5 achievements
--
-- claim_referral(code) — SECURITY DEFINER (it updates the referrer's row,
-- which RLS blocks). Only counts when the caller has no referrer yet, isn't
-- using their own code, and signed up within the last 7 days (so existing
-- users can't farm each other). Returns true when the referral was recorded.

create or replace function public.gen_referral_code()
returns text
language sql
volatile
as $$
  -- 8 chars from an unambiguous alphabet (no 0/O/1/I/L).
  select string_agg(substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.profiles(id) on delete set null,
  add column if not exists referrals_count integer not null default 0;

update public.profiles set referral_code = public.gen_referral_code() where referral_code is null;

alter table public.profiles
  alter column referral_code set default public.gen_referral_code(),
  alter column referral_code set not null;

create unique index if not exists profiles_referral_code_key on public.profiles (referral_code);

create or replace function public.claim_referral(code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  referrer uuid;
  updated int;
begin
  if me is null or code is null then
    return false;
  end if;

  select id into referrer from public.profiles where referral_code = lower(trim(code));
  if referrer is null or referrer = me then
    return false;
  end if;

  update public.profiles
  set referred_by = referrer
  where id = me
    and referred_by is null
    and coalesce(created_at, now()) > now() - interval '7 days';
  get diagnostics updated = row_count;
  if updated = 0 then
    return false;
  end if;

  update public.profiles set referrals_count = referrals_count + 1 where id = referrer;
  return true;
end;
$$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;
