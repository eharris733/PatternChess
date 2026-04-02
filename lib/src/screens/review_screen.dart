import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dartchess/dartchess.dart' as dc;
import 'package:dartchess/dartchess.dart' show Move;
import 'package:chessground/chessground.dart';

import '../theme/app_theme.dart';
import '../models/game_record.dart';
import '../models/game_annotation.dart';
import '../services/supabase_service.dart';
import '../services/pgn_parser_service.dart';
import '../services/stockfish_service.dart';
import '../services/opening_explorer_service.dart';
import '../utils/winning_chances.dart';
import '../widgets/app_shell.dart';
import '../widgets/chess_board_panel.dart';
import '../widgets/move_sequence_panel.dart';
import '../widgets/board_controls.dart';
import '../widgets/classification_buttons.dart';
import '../widgets/eval_display.dart';

enum ReviewPhase { human, engine }

class ReviewScreen extends StatefulWidget {
  final String gameId;

  const ReviewScreen({super.key, required this.gameId});

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  // Game data
  GameRecord? _game;
  List<ParsedPosition> _positions = [];
  bool _loading = true;
  String? _error;

  // Navigation
  int _currentIndex = 0;

  // Board state
  String _fen = dc.kInitialBoardFEN;
  dc.Side _orientation = dc.Side.white;
  Move? _lastMove;

  // Annotations
  Map<String, MoveAnnotation> _annotations = {};
  bool _dirty = false;
  Timer? _saveDebounce;

  // Opening book
  final Map<int, bool> _bookMoves = {};
  int? _lastBookMoveIndex;
  bool _bookProcessingDone = false;

  // Engine verification (Phase 2)
  ReviewPhase _phase = ReviewPhase.human;
  final StockfishService _stockfish = StockfishService();
  bool _stockfishReady = false;
  bool _stockfishLoading = false;
  final Map<int, PositionEval> _engineEvals = {};
  bool _evaluatingCurrent = false;

