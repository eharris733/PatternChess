import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../services/pgn_parser_service.dart';
import '../services/stockfish_service.dart';
import '../services/supabase_service.dart';
import '../widgets/app_shell.dart';

class AnalysisScreen extends StatefulWidget {
  final List<String> gameIds;

  const AnalysisScreen({super.key, required this.gameIds});

  @override
  State<AnalysisScreen> createState() => _AnalysisScreenState();
}

class _AnalysisScreenState extends State<AnalysisScreen> {
  final StockfishService _stockfish = StockfishService();
  bool _analyzing = false;
  bool _complete = false;
  String _status = 'Initializing Stockfish...';
  int _currentGame = 0;
  int _totalGames = 0;
  int _currentPosition = 0;
  int _totalPositions = 0;
  int _totalBlunders = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _startAnalysis();
  }

  Future<void> _startAnalysis() async {
    setState(() {
      _analyzing = true;
      _totalGames = widget.gameIds.length;
    });

    try {
      await _stockfish.init();
      setState(() => _status = 'Stockfish ready. Starting analysis...');

      for (int i = 0; i < widget.gameIds.length; i++) {
        setState(() {
          _currentGame = i + 1;
          _status = 'Analyzing game $_currentGame/$_totalGames...';
        });

        final game = await SupabaseService.getGame(widget.gameIds[i]);
        final positions = PgnParserService.parseGame(game.pgn);

        setState(() => _totalPositions = positions.length);

        final blunders = await _stockfish.analyzeGame(
          positions,
          onProgress: (current, total) {
            setState(() {
              _currentPosition = current + 1;
              _totalPositions = total;
              _status =
                  'Analyzing game $_currentGame/$_totalGames... position $_currentPosition/$_totalPositions';
            });
          },
        );

        if (blunders.isNotEmpty) {
          final blunderMaps = blunders.map((b) => {
            'game_id': game.id,
            'fen': b.fen,
            'move_number': b.moveNumber,
            'played_move': b.playedMove,
            'correct_moves': b.correctMoves
                .map((cm) => {'move': cm.bestMove, 'eval': cm.scoreCp})
                .toList(),
            'eval_before': b.evalBefore,
            'eval_after': b.evalAfter,
            'eval_swing': b.evalSwing,
            'side_to_move': b.sideToMove,
          }).toList();

          await SupabaseService.insertBlunders(blunderMaps);
          _totalBlunders += blunders.length;
        }
      }

      setState(() {
        _complete = true;
        _analyzing = false;
        _status = 'Analysis complete!';
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _analyzing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      center: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(
                  Icons.psychology,
                  size: 64,
                  color: AppTheme.accent,
                ),
                const SizedBox(height: 24),

                Text(
                  _complete ? 'Analysis Complete' : 'Analyzing Games',
                  style: Theme.of(context).textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),

                Text(
                  _status,
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),

                if (_analyzing) ...[
                  // Game progress
                  _buildProgressBar(
                    label: 'Games',
                    value: _currentGame,
                    total: _totalGames,
                  ),
                  const SizedBox(height: 12),
                  // Position progress
                  _buildProgressBar(
                    label: 'Positions',
                    value: _currentPosition,
                    total: _totalPositions,
                  ),
                  const SizedBox(height: 24),
                  const Center(
                    child: CircularProgressIndicator(
                      color: AppTheme.accent,
                    ),
                  ),
                ],

                if (_complete) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppTheme.surface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      children: [
                        Text(
                          '$_totalBlunders',
                          style: const TextStyle(
                            fontSize: 48,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.accent,
                          ),
                        ),
                        Text(
                          'blunders found across $_totalGames games',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    height: 48,
                    child: ElevatedButton(
                      onPressed: _totalBlunders > 0
                          ? () => Navigator.pushReplacementNamed(
                                context,
                                '/training',
                                arguments: {'gameIds': widget.gameIds},
                              )
                          : null,
                      child: Text(
                        _totalBlunders > 0
                            ? 'START TRAINING'
                            : 'NO BLUNDERS FOUND',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () =>
                        Navigator.pushReplacementNamed(context, '/'),
                    child: const Text('Import more games'),
                  ),
                ],

                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.incorrect.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _error!,
                      style: const TextStyle(color: AppTheme.incorrect),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () =>
                        Navigator.pushReplacementNamed(context, '/'),
                    child: const Text('Go back'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProgressBar({
    required String label,
    required int value,
    required int total,
  }) {
    final progress = total > 0 ? value / total : 0.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(color: AppTheme.textSecondary)),
            Text('$value/$total',
                style: const TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: progress,
            backgroundColor: AppTheme.surfaceLight,
            valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
            minHeight: 8,
          ),
        ),
      ],
    );
  }
}
