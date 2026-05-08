-- v1 gamification + insights foundation
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg)

-- ----- games: PGN-derived metadata -----
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS eco TEXT,
  ADD COLUMN IF NOT EXISTS opening_name TEXT,
  ADD COLUMN IF NOT EXISTS user_color TEXT,
  ADD COLUMN IF NOT EXISTS user_rating INTEGER,
  ADD COLUMN IF NOT EXISTS opponent_rating INTEGER,
  ADD COLUMN IF NOT EXISTS clock_per_ply JSONB,
  ADD COLUMN IF NOT EXISTS total_plies INTEGER,
  ADD COLUMN IF NOT EXISTS parsed_metadata_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS games_user_id_eco_idx ON games (user_id, eco);
CREATE INDEX IF NOT EXISTS games_parsed_metadata_idx ON games (user_id) WHERE parsed_metadata_at IS NULL;

-- ----- blunders: phase classification -----
ALTER TABLE blunders
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'middlegame';

UPDATE blunders
SET phase = CASE
  WHEN move_number <= 12 THEN 'opening'
  WHEN move_number > 32 THEN 'endgame'
  ELSE 'middlegame'
END
WHERE phase = 'middlegame';

CREATE INDEX IF NOT EXISTS blunders_user_id_phase_idx ON blunders (user_id, phase);

-- ----- profiles: streak fields -----
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS current_streak_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_drill_local_date TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- ----- training_sessions -----
CREATE TABLE IF NOT EXISTS training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  local_date TEXT NOT NULL,
  blunders_attempted INTEGER NOT NULL DEFAULT 0,
  blunders_correct INTEGER NOT NULL DEFAULT 0,
  cycles_completed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS training_sessions_user_started_idx
  ON training_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS training_sessions_user_local_date_idx
  ON training_sessions (user_id, local_date);

ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_sessions_select_own ON training_sessions;
CREATE POLICY training_sessions_select_own ON training_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS training_sessions_insert_own ON training_sessions;
CREATE POLICY training_sessions_insert_own ON training_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS training_sessions_update_own ON training_sessions;
CREATE POLICY training_sessions_update_own ON training_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ----- benchmarks (read-only seed table; data loaded in v2 migration) -----
CREATE TABLE IF NOT EXISTS benchmarks (
  kind TEXT NOT NULL,
  bucket TEXT NOT NULL,
  value NUMERIC NOT NULL,
  sample_size INTEGER NOT NULL,
  source TEXT,
  PRIMARY KEY (kind, bucket)
);

ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS benchmarks_read_all ON benchmarks;
CREATE POLICY benchmarks_read_all ON benchmarks
  FOR SELECT TO authenticated USING (true);
