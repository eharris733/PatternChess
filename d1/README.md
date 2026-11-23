# D1 app database (`patternchess-app`)

The Cloudflare D1 database that replaces Supabase Postgres. Bound as **`DB`** on
the `patternchess` Pages project (id `7d359ac5-7829-4a4d-8fa9-5af6379cdf15`,
account `3a7d5866…`). The opening book is a separate D1 (`patternchess-book`,
bound as `BOOK`).

```
d1/
  wrangler.jsonc          config for D1 commands only (not a deploy config; the
                          Pages project stays dashboard-configured)
  migrations/0001_app.sql the 17 app tables (ported from Supabase `public`)
  migrations/0002_auth.sql better-auth 1.7 tables: user, session, account,
                          verification, rateLimit
  migrations/0003_social_posts.sql  daily puzzle video queue (scripts/social/)
  migrations/0004_events_state.sql  profiles.events_state
  migrations/0005_cosmetics_referral.sql  avatars, piece sets, supporter_grants
  migrations/0006_courses.sql course_progress + course_focus (/courses)
functions/_shared/schema.ts  decode map: TABLES + decodeRow/encodeRow
scripts/migrate/          export-supabase.mjs, import-d1.mjs, verify.mjs, lib.mjs
data/migrate/             export JSONL + generated SQL (gitignored, user data)
```

Run every wrangler command from the repo root. Wrangler's OAuth login spans
several accounts, so set the account first (the import scripts do this
themselves from `.env.local`, and drop its stale `CLOUDFLARE_API_TOKEN`):

```sh
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' .env.local | cut -d= -f2); unset CLOUDFLARE_API_TOKEN
```

## Migrations

```sh
# remote (preview + production share this one database)
npx wrangler d1 migrations apply patternchess-app --remote --config d1/wrangler.jsonc

# local, for `wrangler pages dev` / scripts/dev-api.sh
npx wrangler d1 migrations apply patternchess-app --local --config d1/wrangler.jsonc --persist-to .wrangler/state

# ad-hoc query
npx wrangler d1 execute patternchess-app --remote --config d1/wrangler.jsonc --command "SELECT count(*) FROM games"
```

New migrations go in `d1/migrations/NNNN_name.sql` (SQLite). 0001-0003 are
applied remotely as of 2026-11-22. feat/courses' original `0003_courses.sql` may
also have been applied remotely from that branch: `0006_courses.sql` replaces it
and is idempotent (`IF NOT EXISTS`, no `ALTER TABLE`), so it applies either way;
a leftover `profiles.course_focus` column, if any, is unused.

## Local development

`scripts/dev-api.sh` applies pending migrations to the local store and starts
`wrangler pages dev` on :8788 with `--d1 DB=7d359ac5-7829-4a4d-8fa9-5af6379cdf15
--persist-to .wrangler/state`. Miniflare keys the local SQLite file by database
id, so `wrangler d1 … --local --config d1/wrangler.jsonc --persist-to
.wrangler/state` and `pages dev --d1 DB=<same id> --persist-to .wrangler/state`
read and write the same file
(`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/67b27de7….sqlite`).

Without the script:

```sh
npx wrangler d1 migrations apply patternchess-app --local --config d1/wrangler.jsonc --persist-to .wrangler/state
npx wrangler pages dev dist --port 8788 --compatibility-date=2026-06-18 --compatibility-flags=nodejs_compat \
  --d1 DB=7d359ac5-7829-4a4d-8fa9-5af6379cdf15 --kv AUTH_KV --persist-to .wrangler/state
```

### Reloading the local copy of production data

The local DB holds a full copy of production data (loaded 2026-11-22). To
refresh it from Supabase:

```sh
npm run migrate:export                          # Supabase -> data/migrate/*.jsonl (~2 min)
npm run migrate:import -- --local --fresh       # wipe local rows, load (~45 s)
node scripts/migrate/verify.mjs --local         # counts + spot checks + accounts
```

`--fresh` deletes **every** row first, including better-auth users created by
local test sign-ins. Sessions live in the `AUTH_KV` namespace, not D1, so they
are never imported (everyone signs in again after the move).

## Type mapping (Postgres -> SQLite)

| Postgres | D1 | API shape (after `decodeRow`) |
|---|---|---|
| `uuid` | `TEXT` (lowercase, hyphenated) | string |
| `timestamptz` | `TEXT`, ISO 8601 UTC with ms: `2026-11-22T03:16:41.851Z` | string |
| `jsonb` | `TEXT` JSON, `json_valid` CHECK | parsed value |
| `text[]` | `TEXT` JSON array, `json_valid` CHECK | array |
| `boolean` | `INTEGER` 0/1, `IN (0, 1)` CHECK | boolean |
| `int` / `smallint` / `bigint` | `INTEGER` | number |
| `real` / `numeric` | `REAL` | number |

- One timestamp format everywhere so string comparison equals time order.
  `encodeRow` normalizes any input (Date, epoch ms, PostgREST's
  `…034104+00:00`) to it; Postgres microseconds are truncated to ms.
