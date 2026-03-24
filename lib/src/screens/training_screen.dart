import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:chessground/chessground.dart';
import 'package:dartchess/dartchess.dart' as dc;
import 'package:dartchess/dartchess.dart' show Move;
import 'package:fast_immutable_collections/fast_immutable_collections.dart';

import '../theme/app_theme.dart';
import '../models/blunder.dart';
import '../models/training_session.dart';
import '../services/stockfish_service.dart';
import '../services/supabase_service.dart';
import '../utils/winning_chances.dart';
import '../widgets/app_shell.dart';
import '../widgets/chess_board_panel.dart';
import '../widgets/move_sequence_panel.dart';
import '../widgets/eval_display.dart';
import '../widgets/feedback_overlay.dart';
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

  // Move history for the panel
  List<MovePair> _movePairs = [];

  // Review state: clickable variation
  List<_ReviewMove> _reviewMoves = [];
  int? _activeReviewIndex;

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
    if (_state == TrainingState.reviewing) {
      _proceedFromReview();
    } else if (_state == TrainingState.correct ||
        _state == TrainingState.incorrect) {
      _advance();
    }
  }

  Future<void> _initStockfish() async {
    try {
      await _stockfish.init();
      if (mounted) setState(() => _stockfishReady = true);
    } catch (_) {
      // Stockfish not available — fall back to strict matching
    }
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
        if (mounted) {
          setState(() => _state = TrainingState.complete);
        }
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

  void _loadCurrentBlunder() {
    final blunder = _session?.currentBlunder;
    if (blunder == null) {
      setState(() => _state = TrainingState.complete);
      return;
    }

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
        _movePairs = [];
        _reviewMoves = [];
        _activeReviewIndex = null;
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

    // Red arrow for the blunder move
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
      _reviewMoves = [];
      _activeReviewIndex = null;
      // Show blunder as first move in the panel
      _movePairs = [];
    });

    // Get refutation line from Stockfish
    if (_stockfishReady) {
      try {
        final result =
            await _stockfish.evaluateMove(blunder.fen, uciMove, timeMs: 500);
        if (mounted && result.principalVariation.isNotEmpty) {
          _buildReviewVariation(
              blunder, afterBlunder, result.principalVariation);
        }
      } catch (_) {
        // No refutation available
      }
    }
  }

  void _buildReviewVariation(
      Blunder blunder, dc.Position afterBlunder, List<String> pvMoves) {
    final reviewMoves = <_ReviewMove>[];
    final movePairs = <MovePair>[];
    var pos = afterBlunder;

    // First entry: the blunder move itself
    final blunderSan = _getSanForUci(
        dc.Chess.fromSetup(dc.Setup.parseFen(blunder.fen)),
        blunder.playedMove);

    // Build refutation moves from PV
    for (final uci in pvMoves) {
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

    // Build MovePairs for the panel
    // First pair: blunder move + first refutation move
    final startMoveNum = afterBlunder.fullmoves;
    final blunderIsWhite = blunder.sideToMove == 'white';

    if (blunderIsWhite) {
      // Blunder was white's move, refutation starts with black
      movePairs.add(MovePair(
        moveNumber: startMoveNum - 1,
        whiteMove: blunderSan,
        whiteLabel: 'Blunder',
        blackMove: reviewMoves.isNotEmpty ? reviewMoves[0].san : null,
      ));
      for (int i = 1; i < reviewMoves.length; i += 2) {
        movePairs.add(MovePair(
          moveNumber: startMoveNum + (i ~/ 2),
          whiteMove: reviewMoves[i].san,
          blackMove:
              i + 1 < reviewMoves.length ? reviewMoves[i + 1].san : null,
        ));
      }
    } else {
      // Blunder was black's move, refutation starts with white
      movePairs.add(MovePair(
        moveNumber: startMoveNum - 1,
        whiteMove: null,
        blackMove: blunderSan,
        blackLabel: 'Blunder',
      ));
      for (int i = 0; i < reviewMoves.length; i += 2) {
        movePairs.add(MovePair(
          moveNumber: startMoveNum + (i ~/ 2),
          whiteMove: reviewMoves[i].san,
          blackMove:
              i + 1 < reviewMoves.length ? reviewMoves[i + 1].san : null,
        ));
      }
    }

    setState(() {
      _reviewMoves = reviewMoves;
      _movePairs = movePairs;
    });
  }

  String _getSanForUci(dc.Position pos, String uci) {
    final move = _parseUciMove(uci);
    if (move == null || !pos.isLegal(move)) return uci;
    final (_, san) = pos.makeSan(move);
    return san;
  }

  void _onReviewMoveTap(int index) {
    if (_state != TrainingState.reviewing || _reviewMoves.isEmpty) return;

    // index 0 in the panel is the blunder move itself (not in _reviewMoves)
    // The blunder move is at panel index 0 (white) or 0 (black)
    // Review moves start after the blunder
    // Compute which review move this maps to
    final blunder = _session?.currentBlunder;
    if (blunder == null) return;

    final blunderIsWhite = blunder.sideToMove == 'white';
    int reviewIdx;

    if (blunderIsWhite) {
      // Panel indices: 0=blunder(white), 1=refutation[0](black), 2=ref[1](white), ...
      if (index == 0) {
        // Clicked the blunder move — show position after blunder
        _showReviewPosition(null);
        return;
      }
      reviewIdx = index - 1;
    } else {
      // Panel indices: 0=nothing(white), 1=blunder(black), 2=ref[0](white), 3=ref[1](black)...
      if (index <= 1) {
        _showReviewPosition(null);
        return;
      }
      reviewIdx = index - 2;
    }

    if (reviewIdx < 0 || reviewIdx >= _reviewMoves.length) return;
    _showReviewPosition(reviewIdx);
  }

  void _showReviewPosition(int? reviewIdx) {
    final blunder = _session?.currentBlunder;
    if (blunder == null) return;

    if (reviewIdx == null) {
      // Show position after the blunder
      final pos = dc.Chess.fromSetup(dc.Setup.parseFen(blunder.fen));
      final move = _parseUciMove(blunder.playedMove);
      if (move != null && pos.isLegal(move)) {
        final afterBlunder = pos.playUnchecked(move);
        final blunderArrow = Arrow(
          color: AppTheme.incorrect.withValues(alpha: 0.7),
          orig: dc.Square.fromName(blunder.playedMove.substring(0, 2)),
          dest: dc.Square.fromName(blunder.playedMove.substring(2, 4)),
        );
        setState(() {
          _position = afterBlunder;
          _fen = afterBlunder.fen;
          _lastMove = move;
          _shapes = ISet([blunderArrow]);
          _activeReviewIndex = null;
        });
      }
      return;
    }

    final rm = _reviewMoves[reviewIdx];
    final afterMove = rm.position.playUnchecked(rm.move!);
    setState(() {
      _position = afterMove;
      _fen = afterMove.fen;
      _lastMove = rm.move;
      _shapes = ISet();
      _activeReviewIndex = reviewIdx;
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
      _movePairs = [];
      _reviewMoves = [];
      _activeReviewIndex = null;
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

    if (_position!.isLegal(move)) {
      final newPosition = _position!.playUnchecked(move);
      setState(() {
        _position = newPosition;
        _fen = newPosition.fen;
        _lastMove = move;
        _validMoves = const IMapConst({});
        _promotionMove = null;
      });
    }

    // On-the-fly evaluation for non-stored moves
    if (!isCorrect && _stockfishReady && blunder.correctMoves.isNotEmpty) {
      setState(() => _evaluating = true);
      try {
        final result =
            await _stockfish.evaluateMove(blunder.fen, uciMove, timeMs: 500);
        final bestEval = blunder.correctMoves.first.eval;

        final bestWinPct = WinningChances.winPercent(bestEval);
        final moveWinPct = WinningChances.winPercent(-result.scoreCp);

        if ((bestWinPct - moveWinPct).abs() <= 5.0) {
          isCorrect = true;
          final newMove =
              CorrectMove(move: uciMove, eval: -result.scoreCp);
          blunder.addCorrectMove(newMove);
          SupabaseService.appendCorrectMove(
              blunder.id, blunder.correctMoves);
        }
      } catch (_) {
        // Eval failed — treat as incorrect
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
      setState(() => _state = TrainingState.correct);
    } else {
      _session!.recordIncorrect();
      blunder.timesAttempted++;
      SupabaseService.updateBlunderAfterDrill(blunder);
      _highlightCorrectMoves(blunder);
      setState(() => _state = TrainingState.incorrect);
    }
  }

  void _highlightCorrectMoves(Blunder blunder) {
    final shapes = <Shape>[];
    for (final cm in blunder.correctMoves) {
      final from = cm.move.substring(0, 2);
      final to = cm.move.substring(2, 4);
      shapes.add(Arrow(
        color: AppTheme.correct.withValues(alpha: 0.7),
        orig: dc.Square.fromName(from),
        dest: dc.Square.fromName(to),
      ));
    }
    setState(() => _shapes = ISet(shapes));
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
    _loadCurrentBlunder();
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
        center: _state == TrainingState.loading
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
          width: 280,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _buildInfoHeader(blunder),
                const SizedBox(height: 12),
                Expanded(
                  child: MoveSequencePanel(
                    moves: _movePairs,
                    activeIndex: _activeReviewIndex,
                    onTap: _state == TrainingState.reviewing
                        ? _onReviewMoveTap
                        : null,
                  ),
                ),
                if (_state == TrainingState.reviewing) ...[
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _proceedFromReview,
                      child: const Text('GOT IT'),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                _buildProgressSection(),
              ],
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
          _buildInfoHeader(blunder),
          const SizedBox(height: 8),
          Expanded(child: _buildBoard()),
          const SizedBox(height: 8),
          _buildControls(),
          if (_state == TrainingState.reviewing) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _proceedFromReview,
                child: const Text('GOT IT'),
              ),
            ),
          ],
          const SizedBox(height: 8),
          _buildProgressSection(),
        ],
      ),
    );
  }

  Widget _buildBoard() {
    return Stack(
      children: [
        ChessBoardPanel(
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
        ),

        // Feedback overlays (no overlay for reviewing state)
        if (_state == TrainingState.correct)
          Positioned.fill(
            child: FeedbackOverlay.correct(
              subtitle: 'Press any key to continue',
              actions: [
                ElevatedButton(
                  onPressed: _advance,
                  child: const Text('NEXT'),
                ),
              ],
            ),
          ),
        if (_state == TrainingState.incorrect)
          Positioned.fill(
            child: FeedbackOverlay.incorrect(
              subtitle:
                  'The correct move is highlighted. Press any key to continue.',
              actions: [
                ElevatedButton(
                  onPressed: _retry,
                  child: const Text('RETRY'),
                ),
                const SizedBox(width: 12),
                OutlinedButton(
                  onPressed: _advance,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.textSecondary,
                  ),
                  child: const Text('NEXT'),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildTurnIndicator() {
    final isWhite = _sideToMove == dc.Side.white;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            color: isWhite ? Colors.white : Colors.black,
            border: Border.all(color: AppTheme.textSecondary, width: 1),
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          isWhite ? 'White' : 'Black',
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildInfoHeader(Blunder? blunder) {
    return Row(
      children: [
        _buildTurnIndicator(),
        const SizedBox(width: 8),
        if (blunder != null) EvalDisplay(scoreCp: blunder.evalBefore),
        const Spacer(),
        if (_session != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              _session!.cycleText,
              style: const TextStyle(
                color: AppTheme.accentLight,
                fontSize: 13,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        const SizedBox(width: 8),
        if (_session != null)
          Text(
            _session!.progressText,
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 14,
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
        ControlConfig(
          icon: Icons.skip_next,
          label: 'SKIP',
          onTap: _state == TrainingState.solving ? _advance : null,
          enabled: _state == TrainingState.solving,
        ),
      ],
    );
  }

  Widget _buildProgressSection() {
    if (_session == null) return const SizedBox();
    return Column(
      children: [
        ProgressDisplay(
          label: 'RECALL RATE',
          value: _session!.recallRate,
        ),
      ],
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
