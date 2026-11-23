-- Daily puzzle video queue (Instagram Reel + TikTok inbox draft), filled and
-- published by scripts/social/ from a GitHub Actions cron; reviewed (veto /
-- restore) on /analytics via admin.socialQueue / admin.socialSetStatus.
--
-- D1-native (no Supabase counterpart), so scripts/migrate never touches it.
-- blunder_id deliberately has no FK: `migrate:import --fresh` deletes and
-- re-inserts blunders, and this table must keep its history across that.
CREATE TABLE social_posts (
  id                TEXT PRIMARY KEY NOT NULL,
  blunder_id        TEXT NOT NULL,
  fen               TEXT NOT NULL,
  -- YYYY-MM-DD (UTC) the post goes out; NULL for rejected candidates.
  scheduled_for     TEXT,
  status            TEXT NOT NULL CHECK (status IN ('queued', 'vetoed', 'posted', 'failed', 'rejected')),
  reject_reason     TEXT,
  hook_template     TEXT,
  motif             TEXT,
  caption           TEXT,
  tiktok_caption    TEXT,
  -- Everything the renderer drew (side, rating, moves, labels) for the review card.
  puzzle            TEXT CHECK (puzzle IS NULL OR json_valid(puzzle)),
  media_url         TEXT,
  poster_url        TEXT,
  ig_media_id       TEXT,
  permalink         TEXT,
  ig_error          TEXT,
  tiktok_publish_id TEXT,
  tiktok_status     TEXT,
  tiktok_error      TEXT,
  plays             INTEGER,
  reach             INTEGER,
  likes             INTEGER,
  comments          INTEGER,
  saves             INTEGER,
  shares            INTEGER,
  insights_at       TEXT,
  posted_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX social_posts_blunder_idx ON social_posts (blunder_id);
-- One live post per day; vetoed / rejected / failed rows don't hold the slot.
CREATE UNIQUE INDEX social_posts_slot_idx ON social_posts (scheduled_for)
  WHERE status IN ('queued', 'posted');