  // Keyboard / focus
  final FocusNode _focusNode = FocusNode();
  final FocusNode _textFieldFocusNode = FocusNode();
  final TextEditingController _annotationController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadGame();
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    _saveNow();
    _focusNode.dispose();
    _textFieldFocusNode.dispose();
    _annotationController.dispose();
    super.dispose();
  }

  // ── Data Loading ──────────────────────────────────────────────────

  Future<void> _loadGame() async {
    try {
      final game = await SupabaseService.getGame(widget.gameId);
      final positions = PgnParserService.parseGame(game.pgn);
      final headers = PgnParserService.extractHeaders(game.pgn);

      // Determine orientation based on which side user played
      final whitePlayer = headers['White']?.toLowerCase() ?? '';
      final username = game.username.toLowerCase();
      final orientation =
          whitePlayer.contains(username) ? dc.Side.white : dc.Side.black;

      // Load existing annotations
      final existing = await SupabaseService.getAnnotations(widget.gameId);
      final annotations = <String, MoveAnnotation>{};
      if (existing != null) {
        for (final a in existing.annotations) {
          annotations[a.key] = a;
        }
      }

      if (mounted) {
        setState(() {
          _game = game;
          _positions = positions;
          _orientation = orientation;
          _annotations = annotations;
          _loading = false;
          _fen = positions.isNotEmpty ? positions[0].fen : dc.kInitialBoardFEN;
        });
        _updateAnnotationTextField();
        _processBookMoves();
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

  Future<void> _processBookMoves() async {
    // Pre-fetch opening explorer for the first ~20 half-moves
    final limit = _positions.length.clamp(0, 22);
    for (int i = 0; i < limit; i++) {
      final pos = _positions[i];
      if (pos.uciMove == null) continue;

      try {
        final result = await OpeningExplorerService.fetchMasters(pos.fen);
        if (result != null && !result.isEmpty) {
          final isBook =
              OpeningExplorerService.isBookMove(result, pos.uciMove!);
          if (mounted) {
            setState(() {
              _bookMoves[i] = isBook;
              if (isBook) {
                _lastBookMoveIndex = i;
              }
            });
          }
          if (!isBook) break; // Stop once we leave book
        } else {
          break; // No data — out of book
        }
      } catch (_) {
        break;
      }

      // Rate limit: ~300ms between requests
      await Future.delayed(const Duration(milliseconds: 300));
    }

    if (mounted) setState(() => _bookProcessingDone = true);
  }

  // ── Navigation ────────────────────────────────────────────────────

  void _goToMove(int index) {
    if (index < 0 || index >= _positions.length) return;
    final pos = _positions[index];

    // Compute last move highlight
    Move? lastMove;
    if (index > 0) {
      final prevPos = _positions[index - 1];
      if (prevPos.uciMove != null && prevPos.uciMove!.length >= 4) {
        final from = dc.Square.fromName(prevPos.uciMove!.substring(0, 2));
        final to = dc.Square.fromName(prevPos.uciMove!.substring(2, 4));
        lastMove = dc.NormalMove(from: from, to: to);
      }
    }

    setState(() {
      _currentIndex = index;
      _fen = pos.fen;
      _lastMove = lastMove;
    });

    _updateAnnotationTextField();

    // If in engine phase, evaluate current position
    if (_phase == ReviewPhase.engine && _stockfishReady) {
      _evaluateCurrentPosition();
    }
  }

  void _goFirst() => _goToMove(0);
  void _goPrev() => _goToMove(_currentIndex - 1);
  void _goNext() => _goToMove(_currentIndex + 1);
  void _goLast() => _goToMove(_positions.length - 1);

  // ── Annotations ───────────────────────────────────────────────────

  void _classifyCurrentMove(MoveGrade grade) {
    if (_currentIndex <= 0 || _currentIndex >= _positions.length) return;

    // The move that LED to the current position is at _currentIndex - 1
    final movePos = _positions[_currentIndex - 1];
    if (movePos.sanMove == null) return;

    final key = '${movePos.moveNumber}_${movePos.sideToMove}';
    final existing = _annotations[key];

    // Toggle off if same grade
    if (existing?.classification == grade) {
      setState(() {
        _annotations[key] = (existing!).copyWith(
          classification: () => null,
        );
      });
    } else {
      setState(() {
        _annotations[key] = MoveAnnotation(
          moveNumber: movePos.moveNumber,
          side: movePos.sideToMove,
          san: movePos.sanMove!,
          classification: grade,
          text: existing?.text,
        );
      });
    }

    _scheduleSave();
  }

  void _updateAnnotationText(String text) {
    if (_currentIndex <= 0 || _currentIndex >= _positions.length) return;

    final movePos = _positions[_currentIndex - 1];
    if (movePos.sanMove == null) return;

    final key = '${movePos.moveNumber}_${movePos.sideToMove}';
    final existing = _annotations[key];

    setState(() {
      _annotations[key] = MoveAnnotation(
        moveNumber: movePos.moveNumber,
        side: movePos.sideToMove,
        san: movePos.sanMove!,
        classification: existing?.classification,
        text: text.isEmpty ? null : text,
      );
    });

    _scheduleSave();
  }

  void _updateAnnotationTextField() {
    if (_currentIndex <= 0 || _currentIndex >= _positions.length) {
      _annotationController.text = '';
      return;
    }
    final movePos = _positions[_currentIndex - 1];
    final key = '${movePos.moveNumber}_${movePos.sideToMove}';
    _annotationController.text = _annotations[key]?.text ?? '';
  }

  MoveGrade? _getCurrentClassification() {
    if (_currentIndex <= 0 || _currentIndex >= _positions.length) return null;
    final movePos = _positions[_currentIndex - 1];
    final key = '${movePos.moveNumber}_${movePos.sideToMove}';
    return _annotations[key]?.classification;
  }

  // ── Persistence ───────────────────────────────────────────────────

  void _scheduleSave() {
    _dirty = true;
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(seconds: 2), _saveNow);
  }

  Future<void> _saveNow() async {
    if (!_dirty) return;
    _dirty = false;

    try {
      await SupabaseService.saveAnnotations(
        widget.gameId,
        _annotations.values.toList(),
      );
      await SupabaseService.markGameAnalyzed(widget.gameId);
    } catch (_) {
      // Silently handle save errors
    }
  }

  // ── Engine Phase ──────────────────────────────────────────────────

  Future<void> _startEnginePhase() async {
    setState(() {
      _phase = ReviewPhase.engine;
      _stockfishLoading = true;
    });

    try {
      await _stockfish.init();
      if (mounted) {
        setState(() {
          _stockfishReady = true;
          _stockfishLoading = false;
        });
        _evaluateCurrentPosition();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _stockfishLoading = false;
          _error = 'Failed to initialize engine: $e';
        });
      }
    }
  }

  Future<void> _evaluateCurrentPosition() async {
    if (!_stockfishReady || _evaluatingCurrent) return;
    if (_currentIndex <= 0) return;

    // Check cache
    if (_engineEvals.containsKey(_currentIndex)) {
      setState(() {}); // Trigger rebuild with cached data
      return;
    }

    setState(() => _evaluatingCurrent = true);

    try {
      // Evaluate position BEFORE the move (to get eval swing)
      final beforePos = _positions[_currentIndex - 1];
      final afterPos = _positions[_currentIndex];

      final evalBefore =
          await _stockfish.evaluatePositionFull(beforePos.fen, depth: 16);
      final evalAfter =
          await _stockfish.evaluatePositionFull(afterPos.fen, depth: 16);

      if (mounted) {
        setState(() {
          _engineEvals[_currentIndex] = evalBefore;
          // Store the after eval too for swing calculation
          _engineEvals[-_currentIndex] = evalAfter;
          _evaluatingCurrent = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _evaluatingCurrent = false);
    }
  }

  MoveClassification? _getEngineClassification(int posIndex) {
    final evalBefore = _engineEvals[posIndex];
    final evalAfter = _engineEvals[-posIndex];
    if (evalBefore == null || evalAfter == null) return null;

    final chancesLost = WinningChances.winningChancesLost(
        evalBefore.scoreCp, evalAfter.scoreCp);
    return WinningChances.classify(chancesLost);
  }

  MoveGrade? _engineClassToGrade(MoveClassification cls) {
    return switch (cls) {
      MoveClassification.good => MoveGrade.A,
      MoveClassification.inaccuracy => MoveGrade.S,
      MoveClassification.mistake => MoveGrade.D,
      MoveClassification.blunder => MoveGrade.F,
    };
  }

  // ── Keyboard ──────────────────────────────────────────────────────

  void _handleKeyPress(KeyEvent event) {
    if (event is! KeyDownEvent) return;
    final isTextFieldFocused = _textFieldFocusNode.hasFocus;

    if (event.logicalKey == LogicalKeyboardKey.arrowRight) {
      _goNext();
    } else if (event.logicalKey == LogicalKeyboardKey.arrowLeft) {
      _goPrev();
    } else if (event.logicalKey == LogicalKeyboardKey.space &&
        !isTextFieldFocused) {
      _goNext();
    } else if (!isTextFieldFocused) {
      if (event.logicalKey == LogicalKeyboardKey.keyA) {
        _classifyCurrentMove(MoveGrade.A);
      } else if (event.logicalKey == LogicalKeyboardKey.keyS) {
        _classifyCurrentMove(MoveGrade.S);
      } else if (event.logicalKey == LogicalKeyboardKey.keyD) {
        _classifyCurrentMove(MoveGrade.D);
      } else if (event.logicalKey == LogicalKeyboardKey.keyF) {
        _classifyCurrentMove(MoveGrade.F);
      }
    }
  }

  // ── Move List Building ────────────────────────────────────────────

  List<MovePair> _buildMovePairs() {
    final pairs = <MovePair>[];
    int pairIndex = 0;

    for (int i = 0; i < _positions.length; i++) {
      final pos = _positions[i];
      if (pos.sanMove == null) continue;

      final key = '${pos.moveNumber}_${pos.sideToMove}';
      final annotation = _annotations[key];

      // Determine label and color
      String? label;
      Color? labelColor;

      if (annotation?.classification != null) {
        label = annotation!.classification!.shortLabel;
        labelColor = annotation.classification!.color;
      } else if (_bookMoves[i] == true) {
        label = 'BOOK';
        labelColor = AppTheme.correct.withValues(alpha: 0.6);
      } else if (_lastBookMoveIndex != null &&
          i == _lastBookMoveIndex! + 1 &&
          _bookProcessingDone) {
        label = 'NEW';
        labelColor = AppTheme.accentLight;
      }

      if (pos.sideToMove == 'white') {
        pairs.add(MovePair(
          moveNumber: pos.moveNumber,
          whiteMove: pos.sanMove,
          whiteLabel: label,
          whiteLabelColor: labelColor,
        ));
        pairIndex = pairs.length - 1;
      } else {
        if (pairs.isEmpty || pairs.last.blackMove != null) {
          pairs.add(MovePair(
            moveNumber: pos.moveNumber,
            blackMove: pos.sanMove,
            blackLabel: label,
            blackLabelColor: labelColor,
          ));
          pairIndex = pairs.length - 1;
        } else {
          final existing = pairs[pairIndex];
          pairs[pairIndex] = MovePair(
            moveNumber: existing.moveNumber,
            whiteMove: existing.whiteMove,
            whiteLabel: existing.whiteLabel,
            whiteLabelColor: existing.whiteLabelColor,
            blackMove: pos.sanMove,
            blackLabel: label,
            blackLabelColor: labelColor,
          );
        }
      }
    }

    return pairs;
  }

  int _positionToMoveIndex(int posIndex) {
    // Convert position index to the move index used by MoveSequencePanel
    // Position 0 = starting position (no move), position 1 = after first move, etc.
    if (posIndex <= 0) return -1;
    return posIndex - 1; // 0-based index into the moves
  }

  int _moveIndexToPosition(int moveIndex) {
    return moveIndex + 1;
  }

  // ── Engine Feedback ───────────────────────────────────────────────

  Widget _buildEngineFeedback() {
    if (_currentIndex <= 0) return const SizedBox();

    final engineClass = _getEngineClassification(_currentIndex);
    final userGrade = _getCurrentClassification();

    if (_evaluatingCurrent) {
      return Container(
        padding: const EdgeInsets.all(12),
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
                  color: AppTheme.accent, strokeWidth: 2),
            ),
            SizedBox(width: 12),
            Text('Evaluating position...',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13)),
          ],
        ),
      );
    }

    if (engineClass == null) return const SizedBox();

    final engineGrade = _engineClassToGrade(engineClass);
    final evalBefore = _engineEvals[_currentIndex];
    final evalAfter = _engineEvals[-_currentIndex];

    final agree = userGrade == engineGrade;
    final movePos = _positions[_currentIndex - 1];

    String message;
    Color messageColor;
    IconData icon;

    if (userGrade == null) {
      message =
          "You didn't grade this move. Engine says: ${engineGrade?.label ?? 'Good'}";
      messageColor = AppTheme.textSecondary;
      icon = Icons.info_outline;
    } else if (agree) {
      message = 'Correct! You identified this as ${userGrade.label}.';
      messageColor = AppTheme.correct;
      icon = Icons.check_circle;
    } else {
      final userLabel = userGrade.label.toLowerCase();
      final engineLabel = engineGrade?.label.toLowerCase() ?? 'good';

      // User thought it was worse than it is
      if ((userGrade == MoveGrade.F || userGrade == MoveGrade.D) &&
          (engineGrade == MoveGrade.A || engineGrade == MoveGrade.S)) {
        message =
            'You marked this as $userLabel, but it was actually $engineLabel!';
      }
      // User thought it was better than it is
      else if ((userGrade == MoveGrade.A || userGrade == MoveGrade.S) &&
          (engineGrade == MoveGrade.D || engineGrade == MoveGrade.F)) {
        message =
            'You marked this as $userLabel, but it was actually a $engineLabel!';
        if (evalBefore != null) {
          message += ' Best was: ${evalBefore.bestMove}';
        }
      } else {
        message =
            'You said $userLabel, engine says $engineLabel.';
      }
      messageColor = engineGrade == MoveGrade.A || engineGrade == MoveGrade.S
          ? AppTheme.correct
          : AppTheme.incorrect;
      icon = Icons.compare_arrows;
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: messageColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: messageColor.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: messageColor, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  message,
                  style: TextStyle(color: messageColor, fontSize: 13),
                ),
              ),
            ],
          ),
          if (evalBefore != null && evalAfter != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                EvalDisplay(scoreCp: evalBefore.scoreCp),
                const SizedBox(width: 8),
                const Icon(Icons.arrow_forward,
                    color: AppTheme.textSecondary, size: 14),
                const SizedBox(width: 8),
                EvalDisplay(scoreCp: evalAfter.scoreCp),
                const SizedBox(width: 12),
                Text(
                  'Best: ${_uciToReadable(evalBefore.bestMove, movePos.fen)}',
                  style: const TextStyle(
                      color: AppTheme.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  String _uciToReadable(String uci, String fen) {
    // Try to convert UCI to SAN using dartchess
    try {
      final position = dc.Chess.fromSetup(dc.Setup.parseFen(fen));
      final move = position.parseSan(uci);
      if (move != null) return uci; // Already SAN
      // Parse as UCI
      if (uci.length >= 4) {
        final from = dc.Square.fromName(uci.substring(0, 2));
        final to = dc.Square.fromName(uci.substring(2, 4));
        final promo = uci.length > 4
            ? _charToRole(uci.substring(4))
            : null;
        final normalMove = dc.NormalMove(from: from, to: to, promotion: promo);
        final (_, san) = position.makeSan(normalMove);
        return san;
      }
    } catch (_) {}
    return uci;
  }

  dc.Role? _charToRole(String c) {
    return switch (c) {
      'q' => dc.Role.queen,
      'r' => dc.Role.rook,
      'b' => dc.Role.bishop,
      'n' => dc.Role.knight,
      _ => null,
    };
  }

  // ── UI ────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return KeyboardListener(
      focusNode: _focusNode,
      autofocus: true,
      onKeyEvent: _handleKeyPress,
      child: AppShell(
        activeRoute: '/vault',
        child: _loading
            ? const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(color: AppTheme.accent),
                    SizedBox(height: 16),
                    Text('Loading game...',
                        style: TextStyle(color: AppTheme.textSecondary)),
                  ],
                ),
              )
            : _error != null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!,
                            style:
                                const TextStyle(color: AppTheme.incorrect)),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Go Back'),
                        ),
                      ],
                    ),
                  )
                : _buildLayout(),
      ),
    );
  }

  Widget _buildLayout() {
    final screenWidth = MediaQuery.of(context).size.width;
    final isWide = screenWidth > 900;

    if (isWide) {
      return _buildWideLayout();
    }
    return _buildNarrowLayout();
  }

  Widget _buildWideLayout() {
    return Row(
      children: [
        // Left side: Board + controls
        Expanded(
          flex: 3,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _buildGameHeader(),
                const SizedBox(height: 8),
                Expanded(child: _buildBoard()),
                const SizedBox(height: 8),
                _buildNavControls(),
                const SizedBox(height: 8),
                ClassificationButtons(
                  current: _getCurrentClassification(),
                  onSelect: _classifyCurrentMove,
                ),
                const SizedBox(height: 8),
                _buildPhaseButton(),
              ],
            ),
          ),
        ),
        // Right side: Move list + annotation
        SizedBox(
          width: 360,
          child: Container(
            color: AppTheme.surface,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: _buildRightPanel(),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildNarrowLayout() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          _buildGameHeader(),
          const SizedBox(height: 8),
          SizedBox(
            height: 400,
            child: _buildBoard(),
          ),
          const SizedBox(height: 8),
          _buildNavControls(),
          const SizedBox(height: 8),
          ClassificationButtons(
            current: _getCurrentClassification(),
            onSelect: _classifyCurrentMove,
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 300,
            child: _buildMoveList(),
          ),
          const SizedBox(height: 8),
          _buildAnnotationField(),
          if (_phase == ReviewPhase.engine) ...[
            const SizedBox(height: 8),
            _buildEngineFeedback(),
          ],
          const SizedBox(height: 8),
          _buildPhaseButton(),
        ],
      ),
    );
  }

  Widget _buildGameHeader() {
    final game = _game;
    if (game == null) return const SizedBox();

    final parts = <String>[];
    if (game.platform.isNotEmpty) parts.add(game.platform);
    if (game.timeControl != null) parts.add(game.timeControl!);
    if (game.playedAt != null) {
      final d = game.playedAt!;
      parts.add(
          '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}');
    }
    if (game.result != null) parts.add(game.result!.toUpperCase());

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
          Text(
            'vs ${game.opponent}',
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.bold,
            ),
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 2),
          Text(
            parts.join(' \u00b7 '),
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 12,
            ),
          ),
          if (_currentIndex > 0 && _currentIndex < _positions.length) ...[
            const SizedBox(height: 4),
            Text(
              'Move ${_positions[_currentIndex - 1].moveNumber} (${_positions[_currentIndex - 1].sideToMove})',
              style: const TextStyle(
                color: AppTheme.accentLight,
                fontSize: 11,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBoard() {
    return ChessBoardPanel(
      fen: _fen,
      orientation: _orientation,
      playerSide: PlayerSide.none,
      sideToMove: _fen.contains(' w ')
          ? dc.Side.white
          : dc.Side.black,
      lastMove: _lastMove,
    );
  }

  Widget _buildNavControls() {
    return BoardControls(
      controls: [
        ControlConfig(
          icon: Icons.skip_previous,
          label: 'First',
          onTap: _goFirst,
          enabled: _currentIndex > 0,
        ),
        ControlConfig(
          icon: Icons.chevron_left,
          label: 'Prev',
          onTap: _goPrev,
          enabled: _currentIndex > 0,
        ),
        ControlConfig(
          icon: Icons.chevron_right,
          label: 'Next',
          onTap: _goNext,
          enabled: _currentIndex < _positions.length - 1,
        ),
        ControlConfig(
          icon: Icons.skip_next,
          label: 'Last',
          onTap: _goLast,
          enabled: _currentIndex < _positions.length - 1,
        ),
      ],
    );
  }

  Widget _buildRightPanel() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Current move info
        if (_currentIndex > 0 && _currentIndex < _positions.length) ...[
          _buildCurrentMoveInfo(),
          const SizedBox(height: 8),
        ],
        // Engine feedback (Phase 2)
        if (_phase == ReviewPhase.engine) ...[
          _buildEngineFeedback(),
          const SizedBox(height: 8),
        ],
        // Move list
        Expanded(child: _buildMoveList()),
        const SizedBox(height: 8),
        // Annotation text field
        _buildAnnotationField(),
      ],
    );
  }

  Widget _buildCurrentMoveInfo() {
    final movePos = _positions[_currentIndex - 1];
    final grade = _getCurrentClassification();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: grade != null
            ? grade.color.withValues(alpha: 0.1)
            : AppTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
        border: grade != null
            ? Border.all(color: grade.color.withValues(alpha: 0.3))
            : null,
      ),
      child: Row(
        children: [
          Text(
            '${movePos.moveNumber}${movePos.sideToMove == 'white' ? '.' : '...'} ${movePos.sanMove ?? ''}',
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const Spacer(),
          if (grade != null) ...[
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: grade.color.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                grade.label,
                style: TextStyle(
                  color: grade.color,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
          if (_bookMoves[_currentIndex - 1] == true) ...[
            const SizedBox(width: 8),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.correct.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text(
                'BOOK',
                style: TextStyle(
                  color: AppTheme.correct,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMoveList() {
    final pairs = _buildMovePairs();
    final activeIndex = _positionToMoveIndex(_currentIndex);

    return MoveSequencePanel(
      moves: pairs,
      activeIndex: activeIndex,
      onTap: (index) => _goToMove(_moveIndexToPosition(index)),
    );
  }

  Widget _buildAnnotationField() {
    final canAnnotate =
        _currentIndex > 0 && _currentIndex < _positions.length;

    return TextField(
      controller: _annotationController,
      focusNode: _textFieldFocusNode,
      enabled: canAnnotate,
      onChanged: _updateAnnotationText,
      maxLines: 2,
      style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
      decoration: InputDecoration(
        hintText: canAnnotate
            ? 'Add a note about this move...'
            : 'Select a move to annotate',
        hintStyle:
            const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
        filled: true,
        fillColor: AppTheme.surfaceLight,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppTheme.accent),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    );
  }

  Widget _buildPhaseButton() {
    if (_phase == ReviewPhase.human) {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: _startEnginePhase,
          icon: const Icon(Icons.psychology, size: 18),
          label: const Text('CHECK WITH ENGINE'),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 12),
          ),
        ),
      );
    }

    if (_stockfishLoading) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                  color: AppTheme.accent, strokeWidth: 2),
            ),
            SizedBox(width: 12),
            Text('Starting engine...',
                style: TextStyle(color: AppTheme.textSecondary)),
          ],
        ),
      );
    }

    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: () => setState(() => _phase = ReviewPhase.human),
        icon: const Icon(Icons.visibility_off, size: 18),
        label: const Text('HIDE ENGINE'),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 12),
          side: const BorderSide(color: AppTheme.surfaceLight),
        ),
      ),
    );
  }
}
