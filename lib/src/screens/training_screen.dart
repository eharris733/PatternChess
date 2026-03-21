import 'dart:async';

import 'package:flutter/material.dart';
import 'package:chessground/chessground.dart';
import 'package:dartchess/dartchess.dart' as dc;
import 'package:dartchess/dartchess.dart' show Move;
import 'package:fast_immutable_collections/fast_immutable_collections.dart';

import '../theme/app_theme.dart';
import '../models/blunder.dart';
import '../models/training_session.dart';
import '../services/supabase_service.dart';
import '../widgets/app_shell.dart';
import '../widgets/chess_board_panel.dart';
import '../widgets/move_sequence_panel.dart';
import '../widgets/eval_display.dart';
import '../widgets/feedback_overlay.dart';
import '../widgets/board_controls.dart';
import '../widgets/progress_indicator.dart';

enum TrainingState { loading, solving, correct, incorrect, complete }

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

  @override
  void initState() {
    super.initState();
    _loadBlunders();
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
    });
  }

  void _onMove(Move move, {bool? viaDragAndDrop}) {
    if (_state != TrainingState.solving || _position == null) return;

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

  void _processMove(Move move) {
    final blunder = _session?.currentBlunder;
    if (blunder == null) return;

    final uciMove = _moveToUci(move);
    final isCorrect = blunder.isCorrectMove(uciMove);

    // Update board with the played move
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

    if (isCorrect) {
      _session!.recordCorrect();
      blunder.timesCorrect++;
      blunder.timesAttempted++;
      blunder.lastDrilledAt = DateTime.now();
      SupabaseService.updateBlunderAfterDrill(blunder);

      setState(() => _state = TrainingState.correct);

      // Auto-advance after delay
      Timer(const Duration(milliseconds: 1500), () {
        if (mounted && _state == TrainingState.correct) {
          _advance();
        }
      });
    } else {
      _session!.recordIncorrect();
      blunder.timesAttempted++;
      SupabaseService.updateBlunderAfterDrill(blunder);

      // Show correct moves on the board
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
      // Check if we should start next cycle
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
          color: AppTheme.accentLight.withValues(alpha: 0.5),
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
      final promo = move.promotion != null
          ? _roleToChar(move.promotion!)
          : '';
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

    return AppShell(
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
    );
  }

  Widget _buildWideLayout(Blunder? blunder) {
    return Row(
      children: [
        // Board area
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

        // Right panel
        SizedBox(
          width: 280,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _buildInfoHeader(blunder),
                const SizedBox(height: 12),
                Expanded(
                  child: MoveSequencePanel(moves: _movePairs),
                ),
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
          validMoves: _state == TrainingState.solving ? _validMoves : const IMapConst({}),
          sideToMove: _sideToMove,
          isCheck: _position?.isCheck ?? false,
          lastMove: _lastMove,
          promotionMove: _promotionMove,
          onMove: _state == TrainingState.solving ? _onMove : null,
          onPromotionSelection: _onPromotionSelection,
          shapes: _shapes.isNotEmpty ? _shapes : null,
        ),

        // Feedback overlay
        if (_state == TrainingState.correct)
          Positioned.fill(child: FeedbackOverlay.correct()),
        if (_state == TrainingState.incorrect)
          Positioned.fill(
            child: FeedbackOverlay.incorrect(
              subtitle: 'The correct move is highlighted',
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
                  child: const Text('SKIP'),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildInfoHeader(Blunder? blunder) {
    return Row(
      children: [
        if (blunder != null)
          EvalDisplay(scoreCp: blunder.evalBefore),
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
