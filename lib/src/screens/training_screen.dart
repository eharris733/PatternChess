import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:chessground/chessground.dart';
import 'package:dartchess/dartchess.dart' as dc;
import 'package:dartchess/dartchess.dart' show Move;
import 'package:fast_immutable_collections/fast_immutable_collections.dart';

import '../theme/app_theme.dart';
import '../models/blunder.dart';
import '../models/game_record.dart';
import '../models/training_session.dart';
import '../services/stockfish_service.dart';
import '../services/supabase_service.dart';
import '../utils/winning_chances.dart';
import '../widgets/app_shell.dart';
import '../widgets/chess_board_panel.dart';
import '../widgets/move_sequence_panel.dart';
import '../widgets/winning_chances_display.dart';
import '../widgets/board_controls.dart';
import '../widgets/progress_indicator.dart';

enum TrainingState { loading, reviewing, solving, correct, incorrect, complete }


class _ReviewMove {
  final dc.Position position;
  final String san;
  final String uci;
  final Move? move;

  _ReviewMove({
    required this.position,
    required this.san,
    required this.uci,
    this.move,
  });
}

class TrainingScreen extends StatefulWidget {
  final List<String>? gameIds;

  const TrainingScreen({super.key, this.gameIds});

  @override
  State<TrainingScreen> createState() => _TrainingScreenState();
}

class _TrainingScreenState extends State<TrainingScreen> {
  TrainingSession? _session;
  TrainingState _state = TrainingState.loading;
  bool _paused = false;
  bool _showHint = false;
  bool _evaluating = false;

  // Stockfish for on-the-fly evaluation
  final StockfishService _stockfish = StockfishService();
  bool _stockfishReady = false;

  // Focus node for keyboard input
  final FocusNode _focusNode = FocusNode();

  // Board state
  dc.Position? _position;
  String _fen = dc.kInitialBoardFEN;
  ValidMoves _validMoves = const IMapConst({});
  dc.Side _orientation = dc.Side.white;
  dc.Side _sideToMove = dc.Side.white;
  Move? _lastMove;
  dc.NormalMove? _promotionMove;
  ISet<Shape> _shapes = ISet();

  // Refutation line (blunder + engine PV)
  List<MovePair> _refutationMovePairs = [];
  List<_ReviewMove> _refutationMoves = [];
  int? _activeRefutationIndex;

  // Post-correct engine continuation
  List<MovePair> _postCorrectMovePairs = [];
  List<_ReviewMove> _postCorrectMoves = [];
  int? _activePostCorrectIndex;
  bool _postCorrectStartsWithWhite = true;

  // Game metadata
  GameRecord? _currentGame;
  final Map<String, GameRecord> _gameCache = {};

  // Incorrect move feedback
  String? _incorrectFeedback;
  Color _feedbackColor = AppTheme.incorrect;

  // "See what you played" toggle
  bool _showWhatYouPlayed = false;

  // Blunder SAN for display
  String _blunderSan = '';