- SQLite defaults stand in for `gen_random_uuid()` (a v4 UUID expression),
  `now()` (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`) and `gen_referral_code()`
  (8 random chars from the same alphabet). The API should still generate them
  in TS (`crypto.randomUUID()`, `new Date().toISOString()`); the defaults are a
  safety net.
- `email_sends.id` (bigint identity) is `INTEGER PRIMARY KEY` (rowid).

## Differences from the Postgres schema

- **`games.time_category`** (new): `bullet | blitz | rapid | classical | NULL`,
  from `timeCategory(time_control)` in `functions/_shared/schema.ts` (exact
  parity with the Postgres regex and the client's `categoryForTimeControl`;
  quirk kept: "1 day per move" parses as 1 s, so bullet). Filled at import;
  `encodeRow('games', …)` fills it whenever `time_control` is written, so
  inserts through `encodeRow` need nothing extra. Index
  `games_user_category_idx (user_id, time_category, played_at)`.
- **`game_annotations`**: `game_id` is `UNIQUE`, the conflict target the
  client's upsert names (`onConflict: 'game_id'`); Postgres only had the
  `(game_id, COALESCE(user_id, zero))` expression index, so the upsert always
  failed. `user_id` is now `ON DELETE CASCADE` (Postgres: NO ACTION, which
  blocked deleting such users).
- **Foreign keys to `auth.users`** point at better-auth's `user(id)` with the
  same ON DELETE actions as Postgres (CASCADE, except `games.user_id` and
  `blunders.user_id`, which stay SET NULL). SQLite resolves FK parents at write
  time, so 0001 can reference `user` before 0002 creates it. D1 enforces FKs.
- **Email CHECKs**: the `~*` regex checks on `profiles.contact_email` and
  `event_digest_subscribers.email` became a loose `LIKE '%_@_%._%'` (SQLite
  has no REGEXP). Validate properly in the Worker.
- **Not ported** (move to Worker code): RLS, the `profiles_guard_email_columns`
  trigger (column allowlist on profile updates), all Postgres functions/RPCs.
- **Indexes**: all Postgres indexes kept (partial ones as SQLite partial
  indexes, `lower(email)` as an expression index) except the plain
  `(user_id)` indexes on `games` and `blunders`, which composite indexes
  starting with `user_id` cover. Added: `email_confirmations (user_id)`,
  `training_sessions (started_at)`, `games_user_category_idx`, and
  `account (providerId, accountId)` UNIQUE.

## Users and accounts (better-auth)

- `user.id` = Supabase `auth.users.id`, verbatim.
- `user.email` = the real email, lowercased (better-auth lowercases on lookup).
  Lichess sign-ins have no email, so they get `<lichessId>@lichess.invalid`.
- `user.emailVerified` = 1 for every Google user, 0 for every Lichess user
  (the auth layer reads the provider from this: placeholder email -> lichess,
  emailVerified 1 -> google, else email/password).
- `user.name` = `full_name` / `name` / `preferred_username` from
  user_metadata; `user.image` = `avatar_url` / `picture`.
- `account`: one row per Supabase identity (0 users had more than one).
  `id` = `identity_id`; Google: `providerId 'google'`, `accountId` = Google
  `sub`; Lichess: `providerId 'lichess'`, `accountId` = the Lichess account
  `id` (lowercased username), which is what the `lichess-userinfo` edge
  function returned as `sub` and what `https://lichess.org/api/account`
  returns as `id`. No tokens are copied.

## Export / import (and the cutover)

`npm run migrate:export` reads `VITE_SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
from `.env.local` (read-only GETs). Tables page through PostgREST 1000 rows at
a time, keyset-ordered by primary key, children before parents, then auth
users through the GoTrue admin API (list, then one GET per user for
identities). Writes `data/migrate/<table>.jsonl`, `auth_users.jsonl` and
`manifest.json`.

`npm run migrate:import -- (--remote | --local) [--fresh] [--resume-from N] [--sql-only]`
turns the JSONL into `data/migrate/sql/NNN-<table>.sql` (literal values, no
bound params; statements < 90 KB, files ~8 MB) and runs each through
`wrangler d1 execute --file` with up to 6 retries. Order: `--fresh` deletes
(children first, chunked 5000 rows), `user`, `account`, `profiles`
(`referred_by` in a second UPDATE pass), `games`, `blunders`, the rest.
Inserts are `ON CONFLICT DO NOTHING`, so re-running a half-applied file is
safe; `--resume-from N` skips files numbered below N. Dangling references from
writes during the export are dropped or nulled per the FK's ON DELETE rule and
reported. It ends with a per-table count check against what it generated.

`node scripts/migrate/verify.mjs --remote|--local` compares row counts with
live Supabase, spot-checks first/middle/last rows of every table field by
field, and checks every user has exactly one correct account row.

Final cutover (writes frozen): `npm run migrate:export && npm run migrate:import -- --remote --fresh && node scripts/migrate/verify.mjs --remote`.
