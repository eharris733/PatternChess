import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../services/chess_api_service.dart';
import '../services/supabase_service.dart';
import '../widgets/app_shell.dart';

enum ChessPlatform { chessCom, lichess }

class ImportScreen extends StatefulWidget {
  const ImportScreen({super.key});

  @override
  State<ImportScreen> createState() => _ImportScreenState();
}

class _ImportScreenState extends State<ImportScreen> {
  final _usernameController = TextEditingController();
  ChessPlatform _platform = ChessPlatform.chessCom;
  int _gameCount = 10;
  bool _ratedOnly = false;
  String? _timeControl;
  bool _loading = false;
  String? _error;
  String? _status;

  static const _gameCountOptions = [5, 10, 25, 50];

  static const _timeControls = {
    null: 'All',
    'bullet': 'Bullet',
    'blitz': 'Blitz',
    'rapid': 'Rapid',
    'classical': 'Classical',
  };

  @override
  void dispose() {
    _usernameController.dispose();
    super.dispose();
  }

  Future<void> _importGames() async {
    final username = _usernameController.text.trim();
    if (username.isEmpty) {
      setState(() => _error = 'Please enter a username');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
      _status = 'Fetching games...';
    });

    try {
      List<Map<String, dynamic>> games;

      if (_platform == ChessPlatform.chessCom) {
        games = await ChessApiService.fetchChessComGames(
          username,
          maxGames: _gameCount,
          ratedOnly: _ratedOnly,
          timeControl: _timeControl,
        );
      } else {
        games = await ChessApiService.fetchLichessGames(
          username,
          maxGames: _gameCount,
          ratedOnly: _ratedOnly,
          perfType: _timeControl,
        );
      }

      if (games.isEmpty) {
        setState(() {
          _loading = false;
          _error = 'No games found for $username';
          _status = null;
        });
        return;
      }

      setState(() => _status = 'Saving ${games.length} games...');

      final savedGames = await SupabaseService.insertGames(games);
      final gameIds = savedGames.map((g) => g.id).toList();

      if (!mounted) return;

      Navigator.pushNamed(context, '/analysis', arguments: {
        'gameIds': gameIds,
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _status = null;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      activeRoute: '/import',
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
                  'PATTERNCHESS',
                  style: Theme.of(context).textTheme.headlineLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Import your games and train your blunders',
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),

                // Platform toggle
                _buildPlatformToggle(),
                const SizedBox(height: 16),

                // Username field
                TextField(
                  controller: _usernameController,
                  decoration: InputDecoration(
                    labelText: _platform == ChessPlatform.chessCom
                        ? 'Chess.com username'
                        : 'Lichess username',
                    prefixIcon: const Icon(Icons.person),
                  ),
                  onSubmitted: (_) => _importGames(),
                ),
                const SizedBox(height: 16),

                // Filters row
                _buildFilters(),
                const SizedBox(height: 24),

                // Import button
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _loading ? null : _importGames,
                    child: _loading
                        ? Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTheme.textPrimary,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Text(_status ?? 'Importing...'),
                            ],
                          )
                        : const Text('IMPORT GAMES',
                            style: TextStyle(
                                fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ),

                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: const TextStyle(color: AppTheme.incorrect),
                    textAlign: TextAlign.center,
                  ),
                ],

                const SizedBox(height: 32),

                // Quick access to training
                OutlinedButton(
                  onPressed: () => Navigator.pushNamed(context, '/training'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.textSecondary,
                    side: const BorderSide(color: AppTheme.surfaceLight),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: const Text('CONTINUE TRAINING'),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => Navigator.pushNamed(context, '/benchmark'),
                  icon: const Icon(Icons.speed, size: 18),
                  label: const Text('ENGINE BENCHMARK'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.textSecondary,
                    side: const BorderSide(color: AppTheme.surfaceLight),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPlatformToggle() {
    return Row(
      children: [
        Expanded(
          child: _platformButton(
            'Chess.com',
            ChessPlatform.chessCom,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _platformButton(
            'Lichess',
            ChessPlatform.lichess,
          ),
        ),
      ],
    );
  }

  Widget _platformButton(String label, ChessPlatform platform) {
    final selected = _platform == platform;
    return GestureDetector(
      onTap: () => setState(() => _platform = platform),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : AppTheme.surfaceLight,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: selected ? AppTheme.textPrimary : AppTheme.textSecondary,
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }

  Widget _buildFilters() {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        // Game count
        _filterChip(
          label: '$_gameCount games',
          onTap: () {
            final currentIndex = _gameCountOptions.indexOf(_gameCount);
            final nextIndex = (currentIndex + 1) % _gameCountOptions.length;
            setState(() => _gameCount = _gameCountOptions[nextIndex]);
          },
        ),

        // Rated only
        _filterChip(
          label: _ratedOnly ? 'Rated' : 'All games',
          onTap: () => setState(() => _ratedOnly = !_ratedOnly),
          active: _ratedOnly,
        ),

        // Time control
        _filterChip(
            label: _timeControls[_timeControl] ?? 'All',
            onTap: () {
              final keys = _timeControls.keys.toList();
              final currentIndex = keys.indexOf(_timeControl);
              final nextIndex = (currentIndex + 1) % keys.length;
              setState(() => _timeControl = keys[nextIndex]);
            },
          ),
      ],
    );
  }

  Widget _filterChip({
    required String label,
    required VoidCallback onTap,
    bool active = false,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: active ? AppTheme.accent.withValues(alpha: 0.3) : AppTheme.surfaceLight,
          borderRadius: BorderRadius.circular(16),
          border: active
              ? Border.all(color: AppTheme.accent)
              : Border.all(color: Colors.transparent),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? AppTheme.accentLight : AppTheme.textSecondary,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}
