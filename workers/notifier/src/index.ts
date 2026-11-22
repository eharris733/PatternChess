// PatternChess notifier: training reminders and progress reports sent through
// Cloudflare Email Service (retention roadmap Phase 2).
//
// scheduled (hourly): email_outbox(now) decides who gets what this hour
//   (migration 20261122120000); each row is rendered with templates.ts, sent
//   with the EMAIL binding and logged to email_sends.
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

import { insert, remove, rpc } from './db';
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
import {
  confirmedPage,
  notFoundPage,
  settingsPage,
  unsubscribeConfirmPage,
  unsubscribedPage,
  type Prefs,
} from './pages';
import { FROM_ADDRESS, FROM_NAME, renderEmail, type EmailKind } from './templates';

export interface Env {
  EMAIL: SendEmail;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_SECRET: string;
  APP_URL: string;
  EMAIL_URL: string;
  SEND_MODE: string;
  TEST_RECIPIENTS: string;
}

/** Well under the account's daily quota; a backlog drains over the next hours. */
const MAX_PER_RUN = 300;

function bases(env: Env): LinkBases {
  return { app: env.APP_URL.replace(/\/$/, ''), email: env.EMAIL_URL.replace(/\/$/, '') };
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

async function newConfirmToken(env: Env, userId: string, email: string): Promise<string> {
  // One live confirmation link per user: the newest replaces the rest.
  await remove(env, 'email_confirmations', `user_id=eq.${userId}`);
  const rows = await insert<Array<{ token: string }>>(env, 'email_confirmations', { user_id: userId, email }, true);
  return rows[0].token;
}

async function deliver(env: Env, row: OutboxRow & { kind: EmailKind; to_email: string }, to: string, confirmToken?: string) {
  const links = buildLinks(bases(env), row.kind, row.unsub_token, confirmToken);
  const email = renderEmail(row.kind, toEmailData(row.data), links);
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
  const rows = await rpc<OutboxRow[]>(env, 'email_outbox', { p_now: now.toISOString() });
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
      const confirmToken = r.kind === 'confirm' ? await newConfirmToken(env, r.user_id, r.to_email) : undefined;
      const { messageId } = await deliver(env, r, r.to_email, confirmToken);
      await insert(env, 'email_sends', {
        user_id: r.user_id,
        kind: r.kind,
        to_email: r.to_email,
        provider_id: messageId ?? null,
      });
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
  const rows = await rpc<OutboxRow[]>(env, 'email_candidates', { p_now: now.toISOString(), p_user: userId });
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

async function handlePublic(req: Request, env: Env, url: URL): Promise<Response> {
  const app = bases(env).app;
  const self = bases(env).email;

  if (url.pathname === '/unsubscribe') {
    const t = url.searchParams.get('t');
    if (!isUuid(t)) return notFoundPage(app);
    if (req.method === 'GET') return unsubscribeConfirmPage(app, `${self}/unsubscribe?t=${t}`);
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const prefs = await rpc<Prefs | null>(env, 'email_unsubscribe', { p_token: t });
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
      const prefs = await rpc<Prefs | null>(env, 'email_update_prefs_by_token', {
        p_token: t,
        p_opt_in: form.get('optIn') === '1',
        p_reminders: reminders,
        p_reports: reports,
        p_hour: hour,
      });
      if (!prefs) return notFoundPage(app);
      return settingsPage(app, action, prefs, true);
    }
    const prefs = await rpc<Prefs | null>(env, 'email_prefs_by_token', { p_token: t });
    if (!prefs) return notFoundPage(app);
    return settingsPage(app, action, prefs, false);
  }

  if (url.pathname === '/confirm' && req.method === 'GET') {
    const c = url.searchParams.get('c');
    if (!isUuid(c)) return notFoundPage(app);
    const prefs = await rpc<Prefs | null>(env, 'email_confirm', { p_token: c });
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
