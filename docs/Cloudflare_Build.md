# Deploying to Cloudflare Pages

PatternChess deploys as a static SPA built by Vite. Cloudflare Pages serves
`dist/` and applies the COEP/COOP headers from `public/_headers` so Stockfish
multi-threading works.

## Build configuration (Pages dashboard)

Settings → Builds & deployments → Build configurations:

- Framework preset: **None**
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: (empty)
- Environment variable: `NODE_VERSION=22.22.2` (matches `.nvmrc`)

Do **not** set the framework preset to "Vite". Cloudflare's Vite preset
auto-injects `@cloudflare/vite-plugin`, which is pinned to a Vite version that
no longer matches this project (we're on Vite 8). It will fail with
`The version of Vite used in the project ("X.Y.Z") cannot be automatically configured`.
Setting the preset to None bypasses that detection — `npm run build` builds the
app the same way it does locally.

If you change the build config, retry with **"Clear build cache"** to wipe any
stale `node_modules` from the previous preset.

## Required headers

`public/_headers`:

```
/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
```

Without these, the browser refuses to grant `crossOriginIsolated`, and
Stockfish drops to single-threaded.

## SPA routing

`public/_redirects` rewrites all paths to `/index.html` so React Router can
take over.

## Manual deploy (without git)

```
npm run build
npx wrangler pages deploy dist --project-name=pattern-chess
```

`_headers` and `_redirects` from `public/` end up in `dist/` automatically via
Vite's `publicDir` copy.

## Pages Functions (link previews)

`functions/p.ts` is a Cloudflare Pages Function that intercepts `GET /p` and
rewrites the Open Graph / Twitter meta tags per shared puzzle (title,
description, and an `og:image` pointing at Lichess's public FEN→GIF export,
`https://lichess.org/export/fen.gif`). Link unfurlers don't run JS, so this is
the only way shared links get position-specific previews. The SPA behavior is
unchanged — the function streams the body through untouched and `PuzzleRoute`
still decodes the payload client-side.

Notes:

- The root `functions/` directory is picked up automatically by both
  `wrangler pages deploy dist` and git builds — no build-config change needed.
- `wrangler.toml` (repo root) pins `pages_build_output_dir` and
  `compatibility_date`. Once it lands, Cloudflare treats it as the source of
  truth for the Pages project config; the values match the current dashboard
  settings, but watch the first deploy after any change to it.
- `public/_headers` applies only to statically-served assets, **not** to
  Function responses — `functions/p.ts` re-emits the three COEP/COOP/CORP
  headers itself. If you ever edit `_headers`, mirror the change there.
- Type-check with `npm run typecheck:functions`. Test locally with
  `npm run pages:dev` (builds, then serves `dist/` + functions at
  `http://localhost:8788`).
- If lichess.org's export endpoint is down or rate-limits, previews lose their
  image but the links themselves keep working — the puzzle payload never
  depends on Lichess.

## Environment variables

Set in Pages → Settings → Environment variables for both Production and
Preview:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `NODE_VERSION` = `22.22.2`
