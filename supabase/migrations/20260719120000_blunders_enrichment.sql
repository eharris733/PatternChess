-- Blunder enrichment: solution line + tactical motifs
-- Apply via Supabase SQL editor or `supabase db push` (project: ydfwppthwnlgxnntzrvg)

-- ----- solution_line -----
-- Engine lines captured at analysis time, shape { pv, playedPv, v }:
--   pv       — UCI principal variation from the position before the blunder
--              (pv[0] === correct_moves[0].move); drives multi-move drills.
--   playedPv — refutation PV from the position after the played move; lets
--              motifs be recomputed without re-running the engine.
--   v        — schema version for future tuning.
-- NULL on legacy rows until the client-side enrichment backfill fills them in.
ALTER TABLE blunders
  ADD COLUMN IF NOT EXISTS solution_line JSONB;

-- ----- motifs -----
-- Tactical motif tags (src/chess/motifs.ts), e.g. 'missedFork', 'allowedMate'.
ALTER TABLE blunders
  ADD COLUMN IF NOT EXISTS motifs TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
