-- PatternChess app schema for Cloudflare D1 (SQLite), ported from the Supabase
-- `public` schema (project ydfwppthwnlgxnntzrvg) on 2026-11-22.
--
-- Same table and column names as Postgres. Type mapping (see d1/README.md):
--   uuid                 -> TEXT (canonical lowercase 8-4-4-4-12)
--   timestamptz          -> TEXT, ISO 8601 UTC with milliseconds: 2026-11-22T03:16:41.851Z
--                           (one fixed format so string comparison = time order)
--   jsonb / text[]       -> TEXT holding JSON (arrays as JSON arrays), json_valid()-checked
--   boolean              -> INTEGER 0/1, CHECK-ed
--   int/smallint/bigint  -> INTEGER;  real/numeric -> REAL
-- Decode/encode between these and the PostgREST row shape with
-- functions/_shared/schema.ts (decodeRow / encodeRow).
--
-- Defaults: ids, tokens, referral codes and now() timestamps have SQLite
-- expression defaults as a safety net, but the API generates them in TS
-- (crypto.randomUUID(), new Date().toISOString()) like the contract says.
--
-- Foreign keys to auth.users point at the better-auth `user` table created in
-- 0002_auth.sql. SQLite resolves FK parents at write time, not at CREATE time,
-- so the apply order 0001 -> 0002 is fine. D1 enforces foreign keys.
--
-- Not ported (enforced in the Worker instead): the email regex CHECKs (SQLite
-- has no REGEXP; a loose LIKE check stands in), the profiles_guard_email_columns
-- trigger, RLS, and gen_referral_code()'s plpgsql (replaced by an expression).

