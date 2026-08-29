-- Background deepening metadata. Initial sync analysis stays a fast depth-12
-- pass (onboarding is its critical path); the dashboard maintenance worker then
-- re-analyzes each row with a fixed thinking-time budget and rewrites the
-- evals/PV, so depth 12 is only ever an initial estimate.

BEGIN;

-- Deepest completed engine depth backing eval_before/eval_after/
-- correct_moves[0]/solution_line. NULL = legacy row from before this column.
ALTER TABLE blunders ADD COLUMN IF NOT EXISTS analysis_depth int;

-- Set once the background timed re-analysis has processed the row; the
-- deepening selector picks rows where this is NULL, shallowest first.
ALTER TABLE blunders ADD COLUMN IF NOT EXISTS deepened_at timestamptz;

-- Set when deepening shows the position wasn't really a blunder (<10% winning
-- chances lost — hysteresis below the 15% trainable bar). Retired rows are
-- hidden from the due queue but keep their SR history and stay in Vault/stats.
ALTER TABLE blunders ADD COLUMN IF NOT EXISTS retired_at timestamptz;

COMMIT;
