import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../services/supabase_service.dart';
import '../models/game_record.dart';
import '../widgets/app_shell.dart';

class VaultScreen extends StatefulWidget {
  const VaultScreen({super.key});

  @override
  State<VaultScreen> createState() => _VaultScreenState();
}

class _VaultScreenState extends State<VaultScreen> {
  List<GameRecord>? _games;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadGames();
  }

  Future<void> _loadGames() async {
    try {
      final games = await SupabaseService.getGames();
      if (mounted) {
        setState(() {
          _games = games;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      activeRoute: '/vault',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Text(
                  'Vault',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: () =>
                      Navigator.pushNamed(context, '/import'),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Import Games'),
                ),
              ],
            ),
          ),
          const Divider(color: AppTheme.surfaceLight, height: 1),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(color: AppTheme.accent),
      );
    }

    if (_error != null) {
      return Center(
        child: Text(_error!, style: const TextStyle(color: AppTheme.incorrect)),
      );
    }

    final games = _games;
    if (games == null || games.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.archive_outlined,
                size: 48, color: AppTheme.textSecondary),
            const SizedBox(height: 12),
            Text(
              'No games yet',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 4),
            Text(
              'Import games to start building your vault',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: games.length,
      itemBuilder: (context, index) {
        final game = games[index];
        return _buildGameTile(game);
      },
    );
  }

  Widget _buildGameTile(GameRecord game) {
    final resultColor = switch (game.result) {
      'win' => AppTheme.correct,
      'loss' => AppTheme.incorrect,
      _ => AppTheme.textSecondary,
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: ListTile(
        dense: true,
        title: Text(
          'vs ${game.opponent}',
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          [
            game.platform,
            if (game.timeControl != null) game.timeControl,
            if (game.playedAt != null)
              '${game.playedAt!.day}/${game.playedAt!.month}/${game.playedAt!.year}',
          ].join(' \u00b7 '),
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
        ),
        trailing: Text(
          (game.result ?? 'unknown').toUpperCase(),
          style: TextStyle(
            color: resultColor,
            fontWeight: FontWeight.bold,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}
