// Email templates for the notifier Worker (retention roadmap Phase 2).
// Table-based HTML (email clients ignore most CSS) in the site's light palette,
// plus a plain-text part. No images (many clients block them) and no emoji
// (CLAUDE.md). Sent from FROM_ADDRESS; reminders are opt-out, so every email
// says why it was sent and links to a one-click unsubscribe.

export const FROM_ADDRESS = 'elliot@patternchess.com';
export const FROM_NAME = 'Elliot from PatternChess';

export type EmailKind = 'welcome' | 'ready' | 'streak_at_risk' | 'daily_plan' | 'weekly_report' | 'confirm';

export interface EmailData {
  firstName: string | null;
  /** Current streak (0 when lapsed). */
  streak: number;
  /** Banked streak freezes (0–2). */
  streakFreezes: number;
  /** Trained on each of the last 7 local days, oldest first (today last). */
  last7: boolean[];
  /** Positions due now (openings excluded, as in the daily plan). */
  dueNow: number;
  positionsGoal: number;
  gamesGoal: number;
  /** Blunders from games synced since the last email. */
  freshBlunders: number;
  /** Total Elo gained by all PatternChess players (landing_stats). */
  communityElo: number;
  // weekly_report only
  report?: {
    solved: number;
    attempted: number;
    minutes: number;
    activeDays: number;
    newlyMastered: number;
    gamesPlayed: number;
    eloChange: number | null;
    leaderboardRank: number | null;
    topMotif: string | null;
  };
}

export interface EmailLinks {
  train: string;
  dashboard: string;
  /** No-login settings page (/email?t=<token>). */
  settings: string;
  /** RFC 8058 one-click endpoint; also used in the List-Unsubscribe header. */
  unsubscribe: string;
  confirm?: string;
}

export interface RenderedEmail {
  subject: string;
  /** Inbox preview line. */
  preheader: string;
  html: string;
  text: string;
}

const INK = '#1A1A1A';
const MUTED = '#5A5A5A';
const PAPER = '#F4F4F0';
const GOLD = '#8B6914';
const LINE = '#E2E2DC';
const MONO = "Menlo,Consolas,'Courier New',monospace";
const SANS = 'Helvetica,Arial,sans-serif';
const SERIF = "Georgia,'Times New Roman',serif";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function hi(d: EmailData): string {
  return d.firstName ? `Hi ${esc(d.firstName)},` : 'Hi,';
}

/** Today's plan as a sentence, sized by the player's commitment level. */
function planLine(d: EmailData): string {
  const parts = [];
  if (d.gamesGoal > 0) parts.push(`play ${plural(d.gamesGoal, 'game')}`);
  parts.push(`train ${plural(d.positionsGoal, 'position')}`);
  return parts.join(', then ');
}

type Block =
  | { kind: 'p'; html: string }
  | { kind: 'streak' }
  | { kind: 'stats'; rows: Array<[string, string]> }
  | { kind: 'cta'; label: string; href: string };

interface Body {
  subject: string;
  preheader: string;
  label: string;
  blocks: Block[];
}

function streakRow(d: EmailData): string {
  const days = d.last7.slice(-7);
  const cells = days
    .map((on, i) => {
      const today = i === days.length - 1;
      const bg = on ? GOLD : '#FFFFFF';
      const border = today && !on ? `2px dashed ${GOLD}` : `2px solid ${INK}`;
      return `<td style="padding:0 3px;"><div style="width:30px;height:30px;background:${bg};border:${border};"></div></td>`;
    })
    .join('');
  const freezes =
    d.streakFreezes > 0
      ? `<div style="margin-top:8px;font:12px/1.4 ${SANS};color:${MUTED};">${plural(d.streakFreezes, 'streak freeze')} banked: miss a day and your streak survives.</div>`
      : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;">
    <tr><td style="padding-bottom:8px;font:bold 28px/1 ${SANS};color:${INK};">${d.streak}<span style="font:13px/1 ${MONO};color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;">&nbsp; day streak</span></td></tr>
    <tr><td><table role="presentation" cellpadding="0" cellspacing="0" style="margin-left:-3px;"><tr>${cells}</tr></table>${freezes}</td></tr>
  </table>`;
}

function statsTable(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border:2px solid ${INK};">
    ${rows
      .map(
        ([label, value], i) => `<tr>
          <td style="padding:10px 14px;font:12px/1.4 ${MONO};text-transform:uppercase;letter-spacing:0.5px;color:${MUTED};${i < rows.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">${esc(label)}</td>
          <td align="right" style="padding:10px 14px;font:bold 16px/1.4 ${SANS};color:${INK};${i < rows.length - 1 ? `border-bottom:1px solid ${LINE};` : ''}">${esc(value)}</td>
        </tr>`,
      )
      .join('')}
  </table>`;
}

