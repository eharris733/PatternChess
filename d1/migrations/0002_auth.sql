-- better-auth 1.7.x core schema (SQLite / D1): user, session, account,
-- verification, plus rateLimit for `rateLimit.storage: 'database'`.
-- Same shape as FindLocal's web/migrations/0001_better_auth.sql minus its
-- FindLocal-only user columns. Field names follow
-- @better-auth/core/dist/db/get-tables.mjs (1.7.18).
--
-- Dates are ISO 8601 TEXT, booleans INTEGER 0/1.
--
-- Migrated users keep their Supabase auth.users.id as user.id (Stripe
-- metadata, email tokens and localStorage keys depend on it). Lichess users
-- have no email, so they get the placeholder `<lichessId>@lichess.invalid`
-- with emailVerified = 0 (see isPlaceholderEmail in functions/_shared/auth.ts).

CREATE TABLE IF NOT EXISTS user (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0 CHECK (emailVerified IN (0, 1)),
  image         TEXT,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id        TEXT PRIMARY KEY NOT NULL,
  expiresAt TEXT NOT NULL,
  token     TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId    TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_userId ON session (userId);

CREATE TABLE IF NOT EXISTS account (
  id                    TEXT PRIMARY KEY NOT NULL,
  accountId             TEXT NOT NULL,
  providerId            TEXT NOT NULL,
  userId                TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  TEXT,
  refreshTokenExpiresAt TEXT,
  scope                 TEXT,
  password              TEXT,
  createdAt             TEXT NOT NULL,
  updatedAt             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_userId ON account (userId);
-- OAuth sign-in looks accounts up by (providerId, accountId); one row per
-- provider identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider_account ON account (providerId, accountId);

CREATE TABLE IF NOT EXISTS verification (
  id         TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  TEXT NOT NULL,
  createdAt  TEXT,
  updatedAt  TEXT
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification (identifier);

CREATE TABLE IF NOT EXISTS rateLimit (
  id          TEXT PRIMARY KEY NOT NULL,
  key         TEXT NOT NULL UNIQUE,
  count       INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);
