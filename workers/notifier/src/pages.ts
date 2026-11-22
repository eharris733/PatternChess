// No-login pages served by the Worker at email.patternchess.com: one-click
// unsubscribe, email settings and address confirmation. Each is reached by a
// per-user token from an email (`email_unsub_token` or an
// `email_confirmations` token); the token RPCs from 20261012140000 do the work.
// Plain server-rendered HTML in the email palette: no JS, no external assets.

export interface Prefs {
  optIn: boolean;
  reminders: 'daily' | 'few_days' | 'off';
  reports: 'weekly' | 'monthly' | 'off';
  hour: number;
  /** Masked, e.g. e•••@gmail.com */
  email: string;
  needsConfirm: boolean;
}

const INK = '#1A1A1A';
const MUTED = '#5A5A5A';
const PAPER = '#F4F4F0';
const GOLD = '#8B6914';
const SANS = 'Helvetica,Arial,sans-serif';
const MONO = "Menlo,Consolas,'Courier New',monospace";
const SERIF = "Georgia,'Times New Roman',serif";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title: string, body: string, appUrl: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · PatternChess</title>
<style>
  body{margin:0;background:${PAPER};color:${INK};font:16px/1.6 ${SANS};}
  main{max-width:520px;margin:40px auto;padding:0 16px;}
  .card{background:#fff;border:2px solid ${INK};padding:24px 26px;}
  .brand{font:22px/1 ${SERIF};color:${INK};text-decoration:none;}
  .brand i{color:${GOLD};}
  h1{font:bold 22px/1.3 ${SANS};margin:20px 0 10px;}
  .muted{color:${MUTED};font-size:14px;}
  label{display:block;margin:14px 0 6px;font:bold 12px/1.4 ${MONO};text-transform:uppercase;letter-spacing:.5px;}
  select{width:100%;padding:10px;font:16px ${SANS};border:2px solid ${INK};background:#fff;color:${INK};}
  .check{display:flex;gap:10px;align-items:center;margin-top:16px;font-size:16px;text-transform:none;letter-spacing:0;font-family:${SANS};}
  .check input{width:20px;height:20px;accent-color:${GOLD};}
  button,.btn{display:inline-block;margin-top:20px;padding:13px 22px;background:${GOLD};color:#fff;border:2px solid ${INK};font:bold 13px/1 ${MONO};letter-spacing:.5px;text-transform:uppercase;text-decoration:none;cursor:pointer;}
  .note{margin-top:16px;padding:10px 12px;border:2px solid ${GOLD};font-size:14px;}
  a{color:${INK};}
</style></head>
<body><main><div class="card">
<a class="brand" href="${esc(appUrl)}">Pattern<i>Chess</i></a>
${body}
</div>
<p class="muted" style="text-align:center;margin-top:18px;">EH Solutions LLC, 2592 Mass Ave, Cambridge, MA 02140</p>
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

export function notFoundPage(appUrl: string): Response {
  return page(
    'Link expired',
    `<h1>This link doesn't work anymore</h1>
     <p>It may be from an old email. You can change your email settings any time from your profile.</p>
     <a class="btn" href="${esc(appUrl)}/profile">Open my profile</a>`,
    appUrl,
    404,
  );
}

export function unsubscribeConfirmPage(appUrl: string, action: string): Response {
  // A GET only shows this form: mail scanners prefetch links, and a GET that
  // unsubscribed would turn people's emails off without them asking.
  return page(
    'Unsubscribe',
    `<h1>Stop PatternChess emails?</h1>
     <p>You won't get training reminders or weekly reports anymore. Your account and training stay exactly as they are.</p>
     <form method="post" action="${esc(action)}"><button type="submit">Unsubscribe</button></form>`,
    appUrl,
  );
}

export function unsubscribedPage(appUrl: string, settingsUrl: string, prefs: Prefs): Response {
  return page(
    'Unsubscribed',
    `<h1>You're unsubscribed</h1>
     <p>No more emails will go to ${esc(prefs.email)}. Changed your mind, or only want some of them?</p>
     <a class="btn" href="${esc(settingsUrl)}">Choose which emails you get</a>`,
    appUrl,
  );
}

function hourLabel(h: number): string {
  if (h === 0) return '12 am (midnight)';
  if (h === 12) return '12 pm (noon)';
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${value}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

export function settingsPage(appUrl: string, action: string, prefs: Prefs, saved: boolean): Response {
  const reports = prefs.reports === 'monthly' ? 'weekly' : prefs.reports;
  const hours = Array.from({ length: 24 }, (_, h) => option(String(h), hourLabel(h), h === prefs.hour)).join('');
  return page(
    'Email settings',
    `<h1>Email settings</h1>
     <p class="muted">For ${esc(prefs.email)}</p>
     ${saved ? '<div class="note">Saved.</div>' : ''}
     ${prefs.needsConfirm ? '<div class="note">This address isn\'t confirmed yet, so nothing but the confirmation email is sent to it.</div>' : ''}
     <form method="post" action="${esc(action)}">
       <label class="check"><input type="checkbox" name="optIn" value="1"${prefs.optIn ? ' checked' : ''}> Send me PatternChess emails</label>
       <label for="reminders">Training reminders</label>
       <select id="reminders" name="reminders">
         ${option('daily', 'On days I have positions due', prefs.reminders === 'daily')}
         ${option('few_days', 'Every few days', prefs.reminders === 'few_days')}
         ${option('off', 'Off', prefs.reminders === 'off')}
       </select>
       <label for="reports">Progress report</label>
       <select id="reports" name="reports">
         ${option('weekly', 'Weekly, on Sundays', reports === 'weekly')}
         ${option('off', 'Off', reports === 'off')}
       </select>
       <label for="hour">Send them around</label>
       <select id="hour" name="hour">${hours}</select>
       <p class="muted">Your local time, from your PatternChess profile.</p>
       <button type="submit">Save</button>
     </form>`,
    appUrl,
  );
}

export function confirmedPage(appUrl: string): Response {
  return page(
    'Email confirmed',
    `<h1>Email confirmed</h1>
     <p>Training reminders and your weekly report will go to this address. Every email has a link to change or stop them.</p>
     <a class="btn" href="${esc(appUrl)}/dashboard">Open PatternChess</a>`,
    appUrl,
  );
}
