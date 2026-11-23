-- Personalised YouTube courses (/courses). Course content is static (the
-- public catalog + supporter days in KV); only progress and the followed
-- course live here. Handlers: functions/_shared/rpc/courses.ts.
--
-- Written to be safe on a database that already ran feat/courses' original
-- 0003_courses.sql (it was applied to the shared remote D1 from that branch
-- before being renumbered here): every statement is IF NOT EXISTS, and the
-- followed course lives in its own table, so no ALTER TABLE can fail on a
-- column that already exists. An old profiles.course_focus column, if
-- present, is left unused.

-- One row per finished lesson. local_date is the player's local date when
-- they finished it (the plan's "Today's lesson" step reads it); the next
-- lesson opens as soon as this one is done (src/lib/coursePacing.ts).
CREATE TABLE IF NOT EXISTS course_progress (
  user_id      TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  course_slug  TEXT NOT NULL,
  day          INTEGER NOT NULL CHECK (day >= 1),
  local_date   TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, course_slug, day)
);

-- The course the player follows (a catalog slug); no row = none.
CREATE TABLE IF NOT EXISTS course_focus (
  user_id     TEXT PRIMARY KEY REFERENCES user (id) ON DELETE CASCADE,
  course_slug TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
