import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../utils/winning_chances.dart';

class WinningChancesDisplay extends StatelessWidget {
  final int evalBefore;
  final int evalAfter;
  final String sideToMove;

  const WinningChancesDisplay({
    super.key,
    required this.evalBefore,
    required this.evalAfter,
    required this.sideToMove,
  });

  @override
  Widget build(BuildContext context) {
    final winBefore = WinningChances.winPercent(evalBefore).round();
    final winAfter = WinningChances.winPercent(-evalAfter).round();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.surfaceLight,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text.rich(
        TextSpan(
          style: const TextStyle(fontSize: 13, fontFamily: 'monospace'),
          children: [
            const TextSpan(
              text: 'Win chance: ',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
            TextSpan(
              text: '$winBefore%',
              style: const TextStyle(
                color: AppTheme.correct,
                fontWeight: FontWeight.bold,
              ),
            ),
            const TextSpan(
              text: ' → ',
              style: TextStyle(color: AppTheme.textSecondary),
            ),
            TextSpan(
              text: '$winAfter%',
              style: const TextStyle(
                color: AppTheme.incorrect,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
