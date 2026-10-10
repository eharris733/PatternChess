-- Win-back outreach queue (2026-10-10). Admin-only, human-sent: /analytics
-- lists leads per funnel segment with a pre-filled message and a link to the
-- platform's DM compose page; the admin sends it by hand and marks it
-- contacted. Nothing here sends messages (bulk Lichess DMs break its ToS and
-- chess.com has no messaging API).
--
-- Lead key: 'lichess:<lower(handle)>' / 'chesscom:<lower(handle)>' when a
-- chess handle is known, else 'user:<profile uuid>' (Google signup with no
-- handle — reachable only by email).

create table if not exists lead_outreach (
  lead_key text primary key,
  segment text not null,
  contacted_at timestamptz not null default now(),
  note text
);
alter table lead_outreach enable row level security; -- no policies => RPC-only access
revoke all on lead_outreach from anon, authenticated, public;

-- ===== admin_outreach_leads(segment) =====
-- Segments, in funnel order:
--   demo_only               entered a username on the landing page, never signed up
--   signed_up_not_connected profile with no chess handle and no games
--   connected_no_games      handle set, zero games (sync failed / abandoned)
--   synced_never_trained    has games, no training_sessions
--   contacted               every lead_outreach row with its outcome since contact
-- Row shape: { leadKey, platform, username, email, since, lastSeen, attempts,
--   blunders, contactedAt, note, signedUp, trainedSinceContact }
create or replace function public.admin_outreach_leads(segment text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  result jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com') then
    raise exception 'not authorized';
  end if;
  if segment not in ('demo_only', 'signed_up_not_connected', 'connected_no_games',
                     'synced_never_trained', 'contacted') then
    raise exception 'unknown segment %', segment;
  end if;

  with
  prof as (
    select
      p.id, p.created_at, p.anon_id,
      nullif(p.lichess_username, '') as lichess,
      nullif(p.chesscom_username, '') as chesscom,
      case
        when nullif(p.lichess_username, '') is not null then 'lichess:' || lower(p.lichess_username)
        when nullif(p.chesscom_username, '') is not null then 'chesscom:' || lower(p.chesscom_username)
        else 'user:' || p.id::text
      end as lead_key,
      u.email,
      exists (select 1 from games g where g.user_id = p.id) as has_games,
      exists (select 1 from training_sessions t where t.user_id = p.id) as trained,
      (select count(*) from blunders b where b.user_id = p.id and b.retired_at is null) as blunders
    from profiles p
    left join auth.users u on u.id = p.id
  ),
  handles as (
    select 'lichess:' || lower(lichess) as k, id from prof where lichess is not null
    union all
    select 'chesscom:' || lower(chesscom), id from prof where chesscom is not null
  ),
  demo as (
    select
      fe.platform || ':' || lower(fe.username) as lead_key,
      fe.platform,
      (array_agg(fe.username order by fe.created_at desc))[1] as username,
      min(fe.created_at) as since,
      max(fe.created_at) as last_seen,
      count(*) as attempts,
      bool_or(exists (select 1 from profiles p where p.anon_id = fe.anon_id)) as converted
    from funnel_events fe
    where fe.type = 'demo_submit' and fe.username is not null
      and fe.platform in ('lichess', 'chesscom')
    group by fe.platform, lower(fe.username)
  ),
  candidates as (
    select d.lead_key, d.platform, d.username, null::text as email,
      d.since, d.last_seen, d.attempts, null::bigint as blunders,
      'demo_only' as seg, null::uuid as user_id
    from demo d
    where not d.converted
      and not exists (select 1 from handles h where h.k = d.lead_key)
    union all
    select p.lead_key,
      case when p.lichess is not null then 'lichess' when p.chesscom is not null then 'chesscom' end,
      coalesce(p.lichess, p.chesscom), p.email,
      p.created_at, p.created_at, null, p.blunders,
      case
        when p.lichess is null and p.chesscom is null and not p.has_games then 'signed_up_not_connected'
        when (p.lichess is not null or p.chesscom is not null) and not p.has_games then 'connected_no_games'
        when p.has_games and not p.trained then 'synced_never_trained'
      end,
      p.id
    from prof p
  ),
  contacted as (
    select
      o.lead_key, o.segment, o.contacted_at, o.note,
      coalesce(
        (select h.id from handles h where h.k = o.lead_key limit 1),
        case when o.lead_key like 'user:%' then substring(o.lead_key from 6)::uuid end
      ) as user_id
    from lead_outreach o
  ),
  lead_rows as (
    select c.lead_key, c.platform, c.username, c.email, c.since, c.last_seen,
      c.attempts, c.blunders, o.contacted_at, o.note,
      (c.user_id is not null) as signed_up,
      false as trained_since
    from candidates c
    left join lead_outreach o on o.lead_key = c.lead_key
    where segment <> 'contacted' and c.seg = segment
    union all
    select o.lead_key,
      split_part(o.lead_key, ':', 1),
      case when o.lead_key like 'user:%' then null else split_part(o.lead_key, ':', 2) end,
      (select email from prof where id = o.user_id),
      null, null, null,
      (select blunders from prof where id = o.user_id),
      o.contacted_at, o.note,
      (o.user_id is not null),
      exists (select 1 from training_sessions t
              where t.user_id = o.user_id and t.started_at >= o.contacted_at)
    from contacted o
    where segment = 'contacted'
  )
  select jsonb_build_object(
    'segment', segment,
    'counts', (
      select jsonb_object_agg(s, n) from (
        select seg as s, count(*) filter (where o.lead_key is null) as n
        from candidates c left join lead_outreach o on o.lead_key = c.lead_key
        where seg is not null group by seg
        union all
        select 'contacted', count(*) from lead_outreach
      ) x
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'leadKey', lead_key, 'platform', platform, 'username', username,
        'email', email, 'since', since, 'lastSeen', last_seen,
        'attempts', attempts, 'blunders', blunders,
        'contactedAt', contacted_at, 'note', note,
        'signedUp', signed_up, 'trainedSinceContact', trained_since
      ) order by (contacted_at is not null) and segment <> 'contacted',
                 coalesce(case when segment = 'contacted' then contacted_at end, last_seen) desc nulls last)
      from lead_rows
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_outreach_leads(text) from public, anon;
grant execute on function public.admin_outreach_leads(text) to authenticated;

-- ===== admin_mark_contacted / admin_unmark_contacted =====
create or replace function public.admin_mark_contacted(lead_key text, segment text, note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com') then
    raise exception 'not authorized';
  end if;
  insert into lead_outreach (lead_key, segment, contacted_at, note)
  values (admin_mark_contacted.lead_key, admin_mark_contacted.segment, now(), nullif(admin_mark_contacted.note, ''))
  on conflict on constraint lead_outreach_pkey do update
    set note = coalesce(excluded.note, lead_outreach.note);
end;
$$;

create or replace function public.admin_unmark_contacted(lead_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com') then
    raise exception 'not authorized';
  end if;
  delete from lead_outreach o where o.lead_key = admin_unmark_contacted.lead_key;
end;
$$;

revoke all on function public.admin_mark_contacted(text, text, text) from public, anon;
revoke all on function public.admin_unmark_contacted(text) from public, anon;
grant execute on function public.admin_mark_contacted(text, text, text) to authenticated;
grant execute on function public.admin_unmark_contacted(text) to authenticated;
