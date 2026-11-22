# patternchess-notifier

Cloudflare Worker behind `email.patternchess.com`: the hourly training
reminders / weekly reports, plus the no-login `/settings`, `/unsubscribe` and
`/confirm` pages. See CLAUDE.md ("Email") for the product rules.

## Data: the app D1 (since 2026-11-22)

The Worker reads and writes the app D1 `patternchess-app` through the `DB`
binding in `wrangler.jsonc` (the same database the Pages Functions use). The
Postgres functions it used to call over PostgREST are ported to TypeScript:

| Postgres (Supabase)                       | Here                                   |
|-------------------------------------------|----------------------------------------|
| `email_candidates` / `email_outbox`       | `store.ts` (facts SQL) + `rules.ts` (decisions) |
| `email_report_data`                       | `store.ts` `reportData`                |
| `email_prefs_json` + token RPCs           | `store.ts` `prefsJson`, `prefsByToken`, `updatePrefsByToken`, `unsubscribeByToken`, `confirmEmail` |
| `email_sends` / `email_confirmations` REST | `store.ts` `logSend`, `newConfirmToken` |

Addresses come from better-auth's `user` table; Lichess sign-ins carry the
placeholder `<id>@lichess.invalid`, which counts as "no address" (as Supabase's
empty email did). A confirmed `profiles.contact_email` still wins.

Parity: on 2026-11-22 the TS engine was run against the local D1 copy of
production and compared with live `email_candidates(t, user)` for all 184
players at five hours (Sunday report hour, weekday morning/evening): identical
kinds, recipients, due/fresh counts and report numbers.

## Deploying — only at the cutover

**Do not deploy this version until the Supabase -> Cloudflare cutover.**
Production keeps running the previous (Supabase) build until then; this one
would read a D1 copy that stops being current and log sends there.

At the cutover, after the final `migrate:import -- --remote --fresh` (d1/README.md):

```sh
cd ~ && npx --prefix ~/PatternChess wrangler deploy --config ~/PatternChess/workers/notifier/wrangler.jsonc
npx --prefix ~/PatternChess wrangler secret delete SUPABASE_SERVICE_ROLE_KEY --config ~/PatternChess/workers/notifier/wrangler.jsonc
```

`ADMIN_SECRET` stays as is. `SEND_MODE` keeps its meaning: anything but
`"live"` sends only to `TEST_RECIPIENTS`. A dry run right after deploying:
`curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" "https://email.patternchess.com/admin/run?dryRun=1"`.

## Local

```sh
npm run typecheck:notifier
npx vitest run workers/notifier     # rules.test.ts (every rule), store.test.ts (SQL on the real schema), outbox.test.ts
npx wrangler dev --config workers/notifier/wrangler.jsonc --local --port 8791 \
  --persist-to .wrangler/state --var SEND_MODE:test     # uses the local D1 copy (scripts/dev-api.sh's)
```

`.dev.vars` here holds `ADMIN_SECRET` for `/admin/*`.
