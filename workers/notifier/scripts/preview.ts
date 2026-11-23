// Render every email kind with sample data to HTML files for review.
//   node --experimental-strip-types workers/notifier/scripts/preview.ts <out-dir>
// The weekly report includes "Events near you" with sample listings; set
// EVENTS_STATE=MA (any US state code) to use that state's live listing from
// events.patternchess.com instead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_SITE, stateEventsLoader, stateEventsUrl, type NearbyEvent } from '../src/events.ts';
import { renderEmail, type EmailData, type EmailKind, type EmailLinks } from '../src/templates.ts';
import { US_STATE_NAME } from '../src/usStates.ts';

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

const SAMPLE_EVENTS: NearbyEvent[] = [
  {
    title: 'Holiday Season Six-Week Swiss',
    when: 'Rd 2 of 6 · Tue, Dec 1 · 6:30 PM',
    where: 'Boylston Chess Foundation · Boston',
    url: `${EVENTS_SITE}/events/9389`,
  },
  {
    title: 'MCC Monthly Swiss',
    when: 'Rd 1 of 4 · Thu, Dec 3 · 7:30 PM',
    where: 'MetroWest Chess Club · Framingham',
    url: `${EVENTS_SITE}/events/41`,
  },
  {
    title: 'Wachusett Saturday Quads',
    when: 'Sat, Dec 5 · 10:00 AM',
    where: 'Wachusett Chess Club · Fitchburg',
    url: `${EVENTS_SITE}/events/12`,
  },
];

const liveState = process.env.EVENTS_STATE?.toUpperCase();
const eventsState = liveState && US_STATE_NAME[liveState] ? liveState : 'MA';
let items = SAMPLE_EVENTS;
if (liveState) {
  const today = new Date().toISOString().slice(0, 10);
  const live = await stateEventsLoader(fetch)(eventsState, today);
  if (live) items = live;
  else console.warn(`events API unavailable for ${eventsState}; using sample listings`);
}
data.nearbyEvents = items.length
  ? { stateName: US_STATE_NAME[eventsState], items, seeAllUrl: stateEventsUrl(EVENTS_SITE, eventsState) }
  : undefined;

const links: EmailLinks = {
  train: 'https://patternchess.com/training?utm_source=email',
  dashboard: 'https://patternchess.com/dashboard?utm_source=email',
  settings: 'https://email.patternchess.com/settings?t=preview',
  unsubscribe: 'https://email.patternchess.com/unsubscribe?t=preview',
  confirm: 'https://email.patternchess.com/confirm?c=preview',
};

const kinds: EmailKind[] = ['welcome', 'ready', 'streak_at_risk', 'daily_plan', 'weekly_report', 'confirm'];
for (const kind of kinds) {
  const e = renderEmail(kind, data, links);
  writeFileSync(join(outDir, `${kind}.html`), e.html);
  writeFileSync(join(outDir, `${kind}.txt`), e.text);
  writeFileSync(join(outDir, `${kind}.json`), JSON.stringify({ subject: e.subject, preheader: e.preheader }));
  console.log(`${kind}: ${e.subject}`);
}
