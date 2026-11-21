-- Uploaded PGNs were keyed by a hash of their text, so (1) the same game
-- exported twice with different headers/clocks was stored twice, and (2) a
-- Lichess or chess.com sync of the same account imported every uploaded game
-- again. Uploads of the user's own games are now stored under their source
-- platform + game id (pgnUploadService.preparePgn); this converts the rows
-- uploaded before that.
--
-- Per (user, platform, game id) one row is kept: an existing synced row
-- first, then an analyzed one, then the oldest. Training data on the other
-- copies is moved to the keeper before they are deleted (every FK to games
-- cascades): all blunders, and for the one-per-game tables (endgame
-- scenarios, opening deviations, annotations) the most-used copy when the
-- keeper has none.
--
-- Only rows whose stored username is one of the PGN's players convert; the
-- same name test the upload uses. Regexes mirror extractLichessGameId and
-- extractChesscomGameId in src/services/chessApiService.ts.

create temporary table pgn_src on commit drop as
select
  g.id,
  g.user_id,
  g.created_at,
  g.analyzed_at,
  case
    when lichess_id is not null then 'lichess'
    else 'chess.com'
  end as platform,
  coalesce(lichess_id, chesscom_id) as xid
from (
  select
    g.*,
    substring(g.pgn from '\[Site "https?://lichess\.org/(?:game/)?([A-Za-z0-9]{8})(?:[^A-Za-z0-9"][^"]*)?"\]') as lichess_id,
    substring(g.pgn from '\[Link "https?://www\.chess\.com/game/(?:live|daily)/([0-9]+)"\]') as chesscom_id
  from public.games g
  where g.platform = 'pgn'
    and lower(g.username) in (
      lower(substring(g.pgn from '\[White "([^"]*)"\]')),
      lower(substring(g.pgn from '\[Black "([^"]*)"\]'))
    )
) g
where coalesce(lichess_id, chesscom_id) is not null;

-- Every copy of each source game: the uploads above plus any synced row.
create temporary table pgn_copies on commit drop as
select s.id, s.user_id, s.platform, s.xid, false as synced, s.analyzed_at, s.created_at
from pgn_src s
union all
select g.id, g.user_id, g.platform, g.external_game_id, true, g.analyzed_at, g.created_at
from public.games g
join (select distinct user_id, platform, xid from pgn_src) k
  on k.user_id = g.user_id and k.platform = g.platform and k.xid = g.external_game_id;

create temporary table pgn_merge on commit drop as
select id, keeper, synced
from (
  select
    id,
    synced,
    first_value(id) over (
      partition by user_id, platform, xid
      order by synced desc, (analyzed_at is null), created_at, id
    ) as keeper
  from pgn_copies
) r;

-- Blunders: (user, fen, kind) is unique, so repointing never collides.
update public.blunders b
set game_id = m.keeper
from pgn_merge m
where b.game_id = m.id and m.id <> m.keeper;

-- One-per-game tables: move the best loser's row when the keeper has none.
update public.endgame_scenarios e
set game_id = pick.keeper
from (
  select distinct on (m.keeper) e2.id, m.keeper
  from public.endgame_scenarios e2
  join pgn_merge m on m.id = e2.game_id and m.id <> m.keeper
  where not exists (select 1 from public.endgame_scenarios k where k.game_id = m.keeper)
  order by m.keeper, coalesce(e2.times_attempted, 0) desc, e2.created_at
) pick
where e.id = pick.id;

update public.opening_deviations d
set game_id = pick.keeper
from (
  select distinct on (m.keeper) d2.id, m.keeper
  from public.opening_deviations d2
  join pgn_merge m on m.id = d2.game_id and m.id <> m.keeper
  where not exists (select 1 from public.opening_deviations k where k.game_id = m.keeper)
  order by m.keeper, d2.id
) pick
where d.id = pick.id;

update public.game_annotations a
set game_id = pick.keeper
from (
  select distinct on (m.keeper) a2.id, m.keeper
  from public.game_annotations a2
  join pgn_merge m on m.id = a2.game_id and m.id <> m.keeper
  where not exists (select 1 from public.game_annotations k where k.game_id = m.keeper)
  order by m.keeper, a2.id
) pick
where a.id = pick.id;

delete from public.games g
using pgn_merge m
where g.id = m.id and m.id <> m.keeper;

-- Kept uploads take their source identity. Lichess rated rule matches
-- isLichessRated(); chess.com PGNs carry no rated flag, so it stays as is.
update public.games g
set
  platform = s.platform,
  external_game_id = s.xid,
  rated = case
    when s.platform = 'lichess' then (g.pgn ~* '\[Event "rated\M' or g.pgn ~ '\[(White|Black)RatingDiff ')
    else g.rated
  end
from pgn_src s
join pgn_merge m on m.id = s.id and m.id = m.keeper and not m.synced
where g.id = s.id;