-- ---------------------------------------------------------------------------
-- profiles (PK = user id)
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  id                        TEXT PRIMARY KEY NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  display_name              TEXT,
  avatar_url                TEXT,
  lichess_username          TEXT,
  chesscom_username         TEXT,
  created_at                TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_synced_lichess_at    TEXT,
  last_synced_chesscom_at   TEXT,
  preferred_rated_only      INTEGER NOT NULL DEFAULT 0 CHECK (preferred_rated_only IN (0, 1)),
  preferred_time_controls   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(preferred_time_controls)),
  current_streak_days       INTEGER NOT NULL DEFAULT 0,
  longest_streak_days       INTEGER NOT NULL DEFAULT 0,
  last_drill_local_date     TEXT,
  timezone                  TEXT,
  anon_id                   TEXT,
  board_theme               TEXT NOT NULL DEFAULT 'default'
                              CHECK (board_theme IN ('default', 'inverse', 'frozen', 'green', 'purple')),
  show_engine_evals         INTEGER NOT NULL DEFAULT 0 CHECK (show_engine_evals IN (0, 1)),
  reveal_before_solve       INTEGER NOT NULL DEFAULT 0 CHECK (reveal_before_solve IN (0, 1)),
  autoplay_refutation       INTEGER NOT NULL DEFAULT 1 CHECK (autoplay_refutation IN (0, 1)),
  used_training_filter      INTEGER NOT NULL DEFAULT 0 CHECK (used_training_filter IN (0, 1)),
  sounds_enabled            INTEGER NOT NULL DEFAULT 1 CHECK (sounds_enabled IN (0, 1)),
  leaderboard_opt_out       INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard_opt_out IN (0, 1)),
  followed_instagram        INTEGER NOT NULL DEFAULT 0 CHECK (followed_instagram IN (0, 1)),
  shares_count              INTEGER NOT NULL DEFAULT 0,
  show_answer_on_miss       INTEGER NOT NULL DEFAULT 0 CHECK (show_answer_on_miss IN (0, 1)),
  opening_reviews_opened    INTEGER NOT NULL DEFAULT 0,
  learn_chapters_done       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(learn_chapters_done)),
  flair                     TEXT,
  -- gen_referral_code(): 8 chars from an unambiguous alphabet (no 0/O/1/I/L).
  referral_code             TEXT NOT NULL UNIQUE DEFAULT (
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1) ||
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1) ||
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1) ||
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1) ||
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1) ||
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1) ||
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1) ||
                              substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + (abs(random()) % 31), 1)),
  referred_by               TEXT REFERENCES profiles (id) ON DELETE SET NULL,
  referrals_count           INTEGER NOT NULL DEFAULT 0,
  signup_source             TEXT,
  email_opt_in              INTEGER NOT NULL DEFAULT 1 CHECK (email_opt_in IN (0, 1)),
  -- Postgres: ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'. Validate properly in the Worker.
  contact_email             TEXT CHECK (contact_email IS NULL OR contact_email LIKE '%_@_%._%'),
  contact_email_verified_at TEXT,
  email_reminders           TEXT NOT NULL DEFAULT 'daily'
                              CHECK (email_reminders IN ('daily', 'few_days', 'off')),
  email_reports             TEXT NOT NULL DEFAULT 'weekly'
                              CHECK (email_reports IN ('weekly', 'monthly', 'off')),
  email_hour                INTEGER NOT NULL DEFAULT 18 CHECK (email_hour BETWEEN 0 AND 23),
  email_unsub_token         TEXT NOT NULL UNIQUE DEFAULT (
                              lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                              substr(lower(hex(randomblob(2))), 2) || '-' ||
                              substr('89ab', 1 + (abs(random()) % 4), 1) ||
                              substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  email_prompted_at         TEXT,
  commitment_level          TEXT NOT NULL DEFAULT 'regular'
                              CHECK (commitment_level IN ('casual', 'regular', 'serious', 'obsessed', 'custom')),
  daily_positions_goal      INTEGER NOT NULL DEFAULT 10 CHECK (daily_positions_goal BETWEEN 1 AND 100),
  daily_games_goal          INTEGER NOT NULL DEFAULT 1 CHECK (daily_games_goal BETWEEN 0 AND 10),
  streak_freezes            INTEGER NOT NULL DEFAULT 0 CHECK (streak_freezes BETWEEN 0 AND 2),
  streak_freezes_used       INTEGER NOT NULL DEFAULT 0,
  app_opens                 INTEGER NOT NULL DEFAULT 0,
  email_prompt_count        INTEGER NOT NULL DEFAULT 0,
  course_prompted_at        TEXT,
  course_prompt_count       INTEGER NOT NULL DEFAULT 0,
  supporter_prompted_at     TEXT,
  supporter_prompt_count    INTEGER NOT NULL DEFAULT 0,
  email_unsubscribed_at     TEXT
);
CREATE INDEX profiles_anon_id_idx ON profiles (anon_id);
CREATE INDEX profiles_referred_by_idx ON profiles (referred_by);

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------
CREATE TABLE games (
  id                        TEXT PRIMARY KEY NOT NULL DEFAULT (
                              lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                              substr(lower(hex(randomblob(2))), 2) || '-' ||
                              substr('89ab', 1 + (abs(random()) % 4), 1) ||
                              substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  platform                  TEXT NOT NULL CHECK (platform IN ('lichess', 'chess.com', 'pgn')),
  username                  TEXT NOT NULL,
  opponent                  TEXT NOT NULL,
  pgn                       TEXT NOT NULL,
  time_control              TEXT,
  rated                     INTEGER DEFAULT 0 CHECK (rated IN (0, 1)),
  result                    TEXT,
  played_at                 TEXT,
  created_at                TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Postgres: ON DELETE SET NULL (kept).
  user_id                   TEXT REFERENCES user (id) ON DELETE SET NULL,
  analyzed_at               TEXT,
  eco                       TEXT,
  opening_name              TEXT,
  user_color                TEXT,
  user_rating               INTEGER,
  opponent_rating           INTEGER,
  clock_per_ply             TEXT CHECK (clock_per_ply IS NULL OR json_valid(clock_per_ply)),
  total_plies               INTEGER,
  parsed_metadata_at        TEXT,
  external_game_id          TEXT NOT NULL,
  opening_family            TEXT,
  opening_classified_at     TEXT,
  opening_deviation_version INTEGER,
  -- NEW (not in Postgres): bullet | blitz | rapid | classical | NULL, derived
  -- from time_control by timeCategory() in functions/_shared/schema.ts
  -- (encodeRow('games', …) fills it whenever time_control is written). Replaces
  -- the regex time-control parse in landing_stats / leaderboard /
  -- public_leaderboard / email_report_data.
  time_category             TEXT CHECK (time_category IN ('bullet', 'blitz', 'rapid', 'classical')),
  UNIQUE (user_id, platform, external_game_id)
);
CREATE INDEX games_external_id_idx ON games (platform, external_game_id);
CREATE INDEX games_opening_unclassified_idx ON games (user_id) WHERE opening_classified_at IS NULL;
CREATE INDEX games_parsed_metadata_idx ON games (user_id) WHERE parsed_metadata_at IS NULL;
CREATE INDEX games_user_analyzed_idx ON games (user_id) WHERE analyzed_at IS NOT NULL;
CREATE INDEX games_user_unanalyzed_idx ON games (user_id) WHERE analyzed_at IS NULL;
CREATE INDEX games_user_created_idx ON games (user_id, created_at);
CREATE INDEX games_user_deviation_version_idx ON games (user_id, opening_deviation_version);
CREATE INDEX games_user_id_eco_idx ON games (user_id, eco);
CREATE INDEX games_user_opening_family_idx ON games (user_id, opening_family) WHERE opening_family IS NOT NULL;
CREATE INDEX games_user_played_idx ON games (user_id, played_at DESC, created_at DESC, id);
CREATE INDEX games_user_category_idx ON games (user_id, time_category, played_at) WHERE time_category IS NOT NULL;
-- (Postgres idx_games_user_id (user_id) dropped: every (user_id, …) index above covers it.)

-- ---------------------------------------------------------------------------
-- blunders (trainable items: tactic | endgame | opening)
-- ---------------------------------------------------------------------------
CREATE TABLE blunders (
  id                TEXT PRIMARY KEY NOT NULL DEFAULT (
                      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                      substr(lower(hex(randomblob(2))), 2) || '-' ||
                      substr('89ab', 1 + (abs(random()) % 4), 1) ||
                      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  game_id           TEXT REFERENCES games (id) ON DELETE CASCADE,
  fen               TEXT NOT NULL,
  move_number       INTEGER NOT NULL,
  played_move       TEXT NOT NULL,
  correct_moves     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(correct_moves)),
  eval_before       INTEGER NOT NULL,
  eval_after        INTEGER NOT NULL,
  eval_swing        INTEGER NOT NULL,
  side_to_move      TEXT NOT NULL CHECK (side_to_move IN ('white', 'black')),
  cycle_number      INTEGER NOT NULL DEFAULT 0,
  last_drilled_at   TEXT,
  next_drill_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  times_correct     INTEGER NOT NULL DEFAULT 0,
  times_attempted   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Postgres: ON DELETE SET NULL (kept).
  user_id           TEXT REFERENCES user (id) ON DELETE SET NULL,
  phase             TEXT NOT NULL DEFAULT 'middlegame',
  last_drill_failed INTEGER NOT NULL DEFAULT 0 CHECK (last_drill_failed IN (0, 1)),
  solution_line     TEXT CHECK (solution_line IS NULL OR json_valid(solution_line)),
  motifs            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(motifs)),
  kind              TEXT NOT NULL DEFAULT 'tactic' CHECK (kind IN ('tactic', 'endgame', 'opening')),
  drill_data        TEXT CHECK (drill_data IS NULL OR json_valid(drill_data)),
  analysis_depth    INTEGER,
  deepened_at       TEXT,
  retired_at        TEXT,
  UNIQUE (user_id, fen, kind)
);
CREATE INDEX blunders_user_due_active_idx ON blunders (user_id, next_drill_at) WHERE retired_at IS NULL;
CREATE INDEX blunders_user_id_kind_idx ON blunders (user_id, kind);
CREATE INDEX blunders_user_id_phase_idx ON blunders (user_id, phase);
CREATE INDEX idx_blunders_game_id ON blunders (game_id);
CREATE INDEX idx_blunders_next_drill ON blunders (next_drill_at);
-- (Postgres idx_blunders_user_id (user_id) dropped: covered by the (user_id, …) indexes.)

