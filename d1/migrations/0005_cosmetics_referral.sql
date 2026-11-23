-- Personalization + the referral reward (feedback round, 2026-11-22).
--
-- profiles:
--   avatar               the pixel avatar's parts (src/lib/avatar.ts), JSON;
--                        NULL = the default one generated from the player's id.
--   piece_set            src/lib/pieceSets.ts id; NULL = cburnett (the default).
--   theme                the app/board theme (src/state/themeStore.ts). Added
--                        because board_theme's CHECK only allows the first five
--                        themes and SQLite can't relax a CHECK without
--                        rebuilding the table. NULL = fall back to board_theme.
--   path_rewards_claimed path rungs whose streak-freeze reward was granted
--                        (profile.claimPathReward), JSON array of rung numbers.
--
-- supporter_grants: Supporter perks given without Stripe (today only the
-- referral reward: 3 months to the referrer when a referred friend trains 20
-- positions, stacking to 12 months ahead). The perk rule is "an active Stripe
-- subscription OR an active grant" (functions/_shared/supporters.ts
-- hasSupporterPerks). D1-native, so scripts/migrate never touches it.
ALTER TABLE profiles ADD COLUMN avatar TEXT CHECK (avatar IS NULL OR json_valid(avatar));
ALTER TABLE profiles ADD COLUMN piece_set TEXT;
ALTER TABLE profiles ADD COLUMN theme TEXT;
ALTER TABLE profiles ADD COLUMN path_rewards_claimed TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(path_rewards_claimed));

CREATE TABLE supporter_grants (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('referral')),
  -- The referred friend whose training earned it; one grant per friend.
  referee_id  TEXT REFERENCES user (id) ON DELETE SET NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX supporter_grants_user_idx ON supporter_grants (user_id, ends_at);
CREATE UNIQUE INDEX supporter_grants_referee_idx ON supporter_grants (source, referee_id) WHERE referee_id IS NOT NULL;