  @override
  void initState() {
    super.initState();
    _loadBlunders();
    _initStockfish();
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  void _handleKeyPress(KeyEvent event) {
    if (event is! KeyDownEvent) return;
    if (event.logicalKey == LogicalKeyboardKey.space) {
      _handleActionButton();
    } else if (event.logicalKey == LogicalKeyboardKey.arrowRight) {
      _stepForward();
    } else if (event.logicalKey == LogicalKeyboardKey.arrowLeft) {
      _stepBackward();
    }
  }

  void _stepForward() {
    if (_state == TrainingState.correct && _postCorrectMoves.isNotEmpty) {
      final idx = (_activePostCorrectIndex ?? -1) + 1;
      if (idx < _postCorrectMoves.length) {
        _showLinePosition(_postCorrectMoves, idx);
        setState(() => _activePostCorrectIndex = idx);
      }
      return;
    }

    if (_refutationMoves.isNotEmpty &&
        (_state == TrainingState.reviewing)) {
      final idx = (_activeRefutationIndex ?? -1) + 1;
      if (idx < _refutationMoves.length) {
        _showLinePosition(_refutationMoves, idx);
        setState(() => _activeRefutationIndex = idx);
      }
    }
  }

  void _stepBackward() {
    if (_state == TrainingState.correct && _postCorrectMoves.isNotEmpty) {
      final idx = (_activePostCorrectIndex ?? 0) - 1;
      if (idx >= 0) {
        _showLinePosition(_postCorrectMoves, idx);
        setState(() => _activePostCorrectIndex = idx);
      }
      return;
    }

    if (_refutationMoves.isNotEmpty &&
        (_state == TrainingState.reviewing)) {
      final idx = (_activeRefutationIndex ?? 0) - 1;
      if (idx >= 0) {
        _showLinePosition(_refutationMoves, idx);
        setState(() => _activeRefutationIndex = idx);
      }
    }
  }

  void _showLinePosition(List<_ReviewMove> moves, int idx) {
    if (idx < 0 || idx >= moves.length) return;
    final rm = moves[idx];
    final afterMove = rm.position.playUnchecked(rm.move!);

    final arrow = Arrow(
      color: AppTheme.incorrect.withValues(alpha: 0.5),
      orig: dc.Square.fromName(rm.uci.substring(0, 2)),
      dest: dc.Square.fromName(rm.uci.substring(2, 4)),
    );

    setState(() {
      _position = afterMove;
      _fen = afterMove.fen;
      _lastMove = rm.move;
      _shapes = ISet([arrow]);
    });
  }

  void _handleActionButton() {
    if (_state == TrainingState.reviewing) {
      _proceedFromReview();
    } else if (_state == TrainingState.correct) {
      _advance();
    } else if (_state == TrainingState.incorrect) {
      _retry();
    }
  }

  Future<void> _initStockfish() async {
    try {
      await _stockfish.init();
      if (mounted) setState(() => _stockfishReady = true);
    } catch (_) {}
  }

  Future<void> _loadBlunders() async {
    try {
      List<Blunder> blunders;
      if (widget.gameIds != null && widget.gameIds!.isNotEmpty) {
        blunders = await SupabaseService.getBlundersForGames(widget.gameIds!);
      } else {
        blunders = await SupabaseService.getDueBlunders();
      }

      if (blunders.isEmpty) {
        if (mounted) setState(() => _state = TrainingState.complete);
        return;
      }

      _session = TrainingSession(blunders: blunders);
      _loadCurrentBlunder();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error loading blunders: $e')),
        );
      }
    }
  }

  Future<void> _fetchGameRecord(String gameId) async {
    if (_gameCache.containsKey(gameId)) {
      _currentGame = _gameCache[gameId];
      return;
    }
    try {
      final game = await SupabaseService.getGame(gameId);
      _gameCache[gameId] = game;
      if (mounted) setState(() => _currentGame = game);
    } catch (_) {}
  }

  Future<void> _loadCurrentBlunder() async {
    final blunder = _session?.currentBlunder;
    if (blunder == null) {
      setState(() => _state = TrainingState.complete);
      return;
    }

    await _fetchGameRecord(blunder.gameId);

    final prePos = dc.Chess.fromSetup(dc.Setup.parseFen(blunder.fen));
    _blunderSan = _getSanForUci(prePos, blunder.playedMove);

    final position = dc.Chess.fromSetup(dc.Setup.parseFen(blunder.fen));
    final playerSide =
        blunder.sideToMove == 'white' ? dc.Side.white : dc.Side.black;

    if (blunder.cycleNumber == 0 && blunder.timesAttempted == 0) {
      _startReview(blunder, position, playerSide);
    } else {
      setState(() {
        _state = TrainingState.solving;
        _position = position;
        _fen = blunder.fen;
        _validMoves = dc.makeLegalMoves(position);
        _orientation = playerSide;
        _sideToMove = playerSide;
        _lastMove = null;
        _promotionMove = null;
        _shapes = ISet();
        _showHint = false;
        _refutationMovePairs = [];
        _refutationMoves = [];
        _activeRefutationIndex = null;

        _postCorrectMoves = [];
        _postCorrectMovePairs = [];
        _activePostCorrectIndex = null;
        _incorrectFeedback = null;
        _showWhatYouPlayed = false;

      });
    }
  }

  Future<void> _startReview(
      Blunder blunder, dc.Position position, dc.Side playerSide) async {
    final uciMove = blunder.playedMove;
    final move = _parseUciMove(uciMove);
    dc.Position afterBlunder = position;
    Move? lastMove;

    if (move != null && position.isLegal(move)) {
      afterBlunder = position.playUnchecked(move);
      lastMove = move;
    }

    final blunderArrow = Arrow(
      color: AppTheme.incorrect.withValues(alpha: 0.7),
      orig: dc.Square.fromName(uciMove.substring(0, 2)),
      dest: dc.Square.fromName(uciMove.substring(2, 4)),
    );

    setState(() {
      _state = TrainingState.reviewing;
      _position = afterBlunder;
      _fen = afterBlunder.fen;
      _orientation = playerSide;
      _sideToMove = playerSide;
      _lastMove = lastMove;
      _validMoves = const IMapConst({});
      _promotionMove = null;
      _shapes = ISet([blunderArrow]);
      _showHint = false;
      _refutationMoves = [];
      _refutationMovePairs = [];
      _activeRefutationIndex = null;
      _postCorrectMoves = [];
      _postCorrectMovePairs = [];
      _activePostCorrectIndex = null;
      _incorrectFeedback = null;
      _showWhatYouPlayed = false;
    });

    // Get refutation line from Stockfish
    if (_stockfishReady) {
      try {
        final result =
            await _stockfish.evaluatePositionFull(afterBlunder.fen, depth: 18);
        if (mounted && result.principalVariation.isNotEmpty) {
          _buildRefutationLine(blunder, position, afterBlunder,
              result.principalVariation);
        }
      } catch (_) {}
    }
  }

  /// Build refutation line with blunder as first move + engine PV
  void _buildRefutationLine(Blunder blunder, dc.Position preBlunderPos,
      dc.Position afterBlunder, List<String> pvMoves) {
    final reviewMoves = <_ReviewMove>[];
    final movePairs = <MovePair>[];

    // First entry: the blunder move itself
    final blunderMove = _parseUciMove(blunder.playedMove);
    reviewMoves.add(_ReviewMove(
      position: preBlunderPos,
      san: _blunderSan,
      uci: blunder.playedMove,
      move: blunderMove,
    ));

    // Add PV moves (up to 5)
    var pos = afterBlunder;
    for (final uci in pvMoves.take(5)) {
      final move = _parseUciMove(uci);
      if (move == null || !pos.isLegal(move)) break;

      final (newPos, san) = pos.makeSan(move);
      reviewMoves.add(_ReviewMove(
        position: pos,
        san: san,
        uci: uci,
        move: move,
      ));
      pos = newPos;
    }

    // Build MovePairs: blunder + refutation sequence
    final blunderMoveNum = blunder.moveNumber;
    final blunderIsWhite = blunder.sideToMove == 'white';
    final shortLabel = _classifyShortLabel(blunder);

    if (blunderIsWhite) {
      // Blunder is white's move at blunderMoveNum
      // First pair: blunderSAN (white) + ref[0] (black)
      movePairs.add(MovePair(
        moveNumber: blunderMoveNum,
        whiteMove: _blunderSan,
        whiteLabel: shortLabel,
        blackMove: reviewMoves.length > 1 ? reviewMoves[1].san : null,
      ));
      // Subsequent pairs
      for (int i = 2; i < reviewMoves.length; i += 2) {
        movePairs.add(MovePair(
          moveNumber: blunderMoveNum + (i ~/ 2),
          whiteMove: reviewMoves[i].san,
          blackMove:
              i + 1 < reviewMoves.length ? reviewMoves[i + 1].san : null,
        ));
      }
    } else {
      // Blunder is black's move
      movePairs.add(MovePair(
        moveNumber: blunderMoveNum,
        whiteMove: null,
        blackMove: _blunderSan,
        blackLabel: shortLabel,
      ));
      // Refutation starts with white
      for (int i = 1; i < reviewMoves.length; i += 2) {
        movePairs.add(MovePair(
          moveNumber: blunderMoveNum + ((i + 1) ~/ 2),
          whiteMove: reviewMoves[i].san,
          blackMove:
              i + 1 < reviewMoves.length ? reviewMoves[i + 1].san : null,
        ));
      }
    }

    // Default: highlight the blunder move (index 0)
    setState(() {
      _refutationMoves = reviewMoves;
      _refutationMovePairs = movePairs;
      _activeRefutationIndex = 0;
      _shapes = ISet([_buildBlunderArrow(blunder)]);
    });
  }

  Arrow _buildBlunderArrow(Blunder blunder) {
    return Arrow(
      color: AppTheme.incorrect.withValues(alpha: 0.7),
      orig: dc.Square.fromName(blunder.playedMove.substring(0, 2)),
      dest: dc.Square.fromName(blunder.playedMove.substring(2, 4)),
    );
  }

  String _getSanForUci(dc.Position pos, String uci) {
    final move = _parseUciMove(uci);
    if (move == null || !pos.isLegal(move)) return uci;
    final (_, san) = pos.makeSan(move);
    return san;
  }

  /// Convert move index to panel flat index for highlighting.
  /// [startsWithWhite] = true if the first move in the line is white's.
  int _moveToPanel(int moveIndex, bool startsWithWhite) {
    return startsWithWhite ? moveIndex : moveIndex + 1;
  }

  /// Convert panel flat index to move index.
  /// Returns null for empty slots (e.g., null white slot when line starts with black).
  int? _panelToMove(int panelIndex, bool startsWithWhite) {
    if (startsWithWhite) return panelIndex;
    if (panelIndex == 0) return null; // null white slot
    return panelIndex - 1;
  }

  void _onRefutationTap(int panelIndex) {
    if (_refutationMoves.isEmpty) return;
    if (_state != TrainingState.reviewing && _state != TrainingState.correct) {
      return;
    }

    final blunder = _session?.currentBlunder;
    if (blunder == null) return;

    final blunderIsWhite = blunder.sideToMove == 'white';
    final idx = _panelToMove(panelIndex, blunderIsWhite);
    if (idx == null || idx < 0 || idx >= _refutationMoves.length) return;

    _showLinePosition(_refutationMoves, idx);
    setState(() {
      _activeRefutationIndex = idx;
      _activePostCorrectIndex = null;
    });
  }

  void _onPostCorrectTap(int panelIndex) {
    if (_postCorrectMoves.isEmpty) return;

    final idx = _panelToMove(panelIndex, _postCorrectStartsWithWhite);
    if (idx == null || idx < 0 || idx >= _postCorrectMoves.length) return;

    _showLinePosition(_postCorrectMoves, idx);
    setState(() {
      _activePostCorrectIndex = idx;
      _activeRefutationIndex = null;
    });
  }

  void _proceedFromReview() {
    final blunder = _session?.currentBlunder;
    if (blunder == null) return;

    final position = dc.Chess.fromSetup(dc.Setup.parseFen(blunder.fen));

    setState(() {
      _state = TrainingState.solving;
      _position = position;
      _fen = blunder.fen;
      _validMoves = dc.makeLegalMoves(position);
      _lastMove = null;
      _shapes = ISet();
      _showHint = false;
      _refutationMovePairs = [];
      _refutationMoves = [];
      _activeRefutationIndex = null;
      _activePostCorrectIndex = null;
      _showWhatYouPlayed = false;
    });
  }

  dc.Move? _parseUciMove(String uci) {
    if (uci.length < 4) return null;
    final from = dc.Square.fromName(uci.substring(0, 2));
    final to = dc.Square.fromName(uci.substring(2, 4));
    dc.Role? promotion;
    if (uci.length == 5) {
      promotion = switch (uci[4]) {
        'q' => dc.Role.queen,
        'r' => dc.Role.rook,
        'b' => dc.Role.bishop,
        'n' => dc.Role.knight,
        _ => null,
      };
    }
    return dc.NormalMove(from: from, to: to, promotion: promotion);
  }

  void _onMove(Move move, {bool? viaDragAndDrop}) {
    if (_state != TrainingState.solving || _position == null || _evaluating) {
      return;
    }

    if (move is dc.NormalMove && _isPromotionPawnMove(move)) {
      setState(() => _promotionMove = move);
      return;
    }

    _processMove(move);
  }

  void _onPromotionSelection(dc.Role? role) {
    if (role == null || _promotionMove == null) {
      setState(() => _promotionMove = null);
      return;
    }
    _processMove(_promotionMove!.withPromotion(role));
  }

  Future<void> _processMove(Move move) async {
    final blunder = _session?.currentBlunder;
    if (blunder == null) return;

    final uciMove = _moveToUci(move);
    var isCorrect = blunder.isCorrectMove(uciMove);
    final isRepeatedBlunder = uciMove == blunder.playedMove;

    dc.Position? newPosition;
    if (_position!.isLegal(move)) {
      newPosition = _position!.playUnchecked(move);
      setState(() {
        _position = newPosition;
        _fen = newPosition!.fen;
        _lastMove = move;
        _validMoves = const IMapConst({});
        _promotionMove = null;
      });
    }

    // On-the-fly evaluation for non-stored moves
    double? chancesLost;
    if (!isCorrect && _stockfishReady && blunder.correctMoves.isNotEmpty && newPosition != null) {
      setState(() => _evaluating = true);
      try {
        final result =
            await _stockfish.evaluatePositionFull(newPosition.fen, depth: 18);
        final bestEval = blunder.correctMoves.first.eval;

        final bestWinPct = WinningChances.winPercent(bestEval);
        final moveWinPct = WinningChances.winPercent(-result.scoreCp);
        chancesLost = bestWinPct - moveWinPct;

        if (chancesLost.abs() <= 5.0) {
          isCorrect = true;
          final newMove = CorrectMove(move: uciMove, eval: -result.scoreCp);
          blunder.addCorrectMove(newMove);
          SupabaseService.appendCorrectMove(blunder.id, blunder.correctMoves);
        }
      } catch (_) {
      } finally {
        if (mounted) setState(() => _evaluating = false);
      }
    }

    if (!mounted) return;

    if (isCorrect) {
      _session!.recordCorrect();
      blunder.timesCorrect++;
      blunder.timesAttempted++;
      blunder.lastDrilledAt = DateTime.now();
      SupabaseService.updateBlunderAfterDrill(blunder);

      // Green arrow for the correct move
      final nm = move as dc.NormalMove;
      final correctArrow = Arrow(
        color: AppTheme.correct.withValues(alpha: 0.7),
        orig: nm.from,
        dest: nm.to,
      );

      setState(() {
        _state = TrainingState.correct;
        _shapes = ISet([correctArrow]);
        _incorrectFeedback = null;
        _refutationMoves = [];
        _refutationMovePairs = [];
        _activeRefutationIndex = null;
        _postCorrectMoves = [];
        _postCorrectMovePairs = [];
        _activePostCorrectIndex = null;
      });

      // Compute engine continuation from the correct position
      if (_stockfishReady && newPosition != null) {
        // Get SAN for the correct move
        final prePos = dc.Chess.fromSetup(dc.Setup.parseFen(blunder.fen));
        final (_, correctSan) = prePos.makeSan(move);

        try {
          final result = await _stockfish.evaluatePositionFull(
              newPosition.fen,
              depth: 18);
          if (mounted && result.principalVariation.isNotEmpty) {
            _buildPostCorrectLine(
              prePos, move, correctSan, newPosition, result.principalVariation);
          }
        } catch (_) {}
      }
    } else {
      _session!.recordIncorrect();
      blunder.timesAttempted++;
      SupabaseService.updateBlunderAfterDrill(blunder);

      String feedback;
      Color feedbackColor = AppTheme.incorrect;
      if (isRepeatedBlunder) {
        feedback = 'This was the move you played in the game';
      } else if (chancesLost != null) {
        final classification = WinningChances.classify(chancesLost);
        feedback = switch (classification) {
          MoveClassification.blunder => "That's a blunder, try again",
          MoveClassification.mistake => "That's a mistake, try again",
          MoveClassification.inaccuracy => "That's an inaccuracy, try again",
          MoveClassification.good =>
            "Good move, but keep looking for the best one",
        };
        feedbackColor = switch (classification) {
          MoveClassification.blunder => AppTheme.incorrect,
          MoveClassification.mistake => AppTheme.mistake,
          MoveClassification.inaccuracy => AppTheme.inaccuracy,
          MoveClassification.good => AppTheme.correct,
        };
      } else {
        feedback = "Incorrect, try again";
      }

      setState(() {
        _state = TrainingState.incorrect;
        _shapes = ISet();
        _incorrectFeedback = feedback;
        _feedbackColor = feedbackColor;
      });
    }
  }

  /// Build engine continuation line after correct move.
  /// Prepends the user's correct move as the first entry.
  void _buildPostCorrectLine(
    dc.Position preCorrectPos,
    dc.Move correctMove,
    String correctSan,
    dc.Position postCorrectPos,
    List<String> pvMoves,
  ) {
    final moves = <_ReviewMove>[];
    final movePairs = <MovePair>[];

    // First entry: the user's correct move
    final correctUci = _moveToUci(correctMove);
    moves.add(_ReviewMove(
      position: preCorrectPos,
      san: correctSan,
      uci: correctUci,
      move: correctMove,
    ));

    // Add engine PV continuation (up to 5)
    var pos = postCorrectPos;
    for (final uci in pvMoves.take(5)) {
      final move = _parseUciMove(uci);
      if (move == null || !pos.isLegal(move)) break;

      final (newPos, san) = pos.makeSan(move);
      moves.add(_ReviewMove(
        position: pos,
        san: san,
        uci: uci,
        move: move,
      ));
      pos = newPos;
    }

    // The line starts with the correct move's side
    final correctMoveIsWhite = preCorrectPos.turn == dc.Side.white;
    _postCorrectStartsWithWhite = correctMoveIsWhite;
    final startMoveNum = preCorrectPos.fullmoves;

    if (correctMoveIsWhite) {
      // Correct move is white's, PV starts with black
      movePairs.add(MovePair(
        moveNumber: startMoveNum,
        whiteMove: correctSan,
        whiteLabel: 'Correct',
        blackMove: moves.length > 1 ? moves[1].san : null,
      ));
      for (int i = 2; i < moves.length; i += 2) {
        movePairs.add(MovePair(
          moveNumber: startMoveNum + (i ~/ 2),
          whiteMove: moves[i].san,
          blackMove: i + 1 < moves.length ? moves[i + 1].san : null,
        ));
      }
    } else {
      // Correct move is black's
      movePairs.add(MovePair(
        moveNumber: startMoveNum,
        whiteMove: null,
        blackMove: correctSan,
        blackLabel: 'Correct',
      ));
      for (int i = 1; i < moves.length; i += 2) {
        movePairs.add(MovePair(
          moveNumber: startMoveNum + ((i + 1) ~/ 2),
          whiteMove: moves[i].san,
          blackMove: i + 1 < moves.length ? moves[i + 1].san : null,
        ));
      }
    }

    if (mounted) {
      setState(() {
        _postCorrectMoves = moves;
        _postCorrectMovePairs = movePairs;
        _activePostCorrectIndex = 0; // highlight the correct move
      });
    }
  }

  void _advance() {
    _session!.advance();
    if (_session!.isComplete) {
      setState(() => _state = TrainingState.complete);
    } else {
      _loadCurrentBlunder();
    }
  }

  void _showHintArrow() {
    final blunder = _session?.currentBlunder;
    if (blunder == null || blunder.correctMoves.isEmpty) return;

    final bestMove = blunder.correctMoves.first.move;
    final from = bestMove.substring(0, 2);
    final to = bestMove.substring(2, 4);

    setState(() {
      _showHint = true;
      _shapes = ISet([
        Arrow(
          color: AppTheme.correct.withValues(alpha: 0.5),
          orig: dc.Square.fromName(from),
          dest: dc.Square.fromName(to),
        ),
      ]);
    });
  }

  void _retry() {
    final blunder = _session?.currentBlunder;
    if (blunder == null) return;

    final position = dc.Chess.fromSetup(dc.Setup.parseFen(blunder.fen));
    final playerSide =
        blunder.sideToMove == 'white' ? dc.Side.white : dc.Side.black;

    setState(() {
      _state = TrainingState.solving;
      _position = position;
      _fen = blunder.fen;
      _validMoves = dc.makeLegalMoves(position);
      _orientation = playerSide;
      _sideToMove = playerSide;
      _lastMove = null;
      _promotionMove = null;
      _shapes = ISet();
      _showHint = false;
      _refutationMovePairs = [];
      _refutationMoves = [];
      _activeRefutationIndex = null;
      _postCorrectMoves = [];
      _postCorrectMovePairs = [];
      _activePostCorrectIndex = null;
      _incorrectFeedback = null;
      _showWhatYouPlayed = false;
    });
  }

  bool _isPromotionPawnMove(dc.NormalMove move) {
    if (_position == null) return false;
    return move.promotion == null &&
        _position!.board.roleAt(move.from) == dc.Role.pawn &&
        ((move.to.rank == dc.Rank.first && _position!.turn == dc.Side.black) ||
            (move.to.rank == dc.Rank.eighth &&
                _position!.turn == dc.Side.white));
  }

  String _moveToUci(Move move) {
    if (move is dc.NormalMove) {
      final promo = move.promotion != null ? _roleToChar(move.promotion!) : '';
      return '${move.from.name}${move.to.name}$promo';
    }
    return move.toString();
  }

  String _roleToChar(dc.Role role) {
    switch (role) {
      case dc.Role.queen:
        return 'q';
      case dc.Role.rook:
        return 'r';
      case dc.Role.bishop:
        return 'b';
      case dc.Role.knight:
        return 'n';
      default:
        return '';
    }
  }

  MoveClassification _classifyBlunder(Blunder blunder) {
    final chancesLost = WinningChances.winningChancesLost(
        blunder.evalBefore, blunder.evalAfter);
    return WinningChances.classify(chancesLost);
  }

  String _classifyBlunderLabel(Blunder blunder) {
    return switch (_classifyBlunder(blunder)) {
      MoveClassification.blunder => 'A Blunder',
      MoveClassification.mistake => 'A Mistake',
      MoveClassification.inaccuracy => 'An Inaccuracy',
      MoveClassification.good => 'A Mistake',
    };
  }

  String _classifyShortLabel(Blunder blunder) {
    return switch (_classifyBlunder(blunder)) {
      MoveClassification.blunder => 'Blunder',
      MoveClassification.mistake => 'Mistake',
      MoveClassification.inaccuracy => 'Inaccuracy',
      MoveClassification.good => 'Mistake',
    };
  }

  Color _classifyColor(Blunder blunder) {
    return switch (_classifyBlunder(blunder)) {
      MoveClassification.blunder => AppTheme.incorrect,
      MoveClassification.mistake => AppTheme.mistake,
      MoveClassification.inaccuracy => AppTheme.inaccuracy,
      MoveClassification.good => AppTheme.mistake,
    };
  }

  // ── UI ──────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final blunder = _session?.currentBlunder;
    final screenWidth = MediaQuery.of(context).size.width;
    final isWide = screenWidth > 900;

    return KeyboardListener(
      focusNode: _focusNode,
      autofocus: true,
      onKeyEvent: _handleKeyPress,
      child: AppShell(
        activeRoute: '/training',
        child: _state == TrainingState.loading
            ? const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(color: AppTheme.accent),
                    SizedBox(height: 16),
                    Text('Loading blunders...',
                        style: TextStyle(color: AppTheme.textSecondary)),
                  ],
                ),
              )
            : _state == TrainingState.complete
                ? _buildCompleteView()
                : isWide
                    ? _buildWideLayout(blunder)
                    : _buildNarrowLayout(blunder),
      ),
    );
  }

  Widget _buildWideLayout(Blunder? blunder) {
    return Row(
      children: [
        Expanded(
          flex: 3,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Expanded(child: _buildBoard()),
                const SizedBox(height: 8),
                _buildControls(),
              ],
            ),
          ),
        ),
        SizedBox(
          width: 360,
          child: Container(
            color: AppTheme.surface,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _buildRightPanel(blunder),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildNarrowLayout(Blunder? blunder) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildGameInfoHeader(),
          const SizedBox(height: 8),
          Expanded(child: _buildBoard()),
          const SizedBox(height: 8),
          _buildControls(),
          const SizedBox(height: 8),
          _buildNarrowStateContent(blunder),
          const SizedBox(height: 8),
          _buildProgressSection(),
          if (_state != TrainingState.solving) ...[
            const SizedBox(height: 8),
            _buildActionButton(),
          ],
        ],
      ),
    );
  }

  Widget _buildRightPanel(Blunder? blunder) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildGameInfoHeader(),
        const SizedBox(height: 12),

        if (_state == TrainingState.reviewing) ...[
          _buildBlunderInfo(blunder),
          const SizedBox(height: 12),
          _buildRefutationSection(),
          const SizedBox(height: 12),
          _buildSolvePrompt(),
        ],

        if (_state == TrainingState.solving) ...[
          _buildTurnToPlay(),
          const SizedBox(height: 12),
          _buildSeeWhatYouPlayed(),
          if (_evaluating) ...[
            const SizedBox(height: 12),
            _buildAnalyzingIndicator(),
          ],
        ],

        if (_state == TrainingState.correct) ...[
          _buildFeedbackBadge(isCorrect: true),
          const SizedBox(height: 12),
          _buildPostCorrectSection(),
        ],

        if (_state == TrainingState.incorrect) ...[
          _buildFeedbackBadge(isCorrect: false),
        ],

        const Spacer(),
        _buildProgressSection(),
        const SizedBox(height: 12),
        if (_state != TrainingState.solving) _buildActionButton(),
      ],
    );
  }

  Widget _buildNarrowStateContent(Blunder? blunder) {
    if (_state == TrainingState.reviewing) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildBlunderInfo(blunder),
          const SizedBox(height: 8),
          _buildSolvePrompt(),
        ],
      );
    }
    if (_state == TrainingState.solving) {
      return _buildTurnToPlay();
    }
    if (_state == TrainingState.correct) {
      return _buildFeedbackBadge(isCorrect: true);
    }
    if (_state == TrainingState.incorrect) {
      return _buildFeedbackBadge(isCorrect: false);
    }
    return const SizedBox();
  }

  Widget _buildBoard() {
    return ChessBoardPanel(
      fen: _fen,
      orientation: _orientation,
      playerSide: _state == TrainingState.solving
          ? (_sideToMove == dc.Side.white
              ? PlayerSide.white
              : PlayerSide.black)
          : PlayerSide.none,
      validMoves: _state == TrainingState.solving
          ? _validMoves
          : const IMapConst({}),
      sideToMove: _sideToMove,
      isCheck: _position?.isCheck ?? false,
      lastMove: _lastMove,
      promotionMove: _promotionMove,
      onMove: _state == TrainingState.solving ? _onMove : null,
      onPromotionSelection: _onPromotionSelection,
      shapes: _shapes.isNotEmpty ? _shapes : null,
    );
  }

  Widget _buildGameInfoHeader() {
    final game = _currentGame;
    final blunder = _session?.currentBlunder;

    String title = 'Training';
    String subtitle = '';

    if (game != null) {
      title = '${game.username} vs ${game.opponent}';
      final parts = <String>[];
      if (game.platform.isNotEmpty) parts.add(game.platform);
      if (game.timeControl != null) parts.add(game.timeControl!);
      if (game.playedAt != null) {
        final d = game.playedAt!;
        parts.add(
            '${d.month.toString().padLeft(2, '0')}/${d.day.toString().padLeft(2, '0')}/${d.year}');
      }
      subtitle = parts.join(' \u00b7 ');
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (_session != null) ...[
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppTheme.surface,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    _session!.cycleText,
                    style: const TextStyle(
                      color: AppTheme.accentLight,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  _session!.progressText,
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ],
          ),
          if (subtitle.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 12,
              ),
            ),
          ],
          if (blunder != null) ...[
            const SizedBox(height: 6),
            WinningChancesDisplay(
              evalBefore: blunder.evalBefore,
              evalAfter: blunder.evalAfter,
              sideToMove: blunder.sideToMove,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBlunderInfo(Blunder? blunder) {
    if (blunder == null) return const SizedBox();

    final label = _classifyBlunderLabel(blunder);
    final color = _classifyColor(blunder);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          RichText(
            text: TextSpan(
              children: [
                const TextSpan(
                  text: 'You played: ',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 14,
                  ),
                ),
                TextSpan(
                  text: _blunderSan,
                  style: TextStyle(
                    color: color,
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRefutationSection() {
    if (_refutationMoves.isEmpty) return const SizedBox();

    final blunder = _session?.currentBlunder;
    final blunderIsWhite = blunder?.sideToMove == 'white';
    final panelIdx = _activeRefutationIndex != null
        ? _moveToPanel(_activeRefutationIndex!, blunderIsWhite == true)
        : null;

    return _buildMoveLineSection(
      title: 'Engine refutation:',
      movePairs: _refutationMovePairs,
      activeIndex: panelIdx,
      onTap: _onRefutationTap,
    );
  }

  Widget _buildPostCorrectSection() {
    if (_postCorrectMoves.isEmpty) {
      return const Padding(
        padding: EdgeInsets.only(left: 4),
        child: Text(
          'Calculating continuation...',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
        ),
      );
    }

    final panelIdx = _activePostCorrectIndex != null
        ? _moveToPanel(_activePostCorrectIndex!, _postCorrectStartsWithWhite)
        : null;

    return _buildMoveLineSection(
      title: 'Game may have continued:',
      movePairs: _postCorrectMovePairs,
      activeIndex: panelIdx,
      onTap: _onPostCorrectTap,
    );
  }

  Widget _buildMoveLineSection({
    required String title,
    required List<MovePair> movePairs,
    required int? activeIndex,
    required void Function(int) onTap,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(
            title,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        SizedBox(
          height: 120,
          child: MoveSequencePanel(
            moves: movePairs,
            activeIndex: activeIndex,
            onTap: onTap,
          ),
        ),
      ],
    );
  }

  Widget _buildSolvePrompt() {
    final side = _sideToMove == dc.Side.white ? 'White' : 'Black';
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Text(
        'Find a better move for $side',
        style: const TextStyle(
          color: AppTheme.textPrimary,
          fontSize: 15,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildTurnToPlay() {
    final side = _sideToMove == dc.Side.white ? 'White' : 'Black';
    return Row(
      children: [
        _buildTurnIndicator(),
        const SizedBox(width: 8),
        Text(
          '$side to play',
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildTurnIndicator() {
    final isWhite = _sideToMove == dc.Side.white;
    return Container(
      width: 16,
      height: 16,
      decoration: BoxDecoration(
        color: isWhite ? Colors.white : Colors.black,
        border: Border.all(color: AppTheme.textSecondary, width: 1),
        shape: BoxShape.circle,
      ),
    );
  }

  Widget _buildSeeWhatYouPlayed() {
    return GestureDetector(
      onTap: () => setState(() => _showWhatYouPlayed = !_showWhatYouPlayed),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
        decoration: BoxDecoration(
          color: AppTheme.surfaceLight,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  _showWhatYouPlayed ? Icons.expand_less : Icons.expand_more,
                  color: AppTheme.textSecondary,
                  size: 18,
                ),
                const SizedBox(width: 4),
                const Text(
                  'See what you played',
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
            if (_showWhatYouPlayed) ...[
              const SizedBox(height: 6),
              Text(
                _blunderSan,
                style: const TextStyle(
                  color: AppTheme.incorrect,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildAnalyzingIndicator() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Row(
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppTheme.textSecondary,
            ),
          ),
          SizedBox(width: 12),
          Text(
            'Analyzing move...',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFeedbackBadge({required bool isCorrect}) {
    final color = isCorrect ? AppTheme.correct : _feedbackColor;
    final icon = (isCorrect || _feedbackColor == AppTheme.correct)
        ? Icons.check_circle
        : Icons.cancel;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              isCorrect
                  ? 'SOLUTION CORRECT'
                  : (_incorrectFeedback ?? 'Incorrect, try again'),
              style: TextStyle(
                color: color,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton() {
    final isRetry = _state == TrainingState.incorrect;
    final label = isRetry ? 'Retry' : 'Next';
    final action = isRetry ? _retry : _handleActionButton;

    return Column(
      children: [
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: action,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.accent,
              foregroundColor: AppTheme.textPrimary,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'or press Space',
          style: TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  Widget _buildControls() {
    return BoardControls(
      controls: [
        ControlConfig(
          icon: Icons.lightbulb_outline,
          label: 'HINT',
          onTap: _state == TrainingState.solving && !_showHint
              ? _showHintArrow
              : null,
          enabled: _state == TrainingState.solving && !_showHint,
        ),
        ControlConfig(
          icon: _paused ? Icons.play_arrow : Icons.pause,
          label: _paused ? 'RESUME' : 'PAUSE',
          onTap: () => setState(() => _paused = !_paused),
        ),
      ],
    );
  }

  Widget _buildProgressSection() {
    if (_session == null) return const SizedBox();
    return ProgressDisplay(
      label: 'RECALL RATE',
      value: _session!.recallRate,
    );
  }

  Widget _buildCompleteView() {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.emoji_events, size: 64, color: AppTheme.accent),
            const SizedBox(height: 16),
            Text(
              _session == null || _session!.blunders.isEmpty
                  ? 'No Blunders Due'
                  : 'Cycle Complete!',
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            if (_session != null && _session!.totalAttempted > 0) ...[
              Text(
                '${(_session!.recallRate * 100).toInt()}% recall rate',
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 16,
                ),
              ),
              Text(
                '${_session!.totalCorrect}/${_session!.totalAttempted} correct',
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 14,
                ),
              ),
            ],
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: () => Navigator.pushReplacementNamed(context, '/'),
              child: const Text('IMPORT MORE GAMES'),
            ),
          ],
        ),
      ),
    );
  }
}
