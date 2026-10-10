-- Landing-page conversion round (2026-10-10):
--  * public_leaderboard(): anon-callable top 5 "positions solved, last 7 days"
--    for the landing page. No ids, no isMe/me, chess handles only (never the
--    Google display name — that is usually a real name), opted-out users
--    excluded. Cached in a one-row table like landing_stats().
--  * funnel_events gains cta_click + lead_return types and a `source` column,
--    so sign-up clicks per landing section and win-back link returns can be
--    counted.
--  * admin_landing_ctas(): admin-only per-source counts for /analytics.

-- ===== public_leaderboard() =====
create table if not exists public_leaderboard_cache (
  id int primary key default 1 check (id = 1),
  payload jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public_leaderboard_cache enable row level security; -- no policies => no client access
revoke all on public_leaderboard_cache from anon, authenticated, public;

create or replace function public.public_leaderboard()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cached record;
  fresh jsonb;
  since timestamptz := now() - interval '7 days';
begin
  select payload, computed_at into cached
  from public_leaderboard_cache where id = 1;

  if found and cached.computed_at > now() - interval '1 hour' then
    return cached.payload;
  end if;

  -- Another request is already recomputing: serve stale (null on first ever call).
  if not pg_try_advisory_xact_lock(hashtext('public_leaderboard')) then
    return cached.payload;
  end if;

  -- Same "solved" source as leaderboard('solved','week') — first-attempt
  -- corrects logged per session — over a rolling 7 days so the board is never
  -- empty on a Monday morning.
  with solved as (
    select user_id, coalesce(sum(blunders_correct), 0)::bigint as value
    from training_sessions where started_at >= since group by user_id
  ),
  ranked as (
    select
      coalesce(nullif(p.lichess_username, ''), nullif(p.chesscom_username, ''), 'Player') as label,
      p.flair,
      s.value,
      rank() over (order by s.value desc, p.id) as rank
    from solved s
    join profiles p on p.id = s.user_id
    where p.leaderboard_opt_out = false and s.value > 0
  )
  select jsonb_build_object(
    'since', since,
    'computedAt', now(),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object('rank', rank, 'label', label, 'value', value, 'flair', flair)
        order by rank
      )
      from (select * from ranked order by rank limit 5) top
    ), '[]'::jsonb)
  ) into fresh;

  insert into public_leaderboard_cache (id, payload, computed_at)
  values (1, fresh, now())
  on conflict (id) do update set payload = excluded.payload, computed_at = excluded.computed_at;

  return fresh;
end;
$$;

revoke all on function public.public_leaderboard() from public;
grant execute on function public.public_leaderboard() to anon, authenticated;

-- ===== funnel_events: CTA clicks + win-back returns =====
alter table funnel_events add column if not exists source text;
alter table funnel_events drop constraint if exists funnel_events_type_check;
alter table funnel_events add constraint funnel_events_type_check
  check (type in ('landing_view', 'demo_submit', 'cta_click', 'lead_return'));

-- ===== admin_landing_ctas(): CTA clicks + returns per source =====
create or replace function public.admin_landing_ctas(days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com') then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'type', type, 'source', source, 'events', events, 'visitors', visitors
    ) order by type, events desc), '[]'::jsonb)
  into result
  from (
    select type, coalesce(source, '(none)') as source,
      count(*) as events, count(distinct anon_id) as visitors
    from funnel_events
    where type in ('cta_click', 'lead_return')
      and created_at >= now() - make_interval(days => greatest(coalesce(days, 30), 1))
    group by 1, 2
  ) t;

  return result;
end;
$$;

revoke all on function public.admin_landing_ctas(int) from public, anon;
grant execute on function public.admin_landing_ctas(int) to authenticated;
