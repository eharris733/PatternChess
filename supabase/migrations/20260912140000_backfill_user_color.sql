-- Backfill games.user_color for legacy lichess/PGN rows that were imported
-- before user_color was parsed. This replicates the exact fallback that the
-- Vault used to run client-side (extractHeaders(pgn).White === username), so
-- the games list query can stop shipping the full `pgn` text on every load.
--
-- chess.com rows are intentionally left alone: resolveOutcome() does not need
-- user_color for chess.com (it uses the per-player status code), and the Vault
-- fallback never applied to them.
update games
set user_color = case
  when lower(substring(pgn from '\[White "([^"]*)"\]')) = lower(username) then 'white'
  else 'black'
end
where user_color is null
  and platform in ('lichess', 'pgn')
  and pgn ~ '\[White "';
