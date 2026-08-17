-- Trainable items are no longer only game-analysis blunders: the opening
-- trainer logs repertoire lapses (no source game) and the endgame trainer logs
-- play-out slips. All three share the blunders table + SR ladder, discriminated
-- by `kind`, so the due queue stays unified while game-analysis stats filter to
-- kind='tactic'.

BEGIN;

ALTER TABLE blunders
  ADD COLUMN kind text NOT NULL DEFAULT 'tactic'
    CHECK (kind IN ('tactic', 'opening', 'endgame'));

-- Kind-specific payload:
--   opening: { "color": "white"|"black", "repertoireMove": "<uci>", "v": 1 }
--   endgame: { "deservedResult": "win"|"draw", "sourceGameId": "<uuid>"|null, "v": 1 }
ALTER TABLE blunders ADD COLUMN drill_data jsonb;

-- Opening-repertoire items are positions in the user's book, not moments from a
-- stored game.
ALTER TABLE blunders ALTER COLUMN game_id DROP NOT NULL;

-- An opening item and a tactic blunder can legitimately share a FEN with
-- different expected answers and drill formats, so the dedup key gains the kind
-- dimension. Same-kind dedup behavior is unchanged.
ALTER TABLE blunders DROP CONSTRAINT blunders_user_fen_unique;
ALTER TABLE blunders ADD CONSTRAINT blunders_user_fen_kind_unique UNIQUE (user_id, fen, kind);

CREATE INDEX IF NOT EXISTS blunders_user_id_kind_idx ON blunders (user_id, kind);

COMMIT;
