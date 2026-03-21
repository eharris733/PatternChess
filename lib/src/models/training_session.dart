import 'blunder.dart';

class TrainingSession {
  final List<Blunder> blunders;
  int currentIndex;
  int currentCycle;
  int totalCorrect;
  int totalAttempted;

  TrainingSession({
    required this.blunders,
    this.currentIndex = 0,
    this.currentCycle = 0,
    this.totalCorrect = 0,
    this.totalAttempted = 0,
  });

  Blunder? get currentBlunder =>
      blunders.isNotEmpty && currentIndex < blunders.length
          ? blunders[currentIndex]
          : null;

  bool get isComplete => currentIndex >= blunders.length;

  double get recallRate =>
      totalAttempted > 0 ? totalCorrect / totalAttempted : 0.0;

  String get progressText => '${currentIndex + 1}/${blunders.length}';

  String get cycleText => 'LOOP ${currentCycle + 1}/7';

  void recordCorrect() {
    totalCorrect++;
    totalAttempted++;
  }

  void recordIncorrect() {
    totalAttempted++;
  }

  void advance() {
    currentIndex++;
  }

  void startNextCycle() {
    currentCycle++;
    currentIndex = 0;
  }
}
