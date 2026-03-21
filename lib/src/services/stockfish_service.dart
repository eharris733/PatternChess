import 'dart:async';
import 'dart:js_interop';

import 'pgn_parser_service.dart';

@JS('initStockfish')
external JSPromise<JSBoolean> _initStockfish();

@JS('sendStockfishCommand')
external void _sendStockfishCommand(JSString command);

@JS('waitForBestMove')
external JSPromise<JSString> _waitForBestMove();

@JS('waitForAnalysis')
external JSPromise<JSString> _waitForAnalysis(JSNumber depth);

class EvalResult {
  final int scoreCp;
  final String bestMove;
  final int multiPv;

  EvalResult({
    required this.scoreCp,
    required this.bestMove,
    this.multiPv = 1,
  });
}

class BlunderCandidate {
  final String fen;
  final int moveNumber;
  final String playedMove;
  final String sideToMove;
  final int evalBefore;
  final int evalAfter;
  final int evalSwing;
  final List<EvalResult> correctMoves;

  BlunderCandidate({
    required this.fen,
    required this.moveNumber,
    required this.playedMove,
    required this.sideToMove,
    required this.evalBefore,
    required this.evalAfter,
    required this.evalSwing,
    required this.correctMoves,
  });
}

class StockfishService {
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    final result = await _initStockfish().toDart;
    _initialized = result.toDart;
    if (!_initialized) throw Exception('Failed to initialize Stockfish');
  }

  Future<int> evaluatePosition(String fen, {int depth = 13}) async {
    _sendStockfishCommand('position fen $fen'.toJS);
    _sendStockfishCommand('go depth $depth'.toJS);
    final output = await _waitForAnalysis(depth.toJS).toDart;
    return _parseEval(output.toDart);
  }

  Future<List<EvalResult>> evaluatePositionMultiPv(
    String fen, {
    int depth = 13,
    int multiPv = 3,
  }) async {
    _sendStockfishCommand('setoption name MultiPV value $multiPv'.toJS);
    _sendStockfishCommand('position fen $fen'.toJS);
    _sendStockfishCommand('go depth $depth'.toJS);
    final output = await _waitForAnalysis(depth.toJS).toDart;
    final results = _parseMultiPvEval(output.toDart, depth);
    // Reset MultiPV
    _sendStockfishCommand('setoption name MultiPV value 1'.toJS);
    return results;
  }

  /// Analyze a full game and return blunder candidates (100+ cp swing).
  /// [onProgress] reports (currentPosition, totalPositions).
  Future<List<BlunderCandidate>> analyzeGame(
    List<ParsedPosition> positions, {
    int depth = 13,
    int blunderThreshold = 100,
    void Function(int current, int total)? onProgress,
  }) async {
    final blunders = <BlunderCandidate>[];
    final evals = <int>[];

    // Evaluate all positions
    for (int i = 0; i < positions.length; i++) {
      onProgress?.call(i, positions.length);
      final eval_ = await evaluatePosition(positions[i].fen, depth: depth);
      evals.add(eval_);
    }

    // Find blunders by comparing consecutive evals
    for (int i = 0; i < positions.length - 1; i++) {
      final pos = positions[i];
      if (pos.uciMove == null) continue;

      // Eval from the perspective of the moving side
      final evalBefore = pos.sideToMove == 'white' ? evals[i] : -evals[i];
      final evalAfter = pos.sideToMove == 'white' ? evals[i + 1] : -evals[i + 1];

      // Negative swing means position got worse for the moving side
      final swing = evalAfter - evalBefore;

      if (swing <= -blunderThreshold) {
        // Get MultiPV to find correct moves
        final multiPvResults = await evaluatePositionMultiPv(
          pos.fen,
          depth: depth,
          multiPv: 3,
        );

        // Filter moves within 30cp of the best
        final bestEval = multiPvResults.isNotEmpty
            ? multiPvResults.first.scoreCp
            : evalBefore;
        final correctMoves = multiPvResults
            .where((r) => (bestEval - r.scoreCp).abs() <= 30)
            .toList();

        blunders.add(BlunderCandidate(
          fen: pos.fen,
          moveNumber: pos.moveNumber,
          playedMove: pos.uciMove!,
          sideToMove: pos.sideToMove,
          evalBefore: evals[i],
          evalAfter: evals[i + 1],
          evalSwing: swing.abs(),
          correctMoves:
              correctMoves.isNotEmpty ? correctMoves : multiPvResults.take(1).toList(),
        ));
      }
    }

    return blunders;
  }

  int _parseEval(String output) {
    final lines = output.split('\n').reversed;
    for (final line in lines) {
      if (line.contains('score cp')) {
        final match = RegExp(r'score cp (-?\d+)').firstMatch(line);
        if (match != null) return int.parse(match.group(1)!);
      }
      if (line.contains('score mate')) {
        final match = RegExp(r'score mate (-?\d+)').firstMatch(line);
        if (match != null) {
          final mateIn = int.parse(match.group(1)!);
          return mateIn > 0 ? 10000 - mateIn : -10000 + mateIn.abs();
        }
      }
    }
    return 0;
  }

  List<EvalResult> _parseMultiPvEval(String output, int targetDepth) {
    final results = <int, EvalResult>{};
    final lines = output.split('\n');

    for (final line in lines) {
      if (!line.contains('multipv') || !line.contains('depth $targetDepth '))
        continue;

      final pvMatch = RegExp(r'multipv (\d+)').firstMatch(line);
      final cpMatch = RegExp(r'score cp (-?\d+)').firstMatch(line);
      final mateMatch = RegExp(r'score mate (-?\d+)').firstMatch(line);
      final moveMatch = RegExp(r' pv (\S+)').firstMatch(line);

      if (pvMatch == null || moveMatch == null) continue;

      final pvNum = int.parse(pvMatch.group(1)!);
      int scoreCp;
      if (cpMatch != null) {
        scoreCp = int.parse(cpMatch.group(1)!);
      } else if (mateMatch != null) {
        final mateIn = int.parse(mateMatch.group(1)!);
        scoreCp = mateIn > 0 ? 10000 - mateIn : -10000 + mateIn.abs();
      } else {
        continue;
      }

      results[pvNum] = EvalResult(
        scoreCp: scoreCp,
        bestMove: moveMatch.group(1)!,
        multiPv: pvNum,
      );
    }

    final sorted = results.entries.toList()
      ..sort((a, b) => a.key.compareTo(b.key));
    return sorted.map((e) => e.value).toList();
  }
}
