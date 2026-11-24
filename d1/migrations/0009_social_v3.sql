-- Social videos v3 (scripts/social/): two posts a day and YouTube Shorts.
--
-- slot          0 = the puzzle series (noon ET: blunder / fall), 1 = "Blunders
--               decide games" (evening ET). One live row per (day, slot).
-- format        adds 'pro': a famous player's deciding blunder, rebuilt from the
--               public game record. blunder_id = 'pro:<source>:<game id>'.
-- buffer_yt_post_id / youtube_title / youtube_caption / yt_status: the YouTube Short via Buffer.
--
-- SQLite can't change a CHECK constraint in place, so the table is rebuilt.
-- It is D1-native (no FKs point at it, none from it) and small.
CREATE TABLE social_posts_v3 (
  id                    TEXT PRIMARY KEY NOT NULL,
  blunder_id            TEXT NOT NULL,
  fen                   TEXT NOT NULL,
  scheduled_for         TEXT,
  slot                  INTEGER NOT NULL DEFAULT 0 CHECK (slot IN (0, 1)),
  status                TEXT NOT NULL CHECK (status IN ('queued', 'vetoed', 'posted', 'failed', 'rejected')),
  reject_reason         TEXT,
  hook_template         TEXT,
  motif                 TEXT,
  caption               TEXT,
  tiktok_caption        TEXT,
  youtube_title         TEXT,
  youtube_caption       TEXT,
  puzzle                TEXT CHECK (puzzle IS NULL OR json_valid(puzzle)),
  media_url             TEXT,
  poster_url            TEXT,
  ig_media_id           TEXT,
  permalink             TEXT,
  ig_error              TEXT,
  tiktok_publish_id     TEXT,
  tiktok_status         TEXT,
  tiktok_error          TEXT,
  plays                 INTEGER,
  reach                 INTEGER,
  likes                 INTEGER,
  comments              INTEGER,
  saves                 INTEGER,
  shares                INTEGER,
  insights_at           TEXT,
  posted_at             TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  format                TEXT NOT NULL DEFAULT 'blunder' CHECK (format IN ('blunder', 'fall', 'pro')),
  fell_count            INTEGER,
  script                TEXT CHECK (script IS NULL OR json_valid(script)),
  script_source         TEXT CHECK (script_source IS NULL OR script_source IN ('claude', 'template')),
  voice                 TEXT,
  buffer_ig_post_id     TEXT,
  buffer_tiktok_post_id TEXT,
  buffer_yt_post_id     TEXT,
  yt_status             TEXT,
  buffer_error          TEXT
);

INSERT INTO social_posts_v3 (
  id, blunder_id, fen, scheduled_for, status, reject_reason, hook_template, motif, caption, tiktok_caption,
  puzzle, media_url, poster_url, ig_media_id, permalink, ig_error, tiktok_publish_id, tiktok_status, tiktok_error,
  plays, reach, likes, comments, saves, shares, insights_at, posted_at, created_at,
  format, fell_count, script, script_source, voice, buffer_ig_post_id, buffer_tiktok_post_id, buffer_error
)
SELECT
  id, blunder_id, fen, scheduled_for, status, reject_reason, hook_template, motif, caption, tiktok_caption,
  puzzle, media_url, poster_url, ig_media_id, permalink, ig_error, tiktok_publish_id, tiktok_status, tiktok_error,
  plays, reach, likes, comments, saves, shares, insights_at, posted_at, created_at,
  format, fell_count, script, script_source, voice, buffer_ig_post_id, buffer_tiktok_post_id, buffer_error
FROM social_posts;

DROP TABLE social_posts;
ALTER TABLE social_posts_v3 RENAME TO social_posts;

CREATE UNIQUE INDEX social_posts_blunder_idx ON social_posts (blunder_id);
-- One live post per day and slot; vetoed / rejected / failed rows don't hold it.
CREATE UNIQUE INDEX social_posts_slot_idx ON social_posts (scheduled_for, slot)
  WHERE status IN ('queued', 'posted');
