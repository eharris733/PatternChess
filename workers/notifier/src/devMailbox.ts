// Local try-out mailbox: only when the Worker runs with `--var DEV_MAILBOX:1`
// (never set in wrangler.jsonc). Emails are kept in memory instead of going
// to the EMAIL binding, so nothing real is sent, and /dev/mailbox shows them
// with working links (APP_URL / EMAIL_URL pointed at localhost). It can also
// run the hourly job for one account, which is how a typed-in address gets
// its confirm email.

import { EMAIL_KINDS, type OutboxRow } from './outbox';
import { emailCandidates } from './store';
import type { EmailKind, RenderedEmail } from './templates';

export interface CapturedEmail {
  id: number;
  at: string;
  kind: EmailKind;
  to: string;
  subject: string;
  html: string;
  text: string;
}

const inbox: CapturedEmail[] = [];

export function devMailboxOn(env: { DEV_MAILBOX?: string }): boolean {
  return env.DEV_MAILBOX === '1';
}

export function capture(kind: EmailKind, to: string, email: RenderedEmail): string {
  const id = inbox.length + 1;
  inbox.push({ id, at: new Date().toISOString(), kind, to, subject: email.subject, html: email.html, text: email.text });
  return `dev-${id}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Local mailbox</title>
<style>body{font:15px system-ui;max-width:860px;margin:24px auto;padding:0 16px;color:#222}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}
form{margin:12px 0;padding:12px;border:1px solid #ddd;border-radius:6px}input,select,button{font:inherit;padding:4px 8px}
.note{color:#555;font-size:13px}.flash{background:#f3f0e6;padding:8px 12px;border-radius:6px}</style>
${body}`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/** The account's user id, by sign-in email or contact email. */
export async function userIdByEmail(db: D1Database, email: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT u.id FROM user u LEFT JOIN profiles p ON p.id = u.id
       WHERE lower(u.email) = ?1 OR lower(p.contact_email) = ?1 LIMIT 1`,
    )
    .bind(email.trim().toLowerCase())
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * The next email this account would get: the candidate now, else at each of
 * the next 24 hours (reminders wait for the player's own hour). The per-user
 * lookup skips the opt-in filter (it serves the admin preview), so check it
 * here the way the hourly run does.
 */
export async function nextCandidate(db: D1Database, userId: string, now: Date): Promise<{ row: OutboxRow; at: Date } | null> {
  const p = await db.prepare('SELECT email_opt_in FROM profiles WHERE id = ?').bind(userId).first<{ email_opt_in: number }>();
  if (!p?.email_opt_in) return null;
  for (let h = 0; h < 24; h++) {
    const at = new Date(now.getTime() + h * 3_600_000);
    const [row] = await emailCandidates(db, at, userId.toLowerCase());
    if (!row) return null;
    if (row.kind && row.to_email) return { row, at };
  }
  return null;
}

export function mailboxPage(flash: string | null): Response {
  const rows = [...inbox]
    .reverse()
    .map(
      (m) =>
        `<tr><td>${esc(m.at.slice(11, 19))}</td><td>${esc(m.kind)}</td><td>${esc(m.to)}</td>
         <td><a href="/dev/mailbox/${m.id}">${esc(m.subject)}</a></td></tr>`,
    )
    .join('');
  const kinds = EMAIL_KINDS.map((k) => `<option>${k}</option>`).join('');
  return page(`<h1>Local mailbox</h1>
<p class="note">Emails from the local notifier land here; nothing is sent for real. Links point at localhost.</p>
${flash ? `<p class="flash">${esc(flash)}</p>` : ''}
<form method="post" action="/dev/run">
  <strong>Run the hourly job for one account</strong><br>
  <input name="email" type="email" required placeholder="account email (sign-in or contact)" size="34">
  <button>Send its next email</button>
  <div class="note">Sends what the real job would send this account, at its next reminder hour if needed
  (welcome and confirm go at once). Logged in email_sends, so the one-per-20h rule applies to the next run.</div>
</form>
<form method="post" action="/dev/sample">
  <strong>Preview any template for an account</strong><br>
  <input name="email" type="email" required placeholder="account email" size="34">
  <select name="kind">${kinds}</select>
  <button>Render</button>
</form>
<table><tr><th>Time (UTC)</th><th>Kind</th><th>To</th><th>Subject</th></tr>${rows || '<tr><td colspan="4">No emails yet.</td></tr>'}</table>`);
}

export function messagePage(id: number): Response {
  const m = inbox.find((x) => x.id === id);
  if (!m) return page('<p>No such email. <a href="/dev/mailbox">Back</a></p>', 404);
  return page(`<p><a href="/dev/mailbox">Back to the mailbox</a></p>
<p><strong>To:</strong> ${esc(m.to)}<br><strong>Subject:</strong> ${esc(m.subject)}<br><strong>Kind:</strong> ${esc(m.kind)}</p>
<iframe srcdoc="${esc(`<base target="_blank">${m.html}`)}" style="width:100%;height:900px;border:1px solid #ddd;border-radius:6px"></iframe>
<details><summary>Plain-text part</summary><pre style="white-space:pre-wrap">${esc(m.text)}</pre></details>`);
}

export function redirectToMailbox(flash: string): Response {
  return new Response(null, { status: 303, headers: { Location: `/dev/mailbox?flash=${encodeURIComponent(flash)}` } });
}
