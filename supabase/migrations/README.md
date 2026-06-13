# Supabase migrations

Migrations apply via `supabase db push` (CLI logged in + linked to project
`ydfwppthwnlgxnntzrvg`). Push only applies files not yet in the remote
migration history.

History note: files up to `20260610120000` were originally applied manually via
the dashboard SQL editor; on 2026-06-12 the remote history table was repaired
(`supabase migration repair`) to match this directory, so push works going
forward. The dashboard SQL editor remains a fallback — if you use it, also mark
the file applied with `supabase migration repair --status applied <version>`.

The schema is one shared project across environments — run once.
