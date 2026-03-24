import 'dart:js_interop';

import '../models/blunder.dart';
import '../utils/winning_chances.dart';
import 'pgn_parser_service.dart';

@JS('initStockfish')
external JSPromise<JSBoolean> _initStockfish();

@JS('sendStockfishCommand')
external void _sendStockfishCommand(JSString command);

@JS('waitForAnalysis')
external JSPromise<JSString> _waitForAnalysis(JSNumber depth);

class PositionEval {
  final int scoreCp;
  final String bestMove;
  final List<String> principalVariation;

  PositionEval({
    required this.scoreCp,
    required this.bestMove,
    this.principalVariation = const [],
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
  final List<CorrectMove> correctMoves;

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

  bool get isReady => _initialized;

  Future<void> init() async {
    if (_initialized) return;
    final result = await _initStockfish().toDart;
    _initialized = result.toDart;
    if (!_initialized) throw Exception('Failed to initialize Stockfish');
  }

  /// Evaluate a position and return both the score and best move.
  Future<PositionEval> evaluatePositionFull(String fen,
      {int depth = 12}) async {
    _sendStockfishCommand('position fen $fen'.toJS);
    _sendStockfishCommand('go depth $depth'.toJS);
    final output = await _waitForAnalysis(depth.toJS).toDart;
    final outputStr = output.toDart;
    return PositionEval(
      scoreCp: _parseEval(outputStr),
      bestMove: _parseBestMove(outputStr),
      principalVariation: _parsePrincipalVariation(outputStr),
    );
  }

  /// Evaluate a position after applying a specific move.
  /// Returns eval from the resulting position's side-to-move perspective.
  /// Uses time limit (ms) for predictable response with multi-threading benefit.
  Future<PositionEval> evaluateMove(String fen, String uciMove,
      {int timeMs = 500}) async {
    _sendStockfishCommand('position fen $fen moves $uciMove'.toJS);
    _sendStockfishCommand('go movetime $timeMs'.toJS);
    final output = await _waitForAnalysis(timeMs.toJS).toDart;
    final outputStr = output.toDart;
    return PositionEval(
      scoreCp: _parseEval(outputStr),
      bestMove: _parseBestMove(outputStr),
      principalVariation: _parsePrincipalVariation(outputStr),
    );
  }

  /// Analyze a full game and return blunder candidates.
  /// Uses Lichess winning-chances model via [WinningChances.isTrainable].
  /// If [playerSide] is provided ('white' or 'black'), only analyzes that side's moves.
  Future<List<BlunderCandidate>> analyzeGame(
    List<ParsedPosition> positions, {
    int depth = 12,
    String? playerSide,
    void Function(int current, int total)? onProgress,
  }) async {
    final blunders = <BlunderCandidate>[];
    final positionEvals = <PositionEval>[];

    // Evaluate all positions, capturing both score and best move
    for (int i = 0; i < positions.length; i++) {
      onProgress?.call(i, positions.length);
      final eval_ =
          await evaluatePositionFull(positions[i].fen, depth: depth);
      positionEvals.add(eval_);
    }

    // Find blunders using winning chances model
    for (int i = 0; i < positions.length - 1; i++) {
      final pos = positions[i];
      if (pos.uciMove == null) continue;

      // Skip opponent's moves if playerSide is specified
      if (playerSide != null && pos.sideToMove != playerSide) continue;

      // Skip if user played the engine's best move
      if (pos.uciMove == positionEvals[i].bestMove) continue;

      final chancesLost = WinningChances.winningChancesLost(
        positionEvals[i].scoreCp,
        positionEvals[i + 1].scoreCp,
      );

      if (WinningChances.isTrainable(chancesLost)) {
        final bestMove = positionEvals[i].bestMove;
        final bestEval = positionEvals[i].scoreCp;

        blunders.add(BlunderCandidate(
          fen: pos.fen,
          moveNumber: pos.moveNumber,
          playedMove: pos.uciMove!,
          sideToMove: pos.sideToMove,
          evalBefore: bestEval,
          evalAfter: positionEvals[i + 1].scoreCp,
          evalSwing: chancesLost.round(),
          correctMoves: [
            CorrectMove(move: bestMove, eval: bestEval),
          ],
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

  List<String> _parsePrincipalVariation(String output, {int maxMoves = 5}) {
    final lines = output.split('\n');
    for (final line in lines.reversed) {
      if (line.contains(' pv ')) {
        final pvIndex = line.indexOf(' pv ');
        final pvStr = line.substring(pvIndex + 4).trim();
        final moves = pvStr.split(' ');
        return moves.take(maxMoves).toList();
      }
    }
    return [];
  }

  String _parseBestMove(String output) {
    final lines = output.split('\n');
    for (final line in lines.reversed) {
      if (line.startsWith('bestmove ')) {
        final parts = line.split(' ');
        if (parts.length >= 2) return parts[1];
      }
    }
    return '';
  }
}
