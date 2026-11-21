// Render every email kind with sample data to HTML files for review.
//   node --experimental-strip-types workers/notifier/scripts/preview.ts <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderEmail, type EmailData, type EmailKind, type EmailLinks } from '../src/templates.ts';

const outDir = process.argv[2] ?? 'email-previews';
mkdirSync(outDir, { recursive: true });

const data: EmailData = {
  firstName: 'Elliot',
  streak: 12,
  streakFreezes: 1,
  last7: [true, true, true, true, true, true, false],
  dueNow: 23,
  positionsGoal: 10,
  gamesGoal: 1,
  freshBlunders: 5,
  communityElo: 3037,
  report: {
    solved: 52,
    attempted: 61,
    minutes: 74,
    activeDays: 6,
    newlyMastered: 4,
    gamesPlayed: 9,
    eloChange: 18,
    leaderboardRank: 7,
    topMotif: 'Missed fork',
  },
};

const links: EmailLinks = {
  train: 'https://patternchess.com/training?utm_source=email',
  dashboard: 'https://patternchess.com/dashboard?utm_source=email',
  settings: 'https://patternchess.com/email?t=preview',
  unsubscribe: 'https://patternchess.com/email?t=preview&unsubscribe=1',
  confirm: 'https://patternchess.com/email?confirm=preview',
};

const kinds: EmailKind[] = ['welcome', 'ready', 'streak_at_risk', 'daily_plan', 'weekly_report', 'confirm'];
for (const kind of kinds) {
  const e = renderEmail(kind, data, links);
  writeFileSync(join(outDir, `${kind}.html`), e.html);
  writeFileSync(join(outDir, `${kind}.txt`), e.text);
  writeFileSync(join(outDir, `${kind}.json`), JSON.stringify({ subject: e.subject, preheader: e.preheader }));
  console.log(`${kind}: ${e.subject}`);
}
