-- The US state (USPS code, e.g. 'MA') a player wants OTB tournaments for:
-- the dashboard's Upcoming OTB events card and the "Events near you" section
-- of the weekly_report email (workers/notifier). NULL = not chosen yet; the
-- card then shows a guess (IP region, else timezone) without saving it, and
-- the email leaves the section out. Written through profile.update
-- (PROFILE_WRITABLE validates the code against US_STATES).
ALTER TABLE profiles ADD COLUMN events_state TEXT
  CHECK (events_state IS NULL OR (length(events_state) = 2 AND events_state = upper(events_state)));
