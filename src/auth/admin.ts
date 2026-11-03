// Client-side admin allowlist. This is a UX gate only (hide nav, redirect the
// route) — the real security boundary is `is_admin()` (migration
// 20261103000956_admin_allowlist), which every admin_* SECURITY DEFINER RPC
// calls. Keep this list in sync with that function.
export const ADMIN_EMAILS = ['elliotmharris@gmail.com', 'writinggoose@gmail.com'];

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
