import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../models/user_profile.dart';
import '../services/auth_service.dart';
import 'sidebar_nav.dart';

class AppShell extends StatefulWidget {
  final String activeRoute;
  final Widget child;
  final Widget? rightPanel;

  const AppShell({
    super.key,
    required this.activeRoute,
    required this.child,
    this.rightPanel,
  });

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  bool _collapsed = false;
  UserProfile? _profile;

  @override
  void initState() {
    super.initState();
    _loadProfile();
    AuthService.authStateChanges.listen((_) => _loadProfile());
  }

  Future<void> _loadProfile() async {
    if (!AuthService.isLoggedIn) {
      if (mounted) setState(() => _profile = null);
      return;
    }
    try {
      final profile = await AuthService.getProfile();
      if (mounted) setState(() => _profile = profile);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: Row(
          children: [
            SidebarNav(
              activeRoute: widget.activeRoute,
              collapsed: _collapsed,
              onToggleCollapse: () =>
                  setState(() => _collapsed = !_collapsed),
              profile: _profile,
              onSignInTap: () =>
                  Navigator.pushNamed(context, '/login'),
            ),
            Expanded(child: widget.child),
            if (widget.rightPanel != null)
              SizedBox(
                width: 300,
                child: widget.rightPanel!,
              ),
          ],
        ),
      ),
    );
  }
}
