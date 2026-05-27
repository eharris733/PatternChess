# Improvements plan

Execution plan for the 12 items in [`improvements.md`](./improvements.md). Built for multiple
sessions and parallel agents. Item numbers map 1:1 to `improvements.md`.

## Decisions locked (2026-05-27)

- **#8 SR schedule** — keep the existing **expanding** ladder `[1,2,4,7,14,28,56]`
  (`src/models/blunder.ts:49`). The "awkward" feeling is presentation, not the algorithm.
  Do **not** implement contracting intervals (they contradict the spacing effect). Work = UX/clarity.
- **#7 batching** — ship batching **and** discard **for all users now**; defer the "Pro" gate
  until a billing/entitlement system exists.
- **Demo focus** — all four areas in scope; sequence by demo-visibility + dependency.
- **#12 architecture** — keep chess.com/Lichess calls **client-side (per-user IP)**. Do **not**
  add a server-side fetch proxy (it funnels every user into one rate-limit bucket = bottleneck +
  single point of ban). Work = robustness only (429/back-off).

> Research note: the SR-science and rate-limit-citation web lookups were blocked (no web access
> this session). Algorithm choices above stand on domain knowledge; if we cite anything publicly,
> verify URLs/numbers against live docs (Anki learning steps, Lichess `lichess.org/api`,
> chess.com published-data API) before quoting.

---

## Progress

- **Session 1 (2026-05-27) — done & verified** on branch `improvements-session-1`:
  B1 nav icons (Dashboard/Vault/Train SVGs, `src/components/icons/`), A3 standout "New"
  pill (`PositionSrState.tsx`), A4 win% on game-state labels (`BlunderContextBadges.tsx`,
  `TrainingRoute.tsx`), E2 trophy SVG replacing the 🏆 emoji. Verified via `npm run typecheck`
  + Playwright walk-through with a seeded blunder (reviewing panel, cycle-complete screen).
  Audit also confirmed: no ad-hoc SR labels anywhere; remaining glyph icons (board controls,
  promotion pieces, ↗ links) are conventional, deferred.
- **Session 2 (2026-05-27) — done & verified** on branch `improvements-session-1`:
  A1 engine refutation of the move the user just played (capture the already-computed PV;
  parameterized `buildRefutationPairs` so the reviewing + played-move paths share it; added a
  `selectPlayedRefutationIndex` scrubber + arrow-key nav). A2 board-shaped loading skeleton +
  fire-and-forget prefetch of the next blunder's game in `loadCurrentBlunder`. Verified via
  typecheck + Playwright (played a wrong move → refutation panel + scrub; reviewing refutation
  intact post-refactor; skeleton renders with `aria-busy`). A1 also resolves the "refutation
  isn't showing" half of #6.
- **Session 3 (2026-05-27) — done & verified** on branch `improvements-session-1`:
  Workstream B (actionable insights). B2 drill-by-phase (PhaseBlunderCard bars → `phaseFilter`),
  B3 drill-by-opening (OpeningInsightsCard rows → `openingFilter`, matched on eco family + user
  color), B4 drill long-think (new `moveTimeSpentSeconds`/`isLongThink` in `blunderContext`,
  long-think = ≥20% of the starting clock spent on one move — **tunable default**, see open
  questions; TimeManagementCard → `contextFilter: 'longThink'`). TrainingRoute now unifies
  context/phase/opening filters under one `activeFilterLabel`. Verified all three filter paths
  via Playwright (chip + queue count correct; long-think math validated). **Completes #2 and #3.**

## Workstreams

Grouped so disjoint-file streams can run in parallel; same-file streams are sequenced.
Effort: **S** ≈ <½ session · **M** ≈ ~1 session · **L** ≈ multi-session.

### A — Training feel  *(files: `state/trainingStore.ts`, `routes/TrainingRoute.tsx`, a few components)*

> ⚠ A1/A2/D1 all edit `trainingStore.ts` — **do not parallelize across agents**; sequence them.

