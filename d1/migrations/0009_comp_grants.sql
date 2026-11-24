-- supporter_grants: allow source 'comp', Supporter perks given by hand (the
-- owner, friends, testers). SQLite can't alter a CHECK, so the table is
-- rebuilt; nothing references it, and its rows and indexes carry over.
-- Comp rows have referee_id NULL, so the referral unique index and
-- referralRewardSummary (source = 'referral') ignore them.
CREATE TABLE supporter_grants_new (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('referral', 'comp')),
  referee_id  TEXT REFERENCES user (id) ON DELETE SET NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO supporter_grants_new (id, user_id, source, referee_id, starts_at, ends_at, created_at)
  SELECT id, user_id, source, referee_id, starts_at, ends_at, created_at FROM supporter_grants;
DROP TABLE supporter_grants;
ALTER TABLE supporter_grants_new RENAME TO supporter_grants;
CREATE INDEX supporter_grants_user_idx ON supporter_grants (user_id, ends_at);
CREATE UNIQUE INDEX supporter_grants_referee_idx ON supporter_grants (source, referee_id) WHERE referee_id IS NOT NULL;
