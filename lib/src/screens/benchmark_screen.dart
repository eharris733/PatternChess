import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../services/benchmark_service.dart';
import '../widgets/app_shell.dart';

enum _Status { idle, loading, analyzing, done, error }

enum _ViewMode { focused, all }

// The engines that matter for the lite-vs-heavy comparison
const _focusedEngineIds = {
  'nmrugg-lite-mt',
  'nmrugg-lite-st',
  'nmrugg-full-mt',
  'nmrugg-full-st',
  'lichess-sf18',
};

class BenchmarkScreen extends StatefulWidget {
  const BenchmarkScreen({super.key});

  @override
  State<BenchmarkScreen> createState() => _BenchmarkScreenState();
}

class _BenchmarkScreenState extends State<BenchmarkScreen> {
  List<EngineVariant> _engines = [];
  final Map<String, BenchmarkResult> _results = {};
  final Map<String, _Status> _statuses = {};
  final Map<String, DeepBenchmarkResult> _deepResults = {};
  final Map<String, _Status> _deepStatuses = {};
  bool _runningAll = false;
  bool _runningDeep = false;
  bool _cancelRequested = false;
  _ViewMode _viewMode = _ViewMode.focused;

  @override
  void initState() {
    super.initState();
    try {
      _engines = BenchmarkService.getEngines();
      for (final e in _engines) {
        _statuses[e.id] = _Status.idle;
        _deepStatuses[e.id] = _Status.idle;
      }
    } catch (e) {
      debugPrint('Failed to load engines: $e');
    }
  }

  Future<void> _runSingle(String engineId) async {
    setState(() => _statuses[engineId] = _Status.loading);
    try {
      final result = await BenchmarkService.runBenchmark(engineId);
      if (!mounted) return;
      setState(() {
        _results[engineId] = result;
        _statuses[engineId] =
            result.error != null ? _Status.error : _Status.done;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _results[engineId] = BenchmarkResult(
          loadTimeMs: 0,
          analysisTimeMs: 0,
          nodesPerSecond: 0,
          depth: 0,
          bestMove: '',
          error: e.toString(),
        );
        _statuses[engineId] = _Status.error;
      });
    }
  }

  List<EngineVariant> get _visibleEngines => _viewMode == _ViewMode.all
      ? _engines
      : _engines.where((e) => _focusedEngineIds.contains(e.id)).toList();

  Future<void> _runAll() async {
    setState(() {
      _runningAll = true;
      _cancelRequested = false;
    });
    for (final engine in _visibleEngines) {
      if (_cancelRequested || !mounted) break;
      await _runSingle(engine.id);
    }
    if (mounted) {
      setState(() => _runningAll = false);
    }
  }

  Future<void> _runDeepSingle(String engineId) async {
    setState(() => _deepStatuses[engineId] = _Status.loading);
    try {
      final result = await BenchmarkService.runDeepBenchmark(engineId);
      if (!mounted) return;
      setState(() {
        _deepResults[engineId] = result;
        _deepStatuses[engineId] =
            result.error != null ? _Status.error : _Status.done;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _deepResults[engineId] = DeepBenchmarkResult(
          loadTimeMs: 0,
          positionsAnalyzed: 0,
          totalAnalysisMs: 0,
          avgPerPositionMs: 0,
          estimatedTotalMs: 0,
          actualElapsedMs: 0,
          error: e.toString(),
        );
        _deepStatuses[engineId] = _Status.error;
      });
    }
  }

  Future<void> _runDeepAll() async {
    setState(() {
      _runningDeep = true;
      _cancelRequested = false;
    });
    for (final engine in _visibleEngines) {
      if (_cancelRequested || !mounted) break;
      await _runDeepSingle(engine.id);
    }
    if (mounted) {
      setState(() => _runningDeep = false);
    }
  }