-- ---------------------------------------------------------------------------
-- endgame_scenarios
-- ---------------------------------------------------------------------------
CREATE TABLE endgame_scenarios (
  id                TEXT PRIMARY KEY NOT NULL DEFAULT (
                      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                      substr(lower(hex(randomblob(2))), 2) || '-' ||
                      substr('89ab', 1 + (abs(random()) % 4), 1) ||
                      substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id           TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  game_id           TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  blunder_id        TEXT REFERENCES blunders (id) ON DELETE SET NULL,
  start_fen         TEXT NOT NULL,
  user_color        TEXT NOT NULL CHECK (user_color IN ('white', 'black')),
  deserved_result   TEXT NOT NULL CHECK (deserved_result IN ('win', 'draw')),
  actual_result     TEXT NOT NULL CHECK (actual_result IN ('loss', 'draw')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_played_at    TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_at       TEXT,
  retired_at        TEXT,
  verify_eval_cp    INTEGER,
  cycle_number      INTEGER NOT NULL DEFAULT 0,
  times_correct     INTEGER NOT NULL DEFAULT 0,
  times_attempted   INTEGER NOT NULL DEFAULT 0,
  last_drill_failed INTEGER NOT NULL DEFAULT 0 CHECK (last_drill_failed IN (0, 1)),
  last_drilled_at   TEXT,
  next_drill_at     TEXT,
  UNIQUE (user_id, game_id)
);
CREATE INDEX endgame_scenarios_blunder_id_idx ON endgame_scenarios (blunder_id);
CREATE INDEX endgame_scenarios_game_id_idx ON endgame_scenarios (game_id);
CREATE INDEX endgame_scenarios_unverified_idx ON endgame_scenarios (user_id)
  WHERE verified_at IS NULL AND retired_at IS NULL;
CREATE INDEX endgame_scenarios_user_due_idx ON endgame_scenarios (user_id, next_drill_at) WHERE retired_at IS NULL;
CREATE INDEX endgame_scenarios_user_idx ON endgame_scenarios (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- opening_deviations (one row per game)
-- ---------------------------------------------------------------------------
CREATE TABLE opening_deviations (
  id                   TEXT PRIMARY KEY NOT NULL DEFAULT (
                         lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                         substr(lower(hex(randomblob(2))), 2) || '-' ||
                         substr('89ab', 1 + (abs(random()) % 4), 1) ||
                         substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id              TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  game_id              TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  status               TEXT NOT NULL
                         CHECK (status IN ('user_left', 'opponent_left', 'theory_end', 'in_book', 'skipped')),
  rule_version         INTEGER NOT NULL,
  ply                  INTEGER,
  move_number          INTEGER,
  user_color           TEXT CHECK (user_color IN ('white', 'black')),
  fen_before           TEXT,
  epd_before           TEXT,
  played_uci           TEXT,
  played_san           TEXT,
  reason               TEXT CHECK (reason IN ('not_in_book', 'losing_line', 'engine_rejected', 'past_book')),
  theory_moves         TEXT CHECK (theory_moves IS NULL OR json_valid(theory_moves)),
  position_games       INTEGER,
  played_games         INTEGER,
  played_mover_win_pct REAL,
  eval_before          INTEGER,
  eval_after           INTEGER,
  chances_lost         REAL,
  classification       TEXT CHECK (classification IN ('good', 'inaccuracy', 'mistake', 'blunder')),
  eval_depth           INTEGER,
  evaluated_at         TEXT,
  blunder_id           TEXT REFERENCES blunders (id) ON DELETE SET NULL,
  opening_family       TEXT,
  opening_name         TEXT,
  eco                  TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  book_tier            TEXT CHECK (book_tier IN ('otb', 'elite')),
  book_end_ply         INTEGER,
  past_book_checked_at TEXT,
  UNIQUE (user_id, game_id)
);
CREATE INDEX opening_deviations_blunder_id_idx ON opening_deviations (blunder_id);
CREATE INDEX opening_deviations_epd_idx ON opening_deviations (user_id, epd_before);
CREATE INDEX opening_deviations_family_idx ON opening_deviations (user_id, opening_family);
CREATE INDEX opening_deviations_game_id_idx ON opening_deviations (game_id);
CREATE INDEX opening_deviations_past_book_idx ON opening_deviations (user_id)
  WHERE book_end_ply IS NOT NULL AND past_book_checked_at IS NULL;
CREATE INDEX opening_deviations_pending_eval_idx ON opening_deviations (user_id)
  WHERE status = 'user_left' AND evaluated_at IS NULL;

-- ---------------------------------------------------------------------------
-- repertoire_moves
-- ---------------------------------------------------------------------------
CREATE TABLE repertoire_moves (
  id         TEXT PRIMARY KEY NOT NULL DEFAULT (
               lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
               substr(lower(hex(randomblob(2))), 2) || '-' ||
               substr('89ab', 1 + (abs(random()) % 4), 1) ||
               substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id    TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  color      TEXT NOT NULL CHECK (color IN ('white', 'black')),
  epd        TEXT NOT NULL,
  uci        TEXT NOT NULL,
  san        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, color, epd)
);
CREATE INDEX repertoire_moves_user_color_idx ON repertoire_moves (user_id, color);

-- ---------------------------------------------------------------------------
-- training_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE training_sessions (
  id                 TEXT PRIMARY KEY NOT NULL DEFAULT (
                       lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                       substr(lower(hex(randomblob(2))), 2) || '-' ||
                       substr('89ab', 1 + (abs(random()) % 4), 1) ||
                       substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id            TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  started_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at           TEXT,
  local_date         TEXT NOT NULL,
  blunders_attempted INTEGER NOT NULL DEFAULT 0,
  blunders_correct   INTEGER NOT NULL DEFAULT 0,
  cycles_completed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX training_sessions_user_local_date_idx ON training_sessions (user_id, local_date);
CREATE INDEX training_sessions_user_started_idx ON training_sessions (user_id, started_at DESC);
-- Rolling-window aggregates (public leaderboard, admin KPIs) scan by time.
CREATE INDEX training_sessions_started_idx ON training_sessions (started_at);

-- ---------------------------------------------------------------------------
-- game_annotations
--   FIX: the client upserts ON CONFLICT (game_id), but Postgres only had the
--   expression index (game_id, COALESCE(user_id, zero-uuid)), so the upsert
--   could never work. A game belongs to exactly one user, so game_id is
--   unique. user_id gets ON DELETE CASCADE (Postgres had NO ACTION, which
--   blocked deleting a user who had annotations).
-- ---------------------------------------------------------------------------
CREATE TABLE game_annotations (
  id          TEXT PRIMARY KEY NOT NULL DEFAULT (
                lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                substr(lower(hex(randomblob(2))), 2) || '-' ||
                substr('89ab', 1 + (abs(random()) % 4), 1) ||
                substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  game_id     TEXT NOT NULL UNIQUE REFERENCES games (id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES user (id) ON DELETE CASCADE,
  annotations TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(annotations)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX game_annotations_user_id_idx ON game_annotations (user_id);

-- ---------------------------------------------------------------------------
-- supporters (Stripe mirror)
-- ---------------------------------------------------------------------------
CREATE TABLE supporters (
  user_id                TEXT PRIMARY KEY NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  stripe_customer_id     TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT,
  status                 TEXT NOT NULL DEFAULT 'none',
  current_period_end     TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  first_supported_at     TEXT,
  beta_invited_at        TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- funnel_events (anonymous landing analytics)
-- ---------------------------------------------------------------------------
CREATE TABLE funnel_events (
  id         TEXT PRIMARY KEY NOT NULL DEFAULT (
               lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
               substr(lower(hex(randomblob(2))), 2) || '-' ||
               substr('89ab', 1 + (abs(random()) % 4), 1) ||
               substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  anon_id    TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('landing_view', 'demo_submit', 'cta_click', 'lead_return')),
  platform   TEXT,
  username   TEXT,
  user_agent TEXT,
  referrer   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source     TEXT
);
CREATE INDEX funnel_events_anon_idx ON funnel_events (anon_id);
CREATE INDEX funnel_events_type_created_idx ON funnel_events (type, created_at);
CREATE INDEX funnel_events_username_idx ON funnel_events (username) WHERE username IS NOT NULL;

-- ---------------------------------------------------------------------------
-- email_sends (bigint identity -> INTEGER PRIMARY KEY, i.e. the rowid)
-- ---------------------------------------------------------------------------
CREATE TABLE email_sends (
  id          INTEGER PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('confirm', 'welcome', 'ready', 'streak_at_risk',
                                            'daily_plan', 'weekly_report', 'reminder', 'report')),
  to_email    TEXT NOT NULL,
  provider_id TEXT,
  sent_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX email_sends_user_sent_idx ON email_sends (user_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- email_confirmations
-- ---------------------------------------------------------------------------
CREATE TABLE email_confirmations (
  token      TEXT PRIMARY KEY NOT NULL DEFAULT (
               lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
               substr(lower(hex(randomblob(2))), 2) || '-' ||
               substr('89ab', 1 + (abs(random()) % 4), 1) ||
               substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  user_id    TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- NEW: the Worker deletes confirmations by user_id (and the FK cascade needs it).
CREATE INDEX email_confirmations_user_idx ON email_confirmations (user_id);

-- ---------------------------------------------------------------------------
-- event_digest_subscribers (owned by the ChessEventsData site)
-- ---------------------------------------------------------------------------
CREATE TABLE event_digest_subscribers (
  id              TEXT PRIMARY KEY NOT NULL DEFAULT (
                    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                    substr(lower(hex(randomblob(2))), 2) || '-' ||
                    substr('89ab', 1 + (abs(random()) % 4), 1) ||
                    substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  -- Postgres: ~* email regex AND length(email) <= 254. Validate in the Worker.
  email           TEXT NOT NULL CHECK (email LIKE '%_@_%._%' AND length(email) <= 254),
  country         TEXT NOT NULL DEFAULT 'US',
  region          TEXT,
  source_path     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed')),
  confirm_token   TEXT NOT NULL DEFAULT (
                    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                    substr(lower(hex(randomblob(2))), 2) || '-' ||
                    substr('89ab', 1 + (abs(random()) % 4), 1) ||
                    substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  unsub_token     TEXT NOT NULL DEFAULT (
                    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
                    substr(lower(hex(randomblob(2))), 2) || '-' ||
                    substr('89ab', 1 + (abs(random()) % 4), 1) ||
                    substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at    TEXT,
  unsubscribed_at TEXT,
  last_sent_at    TEXT
);
CREATE INDEX event_digest_subscribers_active_idx ON event_digest_subscribers (country, region) WHERE status = 'active';
CREATE UNIQUE INDEX event_digest_subscribers_confirm_key ON event_digest_subscribers (confirm_token);
CREATE UNIQUE INDEX event_digest_subscribers_email_key ON event_digest_subscribers (lower(email));
CREATE UNIQUE INDEX event_digest_subscribers_unsub_key ON event_digest_subscribers (unsub_token);

-- ---------------------------------------------------------------------------
-- lead_outreach (admin win-back)
-- ---------------------------------------------------------------------------
CREATE TABLE lead_outreach (
  lead_key     TEXT PRIMARY KEY NOT NULL,
  segment      TEXT NOT NULL,
  contacted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  note         TEXT
);

-- ---------------------------------------------------------------------------
-- singleton caches (landing_stats(), public_leaderboard())
-- ---------------------------------------------------------------------------
CREATE TABLE landing_stats_cache (
  id          INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE public_leaderboard_cache (
  id          INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- benchmarks (global, read-only for users)
-- ---------------------------------------------------------------------------
CREATE TABLE benchmarks (
  kind        TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  value       REAL NOT NULL,
  sample_size INTEGER NOT NULL,
  source      TEXT,
  PRIMARY KEY (kind, bucket)
);
