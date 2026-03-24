import 'dart:math';

enum MoveClassification { good, inaccuracy, mistake, blunder }

class WinningChances {
  /// Lichess winning chances formula.
  /// Converts centipawn evaluation to win percentage (0-100).
  static double winPercent(int centipawns) {
    return 50 + 50 * (2 / (1 + exp(-0.00368208 * centipawns)) - 1);
  }

  /// Calculate winning chances lost from the moving side's perspective.
  /// Both evals are raw engine output (from each position's side-to-move).
  /// evalAfter is automatically negated since it's from the opponent's perspective.
  static double winningChancesLost(int evalBefore, int evalAfter) {
    final winBefore = winPercent(evalBefore);
    final winAfter = winPercent(-evalAfter);
    return winBefore - winAfter;
  }

  /// Classify a move based on winning chances lost (Lichess thresholds).
  static MoveClassification classify(double chancesLost) {
    if (chancesLost >= 30) return MoveClassification.blunder;
    if (chancesLost >= 20) return MoveClassification.mistake;
    if (chancesLost >= 10) return MoveClassification.inaccuracy;
    return MoveClassification.good;
  }

  /// Returns true if the move qualifies for woodpecker training
  /// (mistake or blunder: >=20% winning chances lost).
  static bool isTrainable(double chancesLost) => chancesLost >= 20.0;
}
