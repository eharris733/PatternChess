import { useEffect } from 'react';
import { BackLink } from '../components/BackLink';
import { Link } from 'react-router-dom';
import { AchievementsSection } from '../components/achievements/AchievementsSection';
import { useAchievements } from '../hooks/useAchievements';

export function AchievementsRoute() {
  // Visiting the page clears the profile trophy's unseen badge.
  const { markViewed } = useAchievements();
  useEffect(() => markViewed(), [markViewed]);
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <BackLink to="/profile" label="Profile" />
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
