-- Canonical, platform-independent openings on games.
--
-- Until now openings were grouped by the first two characters of the PGN's ECO
-- header ("B33" → "B3*"). That splits one opening across several rows (the
-- Sicilian spans eight ECO families) and leans on headers that differ per
-- platform: lichess sends `[Opening ...]`, chess.com sends only `[ECOUrl ...]`,
-- and the two sites assign different codes to the same game.
--
-- `opening_family` holds the classified name ("Sicilian Defense"), derived from
-- the board position by src/chess/openingClassifier.ts, and `eco` /
-- `opening_name` are overwritten with the classified code and full variation
-- name. `opening_classified_at` gates the client backfill — it is stamped even
-- when a game is too short to classify, so those rows are not retried forever.

ALTER TABLE games ADD COLUMN IF NOT EXISTS opening_family TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS opening_classified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS games_user_opening_family_idx
  ON games (user_id, opening_family)
  WHERE opening_family IS NOT NULL;

-- Drives the backfill scan ("my games still needing classification").
CREATE INDEX IF NOT EXISTS games_opening_unclassified_idx
  ON games (user_id)
  WHERE opening_classified_at IS NULL;

-- Bulk write-back for the client classifier: one call per batch instead of one
-- PATCH per game (an active account has thousands). NULL eco/opening_name mean
-- "unclassifiable" and leave the existing header values alone.
CREATE OR REPLACE FUNCTION apply_game_openings(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  WITH incoming AS (
    SELECT *
    FROM jsonb_to_recordset(p_rows)
      AS x(id UUID, eco TEXT, opening_name TEXT, opening_family TEXT)
  )
  UPDATE games g
  SET eco = COALESCE(i.eco, g.eco),
      opening_name = COALESCE(i.opening_name, g.opening_name),
      opening_family = i.opening_family,
      opening_classified_at = now()
  FROM incoming i
  WHERE g.id = i.id
    AND g.user_id = auth.uid();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_game_openings(JSONB) TO authenticated;
