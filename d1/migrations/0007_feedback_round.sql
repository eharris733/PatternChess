-- Feedback round 2 (2026-11-23). Additive only: preview and production share
-- this database.

-- OTB events by country (src/lib/eventRegions.ts): the events.patternchess.com
-- country code a player wants tournaments for ('CA', 'GB-ENG', 'US', …).
-- events_state stays the US state. NULL = not chosen; a lone events_state
-- (rows from before countries) means the US. Written through profile.update
-- (PROFILE_WRITABLE validates against EVENT_COUNTRIES).
ALTER TABLE profiles ADD COLUMN events_country TEXT
  CHECK (events_country IS NULL OR (length(events_country) BETWEEN 2 AND 6 AND events_country = upper(events_country)));

-- Achievement unlocks, recorded by the client when it sees a new one
-- (achievements.record), so achievements.rarity can say "12% of players".
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  earned_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS user_achievements_achievement_idx ON user_achievements (achievement_id);

-- achievements.rarity result, recomputed at most hourly.
CREATE TABLE IF NOT EXISTS achievement_rarity_cache (
  id          INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  payload     TEXT NOT NULL CHECK (json_valid(payload)),
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Alerting (workers/notifier/src/alerts.ts): one row per health check.
CREATE TABLE IF NOT EXISTS alert_state (
  check_id             TEXT PRIMARY KEY NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failing_since        TEXT,
  last_alert_at        TEXT,
  last_error           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Unexpected RPC failures per hour and handler (functions/_shared/rpc/core.ts),
-- read by the notifier's alert check. hour = 'YYYY-MM-DDTHH' (UTC).
CREATE TABLE IF NOT EXISTS rpc_errors (
  hour  TEXT NOT NULL,
  name  TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, name)
);
