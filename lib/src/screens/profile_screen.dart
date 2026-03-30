import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../models/user_profile.dart';
import '../services/auth_service.dart';
import '../widgets/app_shell.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  UserProfile? _profile;
  bool _loading = true;
  final _lichessController = TextEditingController();
  final _chesscomController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  @override
  void dispose() {
    _lichessController.dispose();
    _chesscomController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    if (!AuthService.isLoggedIn) {
      if (mounted) setState(() => _loading = false);
      return;
    }

    try {
      final profile = await AuthService.getOrCreateProfile();
      if (mounted) {
        setState(() {
          _profile = profile;
          _lichessController.text = profile.lichessUsername ?? '';
          _chesscomController.text = profile.chesscomUsername ?? '';
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _saveLinkedAccounts() async {
    final profile = _profile;
    if (profile == null) return;

    final updated = profile.copyWith(
      lichessUsername: _lichessController.text.trim().isEmpty
          ? null
          : _lichessController.text.trim(),
      chesscomUsername: _chesscomController.text.trim().isEmpty
          ? null
          : _chesscomController.text.trim(),
    );

    await AuthService.updateProfile(updated);
    if (mounted) {
      setState(() => _profile = updated);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Accounts linked')),
      );
    }
  }

  Future<void> _signOut() async {
    await AuthService.signOut();
    if (mounted) {
      Navigator.pushReplacementNamed(context, '/');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      activeRoute: '/profile',
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: _loading
                ? const Center(
                    child:
                        CircularProgressIndicator(color: AppTheme.accent))
                : !AuthService.isLoggedIn
                    ? _buildSignInPrompt()
                    : _buildProfile(),
          ),
        ),
      ),
    );
  }

  Widget _buildSignInPrompt() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.person_outline,
            size: 48, color: AppTheme.textSecondary),
        const SizedBox(height: 12),
        Text('Sign in to view your profile',
            style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: () => Navigator.pushNamed(context, '/login'),
          child: const Text('SIGN IN'),
        ),
      ],
    );
  }

  Widget _buildProfile() {
    final profile = _profile;
    if (profile == null) return const SizedBox.shrink();

    return ListView(
      children: [
        // Avatar + name
        Center(
          child: Column(
            children: [
              CircleAvatar(
                radius: 40,
                backgroundColor: AppTheme.accent,
                backgroundImage: profile.avatarUrl != null
                    ? NetworkImage(profile.avatarUrl!)
                    : null,
                child: profile.avatarUrl == null
                    ? Text(
                        (profile.displayName ?? '?')[0].toUpperCase(),
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 32,
                          fontWeight: FontWeight.bold,
                        ),
                      )
                    : null,
              ),
              const SizedBox(height: 12),
              Text(
                profile.displayName ?? 'User',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              Text(
                AuthService.currentUser?.email ?? '',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),

        const SizedBox(height: 32),

        // Linked accounts
        const Text(
          'LINKED ACCOUNTS',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.bold,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _lichessController,
          decoration: const InputDecoration(
            labelText: 'Lichess username',
            prefixIcon: Icon(Icons.link),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _chesscomController,
          decoration: const InputDecoration(
            labelText: 'Chess.com username',
            prefixIcon: Icon(Icons.link),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 40,
          child: ElevatedButton(
            onPressed: _saveLinkedAccounts,
            child: const Text('SAVE'),
          ),
        ),

        const SizedBox(height: 32),

        // Sign out
        SizedBox(
          height: 40,
          child: OutlinedButton(
            onPressed: _signOut,
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTheme.incorrect,
              side: const BorderSide(color: AppTheme.incorrect),
            ),
            child: const Text('SIGN OUT'),
          ),
        ),
      ],
    );
  }
}
