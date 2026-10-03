import { Link } from 'react-router-dom';
import { InviteCard } from '../components/achievements/InviteCard';
import { LeaderboardPanel } from '../components/achievements/LeaderboardPanel';

export function LeaderboardsRoute() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="label">Community</span>
        <h1 className="heading-xl">Leaderboards</h1>
        <p className="text-text-secondary text-sm">
          How your training stacks up against everyone else on PatternChess. Your milestones are on{' '}
          <Link to="/achievements" className="underline">
            your achievements page
          </Link>
          .
        </p>
      </header>
      <InviteCard />
      <LeaderboardPanel />
    </div>
  );
}
