// PatternChess notifier: training reminders and progress reports sent through
// Cloudflare Email Service (retention roadmap Phase 2).
//
// scheduled (hourly): emailOutbox(now) decides who gets what this hour
//   (rules.ts over facts read from the app D1, store.ts); each row is rendered
//   with templates.ts, sent with the EMAIL binding and logged to email_sends.
//
// Data: the app D1 `patternchess-app` (binding DB), the same database the
// Pages Functions use. Before the Supabase -> Cloudflare cutover this version
// must not be deployed: the live Worker still reads Supabase, and this one
// would read a D1 copy that stops being current (see README.md).
// fetch, public (email.patternchess.com, token links from emails):
//   GET/POST /unsubscribe?t=  one-click unsubscribe (POST = RFC 8058)
//   GET/POST /settings?t=     no-login email settings
//   GET      /confirm?c=      confirm a typed-in contact address
// fetch, admin (Authorization: Bearer ADMIN_SECRET):
//   GET  /admin/preview?user=<uuid>&kind=<kind>[&format=text|json]
//   POST /admin/run?dryRun=1[&now=<ISO>]   evaluate (and with dryRun=0, send) the outbox
//   POST /admin/send-sample?user=<uuid>&kind=<kind>&to=<addr>
//
// SEND_MODE gates real mail: anything but "live" sends only to TEST_RECIPIENTS.
//
// weekly_report adds "Events near you" for players with a saved
// profiles.events_state, fetched from the public events API (EVENTS_URL,
// default events.patternchess.com) once per state per run; if that API is
// down the section is simply left out (events.ts).
//
// Local only (`--var DEV_MAILBOX:1`, devMailbox.ts): /dev/mailbox keeps every
// email in memory instead of sending it, and can run the job for one account.

import {
  buildLinks,
  EMAIL_KINDS,
  isUuid,
  mayReceive,
  parseRecipients,
  toEmailData,
  unsubscribeHeaders,
  type LinkBases,
  type OutboxRow,
} from './outbox';
import { EVENTS_SITE, stateEventsLoader } from './events';
import {
  confirmEmail,
  emailCandidates,
  emailOutbox,
  logSend,
  newConfirmToken,
  prefsByToken,
  unsubscribeByToken,
  updatePrefsByToken,
} from './store';
import {
  confirmedPage,
  notFoundPage,
  settingsPage,
  unsubscribeConfirmPage,
  unsubscribedPage,
} from './pages';
import { FROM_ADDRESS, FROM_NAME, renderEmail, type EmailKind } from './templates';
import {
  capture,
  devMailboxOn,
  mailboxPage,
  messagePage,
  nextCandidate,
  redirectToMailbox,
  userIdByEmail,
} from './devMailbox';

export interface Env {
  EMAIL: SendEmail;
  /** D1 `patternchess-app` (profiles, blunders, email_sends, better-auth `user`, …). */
  DB: D1Database;
  ADMIN_SECRET: string;
  APP_URL: string;
  EMAIL_URL: string;
  SEND_MODE: string;
  TEST_RECIPIENTS: string;
  /** Events API origin for "Events near you"; defaults to https://events.patternchess.com. */
  EVENTS_URL?: string;
  /** "1" only in local dev (wrangler dev --var DEV_MAILBOX:1): capture instead of sending. */
  DEV_MAILBOX?: string;
}

/** Well under the account's daily quota; a backlog drains over the next hours. */
const MAX_PER_RUN = 300;

function bases(env: Env): LinkBases {
  return { app: env.APP_URL.replace(/\/$/, ''), email: env.EMAIL_URL.replace(/\/$/, '') };
}

