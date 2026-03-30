import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../models/user_profile.dart';

class NavItem {
  final String route;
  final String label;
  final IconData icon;

  const NavItem({
    required this.route,
    required this.label,
    required this.icon,
  });
}

const navItems = [
  NavItem(route: '/', label: 'Dashboard', icon: Icons.dashboard_outlined),
  NavItem(route: '/vault', label: 'Vault', icon: Icons.archive_outlined),
  NavItem(route: '/training', label: 'Training', icon: Icons.fitness_center),
  NavItem(route: '/profile', label: 'Profile', icon: Icons.person_outline),
];

class SidebarNav extends StatelessWidget {
  final String activeRoute;
  final bool collapsed;
  final VoidCallback onToggleCollapse;
  final UserProfile? profile;
  final VoidCallback? onSignInTap;

  const SidebarNav({
    super.key,
    required this.activeRoute,
    required this.collapsed,
    required this.onToggleCollapse,
    this.profile,
    this.onSignInTap,
  });

  @override
  Widget build(BuildContext context) {
    final width = collapsed ? 56.0 : 220.0;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: width,
      color: AppTheme.surface,
      child: Column(
        children: [
          // Logo / collapse toggle
          _buildHeader(),
          const SizedBox(height: 8),

          // Nav items
          for (final item in navItems) _buildNavItem(context, item),

          const Spacer(),

          // Profile or sign-in at bottom
          _buildProfileSection(context),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      child: Row(
        children: [
          IconButton(
            icon: Icon(
              collapsed ? Icons.chevron_right : Icons.chevron_left,
              color: AppTheme.textSecondary,
              size: 20,
            ),
            onPressed: onToggleCollapse,
            tooltip: collapsed ? 'Expand' : 'Collapse',
          ),
          if (!collapsed) ...[
            const SizedBox(width: 4),
            const Expanded(
              child: Text(
                'Pattern Chess',
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildNavItem(BuildContext context, NavItem item) {
    final active = activeRoute == item.route;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: Material(
        color: active
            ? AppTheme.accent.withValues(alpha: 0.2)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () {
            if (!active) {
              Navigator.pushReplacementNamed(context, item.route);
            }
          },
          child: Padding(
            padding: EdgeInsets.symmetric(
              horizontal: collapsed ? 8 : 12,
              vertical: 10,
            ),
            child: Row(
              children: [
                Icon(
                  item.icon,
                  color: active ? AppTheme.accent : AppTheme.textSecondary,
                  size: 22,
                ),
                if (!collapsed) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      item.label,
                      style: TextStyle(
                        color: active
                            ? AppTheme.textPrimary
                            : AppTheme.textSecondary,
                        fontWeight:
                            active ? FontWeight.w600 : FontWeight.normal,
                        fontSize: 14,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProfileSection(BuildContext context) {
    if (profile != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => Navigator.pushReplacementNamed(context, '/profile'),
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: AppTheme.accent,
                  backgroundImage: profile!.avatarUrl != null
                      ? NetworkImage(profile!.avatarUrl!)
                      : null,
                  child: profile!.avatarUrl == null
                      ? Text(
                          (profile!.displayName ?? '?')[0].toUpperCase(),
                          style: const TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                          ),
                        )
                      : null,
                ),
                if (!collapsed) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      profile!.displayName ?? 'User',
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onSignInTap,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                const Icon(
                  Icons.login,
                  color: AppTheme.textSecondary,
                  size: 22,
                ),
                if (!collapsed) ...[
                  const SizedBox(width: 10),
                  const Text(
                    'Sign In',
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
