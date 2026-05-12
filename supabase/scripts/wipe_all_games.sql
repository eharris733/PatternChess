-- One-off cleanup: wipe ALL user-generated training data across ALL users.
-- Safe to run only because the project is pre-launch and the dev account is
-- the only real user. DO NOT run after onboarding any real users.
--
-- Tables left untouched:
--   profiles               (auth/profile rows — keeps you logged in)
--   benchmarks             (seed data)
--   opening_explorer_cache (shared lookup cache, not per-user)
--
-- Run from the Supabase SQL editor or psql against the project DB.

BEGIN;

-- Children first (blunders + annotations reference games)
DELETE FROM blunders;
DELETE FROM game_annotations;

-- Independent user data
DELETE FROM training_sessions;

-- Finally, the games themselves
DELETE FROM games;

-- Reset the per-platform last-synced timestamps so the next sync is treated
-- as a fresh onboarding (large initial batch) rather than an incremental
-- fetch limited by the stale "since" cursor.
UPDATE profiles
SET last_synced_lichess_at = NULL,
    last_synced_chesscom_at = NULL;

-- Sanity check — every counter below should print 0.
SELECT 'games'             AS table_name, COUNT(*) AS remaining FROM games
UNION ALL SELECT 'blunders',          COUNT(*) FROM blunders
UNION ALL SELECT 'game_annotations',  COUNT(*) FROM game_annotations
UNION ALL SELECT 'training_sessions', COUNT(*) FROM training_sessions;

COMMIT;
