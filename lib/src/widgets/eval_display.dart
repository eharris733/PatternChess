import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class EvalDisplay extends StatelessWidget {
  final int scoreCp;

  const EvalDisplay({super.key, required this.scoreCp});

  @override
  Widget build(BuildContext context) {
    final isPositive = scoreCp >= 0;
    final displayScore = scoreCp.abs() >= 10000
        ? 'M${(10000 - scoreCp.abs()).abs()}'
        : '${isPositive ? '+' : '-'}${(scoreCp.abs() / 100).toStringAsFixed(1)}';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: isPositive
            ? Colors.white.withValues(alpha: 0.9)
            : Colors.black.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        displayScore,
        style: TextStyle(
          color: isPositive ? Colors.black : Colors.white,
          fontSize: 16,
          fontWeight: FontWeight.bold,
          fontFamily: 'monospace',
        ),
      ),
    );
  }
}
