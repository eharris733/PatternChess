-- Trainable items are no longer only game-analysis blunders: the endgame
-- trainer logs play-out slips. Both share the blunders table + SR ladder,
-- discriminated by `kind`, so the due queue stays unified while game-analysis
-- stats filter to kind='tactic'.

BEGIN;

ALTER TABLE blunders
  ADD COLUMN kind text NOT NULL DEFAULT 'tactic'
    CHECK (kind IN ('tactic', 'endgame'));

-- Kind-specific payload:
--   endgame: { "deservedResult": "win"|"draw", "sourceGameId": "<uuid>"|null, "v": 1 }
ALTER TABLE blunders ADD COLUMN drill_data jsonb;

-- Future kinds may log positions that aren't moments from a stored game.
ALTER TABLE blunders ALTER COLUMN game_id DROP NOT NULL;

-- An endgame slip and a tactic blunder can legitimately share a FEN with
-- different expected answers and drill formats, so the dedup key gains the kind
-- dimension. Same-kind dedup behavior is unchanged.
ALTER TABLE blunders DROP CONSTRAINT blunders_user_fen_unique;
ALTER TABLE blunders ADD CONSTRAINT blunders_user_fen_kind_unique UNIQUE (user_id, fen, kind);

CREATE INDEX IF NOT EXISTS blunders_user_id_kind_idx ON blunders (user_id, kind);

COMMIT;
