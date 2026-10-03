import { Link } from 'react-router-dom';
import { AchievementsSection } from '../components/achievements/AchievementsSection';

export function AchievementsRoute() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link to="/profile" className="label hover:text-gold-dark self-start">
          ← Profile
        </Link>
        <h1 className="heading-xl">Your milestones</h1>
        <p className="text-text-primary text-sm">
          Earned by training. Share any you've unlocked, or see how you stack up on the{' '}
          <Link to="/leaderboards" className="underline">
            leaderboards
          </Link>
          .
        </p>
      </header>
      <AchievementsSection />
    </div>
  );
}
