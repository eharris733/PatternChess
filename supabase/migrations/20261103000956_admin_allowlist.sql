-- One admin allowlist for every admin_* RPC.
--
-- Until now each SECURITY DEFINER admin function hardcoded
--   coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com')
-- as its gate. This adds `is_admin()` (keep it in sync with ADMIN_EMAILS in
-- src/auth/admin.ts) and rewrites that gate in every live function to call it,
-- so adding an admin is a one-line change from here on.
--
-- The separate `where coalesce(u.email, '') not in (...)` lines that drop the
-- owner's own account from the stats are left alone on purpose.

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'elliotmharris@gmail.com',
    'writinggoose@gmail.com'  -- Kaleth (chess.com DrG00se)
  );
$$;

grant execute on function public.is_admin() to authenticated;

do $$
declare
  fn record;
  def text;
  old_gate constant text := $g$coalesce(auth.jwt() ->> 'email', '') not in ('elliotmharris@gmail.com')$g$;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and position(old_gate in p.prosrc) > 0
  loop
    def := replace(pg_get_functiondef(fn.oid), old_gate, 'not public.is_admin()');
    execute def;
  end loop;
end
$$;
