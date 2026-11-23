-- Daily social video v2 (scripts/social/): two formats, a narrated script,
-- and publishing through Buffer. Additive only.
--
-- format      'blunder' (one of the owner's blunders) | 'fall' (a move several
--             PatternChess players got wrong in the same position). Fall rows
--             use blunder_id = 'trap:<epd>|<uci>', so the existing unique index
--             on blunder_id also dedups traps (and remembers rejected ones).
-- fell_count  fall only: how many different players made the move.
-- script      the voiceover script (JSON: hookStyle, headline, subline, beats, captionLead).
-- script_source 'claude' | 'template'; voice = the Kokoro voice id.
-- buffer_*    the Buffer post per channel and the last publishing error.
--
-- Numbered 0008 because 0007 is taken by feat/feedback-round-2.
ALTER TABLE social_posts ADD COLUMN format TEXT NOT NULL DEFAULT 'blunder' CHECK (format IN ('blunder', 'fall'));
ALTER TABLE social_posts ADD COLUMN fell_count INTEGER;
ALTER TABLE social_posts ADD COLUMN script TEXT CHECK (script IS NULL OR json_valid(script));
ALTER TABLE social_posts ADD COLUMN script_source TEXT CHECK (script_source IS NULL OR script_source IN ('claude', 'template'));
ALTER TABLE social_posts ADD COLUMN voice TEXT;
ALTER TABLE social_posts ADD COLUMN buffer_ig_post_id TEXT;
ALTER TABLE social_posts ADD COLUMN buffer_tiktok_post_id TEXT;
ALTER TABLE social_posts ADD COLUMN buffer_error TEXT;
