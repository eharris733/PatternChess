-- Openings v2: the theory walk now reads the self-hosted opening book
-- (/api/book, Cloudflare D1, built by tools/book-builder) instead of the
-- rate-limited Lichess masters explorer, and the engine judges the user's
-- moves once the book runs out (the "past-book" scan).
--
-- DEVIATION_RULE_VERSION goes to 2 in src/chess/openingDeviation.ts, so every
-- game is re-walked and its row replaced.

alter table public.opening_deviations
  -- Which book tier answered: 'otb' (broadcasts, both 2200+) or 'elite' (Lichess Elite).
  add column if not exists book_tier text check (book_tier in ('otb', 'elite')),
  -- First ply the book can no longer judge; the past-book scan starts here.
  add column if not exists book_end_ply int,
  -- Stamped once the past-book scan has run (found a mistake or not).
  add column if not exists past_book_checked_at timestamptz;

-- engine_rejected: a popular book move the engine vet marks unsound.
-- past_book: a >=10% mistake the engine found after the book ran out.
alter table public.opening_deviations drop constraint if exists opening_deviations_reason_check;
alter table public.opening_deviations add constraint opening_deviations_reason_check
  check (reason in ('not_in_book', 'losing_line', 'engine_rejected', 'past_book'));

create index if not exists opening_deviations_past_book_idx
  on public.opening_deviations (user_id)
  where book_end_ply is not null and past_book_checked_at is null;

-- The Lichess explorer cache is gone with the proxy. It never held a row
-- (RLS blocked every client write before the proxy took it over).
drop table if exists public.opening_explorer_cache;
