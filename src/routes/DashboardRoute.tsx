import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useGames } from '../hooks/useGames';
import { DailyHomeworkCard } from '../components/insights/DailyHomeworkCard';
import { StreakTile } from '../components/insights/StreakTile';
import { RankBadge } from '../components/insights/RankBadge';
import { OpeningInsightsCard } from '../components/insights/OpeningInsightsCard';
import { PhaseBlunderCard } from '../components/insights/PhaseBlunderCard';
import { TimeManagementCard } from '../components/insights/TimeManagementCard';

export function DashboardRoute() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const gamesQuery = useGames();

  const gamesCount = gamesQuery.data?.length ?? 0;
  const greeting =
    profile?.displayName ??
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    'there';

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-text-secondary text-sm">Welcome back</p>
        <h1 className="heading-xl">Hey {greeting}.</h1>
        <RankBadge variant="compact" />
      </header>

      <DailyHomeworkCard />

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StreakTile />
        <button
          className="card text-left hover:border-accent transition"
          onClick={() => navigate('/vault')}
        >
          <span className="label">Vault</span>
          <p className="heading-md mt-2">{gamesCount} games</p>
          <p className="text-text-secondary text-sm mt-1">Browse and review your imports.</p>
        </button>
      </section>

      <OpeningInsightsCard />
      <PhaseBlunderCard />
      <TimeManagementCard />
    </div>
  );
}
