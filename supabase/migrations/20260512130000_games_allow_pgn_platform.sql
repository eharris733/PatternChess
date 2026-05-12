-- Allow 'pgn' as a platform value for user-uploaded PGN games.
--
-- Until now the games.platform column had a CHECK constraint limiting it to
-- ('lichess', 'chess.com'). PGN uploads from the Vault UI store games with
-- platform = 'pgn', which would fail that check. Drop the old constraint and
-- re-add it including the new value.

ALTER TABLE games DROP CONSTRAINT IF EXISTS games_platform_check;

ALTER TABLE games
  ADD CONSTRAINT games_platform_check
  CHECK (platform IN ('lichess', 'chess.com', 'pgn'));