/** A fresh per-run events loader (one API call per state per run). */
function eventsLoader(env: Env) {
  return stateEventsLoader((input, init) => fetch(input, init), (env.EVENTS_URL || EVENTS_SITE).replace(/\/$/, ''));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function deliver(env: Env, row: OutboxRow & { kind: EmailKind; to_email: string }, to: string, confirmToken?: string) {
  const links = buildLinks(bases(env), row.kind, row.unsub_token, confirmToken);
  const email = renderEmail(row.kind, toEmailData(row.data), links);
  if (devMailboxOn(env)) return { email, messageId: capture(row.kind, to, email) };
  const result = await env.EMAIL.send({
    from: { email: FROM_ADDRESS, name: FROM_NAME },
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: unsubscribeHeaders(links),
  });
  return { email, messageId: result.messageId };
}

interface RunSummary {
  now: string;
  mode: string;
  dryRun: boolean;
  candidates: number;
  sent: Array<{ kind: string; to: string; messageId?: string }>;
  wouldSend: Array<{ kind: string; to: string; subject: string }>;
  skipped: Array<{ kind: string; reason: string }>;
  failed: Array<{ kind: string; error: string }>;
}

async function runOutbox(env: Env, now: Date, dryRun: boolean): Promise<RunSummary> {
  const rows = await emailOutbox(env.DB, now, { loadEvents: eventsLoader(env) });
  const allow = parseRecipients(env.TEST_RECIPIENTS);
  const summary: RunSummary = {
    now: now.toISOString(),
    mode: env.SEND_MODE,
    dryRun,
    candidates: rows.length,
    sent: [],
    wouldSend: [],
    skipped: [],
    failed: [],
  };

  for (const row of rows.slice(0, MAX_PER_RUN)) {
    if (!row.kind || !row.to_email || !EMAIL_KINDS.includes(row.kind)) continue;
    const r = row as OutboxRow & { kind: EmailKind; to_email: string };
    if (!mayReceive(env.SEND_MODE, allow, r.to_email)) {
      summary.skipped.push({ kind: r.kind, reason: 'test mode' });
      continue;
    }
    if (dryRun) {
      const links = buildLinks(bases(env), r.kind, r.unsub_token, r.kind === 'confirm' ? 'dry-run' : undefined);
      const email = renderEmail(r.kind, toEmailData(r.data), links);
      summary.wouldSend.push({ kind: r.kind, to: r.to_email, subject: email.subject });
      continue;
    }
    try {
      const confirmToken = r.kind === 'confirm' ? await newConfirmToken(env.DB, r.user_id, r.to_email) : undefined;
      const { messageId } = await deliver(env, r, r.to_email, confirmToken);
      await logSend(env.DB, { user_id: r.user_id, kind: r.kind, to_email: r.to_email, provider_id: messageId ?? null });
      summary.sent.push({ kind: r.kind, to: r.to_email, messageId });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      summary.failed.push({ kind: r.kind, error: `${e.code ?? ''} ${e.message ?? String(err)}`.trim() });
    }
  }
  if (rows.length > MAX_PER_RUN) summary.skipped.push({ kind: '*', reason: `${rows.length - MAX_PER_RUN} over the per-run cap` });
  return summary;
}

async function candidate(env: Env, userId: string, now: Date): Promise<OutboxRow | null> {
  const rows = await emailCandidates(env.DB, now, userId.toLowerCase(), { loadEvents: eventsLoader(env) });
  return rows[0] ?? null;
}

async function handleAdmin(req: Request, env: Env, url: URL): Promise<Response> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!timingSafeEqual(`Bearer ${env.ADMIN_SECRET ?? ''}`, auth) || !env.ADMIN_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }
  const nowParam = url.searchParams.get('now');
  const now = nowParam ? new Date(nowParam) : new Date();
  if (Number.isNaN(now.getTime())) return json({ error: 'bad now' }, 400);

  if (url.pathname === '/admin/run' && req.method === 'POST') {
    const dryRun = url.searchParams.get('dryRun') !== '0';
    return json(await runOutbox(env, now, dryRun));
  }

  const user = url.searchParams.get('user');
  const kind = url.searchParams.get('kind') as EmailKind | null;
  if (!isUuid(user)) return json({ error: 'user must be a profile uuid' }, 400);
  if (!kind || !EMAIL_KINDS.includes(kind)) return json({ error: `kind must be one of ${EMAIL_KINDS.join(', ')}` }, 400);
  const row = await candidate(env, user, now);
  if (!row) return json({ error: 'no such user' }, 404);

  if (url.pathname === '/admin/preview' && req.method === 'GET') {
    const links = buildLinks(bases(env), kind, row.unsub_token, kind === 'confirm' ? 'preview' : undefined);
    const email = renderEmail(kind, toEmailData(row.data), links);
    const format = url.searchParams.get('format');
    if (format === 'json') return json({ decidedKind: row.kind, to: row.to_email, data: row.data, subject: email.subject });
    if (format === 'text') return new Response(`Subject: ${email.subject}\n\n${email.text}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(email.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (url.pathname === '/admin/send-sample' && req.method === 'POST') {
    const to = url.searchParams.get('to') ?? '';
    // Samples go to test recipients only, whatever SEND_MODE says.
    if (!parseRecipients(env.TEST_RECIPIENTS).has(to.toLowerCase())) {
      return json({ error: 'to must be in TEST_RECIPIENTS' }, 400);
    }
    const { email, messageId } = await deliver(
      env,
      { ...row, kind, to_email: to },
      to,
      kind === 'confirm' ? 'sample' : undefined,
    );
    return json({ sent: true, to, kind, subject: email.subject, messageId });
  }

  return json({ error: 'not found' }, 404);
}

async function handleDev(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/dev/mailbox' && req.method === 'GET') return mailboxPage(url.searchParams.get('flash'));
  const m = /^\/dev\/mailbox\/(\d+)$/.exec(url.pathname);
  if (m && req.method === 'GET') return messagePage(Number(m[1]));
  if (req.method !== 'POST') return json({ error: 'not found' }, 404);

  const form = await req.formData();
  const email = String(form.get('email') ?? '');
  const userId = await userIdByEmail(env.DB, email);
  if (!userId) return redirectToMailbox(`No account with the address ${email}.`);

  if (url.pathname === '/dev/run') {
    const next = await nextCandidate(env.DB, userId, new Date());
    if (!next) return redirectToMailbox(`${email}: nothing to send in the next 24 hours (reminders off, no address, or already mailed).`);
    const r = next.row as OutboxRow & { kind: EmailKind; to_email: string };
    const confirmToken = r.kind === 'confirm' ? await newConfirmToken(env.DB, r.user_id, r.to_email) : undefined;
    const { messageId } = await deliver(env, r, r.to_email, confirmToken);
    await logSend(env.DB, { user_id: r.user_id, kind: r.kind, to_email: r.to_email, provider_id: messageId ?? null });
    return redirectToMailbox(`Sent ${r.kind} to ${r.to_email} (as of ${next.at.toISOString().slice(0, 16)}Z).`);
  }

  if (url.pathname === '/dev/sample') {
    const kind = String(form.get('kind')) as EmailKind;
    if (!EMAIL_KINDS.includes(kind)) return redirectToMailbox('Unknown kind.');
    const row = await candidate(env, userId, new Date());
    if (!row) return redirectToMailbox(`No profile for ${email}.`);
    await deliver(env, { ...row, kind, to_email: email }, email, kind === 'confirm' ? 'sample' : undefined);
    return redirectToMailbox(`Rendered a ${kind} sample for ${email} (not logged).`);
  }
  return json({ error: 'not found' }, 404);
}

async function handlePublic(req: Request, env: Env, url: URL): Promise<Response> {
  const app = bases(env).app;
  const self = bases(env).email;

  if (url.pathname === '/unsubscribe') {
    const t = url.searchParams.get('t');
    if (!isUuid(t)) return notFoundPage(app);
    if (req.method === 'GET') return unsubscribeConfirmPage(app, `${self}/unsubscribe?t=${t}`);
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const prefs = await unsubscribeByToken(env.DB, t);
    if (!prefs) return notFoundPage(app);
    // RFC 8058 clients (Gmail's Unsubscribe button) post the form body
    // "List-Unsubscribe=One-Click" and only need a 2xx.
    return unsubscribedPage(app, `${self}/settings?t=${t}`, prefs);
  }

  if (url.pathname === '/settings') {
    const t = url.searchParams.get('t');
    if (!isUuid(t)) return notFoundPage(app);
    const action = `${self}/settings?t=${t}`;
    if (req.method === 'POST') {
      const form = await req.formData();
      const reminders = String(form.get('reminders') ?? 'daily');
      const reports = String(form.get('reports') ?? 'weekly');
      const hour = Number(form.get('hour'));
      if (!['daily', 'few_days', 'off'].includes(reminders) || !['weekly', 'monthly', 'off'].includes(reports)
        || !Number.isInteger(hour) || hour < 0 || hour > 23) {
        return new Response('Bad request', { status: 400 });
      }
      const prefs = await updatePrefsByToken(env.DB, t, {
        optIn: form.get('optIn') === '1',
        reminders,
        reports,
        hour,
      });
      if (!prefs) return notFoundPage(app);
      return settingsPage(app, action, prefs, true);
    }
    const prefs = await prefsByToken(env.DB, t);
    if (!prefs) return notFoundPage(app);
    return settingsPage(app, action, prefs, false);
  }

  if (url.pathname === '/confirm' && req.method === 'GET') {
    const c = url.searchParams.get('c');
    if (!isUuid(c)) return notFoundPage(app);
    const prefs = await confirmEmail(env.DB, c);
    return prefs ? confirmedPage(app) : notFoundPage(app);
  }

  if (url.pathname === '/') return Response.redirect(app, 302);
  return notFoundPage(app);
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/admin/')) return await handleAdmin(req, env, url);
      if (url.pathname.startsWith('/dev/') && devMailboxOn(env)) return await handleDev(req, env, url);
      return await handlePublic(req, env, url);
    } catch (err) {
      console.error('[notifier] request failed', url.pathname, err);
      return new Response('Something went wrong. Please try again in a minute.', { status: 500 });
    }
  },

  async scheduled(controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      runOutbox(env, new Date(controller.scheduledTime), false).then((s) => {
        console.log(
          JSON.stringify({
            msg: 'outbox run',
            candidates: s.candidates,
            sent: s.sent.length,
            skipped: s.skipped.length,
            failed: s.failed,
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
