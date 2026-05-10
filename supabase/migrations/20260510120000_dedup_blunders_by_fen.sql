-- Dedup blunders by (user_id, fen): keep the most-trained row,
-- then add a UNIQUE constraint so duplicates can't recur.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).

BEGIN;

-- 1. Rank rows within each (user_id, fen) group; rank 1 = the keeper.
--    Order: highest cycle_number, then highest times_attempted, then earliest
--    created_at, with id as a final deterministic tiebreak.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, fen
      ORDER BY
        cycle_number    DESC,
        times_attempted DESC,
        created_at      ASC,
        id              ASC
    ) AS rn
  FROM blunders
)
DELETE FROM blunders
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Prevent future duplicates at the database layer.
ALTER TABLE blunders
  ADD CONSTRAINT blunders_user_fen_unique UNIQUE (user_id, fen);

COMMIT;
