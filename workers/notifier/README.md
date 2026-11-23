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

## Deploying

The cutover is done: the deployed Worker has been this D1 build since
2026-11-23 (`SUPABASE_SERVICE_ROLE_KEY` deleted). Deploy changes with the
first command below; run any new D1 migration remotely first. The original
cutover steps were:

```sh
cd ~ && npx --prefix ~/PatternChess wrangler deploy --config ~/PatternChess/workers/notifier/wrangler.jsonc
npx --prefix ~/PatternChess wrangler secret delete SUPABASE_SERVICE_ROLE_KEY --config ~/PatternChess/workers/notifier/wrangler.jsonc
```

`ADMIN_SECRET` stays as is. `SEND_MODE` keeps its meaning: anything but
`"live"` sends only to `TEST_RECIPIENTS`. A dry run right after deploying:
`curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" "https://email.patternchess.com/admin/run?dryRun=1"`.

## Events near you (weekly_report)

Players who saved a US state (`profiles.events_state`, picked on the
dashboard's Upcoming OTB events card) get an "Events near you" section at the
end of the weekly report: up to 5 OTB tournaments in that state over the next
14 days, one line each (title, date, club, link), plus a link to the state's
page. Listings only, no pitch. `events.ts` reads the public
`events.patternchess.com/api/events?state=XX&to=…` at send time, once per
state per run (4 s timeout); any failure leaves the section out and the report
still goes. The rule (`eventsStateFor`) lives in `rules.ts`; the state names
are a copy of `src/lib/usStates.ts` (`usStates.ts`, parity-tested in
`events.test.ts`). `EVENTS_URL` (optional var) overrides the API origin.

## Local

```sh
npm run typecheck:notifier
npx vitest run workers/notifier     # rules.test.ts (every rule), store.test.ts (SQL on the real schema), outbox.test.ts, events.test.ts
node --experimental-strip-types workers/notifier/scripts/preview.ts out    # every template; EVENTS_STATE=MA for live events
npx wrangler dev --config workers/notifier/wrangler.jsonc --local --port 8791 \
  --persist-to .wrangler/state --var SEND_MODE:test     # uses the local D1 copy (scripts/dev-api.sh's)
```

`.dev.vars` here holds `ADMIN_SECRET` for `/admin/*`.