  void _cancelAll() {
    _cancelRequested = true;
    for (final e in _engines) {
      if (_statuses[e.id] == _Status.loading ||
          _statuses[e.id] == _Status.analyzing) {
        BenchmarkService.cancelBenchmark(e.id);
        setState(() => _statuses[e.id] = _Status.idle);
      }
      if (_deepStatuses[e.id] == _Status.loading) {
        BenchmarkService.cancelBenchmark(e.id);
        setState(() => _deepStatuses[e.id] = _Status.idle);
      }
    }
    setState(() {
      _runningAll = false;
      _runningDeep = false;
    });
  }

  String _formatNps(int nps) {
    if (nps >= 1000000) return '${(nps / 1000000).toStringAsFixed(1)}M';
    if (nps >= 1000) return '${(nps / 1000).toStringAsFixed(0)}K';
    return '$nps';
  }

  String _formatTime(int ms) {
    if (ms >= 60000) return '${(ms / 1000).toStringAsFixed(1)}s';
    if (ms >= 1000) return '${(ms / 1000).toStringAsFixed(2)}s';
    return '${ms}ms';
  }

  String _formatDuration(int ms) {
    if (ms >= 3600000) {
      final h = ms / 3600000;
      return '${h.toStringAsFixed(1)}h';
    }
    if (ms >= 60000) {
      final m = ms / 60000;
      return '${m.toStringAsFixed(1)}m';
    }
    return '${(ms / 1000).toStringAsFixed(1)}s';
  }

