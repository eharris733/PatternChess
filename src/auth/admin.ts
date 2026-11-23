// Admin allowlist. On the client this is a UX gate only (hide nav, redirect
// the route); the real boundary is the server: functions/_shared/auth.ts
// imports this same list and every `auth: 'admin'` RPC checks it against the
// session user's email.
export const ADMIN_EMAILS = ['elliotmharris@gmail.com', 'writinggoose@gmail.com'];

export function isAdminEmail(email?: string | null): boolean {
  // Lichess accounts carry a placeholder address that is never an admin.
  if (!email || email.toLowerCase().endsWith('@lichess.invalid')) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
