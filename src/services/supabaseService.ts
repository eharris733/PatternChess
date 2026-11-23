// Barrel for the Supabase data layer. The implementation lives in per-domain
// modules under `./db/*`; this file re-exports every function/type (for named
// imports) and assembles the aggregate `supabaseService` object (used by most
// consumers as `supabaseService.getGames(...)`). Split from a single 1331-line
// module — see the db/ modules for the actual queries.
import * as gamesDb from './db/games';
import * as blundersDb from './db/blunders';
import * as endgameScenariosDb from './db/endgameScenarios';
import * as statsDb from './db/stats';
import * as sessionsDb from './db/sessions';
import * as profilesDb from './db/profiles';
import * as annotationsDb from './db/annotations';
import * as benchmarksDb from './db/benchmarks';
import * as leaderboardDb from './db/leaderboard';
import * as openingDeviationsDb from './db/openingDeviations';
import * as repertoireDb from './db/repertoire';
import * as supportersDb from './db/supporters';
import * as vaultDb from './db/vault';
import * as cosmeticsDb from './db/cosmetics';
import * as coursesDb from './db/courses';
import * as achievementsDb from './db/achievements';

export * from './db/games';
export * from './db/blunders';
export * from './db/endgameScenarios';
export * from './db/stats';
export * from './db/sessions';
export * from './db/profiles';
export * from './db/annotations';
export * from './db/benchmarks';
export * from './db/leaderboard';
export * from './db/openingDeviations';
export * from './db/repertoire';
export * from './db/supporters';
export * from './db/vault';
export * from './db/cosmetics';
export * from './db/courses';
export * from './db/achievements';

export const supabaseService = {
  ...gamesDb,
  ...blundersDb,
  ...endgameScenariosDb,
  ...statsDb,
  ...sessionsDb,
  ...profilesDb,
  ...annotationsDb,
  ...benchmarksDb,
  ...leaderboardDb,
  ...openingDeviationsDb,
  ...repertoireDb,
  ...supportersDb,
  ...vaultDb,
  ...cosmeticsDb,
  ...coursesDb,
  ...achievementsDb,
};
