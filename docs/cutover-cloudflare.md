# Cutover: Supabase → Cloudflare (D1 + better-auth)

> **Status (checked 2026-11-23): done.** Production (`patternchess.com`) runs the Cloudflare backend from
> `main` (PR #47 merged 2026-11-22): `/api/auth/ok` answers, the bundle has no Supabase client, and the
> notifier Worker runs the D1 build with `SUPABASE_SERVICE_ROLE_KEY` deleted (steps 2–4). Preview and
> production share D1 `patternchess-app`. Still open: production Stripe live keys (step 0; until then
> `/supporter` checkout works only on previews), confirming steps 6–7, and step 9 from 2026-12-06.
> The steps below are kept as the record of how it was done.

Everything is built on `feat/cloudflare-backend` and verified on its preview against a full copy of
production data. This runbook moves **production** over. It takes about 20 minutes; pick a quiet hour
(writes made on the old site between the final export and the new deploy going live are lost).

Supabase is never modified by any step here, so rolling back is always possible (step 8).

## 0. Before the day

- [ ] **Google OAuth client** `904456723586-nedgnl7nc0utc00dnvu3tmjgd216lk22` (Google Cloud Console →
      APIs & Services → Credentials): add the authorized redirect URI
      `https://patternchess.com/api/auth/callback/google`. Keep the Supabase one until step 9.
      Have the **client secret** ready (Credentials → the client → "Client secrets").
- [ ] Lichess needs nothing (public PKCE client `patternchess`).
- [ ] Stripe live (separate account recommended): live product + price, portal configuration, webhook
      endpoint `https://patternchess.com/api/stripe/webhook` with the 7 events in CLAUDE.md, restricted key.
- [ ] Merge order of the stacked PRs: #43 → #44 → #45 → #46 → `feat/cloudflare-backend` (→ `feat/courses`).

## 1. Production Pages environment (Cloudflare dashboard → Pages → patternchess → Settings)

Bindings (Production): D1 `DB` = `patternchess-app` (`7d359ac5-7829-4a4d-8fa9-5af6379cdf15`),
KV `AUTH_KV` = `patternchess-auth` (`98e21a428f824fed86c8902e063e82c5`) — `CONTENT` and `BOOK` already exist.
Compatibility flags (Production): `nodejs_compat`.

Secrets (Production) — `npx wrangler pages secret put <NAME> --project-name patternchess` from the repo root:

| Name | Value |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` (new; never reuse the preview one) |
| `BETTER_AUTH_URL` | `https://patternchess.com` |
| `GOOGLE_CLIENT_ID` | `904456723586-nedgnl7nc0utc00dnvu3tmjgd216lk22.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_PRICE_ID_ANNUAL`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PORTAL_CONFIG_ID` | live values |
| `EVENTS_DIGEST_SECRET` | `openssl rand -hex 32` (same value goes to ChessEventsData in step 6) |

Do **not** set `AUTH_TEST_MODE` on production.

## 2. Merge

Merge the PR stack to `main`. Cloudflare starts the production build (~3 min). From this moment the
site is on the new backend, but D1 still holds the snapshot from the night of 2026-11-22 — so do step 3
immediately.

## 3. Final data copy (re-runnable)

```bash
npm run migrate:export                                  # Supabase → data/migrate/*.jsonl (read-only)
npm run migrate:import -- --remote --fresh              # wipe D1 rows, reload everything
node scripts/migrate/verify.mjs --remote                # row counts + spot checks must all pass
```
`--fresh` deletes every D1 row (including preview test users). Sessions live in KV and are not copied,
so **everyone signs in once** after the cutover; their account and history are matched by id.

## 4. Notifier Worker

```bash
npx wrangler deploy --config workers/notifier/wrangler.jsonc
npx wrangler secret delete SUPABASE_SERVICE_ROLE_KEY --config workers/notifier/wrangler.jsonc
curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" "https://email.patternchess.com/admin/run?dryRun=1"
```

## 5. Smoke test production

- Signed out: landing numbers load, `/supporter`, `/faq`.
- Sign in with Google (an existing account → its own dashboard, history intact) and with Lichess.
- Train one position; open `/vault`, `/openings`, `/leaderboards`, `/analytics` (admin).
- `curl -s -X POST https://patternchess.com/api/rpc/landing.stats -H 'content-type: application/json' -d '{}'`

## 6. ChessEventsData

Merge `feat/patternchess-cloudflare-digest` in that repo, then from `web/`:
`npx wrangler secret put PATTERNCHESS_DIGEST_SECRET` (same value as `EVENTS_DIGEST_SECRET`) and `npm run deploy:web`.

## 7. Clean up the Pages env

Delete `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` from both environments.

## 8. Rollback (if step 5 fails)

Revert the merge on `main` (Cloudflare redeploys the Supabase version) and redeploy the previous notifier
(`git checkout <pre-cutover sha> -- workers/notifier && npx wrangler deploy --config workers/notifier/wrangler.jsonc`).
Supabase was never changed, but anything written to D1 after step 2 is not in Supabase.

## 9. After two quiet weeks

Remove the Supabase Google redirect URI, pause the Supabase project (keep a final `pg_dump` / the
`data/migrate/` export), and delete `supabase/` from the repo.
