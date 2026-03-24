import 'dart:convert';
import 'dart:js_interop';

@JS('getBenchmarkEngines')
external JSString _getBenchmarkEngines();

@JS('runEngineBenchmark')
external JSPromise<JSString> _runEngineBenchmark(JSString engineId);

@JS('cancelBenchmark')
external void _cancelBenchmark(JSString engineId);

@JS('runDeepBenchmark')
external JSPromise<JSString> _runDeepBenchmark(JSString engineId);

class EngineVariant {
  final String id;
  final String name;
  final String source;
  final String type;
  final String sizeLabel;
  final bool requiresCORS;

  EngineVariant({
    required this.id,
    required this.name,
    required this.source,
    required this.type,
    required this.sizeLabel,
    required this.requiresCORS,
  });

  factory EngineVariant.fromJson(Map<String, dynamic> json) {
    return EngineVariant(
      id: json['id'] as String,
      name: json['name'] as String,
      source: json['source'] as String,
      type: json['type'] as String,
      sizeLabel: json['sizeLabel'] as String,
      requiresCORS: json['requiresCORS'] as bool? ?? false,
    );
  }
}

class BenchmarkResult {
  final int loadTimeMs;
  final int analysisTimeMs;
  final int nodesPerSecond;
  final int depth;
  final String bestMove;
  final String? error;

  BenchmarkResult({
    required this.loadTimeMs,
    required this.analysisTimeMs,
    required this.nodesPerSecond,
    required this.depth,
    required this.bestMove,
    this.error,
  });

  factory BenchmarkResult.fromJson(Map<String, dynamic> json) {
    return BenchmarkResult(
      loadTimeMs: (json['loadTimeMs'] as num?)?.toInt() ?? 0,
      analysisTimeMs: (json['analysisTimeMs'] as num?)?.toInt() ?? 0,
      nodesPerSecond: (json['nodesPerSecond'] as num?)?.toInt() ?? 0,
      depth: (json['depth'] as num?)?.toInt() ?? 0,
      bestMove: json['bestMove'] as String? ?? '',
      error: json['error'] as String?,
    );
  }
}

class BenchmarkService {
  static List<EngineVariant> getEngines() {
    final json = _getBenchmarkEngines().toDart;
    final list = jsonDecode(json) as List;
    return list.map((e) => EngineVariant.fromJson(e as Map<String, dynamic>)).toList();
  }

  static Future<BenchmarkResult> runBenchmark(String engineId) async {
    final resultJson = (await _runEngineBenchmark(engineId.toJS).toDart).toDart;
    final map = jsonDecode(resultJson) as Map<String, dynamic>;
    return BenchmarkResult.fromJson(map);
  }

  static void cancelBenchmark(String engineId) {
    _cancelBenchmark(engineId.toJS);
  }

  static Future<DeepBenchmarkResult> runDeepBenchmark(String engineId) async {
    final resultJson = (await _runDeepBenchmark(engineId.toJS).toDart).toDart;
    final map = jsonDecode(resultJson) as Map<String, dynamic>;
    return DeepBenchmarkResult.fromJson(map);
  }
}

class DeepBenchmarkResult {
  final int loadTimeMs;
  final int positionsAnalyzed;
  final int totalAnalysisMs;
  final int avgPerPositionMs;
  final int estimatedTotalMs;
  final int actualElapsedMs;
  final List<int> evalScores;
  final String? error;

  DeepBenchmarkResult({
    required this.loadTimeMs,
    required this.positionsAnalyzed,
    required this.totalAnalysisMs,
    required this.avgPerPositionMs,
    required this.estimatedTotalMs,
    required this.actualElapsedMs,
    this.evalScores = const [],
    this.error,
  });

  factory DeepBenchmarkResult.fromJson(Map<String, dynamic> json) {
    final scores = (json['evalScores'] as List?)
        ?.map((e) => (e as num).toInt())
        .toList() ?? [];
    return DeepBenchmarkResult(
      loadTimeMs: (json['loadTimeMs'] as num?)?.toInt() ?? 0,
      positionsAnalyzed: (json['positionsAnalyzed'] as num?)?.toInt() ?? 0,
      totalAnalysisMs: (json['totalAnalysisMs'] as num?)?.toInt() ?? 0,
      avgPerPositionMs: (json['avgPerPositionMs'] as num?)?.toInt() ?? 0,
      estimatedTotalMs: (json['estimatedTotalMs'] as num?)?.toInt() ?? 0,
      actualElapsedMs: (json['actualElapsedMs'] as num?)?.toInt() ?? 0,
      evalScores: scores,
      error: json['error'] as String?,
    );
  }
}
