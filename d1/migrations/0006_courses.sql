-- Personalised YouTube courses (/courses). Course content is static (the
-- public catalog + supporter days in KV); only progress and the active
-- course live here. Handlers: functions/_shared/rpc/courses.ts.

-- One row per completed lesson. Day N+1 opens on the first local date after
-- day N's local_date (src/lib/coursePacing.ts), so the client's local date is
-- stored alongside the UTC timestamp.
CREATE TABLE course_progress (
  user_id      TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  course_slug  TEXT NOT NULL,
  day          INTEGER NOT NULL CHECK (day >= 1),
  local_date   TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, course_slug, day)
);

-- The course the player is following (a catalog slug), or NULL.
ALTER TABLE profiles ADD COLUMN course_focus TEXT;