function cta(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;"><tr>
    <td style="background:${GOLD};border:2px solid ${INK};box-shadow:3px 3px 0 ${INK};">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 24px;font:bold 13px/1 ${MONO};letter-spacing:0.5px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;">${esc(label)}</a>
    </td>
  </tr></table>`;
}

function layout(b: Body, d: EmailData, links: EmailLinks): RenderedEmail {
  const content = b.blocks
    .map((blk) => {
      switch (blk.kind) {
        case 'p':
          return `<p style="margin:0 0 14px;">${blk.html}</p>`;
        case 'streak':
          return streakRow(d);
        case 'stats':
          return statsTable(blk.rows);
        case 'cta':
          return cta(blk.label, blk.href);
      }
    })
    .join('\n');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${esc(b.subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(b.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#FFFFFF;border:2px solid ${INK};box-shadow:4px 4px 0 ${INK};">
    <tr><td style="padding:22px 26px 0;">
      <span style="font:22px/1 ${SERIF};color:${INK};">Pattern<i style="color:${GOLD};">Chess</i></span>
    </td></tr>
    <tr><td style="padding:18px 26px 0;font:bold 11px/1 ${MONO};letter-spacing:1px;text-transform:uppercase;color:${GOLD};">${esc(b.label)}</td></tr>
    <tr><td style="padding:12px 26px 6px;font:15px/1.6 ${SANS};color:${INK};">
      ${content}
      <p style="margin:0 0 4px;">Elliot</p>
    </td></tr>
    <tr><td style="padding:14px 26px 22px;border-top:1px solid ${LINE};font:12px/1.6 ${SANS};color:${MUTED};">
      You're getting this because training reminders are on for your PatternChess account.
      <a href="${esc(links.settings)}" style="color:${MUTED};">Choose which emails you get</a> or
      <a href="${esc(links.unsubscribe)}" style="color:${MUTED};">unsubscribe in one click</a>.<br>
      EH Solutions LLC
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const strip = (s: string) =>
    s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  const textBlocks = b.blocks.map((blk) => {
    switch (blk.kind) {
      case 'p':
        return strip(blk.html);
      case 'streak':
        return `Streak: ${d.streak} days${d.streakFreezes > 0 ? ` (${plural(d.streakFreezes, 'freeze')} banked)` : ''}`;
      case 'stats':
        return blk.rows.map(([l, v]) => `${l}: ${v}`).join('\n');
      case 'cta':
        return `${blk.label}: ${blk.href}`;
    }
  });
  const text = [
    ...textBlocks,
    '',
    'Elliot',
    '',
    '--',
    "You're getting this because training reminders are on for your PatternChess account.",
    `Choose which emails you get: ${links.settings}`,
    `Unsubscribe: ${links.unsubscribe}`,
    'EH Solutions LLC',
  ].join('\n\n');

  return { subject: b.subject, preheader: b.preheader, html, text };
}

export function renderEmail(kind: EmailKind, d: EmailData, links: EmailLinks): RenderedEmail {
  switch (kind) {
    case 'welcome':
      return layout(
        {
          subject: 'Your first PatternChess plan is ready',
          preheader: 'A few positions a day from your own games. That is the whole trick.',
          label: 'Welcome',
          blocks: [
            { kind: 'p', html: hi(d) },
            {
              kind: 'p',
              html: `Thanks for signing up. Your games already show what you need to fix, so PatternChess turns them into a daily plan: <b>${planLine(d)}</b>.`,
            },
            {
              kind: 'p',
              html: `I'll send you a short reminder on days you have training due, and a progress report on Sundays. If that's too much, change it with the links at the bottom of any email.`,
            },
            { kind: 'cta', label: "Start today's plan", href: links.train },
          ],
        },
        d,
        links,
      );

    case 'ready':
      return layout(
        {
          subject: `${plural(d.dueNow, 'blunder')} from your games, ready to train`,
          preheader: 'Your first session takes about five minutes.',
          label: 'Your positions are ready',
          blocks: [
            { kind: 'p', html: hi(d) },
            {
              kind: 'p',
              html: `We went through your games and found <b>${plural(d.dueNow, 'position')}</b> where one move changed the game. Each one comes back on day 1, 3, 7 and 21 until the right move is automatic.`,
            },
            { kind: 'p', html: `Start with ${plural(Math.min(d.positionsGoal, d.dueNow), 'position')}. That's today done.` },
            { kind: 'cta', label: 'Solve the first one', href: links.train },
          ],
        },
        d,
        links,
      );

    case 'streak_at_risk': {
      const freezeNote =
        d.streakFreezes > 0
          ? `You have ${plural(d.streakFreezes, 'streak freeze')} banked, so missing today won't end it. Keeping the freeze for a day you really need it is the better move.`
          : 'It ends tonight unless you train today.';
      return layout(
        {
          subject: `Keep your ${d.streak}-day streak alive`,
          preheader: `${plural(d.positionsGoal, 'position')} is all it takes today.`,
          label: 'Streak check',
          blocks: [
            { kind: 'p', html: hi(d) },
            { kind: 'streak' },
            { kind: 'p', html: `${d.streak} days in a row. ${freezeNote}` },
            {
              kind: 'p',
              html: `Today's plan: <b>${planLine(d)}</b>. ${d.dueNow > 0 ? `${plural(d.dueNow, 'position')} ${d.dueNow === 1 ? 'is' : 'are'} waiting in your queue.` : ''}`,
            },
            { kind: 'cta', label: 'Keep the streak', href: links.train },
          ],
        },
        d,
        links,
      );
    }

    case 'daily_plan': {
      const fresh =
        d.freshBlunders > 1
          ? `Your latest games added <b>${plural(d.freshBlunders, 'fresh blunder')}</b>. That's ${d.freshBlunders} steps closer to GM.`
          : d.freshBlunders === 1
            ? 'Your latest games added one fresh blunder. Small, but it counts.'
            : 'No new games since yesterday. A game or two today gives tomorrow some fresh material.';
      return layout(
        {
          subject: `Today's plan: ${planLine(d)}`,
          preheader: `${plural(d.dueNow, 'position')} due. About ten minutes.`,
          label: "Today's plan",
          blocks: [
            { kind: 'p', html: hi(d) },
            { kind: 'p', html: fresh },
            {
              kind: 'stats',
              rows: [
                ['Games to play', String(d.gamesGoal)],
                ['Positions to train', String(d.positionsGoal)],
                ['Due in your queue', d.dueNow.toLocaleString('en-US')],
              ],
            },
            { kind: 'p', html: 'Stop procrastinating your improvement. Ten minutes today beats two hours next Sunday.' },
            { kind: 'cta', label: "Start today's plan", href: links.train },
          ],
        },
        d,
        links,
      );
    }

    case 'weekly_report': {
      const r = d.report ?? {
        solved: 0,
        attempted: 0,
        minutes: 0,
        activeDays: 0,
        newlyMastered: 0,
        gamesPlayed: 0,
        eloChange: null,
        leaderboardRank: null,
        topMotif: null,
      };
      const rows: Array<[string, string]> = [
        ['Days trained', `${r.activeDays} of 7`],
        ['Positions solved', `${r.solved} of ${r.attempted}`],
        ['Newly mastered', String(r.newlyMastered)],
        ['Games played', String(r.gamesPlayed)],
        ['Time training', `${r.minutes} min`],
      ];
      if (r.eloChange != null) rows.push(['Rating change', `${r.eloChange >= 0 ? '+' : ''}${r.eloChange}`]);
      if (r.leaderboardRank != null) rows.push(['Weekly leaderboard', `#${r.leaderboardRank}`]);
      const headline =
        r.activeDays >= 5
          ? `${r.activeDays} days out of 7. That's what consistency looks like.`
          : r.activeDays > 0
            ? `${r.activeDays} ${r.activeDays === 1 ? 'day' : 'days'} of training this week. Next week, aim for one more.`
            : 'A quiet week. One session is enough to get going again.';
      return layout(
        {
          subject: `Your week: ${plural(r.solved, 'position')} solved, ${d.streak}-day streak`,
          preheader: headline,
          label: 'Your week in chess',
          blocks: [
            { kind: 'p', html: hi(d) },
            { kind: 'p', html: headline },
            { kind: 'streak' },
            { kind: 'stats', rows },
            ...(r.topMotif
              ? [{ kind: 'p' as const, html: `Your most common blunder this week: <b>${esc(r.topMotif)}</b>. Look for it in your next game.` }]
              : []),
            {
              kind: 'p',
              html: `Across PatternChess, players have gained <b>${d.communityElo.toLocaleString('en-US')} Elo</b> so far. Keep adding to it.`,
            },
            { kind: 'cta', label: 'See your dashboard', href: links.dashboard },
          ],
        },
        d,
        links,
      );
    }

    case 'confirm':
      return layout(
        {
          subject: 'Confirm your email for PatternChess',
          preheader: 'One click and your training reminders are on.',
          label: 'Confirm your email',
          blocks: [
            { kind: 'p', html: hi(d) },
            {
              kind: 'p',
              html: 'Confirm this address and PatternChess will remind you when positions from your games are due, plus a weekly progress report.',
            },
            { kind: 'p', html: "If you didn't ask for this, ignore this email and nothing more will be sent." },
            { kind: 'cta', label: 'Confirm my email', href: links.confirm ?? links.settings },
          ],
        },
        d,
        links,
      );
  }
}
