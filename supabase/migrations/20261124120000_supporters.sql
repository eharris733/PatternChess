-- $5/month supporter tier (Stripe, EH Solutions LLC).
--
-- `supporters` mirrors each player's Stripe subscription. Only the webhook
-- (functions/api/stripe/webhook.ts, service role) and checkout (which links
-- the Stripe customer before payment) write it; players may read their own row.
--
--   status              the Stripe subscription status ('none' before the
--                       first payment; 'disputed' after a chargeback)
--   first_supported_at  set on the first active subscription and never
--                       cleared: a lapsed supporter keeps the Early Supporter badge
--   beta_invited_at     for the mobile-app beta list on /analytics
--
-- is_supporter(uid) is the one rule for "has the perks": active, trialing or
-- past_due (Stripe is still retrying the card). supporter_badge(uid) is what
-- leaderboards show: 'supporter', 'early' (lapsed) or null.

create table if not exists public.supporters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text,
  status text not null default 'none',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  first_supported_at timestamptz,
  beta_invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supporters enable row level security;

drop policy if exists "supporters: read own" on public.supporters;
create policy "supporters: read own" on public.supporters
  for select to authenticated using ((select auth.uid()) = user_id);
-- No insert/update/delete policies: clients never write this table.

create or replace function public.is_supporter(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from supporters
    where user_id = uid and status in ('active', 'trialing', 'past_due')
  );
$$;

create or replace function public.supporter_badge(uid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when s.status in ('active', 'trialing', 'past_due') then 'supporter'
    when s.first_supported_at is not null then 'early'
  end
  from supporters s where s.user_id = uid;
$$;

grant execute on function public.is_supporter(uuid) to authenticated;
grant execute on function public.supporter_badge(uuid) to anon, authenticated;

-- Leaderboard rows carry the badge. Patch the live definitions in place (the
-- same approach as 20261103000956) so nothing else in them changes.
do $$
declare
  def text;
  patched text;
begin
  select pg_get_functiondef('public.leaderboard(text, text, integer)'::regprocedure) into def;
  patched := replace(def,
    $a$'isMe', user_id = me, 'flair', flair)$a$,
    $a$'isMe', user_id = me, 'flair', flair, 'supporter', public.supporter_badge(user_id))$a$);
  patched := replace(patched,
    $a$'isMe', true, 'flair', flair)$a$,
    $a$'isMe', true, 'flair', flair, 'supporter', public.supporter_badge(me))$a$);
  if patched = def or position('supporter_badge(me)' in patched) = 0 then
    raise exception 'leaderboard() did not match the expected definition';
  end if;
  execute patched;

  select pg_get_functiondef('public.public_leaderboard()'::regprocedure) into def;
  patched := replace(def,
    $a$'value', t.value, 'flair', t.flair$a$,
    $a$'value', t.value, 'flair', t.flair, 'supporter', public.supporter_badge(t.user_id)$a$);
  if patched = def then
    raise exception 'public_leaderboard() did not match the expected definition';
  end if;
  execute patched;
end;
$$;

-- Recompute the landing board with the new field on the next request.
delete from public.public_leaderboard_cache;

-- /analytics: everyone who has ever subscribed, for thanks and the mobile beta.
create or replace function public.admin_supporters()
returns table (
  user_id uuid,
  label text,
  email text,
  status text,
  first_supported_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  beta_invited_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select s.user_id,
      coalesce(nullif(p.lichess_username, ''), nullif(p.chesscom_username, ''), nullif(p.display_name, ''), 'Player'),
      coalesce(nullif(u.email, ''), case when p.contact_email_verified_at is not null then p.contact_email end),
      s.status, s.first_supported_at, s.current_period_end, s.cancel_at_period_end, s.beta_invited_at
    from supporters s
    join profiles p on p.id = s.user_id
    join auth.users u on u.id = s.user_id
    where s.first_supported_at is not null
    order by s.first_supported_at;
end;
$$;

revoke all on function public.admin_supporters() from public, anon;
grant execute on function public.admin_supporters() to authenticated;
