-- Make the per-platform game ID the dedup key for synced games.
--
-- Until now we deduped on (platform, username, opponent, played_at) in app
-- code only — fragile, and no DB safety net. With this migration the platform
-- gameId is the source of truth, enforced by UNIQUE (user_id, platform,
-- external_game_id). See 20260510120000_dedup_blunders_by_fen.sql for the
-- equivalent treatment on blunders.

ALTER TABLE games ADD COLUMN IF NOT EXISTS external_game_id TEXT;

-- Best-effort backfill from existing PGNs. Run wipe_all_games.sql first in
-- pre-launch to avoid leaning on this.
UPDATE games
SET external_game_id = substring(pgn FROM '\[Site "https?://lichess\.org/([A-Za-z0-9]+)"')
WHERE platform = 'lichess' AND external_game_id IS NULL;

UPDATE games
SET external_game_id = substring(pgn FROM '\[Link "https?://www\.chess\.com/game/(?:live|daily)/([0-9]+)"')
WHERE platform = 'chess.com' AND external_game_id IS NULL;

DELETE FROM games WHERE external_game_id IS NULL;

ALTER TABLE games
  ALTER COLUMN external_game_id SET NOT NULL;

ALTER TABLE games
  DROP CONSTRAINT IF EXISTS games_user_platform_external_unique;
ALTER TABLE games
  ADD CONSTRAINT games_user_platform_external_unique
    UNIQUE (user_id, platform, external_game_id);

CREATE INDEX IF NOT EXISTS games_external_id_idx
  ON games (platform, external_game_id);
