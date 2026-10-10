-- Lichess sync checked the PGN Event for 'Rated', but lichess writes it in
-- lowercase ("rated blitz game"), so every lichess game was stored unrated.
-- Same rule as isLichessRated() in src/services/chessApiService.ts: an Event
-- starting with "rated", or a *RatingDiff header (arena games name the
-- tournament in Event instead).
update public.games
set rated = true
where platform = 'lichess'
  and rated = false
  and (pgn ~* '\[Event "rated\M' or pgn ~ '\[(White|Black)RatingDiff ');
