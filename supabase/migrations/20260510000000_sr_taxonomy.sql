-- SR taxonomy v2: 4 buckets (New / Learning / Try again / Mastered)
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg)

-- ----- new column -----
-- Tracks whether the most recent drill's first attempt was a failure.
-- Drives the "Try again" bucket in srBucket() (src/models/blunder.ts).
ALTER TABLE blunders
  ADD COLUMN IF NOT EXISTS last_drill_failed BOOLEAN NOT NULL DEFAULT FALSE;

-- ----- legacy backfill 1: failure-only rows -----
-- Items that have been attempted but never solved → genuine "Try again".
UPDATE blunders
SET last_drill_failed = TRUE
WHERE times_attempted > 0 AND times_correct = 0;

-- ----- legacy backfill 2: restore lost cycle progress -----
-- The previous training-store revision incremented times_correct on every
-- successful drill but never advanced cycle_number. As a result, blunders the
-- user successfully solved many times remained stuck at cycle 0 and surfaced
-- as "New" in the queue. Recover the lost ladder position by inferring
-- cycle_number from the success count, capped at the ladder length (7).
UPDATE blunders
SET cycle_number = LEAST(times_correct, 7)
WHERE cycle_number = 0 AND times_correct >= 1;
