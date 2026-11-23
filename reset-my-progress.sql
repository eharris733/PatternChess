-- Wipe ALL progress for one user, returning the account to first-run
-- (onboarding) state. D1 app database `patternchess-app` (SQLite).
--
-- IRREVERSIBLE. Deletes games, blunders, training sessions, and annotations,
-- and clears linked accounts + streaks on the profile. SR cycle state,
-- session history, and streaks cannot be recovered.
--
-- Edit the email below, then run from the repo root:
--   npx wrangler d1 execute patternchess-app --remote --config d1/wrangler.jsonc --file reset-my-progress.sql
-- (`--local --persist-to .wrangler/state` instead of `--remote` for the local copy).
-- An unknown email matches no user and changes nothing.
-- (The Supabase-era Postgres version is in git history before 2026-11-22.)

-- Child rows first (FK-safe), then parents.
DELETE FROM game_annotations  WHERE user_id = (SELECT id FROM "user" WHERE email = 'elliotmharris@gmail.com');
DELETE FROM blunders          WHERE user_id = (SELECT id FROM "user" WHERE email = 'elliotmharris@gmail.com');
DELETE FROM training_sessions WHERE user_id = (SELECT id FROM "user" WHERE email = 'elliotmharris@gmail.com');
DELETE FROM games             WHERE user_id = (SELECT id FROM "user" WHERE email = 'elliotmharris@gmail.com');

-- Reset the profile so isFirstRun is true: no linked account + zero games.
UPDATE profiles SET
  lichess_username        = NULL,
  chesscom_username       = NULL,
  last_synced_lichess_at  = NULL,
  last_synced_chesscom_at = NULL,
  current_streak_days     = 0,
  longest_streak_days     = 0,
  last_drill_local_date   = NULL
WHERE id = (SELECT id FROM "user" WHERE email = 'elliotmharris@gmail.com');
