-- public_leaderboard() rows gain `platform` ('lichess' | 'chesscom', the
-- platform of the handle shown) and the player's current `rating` +
-- `ratingCategory` (bullet/blitz/rapid/classical) on that platform: their
-- most-played time-control category over their last 50 games there, rated at
-- the latest of those games. Requires only user_rating (not games.rated): every
-- Lichess game is currently stored rated=false (its PGN Event header is
-- lower-case "rated blitz game").
-- Same window, value and privacy rules as 20261010150000.

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

  if not pg_try_advisory_xact_lock(hashtext('public_leaderboard')) then
    return cached.payload;
  end if;

  with solved as (
    select user_id, coalesce(sum(blunders_correct), 0)::bigint as value
    from training_sessions where started_at >= since group by user_id
  ),
  ranked as (
    select
      p.id as user_id,
      case
        when nullif(p.lichess_username, '') is not null then p.lichess_username
        when nullif(p.chesscom_username, '') is not null then p.chesscom_username
        else 'Player'
      end as label,
      case
        when nullif(p.lichess_username, '') is not null then 'lichess'
        when nullif(p.chesscom_username, '') is not null then 'chesscom'
      end as platform,
      p.flair,
      s.value,
      rank() over (order by s.value desc, p.id) as rank
    from solved s
    join profiles p on p.id = s.user_id
    where p.leaderboard_opt_out = false and s.value > 0
  ),
  top as (
    select * from ranked order by rank limit 5
  ),
  recent as (
    select t.user_id, g.played_at, g.user_rating,
      case
        -- chess.com daily ("1/1209600") and correspondence ("-") have no rating category
        when ts.base_seconds is null or g.time_control like '%/%' then null
        when ts.base_seconds < 180  then 'bullet'
        when ts.base_seconds < 600  then 'blitz'
        when ts.base_seconds < 1800 then 'rapid'
        else 'classical'
      end as category
    from top t
    cross join lateral (
      select g.played_at, g.user_rating, g.time_control
      from games g
      where g.user_id = t.user_id
        and g.platform = case t.platform when 'chesscom' then 'chess.com' else t.platform end
        and g.user_rating is not null
        and g.played_at is not null
      order by g.played_at desc
      limit 50
    ) g
    cross join lateral (
      select nullif(
        substring(split_part(split_part(g.time_control, '+', 1), '/', -1) from '^\d+'),
        ''
      )::int as base_seconds
    ) ts
  ),
  main_category as (
    select distinct on (user_id) user_id, category
    from recent
    where category is not null
    group by user_id, category
    order by user_id, count(*) desc, max(played_at) desc
  ),
  rating as (
    select distinct on (r.user_id) r.user_id, r.category, r.user_rating
    from recent r
    join main_category m on m.user_id = r.user_id and m.category = r.category
    order by r.user_id, r.played_at desc
  )
  select jsonb_build_object(
    'since', since,
    'computedAt', now(),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rank', t.rank, 'label', t.label, 'platform', t.platform,
          'rating', ra.user_rating, 'ratingCategory', ra.category,
          'value', t.value, 'flair', t.flair
        )
        order by t.rank
      )
      from top t
      left join rating ra on ra.user_id = t.user_id
    ), '[]'::jsonb)
  ) into fresh;

  insert into public_leaderboard_cache (id, payload, computed_at)
  values (1, fresh, now())
  on conflict (id) do update set payload = excluded.payload, computed_at = excluded.computed_at;

  return fresh;
end;
$$;

-- Drop the cached payload so the new row shape is served immediately.
delete from public_leaderboard_cache;
