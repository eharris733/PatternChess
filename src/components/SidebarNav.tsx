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
import { EndgameIcon } from './icons/EndgameIcon';
import { OpeningIcon } from './icons/OpeningIcon';
import { PathIcon } from './icons/PathIcon';
import { featureVisible, type Feature } from '../lib/features';
import { CourseIcon } from './icons/CourseIcon';
import { AVAILABLE_COURSES } from '../lib/courses';
import { SettingsLink } from './SettingsLink';
import { MyAvatar } from './avatar/PixelAvatar';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/i18n';

const NAV_ITEMS = [
  { to: '/dashboard', labelKey: 'nav.dashboard' as MessageKey, Icon: DashboardIcon },
  { to: '/vault', labelKey: 'nav.vault' as MessageKey, Icon: VaultIcon },
  { to: '/training', labelKey: 'nav.train' as MessageKey, Icon: TrainIcon },
  { to: '/openings', labelKey: 'nav.openings' as MessageKey, Icon: OpeningIcon },
  { to: '/endgames', labelKey: 'nav.endgames' as MessageKey, Icon: EndgameIcon },
  { to: '/path', labelKey: 'nav.path' as MessageKey, Icon: PathIcon, feature: 'path' as Feature },
  // Only once a course is live in this build (production: creator permission granted).
  ...(AVAILABLE_COURSES.length > 0 ? [{ to: '/courses', labelKey: 'nav.courses' as MessageKey, Icon: CourseIcon }] : []),
  { to: '/leaderboards', labelKey: 'nav.leaderboards' as MessageKey, Icon: TrophyIcon },
];

const ADMIN_NAV_ITEM = { to: '/analytics', labelKey: 'nav.analytics' as MessageKey, Icon: AnalyticsIcon };

export function SidebarNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { profile, user } = useAuth();
  const t = useT();
  const released = NAV_ITEMS.filter((item) => {
    const feature = (item as { feature?: Feature }).feature;
    return !feature || featureVisible(feature, user?.email);
  });
  const navItems = isAdminEmail(user?.email) ? [...released, ADMIN_NAV_ITEM] : released;
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
        aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
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
                {!collapsed && <span>{t(item.labelKey)}</span>}
              </>
            )}
          </NavLink>
        ))}

      </nav>

      <div className="mt-auto" />

      <SyncIndicator collapsed={collapsed} />

      <div className="mx-2 mb-1 border-2 border-text-primary bg-surface-3 divide-y-2 divide-text-primary/30">
        <StreakBadge collapsed={collapsed} />

        <div className="flex items-center">
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              clsx(
                'flex min-w-0 flex-1 items-center gap-3 py-2.5 rounded-none font-mono uppercase tracking-tight text-xs transition-colors',
                collapsed ? 'justify-center px-0' : 'px-3',
                isActive
                  ? 'bg-accent/15 text-text-primary shadow-[inset_3px_0_0_rgb(var(--accent))]'
                  : 'text-text-primary hover:bg-accent/10',
              )
            }
          >
            {/* The pixel avatar (src/lib/avatar.ts) replaces the OAuth photo. */}
            <MyAvatar className="w-7 h-7 shrink-0 border-2 border-text-primary" />
            {!collapsed && <span className="truncate">{firstName}</span>}
          </NavLink>
          {/* Collapsed rail is too narrow for a second control. */}
          {!collapsed && <SettingsLink className="mr-1.5 h-8 w-8 border-0 hover:bg-accent/10" />}
        </div>
      </div>
    </div>
  );
}
