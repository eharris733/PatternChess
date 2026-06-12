import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { isAdminEmail } from '../auth/admin';
import { SyncIndicator } from './SyncIndicator';
import { StreakBadge } from './insights/StreakBadge';
import { BrandLockup, BrandMark } from './BrandLogo';
import { DashboardIcon } from './icons/DashboardIcon';
import { VaultIcon } from './icons/VaultIcon';
import { TrainIcon } from './icons/TrainIcon';
import { AnalyticsIcon } from './icons/AnalyticsIcon';
import { TrophyIcon } from './icons/TrophyIcon';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { to: '/vault', label: 'Vault', Icon: VaultIcon },
  { to: '/training', label: 'Train', Icon: TrainIcon },
  { to: '/achievements', label: 'Achievements', Icon: TrophyIcon },
];

const ADMIN_NAV_ITEM = { to: '/analytics', label: 'Analytics', Icon: AnalyticsIcon };

export function SidebarNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { profile, user } = useAuth();
  const navItems = isAdminEmail(user?.email) ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  const firstName =
    (profile?.displayName ??
      (user?.user_metadata?.full_name as string | undefined) ??
      user?.email?.split('@')[0] ??
      'there')
      .trim()
      .split(/\s+/)[0];

  return (
    <div className="flex flex-col h-full py-3">
      <button
        onClick={onToggle}
        className={clsx(
          'mx-2 mb-2 flex items-center rounded-none hover:bg-text-primary/5 transition text-left',
          collapsed ? 'justify-center p-2' : 'px-3 py-2',
        )}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <BrandMark className="h-8 w-8 shrink-0" />
        ) : (
          <BrandLockup size="md" />
        )}
      </button>

      <nav className="flex flex-col gap-0.5 mt-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            className={({ isActive }) =>
              clsx(
                'mx-2 flex items-center gap-3 py-2.5 rounded-none font-mono uppercase tracking-tight text-xs transition-colors',
                collapsed ? 'justify-center px-0' : 'px-3',
                isActive
                  ? 'bg-accent/15 text-text-primary shadow-[inset_3px_0_0_rgb(var(--accent))]'
                  : 'text-text-primary hover:bg-accent/10',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('shrink-0', isActive ? 'text-gold-light' : 'text-text-primary')}>
                  <item.Icon className="h-5 w-5" />
                </span>
                {!collapsed && <span>{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto" />

      <SyncIndicator collapsed={collapsed} />

      <div className="mx-2 mb-1 border-2 border-text-primary bg-surface-3 divide-y-2 divide-text-primary/30">
        <StreakBadge collapsed={collapsed} />

        <NavLink
          to="/profile"
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 py-2.5 rounded-none font-mono uppercase tracking-tight text-xs transition-colors',
              collapsed ? 'justify-center px-0' : 'px-3',
              isActive
                ? 'bg-accent/15 text-text-primary shadow-[inset_3px_0_0_rgb(var(--accent))]'
                : 'text-text-primary hover:bg-accent/10',
            )
          }
        >
          {profile?.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-full shrink-0 border-2 border-text-primary"
            />
          ) : (
            <span className="w-7 h-7 rounded-full bg-text-primary text-bg shrink-0 flex items-center justify-center text-xs">
              {firstName.charAt(0).toUpperCase()}
            </span>
          )}
          {!collapsed && <span className="truncate">{firstName}</span>}
        </NavLink>
      </div>
    </div>
  );
}
