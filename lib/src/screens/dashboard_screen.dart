import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../services/auth_service.dart';
import '../services/supabase_service.dart';
import '../widgets/app_shell.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  int _dueCount = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadDueCount();
  }

  Future<void> _loadDueCount() async {
    try {
      final blunders = await SupabaseService.getDueBlunders();
      if (mounted) {
        setState(() {
          _dueCount = blunders.length;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = AuthService.currentUser;
    final greeting = user?.userMetadata?['full_name'] as String? ??
        user?.userMetadata?['name'] as String? ??
        'there';

    return AppShell(
      activeRoute: '/',
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Hey $greeting',
                  style: Theme.of(context).textTheme.headlineLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                if (_loading)
                  const Center(
                    child: CircularProgressIndicator(color: AppTheme.accent),
                  )
                else ...[
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: AppTheme.surface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      children: [
                        Text(
                          '$_dueCount',
                          style: const TextStyle(
                            color: AppTheme.accent,
                            fontSize: 48,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _dueCount == 1
                              ? 'position due today'
                              : 'positions due today',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    height: 48,
                    child: ElevatedButton(
                      onPressed: _dueCount > 0
                          ? () =>
                              Navigator.pushNamed(context, '/training')
                          : null,
                      child: Text(
                        _dueCount > 0
                            ? 'START TRAINING'
                            : 'NO POSITIONS DUE',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 48,
                    child: OutlinedButton(
                      onPressed: () =>
                          Navigator.pushNamed(context, '/vault'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.textSecondary,
                        side: const BorderSide(
                            color: AppTheme.surfaceLight),
                      ),
                      child: const Text('IMPORT GAMES'),
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
