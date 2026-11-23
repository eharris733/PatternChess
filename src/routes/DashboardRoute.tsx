import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useGameCount } from '../hooks/useGameCount';
import { startBlunderMaintenance } from '../services/blunderEnrichmentBackfill';
import { startEndgameScenarioVerification } from '../services/endgameScenarioVerifier';
import { startOpeningBackfill } from '../services/openingClassificationService';
import { startOpeningDeviationScan } from '../services/openingDeviationService';
import { DailyHabitCard } from '../components/insights/DailyHabitCard';
import { CycleTimelineCard } from '../components/insights/CycleTimelineCard';
import { HowTrainingWorksCard } from '../components/insights/HowTrainingWorksCard';
import { GetStartedHero } from '../components/insights/GetStartedHero';
import { OpeningInsightsCard } from '../components/insights/OpeningInsightsCard';
import { PhaseBlunderCard } from '../components/insights/PhaseBlunderCard';
import { MotifWeaknessCard } from '../components/insights/MotifWeaknessCard';
import { TimeManagementCard } from '../components/insights/TimeManagementCard';
import { TimeTroubleCard } from '../components/insights/TimeTroubleCard';
import { GameStateCard } from '../components/insights/GameStateCard';
import { EndgameRescueCard } from '../components/insights/EndgameRescueCard';
import { RatingProgressCard } from '../components/insights/RatingProgressCard';
import { UpcomingEventsCard } from '../components/insights/UpcomingEventsCard';
import { StatStrip } from '../components/insights/StatStrip';
import { useBlunderStats } from '../hooks/useBlunderStats';
import { FreshBlundersCard } from '../components/insights/FreshBlundersCard';
import { NextAskSlot } from '../components/email/NextAskSlot';
import { streakStatus } from '../services/streakService';
import type { UserProfile } from '../models/userProfile';

// Background jobs wait this long after the dashboard mounts.
const JOB_START_DELAY_MS = 3_000;

/** Start a background job after a delay; the returned cleanup cancels or stops it. */
function deferJob(start: () => () => void): () => void {
  let stop: (() => void) | null = null;
  const timer = setTimeout(() => {
    stop = start();
  }, JOB_START_DELAY_MS);
  return () => {
    clearTimeout(timer);
    stop?.();
  };
}

export function DashboardRoute() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const gameCountQuery = useGameCount();
  const statsQuery = useBlunderStats();

  // All four jobs start a few seconds after mount (deferJob) so their count
  // queries, engine boot and CPU work don't compete with the dashboard's own
  // first load.
  // Quietly enrich legacy blunders and deepen shallow first-pass analyses
  // (timed re-analysis of evals + solution PVs) while the user is here; stops
  // on unmount so training/review get the engine to themselves.
  useEffect(() => deferJob(startBlunderMaintenance), []);
  // Deep re-check of newly derived endgame scenarios; yields to the worker
  // above (same engine) and picks up on the next visit if it had to.
  useEffect(() => deferJob(startEndgameScenarioVerification), []);
  // Classify openings on games that predate the position-based classifier.
  // Pure CPU (no engine), so it runs alongside the two workers above.
  useEffect(() => deferJob(startOpeningBackfill), []);
  // Walk games through the opening book for /openings (network), then score
  // the exits on the engine — yielding to the two engine workers above.
  useEffect(() => deferJob(startOpeningDeviationScan), []);

  // One count call (never the full games list: dashboard cards must not gate on it).
  const gamesLoading = gameCountQuery.isPending;
  const gamesCount = gameCountQuery.data ?? 0;
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);
  // First-run: never linked an external account and no games (uploaded PGNs
  // count as games, so a PGN-only user falls out of this state once they
  // import).
  const isFirstRun = !gamesLoading && !hasAccount && gamesCount === 0;
  // The explainer earns its place only until the first drill; after that it
  // collapses to a one-line disclosure (the card handles the dismissed state).
  const showExplainer = !isFirstRun && (statsQuery.data?.attempted ?? 1) === 0;
  const firstName =
    (profile?.displayName ??
      (user?.user_metadata?.full_name as string | undefined) ??
      user?.email?.split('@')[0] ??
      'there')
      .trim()
      .split(/\s+/)[0];

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        {isFirstRun ? (
          <>
            <span className="label">Welcome to PatternChess</span>
            <h1 className="heading-xl">{firstName}, let's get started.</h1>
          </>
        ) : (
          <h1 className="heading-xl">{greeting(profile, firstName)}</h1>
        )}
      </header>

      {!isFirstRun && <StatStrip />}

      {showExplainer && <HowTrainingWorksCard />}

      {!isFirstRun && <FreshBlundersCard />}

      {!isFirstRun && <NextAskSlot />}

      {isFirstRun ? <GetStartedHero /> : <DailyHabitCard />}

      {/* Insight cards pack into two columns on wide screens. Each card
          renders nothing until it has data, and the spacing sits on the
          rendered children, so a missing card never leaves a gap. */}
      {!isFirstRun && (
        <div
          className="columns-1 lg:columns-2 gap-5 [&>*]:mb-5 [&>*]:break-inside-avoid [&>*]:w-full"
          data-testid="dashboard-insights"
        >
          <CycleTimelineCard />
          <EndgameRescueCard />
          <RatingProgressCard />
          <UpcomingEventsCard />
          <MotifWeaknessCard />
          <OpeningInsightsCard />
          <PhaseBlunderCard />
          <TimeManagementCard />
          <TimeTroubleCard />
          <GameStateCard />
          {!gamesLoading && gamesCount > 0 && (
            <button
              className="card block text-left hover:border-accent transition"
              onClick={() => navigate('/vault?tab=games')}
            >
              <span className="label">Vault</span>
              <p className="heading-md mt-1">
                <span className="font-mono">{gamesCount.toLocaleString()}</span> games
              </p>
              <p className="text-text-primary text-sm mt-1">Every game you've imported, and the blunders in each.</p>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The most-seen line carries the streak; a lapsed streak gets a welcome back.
function greeting(profile: UserProfile | null, firstName: string): string {
  if (profile && profile.currentStreakDays > 0) {
    const { alive } = streakStatus({
      currentStreakDays: profile.currentStreakDays,
      lastDrillLocalDate: profile.lastDrillLocalDate,
      timezone: profile.timezone,
      streakFreezes: profile.streakFreezes,
    });
    if (!alive) return `Welcome back, ${firstName}.`;
    if (profile.currentStreakDays >= 2) return `Day ${profile.currentStreakDays}, ${firstName}. Keep it going.`;
  }
  return `Hey ${firstName}`;
}
