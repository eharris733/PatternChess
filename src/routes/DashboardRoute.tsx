import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { startBlunderEnrichment } from '../services/blunderEnrichmentBackfill';
import { DailyHabitCard } from '../components/insights/DailyHabitCard';
import { CycleTimelineCard } from '../components/insights/CycleTimelineCard';
import { HowTrainingWorksCard } from '../components/insights/HowTrainingWorksCard';
import { GetStartedHero } from '../components/insights/GetStartedHero';
import { RankBadge } from '../components/insights/RankBadge';
import { OpeningInsightsCard } from '../components/insights/OpeningInsightsCard';
import { PhaseBlunderCard } from '../components/insights/PhaseBlunderCard';
import { MotifWeaknessCard } from '../components/insights/MotifWeaknessCard';
import { TimeManagementCard } from '../components/insights/TimeManagementCard';
import { TimeTroubleCard } from '../components/insights/TimeTroubleCard';
import { GameStateCard } from '../components/insights/GameStateCard';
import { RatingProgressCard } from '../components/insights/RatingProgressCard';
import { UpcomingEventsCard } from '../components/insights/UpcomingEventsCard';
import { Skeleton } from '../components/Skeleton';

export function DashboardRoute() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const gamesQuery = useGames();

  // Quietly enrich legacy blunders (engine line + motif tags) while the user
  // is here; stops on unmount so training/review get the engine to themselves.
  useEffect(() => startBlunderEnrichment(), []);

  const gamesLoading = gamesQuery.isPending;
  const gamesCount = gamesQuery.data?.length ?? 0;
  const hasAccount = !!(profile?.lichessUsername || profile?.chesscomUsername);
  // First-run: never linked an external account and no games (uploaded PGNs
  // count as games, so a PGN-only user falls out of this state once they
  // import).
  const isFirstRun = !gamesLoading && !hasAccount && gamesCount === 0;
  const firstName =
    (profile?.displayName ??
      (user?.user_metadata?.full_name as string | undefined) ??
      user?.email?.split('@')[0] ??
      'there')
      .trim()
      .split(/\s+/)[0];

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        {isFirstRun ? (
          <>
            <span className="label">Welcome to PatternChess</span>
            <h1 className="heading-xl">{firstName}, let's get started.</h1>
          </>
        ) : (
          <>
            <h1 className="heading-xl">Hey {firstName}</h1>
            <RankBadge variant="compact" />
          </>
        )}
      </header>

      {!isFirstRun && <HowTrainingWorksCard />}

      {isFirstRun ? <GetStartedHero /> : <DailyHabitCard />}

      {!isFirstRun && <CycleTimelineCard />}

      {!isFirstRun && <RatingProgressCard />}

      {!isFirstRun && (
        <button
          className="card text-left hover:border-accent transition"
          onClick={() => navigate('/vault')}
        >
          <span className="label">Vault</span>
          {gamesLoading ? (
            <Skeleton className="h-6 w-24 mt-2" />
          ) : (
            <p className="heading-md mt-2">{gamesCount} games</p>
          )}
          <p className="text-text-secondary text-sm mt-1">Browse and review your imports.</p>
        </button>
      )}

      {!isFirstRun && <UpcomingEventsCard />}

      <MotifWeaknessCard />
      <OpeningInsightsCard />
      <PhaseBlunderCard />
      <TimeManagementCard />
      <TimeTroubleCard />
      <GameStateCard />
    </div>
  );
}