  @override
  Widget build(BuildContext context) {
    return AppShell(
      center: Column(
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back),
                  color: AppTheme.textSecondary,
                  onPressed: () => Navigator.pop(context),
                ),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'Engine Benchmark',
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                if (_runningAll || _runningDeep)
                  TextButton(
                    onPressed: _cancelAll,
                    child: const Text('CANCEL',
                        style: TextStyle(color: AppTheme.incorrect)),
                  )
                else ...[
                  ElevatedButton.icon(
                    onPressed: _runAll,
                    icon: const Icon(Icons.play_arrow, size: 18),
                    label: const Text('QUICK'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.accent,
                      foregroundColor: AppTheme.textPrimary,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: _runDeepAll,
                    icon: const Icon(Icons.analytics, size: 18),
                    label: const Text('50-GAME SIM'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.surfaceLight,
                      foregroundColor: AppTheme.textPrimary,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                    ),
                  ),
                ],
              ],
            ),
          ),

          // View toggle
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                _viewToggle('Lite vs Heavy', _ViewMode.focused),
                const SizedBox(width: 8),
                _viewToggle('All Engines', _ViewMode.all),
                const Spacer(),
                if (_deepResults.length >= 2)
                  Text(
                    _buildAccuracySummary(),
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 12,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),

          // Engine list
          Expanded(
            child: _visibleEngines.isEmpty
                ? const Center(
                    child: Text('No engines found',
                        style: TextStyle(color: AppTheme.textSecondary)))
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _visibleEngines.length + (_hasAccuracyData ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index < _visibleEngines.length) {
                        return _buildEngineCard(_visibleEngines[index]);
                      }
                      return _buildAccuracyCard();
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildEngineCard(EngineVariant engine) {
    final status = _statuses[engine.id] ?? _Status.idle;
    final result = _results[engine.id];
    final deepStatus = _deepStatuses[engine.id] ?? _Status.idle;
    final deepResult = _deepResults[engine.id];

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: status == _Status.done
              ? AppTheme.accent.withValues(alpha: 0.5)
              : status == _Status.error
                  ? AppTheme.incorrect.withValues(alpha: 0.5)
                  : AppTheme.surfaceLight,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              _statusDot(status),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      engine.name,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${engine.source}  •  ${engine.sizeLabel}',
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (engine.requiresCORS)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceLight,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text('CORS',
                      style: TextStyle(
                          color: AppTheme.textSecondary, fontSize: 10)),
                ),
              const SizedBox(width: 8),
              if (status == _Status.loading || deepStatus == _Status.loading)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppTheme.accent,
                  ),
                )
              else
                IconButton(
                  icon: const Icon(Icons.play_arrow),
                  color: AppTheme.accent,
                  iconSize: 20,
                  constraints: const BoxConstraints(),
                  padding: EdgeInsets.zero,
                  onPressed: (_runningAll || _runningDeep)
                      ? null
                      : () => _runSingle(engine.id),
                ),
            ],
          ),

          // Results
          if (result != null && result.error == null) ...[
            const SizedBox(height: 12),
            const Divider(color: AppTheme.surfaceLight, height: 1),
            const SizedBox(height: 12),
            Row(
              children: [
                _resultTile('Load Time', _formatTime(result.loadTimeMs)),
                _resultTile(
                    'Analysis (d${result.depth})',
                    _formatTime(result.analysisTimeMs)),
                _resultTile('NPS', _formatNps(result.nodesPerSecond)),
                _resultTile('Best Move', result.bestMove),
              ],
            ),
          ],

          if (result != null && result.error != null) ...[
            const SizedBox(height: 8),
            Text(
              result.error!,
              style: const TextStyle(color: AppTheme.incorrect, fontSize: 12),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],

          // Deep analysis results
          if (deepResult != null && deepResult.error == null) ...[
            const SizedBox(height: 12),
            const Divider(color: AppTheme.surfaceLight, height: 1),
            const SizedBox(height: 8),
            const Text(
              '50-GAME SIMULATION (depth 12)',
              style: TextStyle(
                color: AppTheme.accentLight,
                fontSize: 11,
                fontWeight: FontWeight.bold,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                _resultTile('Avg/Position',
                    _formatTime(deepResult.avgPerPositionMs)),
                _resultTile('10-Pos Sample',
                    _formatTime(deepResult.totalAnalysisMs)),
                _resultTile('Est. 50 Games',
                    _formatDuration(deepResult.estimatedTotalMs)),
                _resultTile('Init Time',
                    _formatTime(deepResult.loadTimeMs)),
              ],
            ),
          ],

          if (deepResult != null && deepResult.error != null) ...[
            const SizedBox(height: 8),
            Text(
              'Deep: ${deepResult.error!}',
              style: const TextStyle(color: AppTheme.incorrect, fontSize: 12),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }

  Widget _statusDot(_Status status) {
    Color color;
    switch (status) {
      case _Status.idle:
        color = AppTheme.surfaceLight;
      case _Status.loading:
      case _Status.analyzing:
        color = AppTheme.accentLight;
      case _Status.done:
        color = AppTheme.correct;
      case _Status.error:
        color = AppTheme.incorrect;
    }
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }

  Widget _viewToggle(String label, _ViewMode mode) {
    final selected = _viewMode == mode;
    return GestureDetector(
      onTap: () => setState(() => _viewMode = mode),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : AppTheme.surfaceLight,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? AppTheme.textPrimary : AppTheme.textSecondary,
            fontSize: 12,
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }

  bool get _hasAccuracyData {
    // Need at least one lite and one heavy result to compare
    final hasLite = _deepResults.containsKey('nmrugg-lite-mt') ||
        _deepResults.containsKey('nmrugg-lite-st');
    final hasHeavy = _deepResults.containsKey('nmrugg-full-mt') ||
        _deepResults.containsKey('lichess-sf18');
    return hasLite && hasHeavy;
  }

  String _buildAccuracySummary() {
    if (!_hasAccuracyData) return '';
    final liteId = _deepResults.containsKey('nmrugg-lite-mt')
        ? 'nmrugg-lite-mt'
        : 'nmrugg-lite-st';
    final heavyId = _deepResults.containsKey('nmrugg-full-mt')
        ? 'nmrugg-full-mt'
        : 'lichess-sf18';
    final lite = _deepResults[liteId]!;
    final heavy = _deepResults[heavyId]!;
    if (lite.evalScores.isEmpty || heavy.evalScores.isEmpty) return '';
    final diffs = <int>[];
    for (int i = 0; i < lite.evalScores.length && i < heavy.evalScores.length; i++) {
      diffs.add((lite.evalScores[i] - heavy.evalScores[i]).abs());
    }
    final avgDiff = diffs.reduce((a, b) => a + b) / diffs.length;
    return 'Avg eval diff: ${avgDiff.toStringAsFixed(0)} cp';
  }

  Widget _buildAccuracyCard() {
    // Find lite and heavy results
    final liteId = _deepResults.containsKey('nmrugg-lite-mt')
        ? 'nmrugg-lite-mt'
        : 'nmrugg-lite-st';
    final heavyId = _deepResults.containsKey('nmrugg-full-mt')
        ? 'nmrugg-full-mt'
        : (_deepResults.containsKey('lichess-sf18') ? 'lichess-sf18' : null);
    if (heavyId == null) return const SizedBox.shrink();

    final lite = _deepResults[liteId]!;
    final heavy = _deepResults[heavyId]!;
    final liteEngine = _engines.firstWhere((e) => e.id == liteId);
    final heavyEngine = _engines.firstWhere((e) => e.id == heavyId);

    // Calculate eval differences
    final diffs = <int>[];
    for (int i = 0; i < lite.evalScores.length && i < heavy.evalScores.length; i++) {
      diffs.add((lite.evalScores[i] - heavy.evalScores[i]).abs());
    }
    final avgDiff = diffs.isEmpty ? 0.0 : diffs.reduce((a, b) => a + b) / diffs.length;
    final maxDiff = diffs.isEmpty ? 0 : diffs.reduce((a, b) => a > b ? a : b);
    final speedup = heavy.avgPerPositionMs > 0
        ? heavy.avgPerPositionMs / lite.avgPerPositionMs
        : 0.0;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.accentLight.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'ACCURACY COMPARISON: LITE vs HEAVY',
            style: TextStyle(
              color: AppTheme.accentLight,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            '${liteEngine.name}  vs  ${heavyEngine.name}',
            style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _resultTile('Avg Eval Diff', '${avgDiff.toStringAsFixed(0)} cp'),
              _resultTile('Max Eval Diff', '$maxDiff cp'),
              _resultTile('Speed Advantage', '${speedup.toStringAsFixed(1)}x'),
              _resultTile(
                  'Time Saved (50g)',
                  _formatDuration(
                      heavy.estimatedTotalMs - lite.estimatedTotalMs)),
            ],
          ),
          const SizedBox(height: 12),
          // Per-position breakdown
          const Text(
            'Per-position evals (centipawns):',
            style: TextStyle(color: AppTheme.textSecondary, fontSize: 11),
          ),
          const SizedBox(height: 6),
          ...List.generate(
            lite.evalScores.length < heavy.evalScores.length
                ? lite.evalScores.length
                : heavy.evalScores.length,
            (i) {
              final diff = (lite.evalScores[i] - heavy.evalScores[i]).abs();
              return Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Row(
                  children: [
                    SizedBox(
                      width: 30,
                      child: Text(
                        'P${i + 1}',
                        style: const TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 11,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 70,
                      child: Text(
                        'Lite: ${lite.evalScores[i]}',
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 11,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 80,
                      child: Text(
                        'Heavy: ${heavy.evalScores[i]}',
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 11,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                    Text(
                      diff == 0
                          ? 'exact match'
                          : 'diff: $diff cp${diff > 50 ? " (!)" : ""}',
                      style: TextStyle(
                        color: diff > 50
                            ? AppTheme.incorrect
                            : diff > 20
                                ? AppTheme.accentLight
                                : AppTheme.correct,
                        fontSize: 11,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
          const SizedBox(height: 8),
          Text(
            avgDiff < 15
                ? 'Evals are nearly identical. Lite is accurate enough for blunder detection.'
                : avgDiff < 40
                    ? 'Minor eval differences. Lite is sufficient for most analysis.'
                    : 'Significant eval differences. Heavy engine recommended for deep analysis.',
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 12,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ),
    );
  }

  Widget _resultTile(String label, String value) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.bold,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
          ),
        ],
      ),
    );
  }
}
