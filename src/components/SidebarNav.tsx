import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../auth/useAuth';
import { SyncIndicator } from './SyncIndicator';
import { StreakBadge } from './insights/StreakBadge';
import { BrandLockup, BrandMark } from './BrandLogo';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: '◐' },
  { to: '/vault', label: 'Vault', icon: '▤' },
  { to: '/training', label: 'Train', icon: '✦' },
];

export function SidebarNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { profile, user } = useAuth();
  const displayName =
    profile?.displayName ?? (user?.email ? user.email.split('@')[0] : 'Guest');

  return (
    <div className="flex flex-col h-full py-3">
      <button
        onClick={onToggle}
        className={clsx(
          'mx-2 mb-2 flex items-center rounded-none hover:bg-[#1A1A1A]/5 transition text-left',
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
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            className={({ isActive }) =>
              clsx(
                'mx-2 flex items-center gap-3 px-3 py-2.5 rounded-none font-mono uppercase tracking-tight text-xs transition-colors',
                isActive
                  ? 'bg-[#1A1A1A] text-[#F4F4F0]'
                  : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/5',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('shrink-0 text-base', isActive ? 'text-gold-light' : 'text-[#1A1A1A]')}>
                  {item.icon}
                </span>
                {!collapsed && <span>{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto" />

      <StreakBadge collapsed={collapsed} />

      <SyncIndicator collapsed={collapsed} />

      <NavLink
        to="/profile"
        className={({ isActive }) =>
          clsx(
            'mx-2 mb-1 flex items-center gap-3 px-3 py-2.5 rounded-none font-mono uppercase tracking-tight text-xs transition-colors',
            isActive
              ? 'bg-[#1A1A1A] text-[#F4F4F0]'
              : 'text-[#1A1A1A] hover:bg-[#1A1A1A]/5',
          )
        }
      >
        {profile?.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt=""
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-full shrink-0 border-2 border-[#1A1A1A]"
          />
        ) : (
          <span className="w-7 h-7 rounded-full bg-[#1A1A1A] text-[#F4F4F0] shrink-0 flex items-center justify-center text-xs">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
        {!collapsed && <span className="truncate">{displayName}</span>}
      </NavLink>
    </div>
  );
}
