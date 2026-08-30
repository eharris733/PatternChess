-- Applied via MCP 2026-08-29 (recorded in remote history as 20260829145638).
-- The remote DB had the original 3-kind CHECK from a hand-applied run of
-- 20260817120000; this narrows it after opening training was removed. A fresh
-- database gets the 2-kind CHECK directly from 20260817120000, where this is
-- a no-op rewrite of the same constraint.
ALTER TABLE public.blunders DROP CONSTRAINT blunders_kind_check;
ALTER TABLE public.blunders ADD CONSTRAINT blunders_kind_check
  CHECK (kind IN ('tactic', 'endgame'));
