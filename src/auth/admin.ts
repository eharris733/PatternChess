// Client-side admin allowlist. This is a UX gate only (hide nav, redirect the
// route) — the real security boundary is the email check inside the admin_kpis()
// SECURITY DEFINER function. Keep this list in sync with that migration.
export const ADMIN_EMAILS = ['elliotmharris@gmail.com'];

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
