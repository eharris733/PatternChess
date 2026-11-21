-- Training reminders are opt-out (2026-11-21): new accounts start opted in.
-- The sign-in page says so next to "Continue with Google", /profile has the
-- switch, and every email will carry a one-click unsubscribe. Existing
-- accounts keep their current choice: they never saw that disclosure.
-- (Lichess sign-ins have no email address, so nothing is sent to them until
-- they add one.)

alter table public.profiles alter column email_opt_in set default true;
