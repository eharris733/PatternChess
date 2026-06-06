-- Allow users to delete their own blunders and games.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).
--
-- Symptom this fixes: deleting a position (training) or a game (vault) silently
-- removed 0 rows. RLS is enabled on `blunders` and `games` (reads/inserts/updates
-- work, so SELECT/INSERT/UPDATE policies already exist), but no DELETE policy was
-- ever created — and a DELETE blocked by RLS returns success with 0 rows affected,
-- no error. These policies add the missing DELETE permission, scoped to the owner.
--
-- `ENABLE ROW LEVEL SECURITY` is a no-op when RLS is already on; included so the
-- migration is self-contained and matches the project convention.

ALTER TABLE blunders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blunders_delete_own ON blunders;
CREATE POLICY blunders_delete_own ON blunders
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS games_delete_own ON games;
CREATE POLICY games_delete_own ON games
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
