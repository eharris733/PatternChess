class CorrectMove {
  final String move;
  final int eval;

  CorrectMove({required this.move, required this.eval});

  factory CorrectMove.fromJson(Map<String, dynamic> json) {
    return CorrectMove(
      move: json['move'] as String,
      eval: json['eval'] as int,
    );
  }

  Map<String, dynamic> toJson() => {'move': move, 'eval': eval};
}

class Blunder {
  final String id;
  final String gameId;
  final String fen;
  final int moveNumber;
  final String playedMove;
  List<CorrectMove> correctMoves;
  final int evalBefore;
  final int evalAfter;
  final int evalSwing;
  final String sideToMove;
  int cycleNumber;
  DateTime? lastDrilledAt;
  DateTime? nextDrillAt;
  int timesCorrect;
  int timesAttempted;
  final DateTime createdAt;

  Blunder({
    required this.id,
    required this.gameId,
    required this.fen,
    required this.moveNumber,
    required this.playedMove,
    required this.correctMoves,
    required this.evalBefore,
    required this.evalAfter,
    required this.evalSwing,
    required this.sideToMove,
    this.cycleNumber = 0,
    this.lastDrilledAt,
    this.nextDrillAt,
    this.timesCorrect = 0,
    this.timesAttempted = 0,
    required this.createdAt,
  });

  static const List<int> spacedRepetitionDays = [1, 2, 4, 7, 14, 28, 56];

  double get recallRate =>
      timesAttempted > 0 ? timesCorrect / timesAttempted : 0.0;

  DateTime get nextDrillDate {
    final base = lastDrilledAt ?? createdAt;
    final dayIndex =
        cycleNumber < spacedRepetitionDays.length ? cycleNumber : spacedRepetitionDays.length - 1;
    return base.add(Duration(days: spacedRepetitionDays[dayIndex]));
  }

  bool isCorrectMove(String uciMove) {
    return correctMoves.any((cm) => cm.move == uciMove);
  }

  void addCorrectMove(CorrectMove move) {
    if (!correctMoves.any((cm) => cm.move == move.move)) {
      correctMoves.add(move);
    }
  }

  factory Blunder.fromJson(Map<String, dynamic> json) {
    final correctMovesJson = json['correct_moves'] as List<dynamic>;
    return Blunder(
      id: json['id'] as String,
      gameId: json['game_id'] as String,
      fen: json['fen'] as String,
      moveNumber: json['move_number'] as int,
      playedMove: json['played_move'] as String,
      correctMoves: correctMovesJson
          .map((e) => CorrectMove.fromJson(e as Map<String, dynamic>))
          .toList(),
      evalBefore: json['eval_before'] as int,
      evalAfter: json['eval_after'] as int,
      evalSwing: json['eval_swing'] as int,
      sideToMove: json['side_to_move'] as String,
      cycleNumber: json['cycle_number'] as int? ?? 0,
      lastDrilledAt: json['last_drilled_at'] != null
          ? DateTime.parse(json['last_drilled_at'] as String)
          : null,
      nextDrillAt: json['next_drill_at'] != null
          ? DateTime.parse(json['next_drill_at'] as String)
          : null,
      timesCorrect: json['times_correct'] as int? ?? 0,
      timesAttempted: json['times_attempted'] as int? ?? 0,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toInsertJson() {
    return {
      'game_id': gameId,
      'fen': fen,
      'move_number': moveNumber,
      'played_move': playedMove,
      'correct_moves': correctMoves.map((e) => e.toJson()).toList(),
      'eval_before': evalBefore,
      'eval_after': evalAfter,
      'eval_swing': evalSwing,
      'side_to_move': sideToMove,
    };
  }
}