- **A1 (#1) Engine refutation of the move you played.** *(M)*
  `processMove` already runs `evaluatePositionFull(newFen, 18)` on a wrong move and gets a full
  PV back (`trainingStore.ts:591`) — but discards it. Retain it: build refutation pairs from
  *the played move + PV* (reuse `buildRefutationPairs`/`buildLineMoves`), store as e.g.
  `playedRefutationPairs`, render in the `incorrect` phase (`TrainingRoute.tsx:451-460`) using the
  existing `MoveSequencePanel`.
  - Cover the branches that don't currently eval: repeated-blunder (`:725`) and "good but not best"
    (`:618`) — run an eval there too, or label clearly.
  - Likely resolves the "refutation isn't showing" half of #6.
- **A2 (#5) Instant next position (skeleton + prefetch).** *(M)*
  - Skeleton: replace the `Loading…` text (`TrainingRoute.tsx:176-182`) with a board-shaped
    skeleton (`components/Skeleton.tsx` exists).
  - Prefetch: during the idle `correct`/`reviewing` screen, warm `blunder[i+1]` — its `GameRecord`
    (`gameCache` already exists, `trainingStore.ts:197`/`:408`) and the engine eval for the
    next position. Engine is a singleton worker (can't run two evals at once), so the win is
    fetching the next game over the network + pre-computing the preplay FEN ahead of `advance()`.
- **A3 (#6) "New" tag stands out + refutation shows.** *(S)*
  - `PositionSrState` renders the bucket as plain text (`PositionSrState.tsx:75`). Give each
    `SrBucket` a colored pill (esp. `New`), reusing `SR_BUCKET_LABEL` — **never** invent labels
    (see memory + `CLAUDE.md`).
  - Refutation visibility: pair with A1; also add a fallback when the reviewing-phase engine eval
    fails silently (`trainingStore.ts:493` catch leaves `refutationPairs` empty).
- **A4 (#4) Quantitative eval values on the qualitative labels.** *(S)*
  `blunderContext.preMoveWinPercent` + `winPercent()` already exist. Append numbers:
  `Already losing → "Already losing · 18% win"`, `Roughly equal → "~50%"`, etc.
  - Touch: `BlunderContextBadges.tsx`, the reviewing block `TrainingRoute.tsx:336-348`.
  - Decide once: show **win %**, **eval in pawns** (`cp/100`, e.g. "−3.2"), or both — keep
    consistent with `WinningChancesDisplay` (already %). Add a `cp→pawns` helper if showing eval.

### B — Actionable insights + icons  *(files: `components/insights/*`, `routes/TrainingRoute.tsx` filter plumbing, `components/SidebarNav.tsx`, new `components/icons/*`)*

- **B1 (#2) Real nav/section icons.** *(S, do first — unblocks the "no emoji" cleanup)*
  `SidebarNav.tsx:8-12` uses glyph chars (`◐ ▤ ✦`). Replace with SVG icons following the
  `FlameIcon` pattern (`components/icons/FlameIcon.tsx`): `viewBox="0 0 24 24"`, `aria-hidden`.
  Add Dashboard / Vault / Train icons.
- **B2 (#2) Drill by phase.** *(M)* Add a `phase` drilling dimension.
  `Blunder.phase` already exists. Add `phaseFilter?: BlunderPhase` to `TrainingRoute` location
  state + a simple `b.phase === filter` filter (no game fetch needed). Make `PhaseBlunderCard`
  bars clickable → `navigate('/training', { state: { phaseFilter: 'opening' } })`.
- **B3 (#3) Drill by opening.** *(M)* New `ecoFamily` filter dimension.
  Join blunder→`game.eco` (use the existing `fetchGamesByIds` + `applyContextFilter` pattern in
  `TrainingRoute.tsx:42-64`, or add `getBlundersForOpening`). Make `OpeningInsightsCard` rows
  clickable → drill that family.
- **B4 (#3) Drill "long think" blunders.** *(M)* Complement to time-trouble (which already
  deep-links, `TimeTroubleCard.tsx:34`). Add *time-spent-on-this-move* to `blunderContext`
  (delta `clock[ply-2] − clock[ply]`; `clockPerPly` is on `GameRecord`). Define a "long think"
  threshold, then make `TimeManagementCard` drill those.

> B2 first (simplest filter), then reuse the pattern for B3/B4. The filter plumbing in
> `TrainingRoute.tsx:79-126` is the shared seam.

### C — Social proof / Elo  *(files: new hook + `routes/DashboardRoute.tsx` / insights)*

- **C1 (#9) Elo gain since inception.** *(M)*
  `GameRecord.userRating` is per-game; `UserProfile` has no rating history.
  - **Now (no new API calls — supports #12):** derive earliest-vs-latest `userRating` per
    time-control category from synced games (mirror `fetchUserRatingMean`, `useInsights.ts:22`).
    Surface "since you started: 1450 → 1612 (+162)" on the dashboard.
  - **Later (cleaner series):** capture a rating snapshot row at each sync for a true time series
    + per-sync deltas. Decide which rating(s) to show (most-played category, or per-category).

### D — Foundations  *(files: `state/trainingStore.ts` (D1), schema + `services/supabaseService.ts` + sync + UI (D2), UI copy (D3))*

- **D1 (#11) Fail → requeue within the session.** *(M, store-only, no schema)*
  Anki-style lapse handling: on a first-attempt fail, reinsert the blunder ~3–7 positions later
  in the in-memory `blunders` array instead of forcing retry-in-place; it leaves the queue only
  once solved. Cross-session SR persistence is unchanged (first-attempt fail already sets
  `cycleNumber=0`, `lastDrillFailed=true`, `trainingStore.ts:716-719`). Mind `currentIndex`,
  `attemptedBlunderIds`, and first-attempt semantics. Decide whether to keep the in-place "Retry"
  button as well. (Science-compatible with the expanding ladder — different axis.)
- **D2 (#7) Batching (+ discard for all).** *(L — biggest data-model change)*
  - Schema: `batch` concept on blunders (`batch_id` / `batch_number`) or a `batches` table
    (`id, user_id, created_at, label, discarded_at`).
  - Sync: assign new blunders to the open batch until it hits 100, then open a new one.
  - Discard: soft-delete (`discarded_at`); exclude from `getDueBlunders` (`supabaseService.ts:111`).
  - UI: batch list + discard controls (Vault or a new screen); per-problem discard.
- **D3 (#8) SR clarity (UX only).** *(S)*
  Keep the ladder; make it legible: clearer "next review in X / cycle N of 7" copy in
  `PositionSrState.tsx`, the New pill (shared with A3), optionally surface the schedule so users
  understand the cadence. No data migration.

### E — Reliability  *(files: `services/chessApiService.ts`, `services/syncService.ts`, `state/syncStore.ts`; audit is cross-cutting)*

- **E1 (#12) Rate-limit hardening.** *(M)* Architecture stays client-side. Fix robustness:
  - Add `429` + `Retry-After`-aware exponential back-off to `fetchChessComGames` /
    `fetchLichessGames` (`chessApiService.ts:36,126`). Default ~60s for Lichess when no header.
  - Fix the **silent month-skip**: `if (!monthRes.ok) continue;` (`chessApiService.ts:51`) hides
    a 429 and yields incomplete sync with no signal.
  - Add ~300ms spacing in the chess.com archive loop (mirror the explorer throttle,
    `reviewStore.ts:183-197`).
  - Surface a "rate-limited, retrying" state in `syncStore`.
  - Keep incremental `since` + dedupe + FEN cache as-is (they make per-user volume negligible).
- **E2 (#10) Code audit.** *(ongoing)* Run `/code-review high` (or `ultra`) per branch, plus a
  read-only audit agent each session, for redundancy/bugs. **Known quick-win:** `TrainingRoute.tsx:225`
  renders a 🏆 emoji — violates the "no emojis in UI" rule (`CLAUDE.md`); replace with an SVG icon.

---

## Suggested session sequence

Front-loads demo-visible wins; threads foundations between.

1. **Quick wins (parallelizable — disjoint files):** B1 icons · A4 eval values · A3 New pill +
   E2 audit pass (find the 🏆 + more). High visual payoff, low risk.
2. **Training feel:** A1 refutation (resolves #6 refutation half) → A2 skeleton/prefetch.
   *(Sequential — same file.)*
3. **Actionable insights:** B2 phase drills → B3 openings → B4 long-think.
4. **Social proof:** C1 Elo-gain (parallel with #3, different files).
5. **Reliability:** E1 rate-limit hardening (parallel — sync files only).
6. **Foundations:** D1 requeue → D3 SR clarity → D2 batching (largest, own session).

## Parallelization rules

- **Never run two agents on `trainingStore.ts` at once** (A1, A2, D1) — sequence them.
- **Safe to parallelize** (disjoint files): B1 (`SidebarNav`/icons) · C1 (new hook + dashboard) ·
  E1 (`chessApiService`/`syncStore`) · E2 (read-only audit). Use separate worktrees if running
  truly concurrently.
- B2/B3/B4 share `TrainingRoute` filter plumbing — same stream, sequence within it.

## Done-when (every item)

Per `CLAUDE.md`: after any UI/behavior change, run `npm run typecheck`, the Playwright spec suite,
**and** walk the changed flow with the Playwright MCP (start `npm run dev`, sign in / stub auth,
check `browser_console_messages`, snapshot if visual). Code-correctness tests don't catch runtime
rendering errors.

## Open questions / to confirm later

- **C1:** which rating to headline (most-played category vs per-category vs overall)?
- **B4:** "long think" threshold — fixed seconds, percentile, or relative to the player's median?
- **D2:** where does the batch UI live — Vault, or a dedicated screen? Discard = soft-delete
  (recoverable) or hard-delete?
- **A4:** show win %, eval in pawns, or both?
